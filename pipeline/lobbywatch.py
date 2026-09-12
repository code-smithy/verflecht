"""Resumable Lobbywatch export download and conservative candidate projection."""

from datetime import date, datetime, timezone
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

from pipeline.build import project, require
from pipeline.json_store import read_dataset, write_dataset
from pipeline.parliament import atomic_json, encode


EXPORT_URL = "https://cms.lobbywatch.ch/sites/lobbywatch.ch/files/exports/lobbywatch_export_aggregated.json.zip"
EXPORT_FILENAME = "lobbywatch-export.zip"
DATA_MEMBER = "aggregated_essential_parlamentarier_nested.json"
USER_AGENT = "Verflecht/0.1 (public political research; https://github.com/code-smithy/verflecht)"
MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
MAX_MEMBER_BYTES = 256 * 1024 * 1024
SOURCE = {
    "id": "lobbywatch",
    "name": "Lobbywatch Switzerland — weekly data export",
    "type": "organisation",
    "url": "https://lobbywatch.ch/datenexport/",
    "license": "CC BY-SA 4.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_archive(path):
    """Validate the bounded public ZIP and return its canonical JSON member."""
    try:
        with zipfile.ZipFile(path) as archive:
            matches = [item for item in archive.infolist() if item.filename == DATA_MEMBER]
            require(len(matches) == 1, f"Lobbywatch export must contain exactly one {DATA_MEMBER}")
            member = matches[0]
            require(not member.flag_bits & 1, "Lobbywatch export member must not be encrypted")
            require(member.file_size <= MAX_MEMBER_BYTES, "Lobbywatch JSON export exceeds the size limit")
            with archive.open(member) as stream:
                prefix = stream.read(4).lstrip()
            require(prefix.startswith(b"["), "Lobbywatch JSON export must be an array")
            return member
    except (OSError, zipfile.BadZipFile) as error:
        raise ValueError(f"invalid Lobbywatch export: {error}") from error


def _saved_manifest(path):
    if not path.exists():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else {}


def download_export(archive, url=EXPORT_URL, opener=urlopen):
    """Download the weekly ZIP, resuming a retained partial response when possible."""
    archive = Path(archive)
    archive.mkdir(parents=True, exist_ok=True)
    destination = archive / EXPORT_FILENAME
    partial = archive / (EXPORT_FILENAME + ".part")
    manifest_path = archive / "manifest.json"
    previous = _saved_manifest(manifest_path)

    headers = {"User-Agent": USER_AGENT, "Accept": "application/zip"}
    current_valid = False
    if destination.exists() and previous.get("status") == "complete" and previous.get("url") == url:
        current_valid = sha256_file(destination) == previous.get("sha256")

    offset = partial.stat().st_size if partial.exists() else 0
    if offset:
        headers["Range"] = f"bytes={offset}-"
        if previous.get("etag"):
            headers["If-Range"] = previous["etag"]
    elif current_valid:
        if previous.get("etag"):
            headers["If-None-Match"] = previous["etag"]
        if previous.get("last_modified"):
            headers["If-Modified-Since"] = previous["last_modified"]
    atomic_json(manifest_path, {
        **previous, "source": "lobbywatch", "url": url, "status": "downloading",
        "partial_bytes": offset, "updated_at": utc_now(),
    })

    try:
        response = opener(Request(url, headers=headers), timeout=60)
    except HTTPError as error:
        if error.code == 304 and current_valid:
            atomic_json(manifest_path, {**previous, "checked_at": utc_now()})
            return _saved_manifest(manifest_path)
        raise

    with response:
        status = getattr(response, "status", None) or response.getcode()
        append = offset > 0 and status == 206
        if append:
            content_range = response.headers.get("Content-Range", "")
            require(content_range.startswith(f"bytes {offset}-"), "server returned an invalid resume range")
        else:
            offset = 0
        length = response.headers.get("Content-Length")
        if length is not None:
            require(offset + int(length) <= MAX_DOWNLOAD_BYTES, "Lobbywatch export exceeds the download size limit")
        written = offset
        with partial.open("ab" if append else "wb") as stream:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                require(written <= MAX_DOWNLOAD_BYTES, "Lobbywatch export exceeds the download size limit")
                stream.write(chunk)
        etag = response.headers.get("ETag")
        last_modified = response.headers.get("Last-Modified")

    validate_archive(partial)
    digest = sha256_file(partial)
    if destination.exists():
        old_digest = sha256_file(destination)
        if old_digest != digest:
            version = archive / "versions" / f"{old_digest}.zip"
            version.parent.mkdir(parents=True, exist_ok=True)
            if not version.exists():
                shutil.copyfile(destination, version)
    os.replace(partial, destination)
    state = {
        "source": "lobbywatch", "url": url, "status": "complete",
        "sha256": digest, "bytes": destination.stat().st_size,
        "etag": etag, "last_modified": last_modified,
        "retrieved_at": utc_now(), "updated_at": utc_now(),
    }
    atomic_json(manifest_path, state)
    return state


def _name(record):
    for key in ("name_de", "name", "anzeige_name_de", "anzeige_name"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _identifier(value):
    return value if type(value) is int and value > 0 else None


def _date(value):
    if value in (None, ""):
        return None
    require(isinstance(value, str), "relationship date must be text")
    parsed = date.fromisoformat(value)
    require(parsed.isoformat() == value, "relationship date must use YYYY-MM-DD")
    return value


def _organisation_type(record):
    legal_form = record.get("rechtsform")
    if legal_form in {"AG", "GmbH", "KG", "Einzelunternehmen", "Genossenschaft"}:
        return "COMPANY"
    if legal_form == "Verein":
        return "ASSOCIATION"
    return "ORGANISATION"


def _predicate(record):
    function = record.get("funktion_im_gremium")
    if function == "praesident":
        return "PRESIDENT_OF"
    if function == "vizepraesident":
        return "VICE_PRESIDENT_OF"
    return {
        "vorstand": "BOARD_MEMBER_OF",
        "geschaeftsfuehrend": "EMPLOYED_BY",
        "taetig": "EMPLOYED_BY",
        "gesellschafter": "SHAREHOLDER_OF",
    }.get(record.get("art"), "HAS_MANDATE_AT")


def _evidence(record, subject_key):
    fields = (
        "id", subject_key, "organisation_id", "art", "funktion_im_gremium",
        "deklarationstyp", "status", "hauptberuflich", "behoerden_vertreter",
        "beschreibung", "beschreibung_fr", "quelle_url", "quelle", "von", "bis",
        "autorisiert_datum", "freigabe_datum", "aktiv",
    )
    result = {key: record.get(key) for key in fields if key in record}
    organisation = record.get("organisation")
    if isinstance(organisation, dict):
        result["organisation"] = {
            key: organisation.get(key)
            for key in ("id", "name_de", "name_fr", "rechtsform", "uid", "homepage")
            if key in organisation
        }
    return encode(result)


def load_records(path):
    validate_archive(path)
    with zipfile.ZipFile(path) as archive, archive.open(DATA_MEMBER) as raw:
        records = json.load(io.TextIOWrapper(raw, encoding="utf-8"))
    require(isinstance(records, list), "Lobbywatch export must be an array")
    require(all(isinstance(item, dict) for item in records), "Lobbywatch parliamentarians must be objects")
    return records


def materialize(archive, output):
    """Create PENDING_REVIEW claims; this organisation source never self-verifies."""
    archive, output = Path(archive), Path(output)
    export = archive / EXPORT_FILENAME
    records = load_records(export)
    manifest = _saved_manifest(archive / "manifest.json")
    snapshot_sha = sha256_file(export)
    retrieved_at = manifest.get("retrieved_at") or utc_now()
    previous = read_dataset(output) if output.exists() else {
        "schema_version": 1, "sources": [], "documents": [], "entities": [], "claims": [],
    }
    # A cold CI cache can download an unchanged export again. Preserve the first
    # observation time so a byte-identical snapshot does not create a noisy PR.
    same_snapshot_times = {
        item.get("retrieved_at") for item in previous.get("documents", [])
        if item.get("raw_sha256") == snapshot_sha and isinstance(item.get("retrieved_at"), str)
    }
    if same_snapshot_times:
        retrieved_at = min(same_snapshot_times)
    previous_documents = {item["id"]: item for item in previous.get("documents", [])}
    previous_entities = {item["id"]: item for item in previous.get("entities", [])}
    previous_by_lineage = {}
    for item in previous.get("claims", []):
        lineage = item.get("lineage_id")
        if isinstance(lineage, str):
            previous_by_lineage.setdefault(lineage, []).append(item)
    for versions in previous_by_lineage.values():
        versions.sort(key=lambda item: (item.get("snapshot_retrieved_at", ""), item["id"]))
    entities, documents, claims = {}, {}, {}
    skipped = []
    counts = {"interests": 0, "badges": 0, "badge_mandates": 0}

    def entity(identifier, name, kind, names=None, **metadata):
        if identifier not in entities:
            entities[identifier] = {"id": identifier, "name": name, "type": kind}
        if names:
            entities[identifier]["names"] = {key: value for key, value in names.items() if value}
        entities[identifier].update(metadata)
        return identifier

    def organisation(record):
        identifier = _identifier(record.get("id"))
        name = _name(record)
        if identifier is None or name is None:
            return None
        return entity(
            f"lobbywatch:organisation:{identifier}", name, _organisation_type(record),
            names={"de": record.get("name_de"), "fr": record.get("name_fr"), "it": record.get("name_it")},
            lobbywatch_id=identifier, uid=record.get("uid"), wikidata_qid=record.get("wikidata_qid"),
        )

    def relationship(kind, record, subject, target, subject_key, document_id, excerpts):
        record_id = _identifier(record.get("id"))
        if record_id is None:
            skipped.append({"kind": kind, "reason": "missing positive numeric ID"})
            return
        try:
            start, end = _date(record.get("von")), _date(record.get("bis"))
        except (TypeError, ValueError) as error:
            skipped.append({"kind": kind, "id": record_id, "reason": str(error)})
            return
        excerpt = _evidence(record, subject_key)
        excerpts.append(excerpt)
        classification = "HISTORICAL" if end else "OFFICIAL" if record.get("behoerden_vertreter") == "J" else "DIRECT"
        predicate = _predicate(record)
        lineage = f"lobbywatch:{kind}:{record_id}"
        identity = encode([subject, target, predicate, start, end, excerpt])
        claim_id = f"lobbywatch:claim:{kind}:{record_id}:{hashlib.sha256(identity.encode()).hexdigest()[:16]}"
        versions = previous_by_lineage.get(lineage, [])
        if any(item["id"] == claim_id for item in versions) and versions[-1]["id"] != claim_id:
            # A source value can revert to an older value. Give that occurrence
            # a fresh ID rather than creating a supersession cycle.
            claim_id += f":{snapshot_sha[:8]}"
        claims[claim_id] = {
            "id": claim_id, "subject_id": subject, "object_id": target,
            "predicate": predicate, "connection_class": classification,
            "valid_from": start, "valid_to": end, "status": "PENDING_REVIEW",
            "evidence": [{"document_id": document_id, "text": excerpt}],
            "imported_from": EXPORT_URL, "retrieved_at": retrieved_at,
            "lineage_id": lineage, "snapshot_retrieved_at": retrieved_at,
        }
        older = [item for item in versions if item["id"] != claim_id]
        if older:
            claims[claim_id]["supersedes_id"] = older[-1]["id"]
        counts[kind] += 1

    for parliamentarian in records:
        lobbywatch_id = _identifier(parliamentarian.get("id"))
        biography_id = _identifier(parliamentarian.get("parlament_biografie_id"))
        person_name = _name(parliamentarian)
        if lobbywatch_id is None or biography_id is None or person_name is None:
            skipped.append({"kind": "parliamentarian", "id": parliamentarian.get("id"),
                            "reason": "missing Lobbywatch ID, Parliament biography ID, or name"})
            continue
        person = entity(
            f"parliament:person:{biography_id}", person_name, "PERSON",
            names={"de": parliamentarian.get("name_de"), "fr": parliamentarian.get("name_fr")},
            lobbywatch_id=lobbywatch_id, parliament_biography_id=biography_id,
        )
        document_id = f"lobbywatch:document:{lobbywatch_id}:{snapshot_sha[:16]}"
        excerpts = []

        for interest in parliamentarian.get("interessenbindungen") or []:
            if not isinstance(interest, dict) or not isinstance(interest.get("organisation"), dict):
                skipped.append({"kind": "interests", "id": getattr(interest, "get", lambda _key: None)("id"),
                                "reason": "missing nested organisation"})
                continue
            target = organisation(interest["organisation"])
            if target is None:
                skipped.append({"kind": "interests", "id": interest.get("id"),
                                "reason": "organisation has no positive ID or name"})
                continue
            relationship("interests", interest, person, target, "parlamentarier_id", document_id, excerpts)

        for badge in parliamentarian.get("zutrittsberechtigungen") or []:
            if not isinstance(badge, dict):
                skipped.append({"kind": "badges", "reason": "badge is not an object"})
                continue
            badge_id = _identifier(badge.get("zutrittsberechtigung_id") or badge.get("id"))
            badge_person_id = _identifier(badge.get("person_id"))
            badge_name = _name(badge)
            if badge_id is None or badge_person_id is None or badge_name is None:
                skipped.append({"kind": "badges", "id": badge.get("id"),
                                "reason": "missing badge ID, person ID, or name"})
                continue
            badge_person = entity(
                f"lobbywatch:person:{badge_person_id}", badge_name, "PERSON",
                names={"de": badge.get("name_de"), "fr": badge.get("name_fr")},
                lobbywatch_id=badge_person_id,
            )
            try:
                start, end = _date(badge.get("von")), _date(badge.get("bis"))
            except (TypeError, ValueError) as error:
                skipped.append({"kind": "badges", "id": badge_id, "reason": str(error)})
                continue
            badge_excerpt = encode({
                key: badge.get(key)
                for key in ("zutrittsberechtigung_id", "parlamentarier_id", "person_id", "name_de", "name_fr",
                            "funktion", "funktion_fr", "von", "bis", "autorisiert_datum", "freigabe_datum")
                if key in badge
            })
            excerpts.append(badge_excerpt)
            lineage = f"lobbywatch:badge:{badge_id}"
            identity = encode([person, badge_person, "ISSUED_ACCESS_BADGE_TO", start, end, badge_excerpt])
            claim_id = f"lobbywatch:claim:badge:{badge_id}:{hashlib.sha256(identity.encode()).hexdigest()[:16]}"
            versions = previous_by_lineage.get(lineage, [])
            if any(item["id"] == claim_id for item in versions) and versions[-1]["id"] != claim_id:
                claim_id += f":{snapshot_sha[:8]}"
            claims[claim_id] = {
                "id": claim_id, "subject_id": person, "object_id": badge_person,
                "predicate": "ISSUED_ACCESS_BADGE_TO",
                "connection_class": "HISTORICAL" if end else "DIRECT",
                "valid_from": start, "valid_to": end, "status": "PENDING_REVIEW",
                "evidence": [{"document_id": document_id, "text": badge_excerpt}],
                "imported_from": EXPORT_URL, "retrieved_at": retrieved_at,
                "lineage_id": lineage, "snapshot_retrieved_at": retrieved_at,
            }
            older = [item for item in versions if item["id"] != claim_id]
            if older:
                claims[claim_id]["supersedes_id"] = older[-1]["id"]
            counts["badges"] += 1
            for mandate in badge.get("mandate") or []:
                if not isinstance(mandate, dict) or not isinstance(mandate.get("organisation"), dict):
                    skipped.append({"kind": "badge_mandates", "reason": "missing nested organisation"})
                    continue
                target = organisation(mandate["organisation"])
                if target is None:
                    skipped.append({"kind": "badge_mandates", "id": mandate.get("id"),
                                    "reason": "organisation has no positive ID or name"})
                    continue
                relationship("badge_mandates", mandate, badge_person, target, "person_id", document_id, excerpts)

        if excerpts:
            documents[document_id] = {
                "id": document_id, "source_id": SOURCE["id"],
                "title": f"Lobbywatch relationships — {person_name}",
                "url": EXPORT_URL, "text": "\n".join(excerpts),
                "raw_sha256": snapshot_sha, "retrieved_at": retrieved_at,
                "extraction": "Selected fields serialized from the weekly aggregated Lobbywatch JSON export",
                "license": SOURCE["license"], "license_url": SOURCE["license_url"],
            }

    retained_outdated = 0
    for prior in previous.get("claims", []):
        if prior["id"] in claims:
            continue
        retained = copy.deepcopy(prior)
        retained["status"] = "OUTDATED"
        retained.pop("reviewed_by", None)
        retained.pop("reviewed_at", None)
        retained.setdefault("missing_from_snapshot", snapshot_sha)
        claims[retained["id"]] = retained
        for key in ("subject_id", "object_id"):
            identifier = retained[key]
            if identifier not in entities and identifier in previous_entities:
                entities[identifier] = copy.deepcopy(previous_entities[identifier])
        for evidence in retained.get("evidence", []):
            identifier = evidence.get("document_id")
            if identifier not in documents and identifier in previous_documents:
                documents[identifier] = copy.deepcopy(previous_documents[identifier])
        retained_outdated += 1

    dataset = {
        "schema_version": 1, "sources": [SOURCE],
        "documents": [documents[key] for key in sorted(documents)],
        "entities": [entities[key] for key in sorted(entities)],
        "claims": [claims[key] for key in sorted(claims)],
    }
    project(dataset)
    write_dataset(output, dataset)
    report = {
        "source": "lobbywatch", "status": "complete", "snapshot_sha256": snapshot_sha,
        "retrieved_at": retrieved_at, "parliamentarians": len(records),
        "entities": len(entities), "documents": len(documents),
        "candidate_claims": len(claims), **counts,
        "retained_outdated_claims": retained_outdated,
        "skipped": skipped,
        "note": "All Lobbywatch relationships are PENDING_REVIEW; none are automatically published.",
    }
    atomic_json(output.with_name("normalization-report.json"), report)
    return report
