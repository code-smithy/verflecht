"""Map explicit official parliamentary memberships to published research records.

The full, multilingual API archive remains authoritative for fields that do not
map to the graph. No votes or free-text disclosures become inferred affiliations.
"""

import gzip
import hashlib
import json
from pathlib import Path

from pipeline.build import project, require
from pipeline.parliament import BASE_URL, Client, atomic_json, encode, request_url

SOURCE = {"id": "ch-parliament", "name": "Swiss Parliament — public web services",
          "type": "official", "url": BASE_URL + "/"}


def cached_response(client, path, language, page=None):
    filename = client.cache_path(request_url(path, language, page))
    if not filename.exists():
        return None
    with gzip.open(filename, "rt", encoding="utf-8") as stream:
        response = json.load(stream)
    require(hashlib.sha256(response["body"].encode("utf-8")).hexdigest() == response["sha256"], f"corrupt cache: {filename}")
    return response, json.loads(response["body"])


def materialize(archive, output):
    archive = Path(archive)
    manifest = json.loads((archive / "manifest.json").read_text(encoding="utf-8"))
    client = Client(archive)
    entities, documents, claims = {}, {}, {}
    skipped = []
    skipped_affairs = []

    def entity(kind, identifier, name, language):
        key = f"parliament:{kind.lower()}:{identifier}"
        if key not in entities:
            entities[key] = {"id": key, "type": kind, "name": name or str(identifier), "names": {}}
        if name:
            entities[key]["names"][language] = name
            if language == "de" or entities[key]["name"] == str(identifier):
                entities[key]["name"] = name
        return key

    def process_person(row, response, language):
        person = entity("PERSON", row["id"], " ".join(filter(None, [row.get("firstName"), row.get("lastName")])), language)
        # Normalize one language into claims, preserving every translation in the
        # raw archive and multilingual entity names without duplicate edges.
        if language != "de":
            return
        evidence = []
        # These fields describe the active member at the time of retrieval,
        # not a dated membership history. Never borrow council term dates.
        if row.get("active") is True:
            for field, kind, prefix in (("party", "POLITICAL_PARTY", ""),
                                        ("faction", "ORGANISATION", "factions:")):
                identifier = row.get(field + "Id")
                name = row.get(field + "Name")
                if type(identifier) is not int or identifier <= 0 or not isinstance(name, str) or not name.strip():
                    skipped.append({"person": row["id"], "reason": f"{field} has no unambiguous ID/name"})
                    continue
                target_id = entity(kind, f"{prefix}{identifier}", name, language)
                excerpt = encode({"id": row["id"], "active": True,
                                  field + "Id": identifier, field + "Name": name})
                evidence.append(excerpt)
                identity = encode([person, target_id, "MEMBER_OF", None, None, None])
                claim_id = "parliament:claim:" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
                version = hashlib.sha256(excerpt.encode("utf-8")).hexdigest()[:16]
                doc_id = f"parliament:document:{row['id']}:{response['sha256'][:16]}"
                claims[f"{claim_id}:{version}"] = {
                    "id": f"{claim_id}:{version}", "subject_id": person, "object_id": target_id,
                    "predicate": "MEMBER_OF", "connection_class": "OFFICIAL",
                    "valid_from": None, "valid_to": None, "status": "VERIFIED",
                    "reviewed_by": "automatic:ch-parliament-official-api",
                    "reviewed_at": response["retrieved_at"],
                    "evidence": [{"document_id": doc_id, "text": excerpt}],
                    "imported_from": response["url"],
                }
        for field, kind, predicate in (("councilMemberships", "PARLIAMENT", "MEMBER_OF"),
                                        ("committeeMemberships", "COMMITTEE", "MEMBER_OF_COMMITTEE")):
            for membership in row.get(field, []) or []:
                target = membership.get("council" if kind == "PARLIAMENT" else "committee")
                if not isinstance(target, dict) or target.get("id") is None:
                    skipped.append({"person": row["id"], "reason": "membership has no target ID"})
                    continue
                target_id = entity(kind, target["id"], target.get("name"), language)
                start = (membership.get("entryDate") or "")[:10] or None
                end = (membership.get("leavingDate") or "")[:10] or None
                # Keep invalid or imprecise periods in raw data for review; do not
                # invent precision or silently repair source dates.
                from datetime import date
                try:
                    for value in (start, end):
                        if value:
                            require(date.fromisoformat(value).isoformat() == value, "invalid date")
                    require(not (start and end) or start <= end, "reversed period")
                except ValueError:
                    skipped.append({"person": row["id"], "reason": "invalid membership dates"})
                    continue
                excerpt = encode(membership)
                evidence.append(excerpt)
                identity = encode([person, target_id, predicate, start, end, membership.get("function")])
                claim_id = "parliament:claim:" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
                # A changed source excerpt produces a new candidate version.
                version = hashlib.sha256(excerpt.encode("utf-8")).hexdigest()[:16]
                doc_id = f"parliament:document:{row['id']}:{response['sha256'][:16]}"
                claims[f"{claim_id}:{version}"] = {
                    "id": f"{claim_id}:{version}", "subject_id": person, "object_id": target_id,
                    "predicate": predicate, "connection_class": "HISTORICAL" if end else "OFFICIAL",
                    "valid_from": start, "valid_to": end, "status": "VERIFIED",
                    "reviewed_by": "automatic:ch-parliament-official-api",
                    "reviewed_at": response["retrieved_at"],
                    "evidence": [{"document_id": doc_id, "text": excerpt}],
                    "imported_from": response["url"],
                }
        if evidence:
            doc_id = f"parliament:document:{row['id']}:{response['sha256'][:16]}"
            documents[doc_id] = {
                "id": doc_id, "source_id": SOURCE["id"],
                "title": f"Parliamentary memberships — {entities[person]['name']}",
                "url": response["url"], "text": "\n".join(evidence),
                "raw_sha256": response["sha256"], "retrieved_at": response["retrieved_at"],
                "extraction": "JSON serialization of source membership objects and explicit active-member affiliation fields",
            }

    # Collect IDs from cached lists, including partially downloaded collections.
    # Multiple historical terms share a person ID, so deduplicate requests only,
    # never the original historical rows.
    person_tasks = set()
    affair_tasks = set()
    kinds = {"committees": "COMMITTEE", "councils": "PARLIAMENT", "cantons": "LOCATION",
             "parties/historic": "POLITICAL_PARTY", "factions": "ORGANISATION",
             "factions/historic": "ORGANISATION", "departments": "GOVERNMENT_BODY",
             "departments/historic": "GOVERNMENT_BODY"}
    for key, progress in sorted(manifest.get("collections", {}).items()):
        language, path = key.split("/", 1)
        for page in range(1, progress["pages"] + 1):
            cached = cached_response(client, path, language, page)
            if cached is None:
                continue
            response, rows = cached
            for row in rows:
                if path.startswith("councillors"):
                    entity("PERSON", row["id"], " ".join(filter(None, [row.get("firstName"), row.get("lastName")])), language)
                    person_tasks.add((row["id"], language))
                elif path == "affairs" and type(row.get("id")) is int:
                    affair_tasks.add((row["id"], language))
                elif path in kinds:
                    # Organisation IDs in different upstream tables can overlap.
                    entity(kinds[path], f"{path.split('/')[0]}:{row['id']}" if kinds[path] in ("ORGANISATION", "GOVERNMENT_BODY") else row["id"], row.get("name") or row.get("abbreviation"), language)
    details_available = 0
    for identifier, language in sorted(person_tasks):
        cached = cached_response(client, f"councillors/{identifier}", language)
        if cached:
            response, row = cached
            process_person(row, response, language)
            details_available += 1
    affair_details_available = 0
    for identifier, language in sorted(affair_tasks):
        cached = cached_response(client, f"affairs/{identifier}", language)
        if cached is None:
            continue
        response, row = cached
        affair_details_available += 1
        title = row.get("title")
        if row.get("id") != identifier or not isinstance(title, str) or not title.strip():
            skipped_affairs.append({"affair": identifier, "reason": "missing title or mismatched ID"})
            continue
        affair = entity("PARLIAMENTARY_AFFAIR", identifier, title, language)
        if language != "de":
            continue
        # The author object may also contain faction context for a councillor.
        # Only an explicit author role is eligible; correspondents are not authors.
        roles = row.get("roles") if isinstance(row.get("roles"), list) else []
        author = row.get("author")
        candidates = ([author] if isinstance(author, dict) else []) + roles
        seen = set()
        for role in candidates:
            if not isinstance(role, dict) or role.get("type") not in ("author", "cosign"):
                continue
            predicate = "AUTHORED" if role["type"] == "author" else "CO_SIGNED"
            fields = [field for field in ("councillor", "committee") if role.get(field) is not None]
            if not fields and role.get("faction") is not None:
                fields = ["faction"]
            if len(fields) != 1:
                skipped_affairs.append({"affair": identifier, "reason": "unsupported or ambiguous author"})
                continue
            field = fields[0]
            if predicate == "CO_SIGNED" and field != "councillor":
                skipped_affairs.append({"affair": identifier, "reason": "unsupported co-signatory type"})
                continue
            target = role[field]
            if not isinstance(target, dict) or type(target.get("id")) is not int or target["id"] <= 0 or not isinstance(target.get("name"), str) or not target["name"].strip():
                skipped_affairs.append({"affair": identifier, "reason": "author has no explicit ID/name"})
                continue
            kind = {"councillor": "PERSON", "committee": "COMMITTEE", "faction": "ORGANISATION"}[field]
            target_key = f"factions:{target['id']}" if field == "faction" else target["id"]
            subject = f"parliament:{kind.lower()}:{target_key}"
            if (subject, predicate) in seen:
                continue
            seen.add((subject, predicate))
            # Preserve the existing councillor's canonical name when available.
            if subject not in entities:
                entity(kind, target_key, target["name"], language)
            excerpt = encode({"id": identifier, "title": title, "role": role})
            doc_id = f"parliament:affair-document:{identifier}:{response['sha256'][:16]}"
            identity = encode([subject, affair, predicate])
            claim_id = "parliament:claim:" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
            version = hashlib.sha256(excerpt.encode("utf-8")).hexdigest()[:16]
            claims[f"{claim_id}:{version}"] = {
                "id": f"{claim_id}:{version}", "subject_id": subject, "object_id": affair,
                "predicate": predicate, "connection_class": "OFFICIAL",
                "valid_from": None, "valid_to": None, "status": "VERIFIED",
                "reviewed_by": "automatic:ch-parliament-official-api",
                "reviewed_at": response["retrieved_at"],
                "evidence": [{"document_id": doc_id, "text": excerpt}],
                "imported_from": response["url"],
            }
            document = documents.setdefault(doc_id, {
                "id": doc_id, "source_id": SOURCE["id"], "title": title,
                "url": response["url"], "text": "", "raw_sha256": response["sha256"],
                "retrieved_at": response["retrieved_at"],
                "extraction": "JSON serialization of explicit affair author roles",
            })
            document["text"] += excerpt + "\n"
    dataset = {"schema_version": 1, "sources": [SOURCE], "documents": sorted(documents.values(), key=lambda row: row["id"]),
               "entities": sorted(entities.values(), key=lambda row: row["id"]), "claims": sorted(claims.values(), key=lambda row: row["id"])}
    project(dataset)
    atomic_json(output, dataset)
    report = {"source": SOURCE["id"], "archive_status": manifest["status"], "languages": manifest["languages"],
              "entities": len(entities), "documents": len(documents), "verified_claims": len(claims),
              "person_detail_responses": details_available, "skipped_memberships": skipped,
              "affair_detail_responses": affair_details_available, "skipped_affairs": skipped_affairs,
              "authorship_claims": sum(claim["predicate"] == "AUTHORED" for claim in claims.values()),
              "cosignatory_claims": sum(claim["predicate"] == "CO_SIGNED" for claim in claims.values()),
              "note": "Explicit memberships and affair authorship are automatically published. Party/faction and authorship dates are unknown. Votes and inferred affiliations are not published."}
    atomic_json(Path(output).with_name("normalization-report.json"), report)
    return report
