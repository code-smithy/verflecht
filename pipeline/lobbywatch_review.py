"""Promote explicit Lobbywatch review decisions into authored research."""

import copy
from datetime import datetime, timezone
from pathlib import Path

from pipeline.build import merge_research, project, require
from pipeline.json_store import read_dataset, write_dataset


DECISIONS = ("VERIFIED", "REJECTED")


def review_claims(imported_path, authored_path, claim_ids, decision, reviewer, reviewed_at=None):
    require(decision in DECISIONS, f"decision must be one of {', '.join(DECISIONS)}")
    require(isinstance(reviewer, str) and reviewer.strip(), "reviewer must be non-empty")
    require(claim_ids and len(claim_ids) == len(set(claim_ids)), "claim IDs must be non-empty and unique")
    imported_path, authored_path = Path(imported_path), Path(authored_path)
    imported = read_dataset(imported_path)
    authored = read_dataset(authored_path)
    imported_rows = {key: {item["id"]: item for item in imported[key]}
                     for key in ("sources", "documents", "entities", "claims")}
    authored_rows = {key: {item["id"]: copy.deepcopy(item) for item in authored[key]}
                     for key in ("sources", "documents", "entities", "claims")}
    timestamp = reviewed_at or datetime.now(timezone.utc).isoformat()

    for claim_id in claim_ids:
        require(claim_id in imported_rows["claims"], f"unknown Lobbywatch claim: {claim_id}")
        require(claim_id not in authored_rows["claims"], f"claim already has an authored decision: {claim_id}")
        candidate = copy.deepcopy(imported_rows["claims"][claim_id])
        require(candidate.get("status") in ("PENDING_REVIEW", "OUTDATED"),
                f"claim is not reviewable: {claim_id}")
        for entity_id in (candidate["subject_id"], candidate["object_id"]):
            if entity_id not in authored_rows["entities"]:
                authored_rows["entities"][entity_id] = copy.deepcopy(imported_rows["entities"][entity_id])
        for evidence in candidate.get("evidence", []):
            document_id = evidence["document_id"]
            document = imported_rows["documents"][document_id]
            source_id = document["source_id"]
            if source_id not in authored_rows["sources"]:
                authored_rows["sources"][source_id] = copy.deepcopy(imported_rows["sources"][source_id])
            if document_id not in authored_rows["documents"]:
                authored_rows["documents"][document_id] = copy.deepcopy(document)
        candidate["status"] = decision
        candidate["reviewed_by"] = reviewer.strip()
        candidate["reviewed_at"] = timestamp
        authored_rows["claims"][claim_id] = candidate

    result = {
        "schema_version": 1,
        **{key: [authored_rows[key][identifier] for identifier in sorted(authored_rows[key])]
           for key in ("sources", "documents", "entities", "claims")},
    }
    # Validate the exact merged state before atomically changing authored data.
    project(merge_research(result, [imported]))
    write_dataset(authored_path, result, indent=2)
    return {"decision": decision, "reviewer": reviewer.strip(), "claims": list(claim_ids)}
