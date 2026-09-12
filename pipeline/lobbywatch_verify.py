"""Corroborate Lobbywatch interest candidates against official Parliament data."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import copy
import hashlib
import re
import unicodedata
from pathlib import Path

from pipeline.build import project, require
from pipeline.json_store import read_dataset, write_dataset
from pipeline.parliament import BASE_URL, Client, atomic_json, encode, request_url


SOURCE = {
    "id": "ch-parliament",
    "name": "Swiss Parliament — public web services",
    "type": "official",
    "url": BASE_URL + "/",
}
AUTOMATIC_REVIEWER = "automatic:ch-parliament-official-api"


def canonical_name(value):
    """Normalize presentation differences, but never perform fuzzy matching."""
    if not isinstance(value, str) or not value.strip():
        return None
    value = unicodedata.normalize("NFKD", value).casefold()
    value = "".join(character for character in value if not unicodedata.combining(character))
    value = value.replace("&", " und ")
    value = re.sub(r"[^\w]+", " ", value, flags=re.UNICODE)
    return " ".join(value.split()) or None


def concern_predicate(concern):
    """Map explicit Parliament role codes to the deliberately small ontology."""
    function = canonical_name(concern.get("function"))
    organisation_type = canonical_name(concern.get("organizationType"))
    if function in {"p", "pras", "prasident in", "co pras", "co prasident in"}:
        return "PRESIDENT_OF"
    if function in {"vp", "vizepras", "vizeprasident in"}:
        return "VICE_PRESIDENT_OF"
    if function in {"gf", "geschaftsfuhrer in"}:
        return "EMPLOYED_BY"
    if function in {"gs", "gesellschafter in"}:
        return "SHAREHOLDER_OF"
    if function == "m" and organisation_type in {"vr", "v", "sr"}:
        return "BOARD_MEMBER_OF"
    if function == "m":
        return "HAS_MANDATE_AT"
    return None


def _timestamp(record):
    value = record.get("updated")
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is not None:
                return value
        except ValueError:
            pass
    return datetime.now(timezone.utc).isoformat()


def fetch_official_concerns(person_ids, archive, *, workers=4, interval=0.2, client=None):
    """Fetch current councillor details directly from the official API."""
    require(1 <= workers <= 8, "workers must be between 1 and 8")
    client = client or Client(archive, interval=interval)
    client.check_robots()
    results = {}

    def fetch(identifier):
        record = client.fetch(f"councillors/{identifier}", "de", refresh=True)
        require(record.get("id") == identifier, f"official councillor ID mismatch: {identifier}")
        require(isinstance(record.get("concerns"), list), f"official councillor {identifier} has no concerns array")
        require(all(isinstance(item, dict) for item in record["concerns"]),
                f"official councillor {identifier} has an invalid concerns array")
        return record

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch, identifier): identifier for identifier in sorted(set(person_ids))}
        for future in as_completed(futures):
            identifier = futures[future]
            results[identifier] = future.result()
    return results


def corroborate(imported_path, output_path, official_records, report_path=None, markdown_path=None):
    """Generate official VERIFIED claims for unique exact candidate matches."""
    imported_path, output_path = Path(imported_path), Path(output_path)
    imported = read_dataset(imported_path)
    previous = read_dataset(output_path) if output_path.exists() else {
        "schema_version": 1, "sources": [], "documents": [], "entities": [], "claims": [],
    }
    previous_claims = {row["id"]: row for row in previous.get("claims", [])}
    previous_documents = {row["id"]: row for row in previous.get("documents", [])}
    candidates = [claim for claim in imported.get("claims", [])
                  if claim.get("status") == "PENDING_REVIEW"
                  and str(claim.get("lineage_id", "")).startswith("lobbywatch:interests:")
                  and claim.get("valid_to") is None]
    imported_entities = {row["id"]: row for row in imported.get("entities", [])}

    candidates_by_person = {}
    for claim in candidates:
        target = imported_entities.get(claim.get("object_id"), {})
        names = {target.get("name")}
        names.update((target.get("names") or {}).values())
        for name in names:
            normalized = canonical_name(name)
            if normalized:
                key = (claim["subject_id"], normalized, claim["predicate"])
                candidates_by_person.setdefault(key, []).append(claim)

    entities, documents, claims = {}, {}, {}
    matched_candidates = set()
    official_concerns = 0
    unsupported_roles = 0
    unmatched_official = []
    ambiguous = []

    for biography_id, record in sorted(official_records.items()):
        person_id = f"parliament:person:{biography_id}"
        require(person_id in imported_entities, f"official person has no Lobbywatch candidate entity: {person_id}")
        revision = _timestamp(record)
        excerpts = []
        person_claims = []
        mapped_concerns = []
        official_key_counts = {}
        for concern in record["concerns"]:
            official_concerns += 1
            name = concern.get("name")
            normalized = canonical_name(name)
            predicate = concern_predicate(concern)
            if predicate is None:
                unsupported_roles += 1
                continue
            key = (normalized, predicate)
            mapped_concerns.append((concern, name, normalized, predicate, key))
            official_key_counts[key] = official_key_counts.get(key, 0) + 1

        for concern, name, normalized, predicate, official_key in mapped_concerns:
            if official_key_counts[official_key] != 1:
                ambiguous.append({
                    "person_id": person_id, "organisation": name, "predicate": predicate,
                    "reason": "duplicate official organization and role",
                })
                continue
            matches = candidates_by_person.get((person_id, normalized, predicate), [])
            # Candidate aliases can create the same row more than once.
            matches = list({item["id"]: item for item in matches}.values())
            if len(matches) != 1:
                sample = {"person_id": person_id, "organisation": name, "predicate": predicate}
                if matches:
                    sample["candidate_ids"] = sorted(item["id"] for item in matches)
                    ambiguous.append(sample)
                else:
                    unmatched_official.append(sample)
                continue
            candidate = matches[0]
            if candidate["id"] in matched_candidates:
                ambiguous.append({
                    "person_id": person_id, "organisation": name, "predicate": predicate,
                    "candidate_ids": [candidate["id"]], "reason": "candidate matched multiple official rows",
                })
                continue
            matched_candidates.add(candidate["id"])
            excerpt = encode({key: concern.get(key) for key in
                              ("name", "organizationType", "function", "agency", "type")
                              if key in concern})
            excerpts.append(excerpt)
            identity = encode([person_id, candidate["object_id"], predicate, excerpt])
            identifier = "parliament:concern:" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
            person_claims.append({
                "id": identifier,
                "subject_id": person_id,
                "object_id": candidate["object_id"],
                "predicate": predicate,
                "connection_class": "DIRECT",
                "valid_from": None,
                "valid_to": None,
                "status": "VERIFIED",
                "reviewed_by": AUTOMATIC_REVIEWER,
                "reviewed_at": revision,
                "evidence_text": excerpt,
                "corroborates_claim_id": candidate["id"],
            })

        if not person_claims:
            continue
        document_text = "\n".join(excerpts)
        digest = hashlib.sha256(document_text.encode("utf-8")).hexdigest()
        document_id = f"parliament:concerns-document:{biography_id}:{digest[:16]}"
        url = request_url(f"councillors/{biography_id}", "de")
        documents[document_id] = {
            "id": document_id,
            "source_id": SOURCE["id"],
            "title": f"Official declared interests — {record.get('firstName', '')} {record.get('lastName', '')}".strip(),
            "url": url,
            "text": document_text,
            "raw_sha256": digest,
            "retrieved_at": revision,
            "extraction": "Exact fields selected from the official councillor concerns array",
        }
        if document_id in previous_documents:
            documents[document_id]["retrieved_at"] = previous_documents[document_id].get("retrieved_at", revision)
        entities[person_id] = copy.deepcopy(imported_entities[person_id])
        for claim in person_claims:
            claim["evidence"] = [{"document_id": document_id, "text": claim.pop("evidence_text")}]
            if claim["id"] in previous_claims and previous_claims[claim["id"]].get("status") == "VERIFIED":
                claim["reviewed_at"] = previous_claims[claim["id"]].get("reviewed_at", revision)
            entities[claim["object_id"]] = copy.deepcopy(imported_entities[claim["object_id"]])
            claims[claim["id"]] = claim

    # Preserve prior generated evidence as non-public history when an exact match disappears.
    previous_entities = {row["id"]: row for row in previous.get("entities", [])}
    retained_outdated = 0
    for prior in previous.get("claims", []):
        if prior["id"] in claims:
            continue
        retained = copy.deepcopy(prior)
        retained["status"] = "OUTDATED"
        retained.pop("reviewed_by", None)
        retained.pop("reviewed_at", None)
        claims[retained["id"]] = retained
        for key in ("subject_id", "object_id"):
            if key in retained and retained[key] not in entities and retained[key] in previous_entities:
                entities[retained[key]] = copy.deepcopy(previous_entities[retained[key]])
        for evidence in retained.get("evidence", []):
            identifier = evidence.get("document_id")
            if identifier not in documents and identifier in previous_documents:
                documents[identifier] = copy.deepcopy(previous_documents[identifier])
        retained_outdated += 1

    dataset = {
        "schema_version": 1,
        "sources": [SOURCE],
        "documents": [documents[key] for key in sorted(documents)],
        "entities": [entities[key] for key in sorted(entities)],
        "claims": [claims[key] for key in sorted(claims)],
    }
    project(dataset)
    write_dataset(output_path, dataset)

    unmatched_candidates = [claim for claim in candidates if claim["id"] not in matched_candidates]
    report = {
        "source": "ch-parliament",
        "status": "complete",
        "official_people": len(official_records),
        "official_concerns": official_concerns,
        "verified_exact_matches": len(matched_candidates),
        "pending_interest_candidates": len(candidates),
        "unmatched_interest_candidates": len(unmatched_candidates),
        "unmatched_official_concerns": len(unmatched_official),
        "ambiguous_matches": len(ambiguous),
        "unsupported_official_roles": unsupported_roles,
        "retained_outdated_claims": retained_outdated,
        "samples": {
            "unmatched_official": unmatched_official[:50],
            "ambiguous": ambiguous[:50],
            "unmatched_candidates": [item["id"] for item in unmatched_candidates[:50]],
        },
        "policy": "Only one-to-one exact normalized organization-name and role matches are automatically verified.",
    }
    report_path = Path(report_path) if report_path else output_path.with_name("verification-report.json")
    markdown_path = Path(markdown_path) if markdown_path else output_path.with_name("verification-report.md")
    atomic_json(report_path, report)
    markdown = "\n".join([
        "## Lobbywatch official corroboration",
        "",
        f"- **{report['verified_exact_matches']:,}** exact matches are publishable as verified official claims.",
        f"- **{report['unmatched_interest_candidates']:,}** current Lobbywatch interest candidates remain pending.",
        f"- **{report['ambiguous_matches']:,}** matches were ambiguous and were not published.",
        f"- **{report['unmatched_official_concerns']:,}** official concerns had no exact Lobbywatch organization/role match.",
        f"- **{report['unsupported_official_roles']:,}** official role codes are outside the supported deterministic mapping.",
        "",
        "Only exact one-to-one matches are automatic. Access badges and fuzzy name matches remain pending.",
        "",
    ])
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text(markdown, encoding="utf-8", newline="\n")
    return report
