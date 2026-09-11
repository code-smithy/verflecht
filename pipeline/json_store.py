"""Deterministic JSON datasets with bounded, content-addressed collection parts."""

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

MAX_BYTES = 32 * 1024 * 1024
FORMAT = "json-parts-v1"


class ValidationError(ValueError):
    """An actionable error in the local dataset."""


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"JSON: duplicate key {key}")
        result[key] = value
    return result


def encoded(value, indent=None):
    options = {"indent": indent} if indent else {"separators": (",", ":")}
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, **options) + "\n").encode("utf-8")


def read_dataset(path):
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_keys)
    if not isinstance(data, dict) or data.get("storage") != FORMAT:
        return data
    require(set(data) == {"schema_version", "storage", "parts"}, "invalid dataset manifest")
    require(isinstance(data["parts"], dict), "invalid dataset parts")
    result = {"schema_version": data["schema_version"]}
    for key, names in data["parts"].items():
        require(key not in ("schema_version", "storage", "parts"), "invalid collection name")
        require(isinstance(names, list) and all(isinstance(name, str) for name in names)
                and len(names) == len(set(names)), "invalid or duplicate parts")
        result[key] = []
        for name in names:
            require(isinstance(name, str) and re.fullmatch(re.escape(path.stem) + r"\.parts/[a-f0-9]{64}\.json", name), "invalid dataset part path")
            payload = (path.parent / name).read_bytes()
            require(hashlib.sha256(payload).hexdigest() == Path(name).stem, f"corrupt dataset part: {name}")
            rows = json.loads(payload, object_pairs_hook=unique_keys)
            require(isinstance(rows, list), "dataset part must be an array")
            result[key].extend(rows)
    return result


def write_dataset(path, data, *, indent=None, check=False, max_bytes=MAX_BYTES):
    """Keep small exports compatible; split large arrays without dropping records."""
    path = Path(path)
    payload = encoded(data, indent)
    files = {}
    if len(payload) > max_bytes:
        del payload
        manifest = {"schema_version": data["schema_version"], "storage": FORMAT, "parts": {}}
        for key, rows in data.items():
            if key == "schema_version":
                continue
            require(isinstance(rows, list), f"{key}: expected an array")
            names = manifest["parts"][key] = []
            chunk, size = [], 3  # brackets and final newline

            def flush():
                part = b"[" + b",".join(chunk) + b"]\n"
                name = f"{path.stem}.parts/{hashlib.sha256(part).hexdigest()}.json"
                names.append(name)
                files[path.parent / name] = part

            for row in rows:
                item = encoded(row).rstrip(b"\n")
                require(len(item) + 3 <= max_bytes, f"{key}: one record exceeds the {max_bytes}-byte part limit")
                if chunk and size + 1 + len(item) > max_bytes:
                    flush()
                    chunk, size = [], 3
                size += len(item) + bool(chunk)
                chunk.append(item)
            if chunk:
                flush()
        payload = encoded(manifest, 2)
        require(len(payload) <= max_bytes, "dataset manifest exceeds the part limit")
    files[path] = payload
    # Validate/serialize the entire result before modifying any previous export.
    stale = "generated graph is missing or stale; run python build_data_pipeline.py"
    for target, content in files.items():
        if check:
            require(target.is_file() and target.read_bytes() == content, stale)
            continue
        if target.is_file() and target.read_bytes() == content:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(content)
            os.replace(temporary, target)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    # Only prune our own generated files, after the new manifest is in place.
    for obsolete in path.with_suffix(".parts").glob("*.json"):
        if obsolete not in files and re.fullmatch(r"[a-f0-9]{64}", obsolete.stem):
            if check:
                raise ValidationError(stale)
            obsolete.unlink()
