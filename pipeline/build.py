"""Validate local research records and project only reviewed, evidenced claims."""

import hashlib
import json
import os
import tempfile
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
ONTOLOGY = json.loads((ROOT / "data/ontology.json").read_text(encoding="utf-8"))


class ValidationError(ValueError):
    """An actionable error in the local dataset."""


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def string(record, key, context):
    value = record.get(key)
    require(isinstance(value, str) and bool(value.strip()), f"{context}.{key}: expected non-empty text")
    return value.strip()


def enum(record, key, values, context):
    value = string(record, key, context)
    require(value in values, f"{context}.{key}: expected one of {', '.join(values)}")
    return value


def url(record, key, context):
    value = string(record, key, context)
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme in ("http", "https")
            and parsed.hostname
            and not parsed.username
            and not parsed.password
            and not any(character.isspace() or ord(character) < 32 for character in value)
        )
        _ = parsed.port
    except ValueError:
        valid = False
    require(valid, f"{context}.{key}: expected an http(s) URL without credentials")
    return value


def optional_date(record, key, context):
    value = record.get(key)
    if value is None:
        return None
    require(isinstance(value, str), f"{context}.{key}: expected YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(value)
        require(parsed.isoformat() == value, f"{context}.{key}: expected YYYY-MM-DD")
    except ValueError as error:
        raise ValidationError(f"{context}.{key}: expected YYYY-MM-DD") from error
    return value


def collection(dataset, key):
    rows = dataset.get(key)
    require(isinstance(rows, list), f"{key}: expected an array")
    indexed = {}
    for index, row in enumerate(rows):
        context = f"{key}[{index}]"
        require(isinstance(row, dict), f"{context}: expected an object")
        identifier = string(row, "id", context)
        require(identifier not in indexed, f"{context}: duplicate id {identifier}")
        indexed[identifier] = row
    return indexed


def reference(record, key, records, context):
    identifier = string(record, key, context)
    require(identifier in records, f"{context}.{key}: unknown id {identifier}")
    return identifier


def project(dataset):
    """No mutation, network calls, or automatic verification; deterministic output."""
    require(isinstance(dataset, dict), "dataset: expected an object")
    require(type(dataset.get("schema_version")) is int and dataset["schema_version"] == 1, "schema_version: expected 1")
    sources = collection(dataset, "sources")
    documents = collection(dataset, "documents")
    entities = collection(dataset, "entities")
    claims = collection(dataset, "claims")

    public_sources = {}
    for identifier, source in sources.items():
        context = f"source {identifier}"
        public_sources[identifier] = {
            "id": identifier,
            "name": string(source, "name", context),
            "type": enum(source, "type", ONTOLOGY["source_types"], context),
            "url": url(source, "url", context),
        }

    normalized_documents = {}
    for identifier, document in documents.items():
        context = f"document {identifier}"
        source_id = reference(document, "source_id", sources, context)
        title = string(document, "title", context)
        document_url = url(document, "url", context)
        string(document, "text", context)
        # Preserve exact text: evidence matching and hashes refer to the authored version.
        content_hash = hashlib.sha256(document["text"].encode("utf-8")).hexdigest()
        normalized_documents[identifier] = {
            "id": identifier, "title": title, "url": document_url,
            "source_id": source_id, "content_hash": content_hash,
        }

    public_entities = {}
    for identifier, entity in entities.items():
        context = f"entity {identifier}"
        public_entities[identifier] = {
            "id": identifier,
            "name": string(entity, "name", context),
            "type": enum(entity, "type", ONTOLOGY["entity_types"], context),
        }

    edges = {}
    predecessors = {}
    for identifier, claim in claims.items():
        context = f"claim {identifier}"
        subject = reference(claim, "subject_id", entities, context)
        target = reference(claim, "object_id", entities, context)
        predicate = enum(claim, "predicate", ONTOLOGY["predicates"], context)
        classification = enum(claim, "connection_class", ONTOLOGY["connection_classes"], context)
        status = enum(claim, "status", ONTOLOGY["verification_statuses"], context)
        start = optional_date(claim, "valid_from", context)
        end = optional_date(claim, "valid_to", context)
        require(not (start and end) or start <= end, f"{context}: valid_from must not follow valid_to")
        require(classification != "HISTORICAL" or end is not None, f"{context}: historical claims need valid_to")
        if predicate in ("PARTICIPATED_IN", "SPOKE_AT"):
            require(public_entities[target]["type"] == "EVENT", f"{context}: {predicate} requires an EVENT object")
        if predicate == "ORGANISED_BY":
            require(public_entities[subject]["type"] == "EVENT", f"{context}: ORGANISED_BY requires an EVENT subject")
        if claim.get("supersedes_id") is not None:
            predecessors[identifier] = reference(claim, "supersedes_id", claims, context)

        evidence_rows = claim.get("evidence", [])
        require(isinstance(evidence_rows, list), f"{context}.evidence: expected an array")
        evidence = []
        for index, item in enumerate(evidence_rows):
            evidence_context = f"{context}.evidence[{index}]"
            require(isinstance(item, dict), f"{evidence_context}: expected an object")
            document_id = reference(item, "document_id", documents, evidence_context)
            excerpt = string(item, "text", evidence_context)
            require(excerpt in documents[document_id]["text"], f"{evidence_context}: excerpt not found in document text")
            document = normalized_documents[document_id]
            evidence.append({"text": excerpt, "document": document, "source": public_sources[document["source_id"]]})

        if status == "VERIFIED":
            require(bool(evidence), f"{context}: VERIFIED requires evidence")
            string(claim, "reviewed_by", context)
            reviewed_at = string(claim, "reviewed_at", context)
            try:
                timestamp = datetime.fromisoformat(reviewed_at.replace("Z", "+00:00"))
                require(timestamp.tzinfo is not None, f"{context}.reviewed_at: timezone required")
            except ValueError as error:
                raise ValidationError(f"{context}.reviewed_at: expected ISO timestamp with timezone") from error
            edges[identifier] = {
                "id": identifier, "subject_id": subject, "object_id": target,
                "predicate": predicate, "connection_class": classification,
                "valid_from": start, "valid_to": end, "evidence": evidence,
            }

    for identifier in predecessors:
        seen = set()
        current = identifier
        while current in predecessors:
            require(current not in seen, f"claim {identifier}: supersession cycle")
            seen.add(current)
            current = predecessors[current]

    superseded = set()
    direct_replacements = {}
    for identifier in edges:
        if identifier in predecessors:
            previous = predecessors[identifier]
            require(previous not in direct_replacements, f"claim {previous}: multiple verified replacements")
            direct_replacements[previous] = identifier
        current = identifier
        while current in predecessors:
            current = predecessors[current]
            superseded.add(current)
    visible = [edge for identifier, edge in sorted(edges.items()) if identifier not in superseded]
    node_ids = {edge[key] for edge in visible for key in ("subject_id", "object_id")}
    return {
        "schema_version": 1,
        "nodes": [public_entities[identifier] for identifier in sorted(node_ids)],
        "edges": visible,
    }


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"JSON: duplicate key {key}")
        result[key] = value
    return result


def build(input_path, output_path, check=False):
    input_path, output_path = Path(input_path).resolve(), Path(output_path).resolve()
    require(input_path != output_path, "input and output paths must differ")
    dataset = json.loads(input_path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_keys)
    graph = project(dataset)
    serialized = json.dumps(graph, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if check:
        require(output_path.is_file() and output_path.read_bytes() == serialized.encode("utf-8"), "generated graph is missing or stale; run python build_data_pipeline.py")
        return graph
    # Validate everything before touching the last successful public export.
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=output_path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(serialized)
        os.replace(temporary, output_path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return graph
