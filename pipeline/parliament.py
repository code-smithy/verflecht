"""Resumable archive of the public ws-old.parlament.ch JSON API.

No API keys or third-party Python packages. A snapshot is append-only: use a new
archive directory for a fresh snapshot, or reuse one to resume an interrupted run.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import gzip
import hashlib
import json
import os
import shutil
from pathlib import Path
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

from pipeline.build import ROOT, ValidationError, require, unique_keys

BASE_URL = "https://ws-old.parlament.ch"
USER_AGENT = "Verflecht/0.1 (public parliamentary research; https://github.com/code-smithy/verflecht)"
LANGUAGES = ("de", "fr", "it", "en")


@dataclass(frozen=True)
class Resource:
    path: str
    detail_path: str | None = None


# Paths and detail links observed in the service's HTML documentation.
# /votes has no default view; /parties returns 404. Their implemented views
# below contain the accessible data. No date, activity or legislature filters.
RESOURCES = (
    Resource("councillors", "councillors"),
    Resource("councillors/basicdetails", "councillors"),
    Resource("councillors/historic", "councillors"),
    Resource("committees", "committees"),
    Resource("councils", "councils"),
    Resource("cantons"),
    Resource("parties/historic"),
    Resource("factions", "factions"),
    Resource("factions/historic"),
    Resource("departments"),
    Resource("departments/historic"),
    Resource("legislativeperiods"),
    Resource("sessions"),
    Resource("affairs/types"),
    Resource("affairs/states"),
    Resource("affairs/topics"),
    Resource("affairs/descriptors"),
    Resource("affairsummaries", "affairsummaries"),
    Resource("affairs", "affairs"),
    Resource("votes/affairs", "votes/affairs"),
    Resource("votes/councillors", "votes/councillors"),
)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".{threading.get_ident()}.tmp")
    try:
        temporary.write_text(encode(value) + "\n", encoding="utf-8", newline="\n")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def request_url(path, language, page=None):
    require(language in LANGUAGES, f"unsupported language: {language}")
    require(path and all(part not in ("", ".", "..") for part in path.split("/")), "invalid API path")
    query = {"format": "json", "lang": language}
    if page is not None:
        require(type(page) is int and page >= 1, "page must be a positive integer")
        query["pageNumber"] = page
    return f"{BASE_URL}/{quote(path, safe='/')}?{urlencode(query)}"


def has_more(payload):
    require(isinstance(payload, list), "collection response must be a JSON array")
    require(all(isinstance(row, dict) for row in payload), "collection items must be objects")
    # The legacy API puts the pagination flag on the LAST RECORD, not a wrapper.
    for row in payload:
        require(type(row.get("hasMorePages", False)) is bool, "invalid hasMorePages flag")
    return any(row.get("hasMorePages", False) for row in payload)


def page_fingerprint(payload):
    # Historic endpoints synthesize updated timestamps on every request.
    def stable(value):
        if isinstance(value, dict):
            return {key: stable(item) for key, item in value.items() if key not in ("updated", "hasMorePages")}
        if isinstance(value, list):
            return [stable(item) for item in value]
        return value
    return hashlib.sha256(encode(stable(payload)).encode("utf-8")).hexdigest()


def retry_seconds(value, fallback):
    if value:
        try:
            return max(0, float(value))
        except ValueError:
            try:
                return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
            except (TypeError, ValueError):
                pass
    return fallback


class ImportFailure(RuntimeError):
    pass


class AccessDenied(ImportFailure):
    pass


class NotFound(ImportFailure):
    """A collection record has no corresponding legacy detail response."""


class RequestTimedOut(ImportFailure):
    """A request did not return after all retries."""


class BudgetReached(ImportFailure):
    pass


class Client:
    def __init__(self, archive, interval=0.2, timeout=60, retries=3, max_requests=None, max_seconds=None):
        self.archive = Path(archive)
        self.interval = interval
        self.timeout = timeout
        self.retries = retries
        self.max_requests = max_requests
        self.deadline = time.monotonic() + max_seconds if max_seconds else None
        self.downloaded = 0
        self.cached = 0
        self.network_attempts = 0
        self.bytes = 0
        self.next_request = 0.0
        self.lock = threading.Lock()
        self.rate_lock = threading.Lock()
        self.stop = threading.Event()
        self.robots = None

    def throttle(self):
        # Recheck a shared cooldown after sleeping; Retry-After from one worker
        # must delay the other workers too.
        with self.rate_lock:
            while True:
                with self.lock:
                    require(not self.stop.is_set(), "import stopped")
                    if self.deadline and time.monotonic() >= self.deadline:
                        raise BudgetReached("time limit reached; resume from this archive")
                    if self.max_requests is not None and self.network_attempts >= self.max_requests:
                        raise BudgetReached("request limit reached; rerun the same command to resume")
                    wait = max(0, self.next_request - time.monotonic())
                    if wait <= 0:
                        self.network_attempts += 1
                        self.next_request = time.monotonic() + self.interval
                        return
                if self.stop.wait(min(wait, 1)):
                    raise ImportFailure("import stopped")

    def download(self, url, accept="text/json"):
        if self.robots and not self.robots.can_fetch(USER_AGENT, url):
            raise AccessDenied(f"robots.txt disallows {url}")
        for attempt in range(self.retries + 1):
            self.throttle()
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    require(response.geturl().startswith(BASE_URL + "/"), "unexpected off-site redirect")
                    return response.read()
            except HTTPError as error:
                if error.code in (401, 403):
                    self.stop.set()
                    raise AccessDenied(f"HTTP {error.code}: {url}; access denied, no bypass attempted") from error
                if error.code == 404:
                    raise NotFound(f"HTTP 404: {url}") from error
                if error.code not in (408, 429, 500, 502, 503, 504) or attempt == self.retries:
                    raise ImportFailure(f"HTTP {error.code}: {url}") from error
                delay = retry_seconds(error.headers.get("Retry-After"), 2 ** (attempt + 1))
                # A server cooldown applies to every worker, not only this request.
                with self.lock:
                    self.next_request = max(self.next_request, time.monotonic() + delay)
            except (URLError, TimeoutError, ConnectionError, OSError) as error:
                if attempt == self.retries:
                    failure = RequestTimedOut if isinstance(error, TimeoutError) else ImportFailure
                    raise failure(f"request failed: {url}: {error}") from error
                with self.lock:
                    self.next_request = max(self.next_request, time.monotonic() + 2 ** (attempt + 1))
        raise ImportFailure(f"request failed: {url}")

    def check_robots(self):
        # Missing robots.txt means there are no published crawler rules.
        try:
            body = self.download(BASE_URL + "/robots.txt", "text/plain")
        except NotFound:
            return
        self.robots = RobotFileParser()
        self.robots.parse(body.decode("utf-8-sig").splitlines())
        crawl_delay = self.robots.crawl_delay(USER_AGENT)
        rate = self.robots.request_rate(USER_AGENT)
        if crawl_delay:
            self.interval = max(self.interval, crawl_delay)
        if rate:
            self.interval = max(self.interval, rate.seconds / rate.requests)

    def cache_path(self, url):
        key = hashlib.sha256(url.encode("utf-8")).hexdigest()
        return self.archive / "responses" / key[:2] / f"{key}.json.gz"

    def fetch(self, path, language, page=None, refresh=False, source_updated=None):
        if self.deadline and time.monotonic() >= self.deadline:
            raise BudgetReached("time limit reached; resume from this archive")
        url = request_url(path, language, page)
        cache_path = self.cache_path(url)
        envelope = None
        if cache_path.exists():
            try:
                with gzip.open(cache_path, "rt", encoding="utf-8") as stream:
                    envelope = json.load(stream, object_pairs_hook=unique_keys)
                require(envelope["url"] == url, "cache URL mismatch")
                require(hashlib.sha256(envelope["body"].encode("utf-8")).hexdigest() == envelope["sha256"], "cache checksum mismatch")
            except (OSError, EOFError, ValueError, KeyError, TypeError) as error:
                raise ImportFailure(f"corrupt cache {cache_path}: {error}; preserve it and use a new snapshot directory") from error
            if source_updated is not None and envelope.get("source_updated") != source_updated:
                refresh = True
        if envelope is None or refresh:
            body = self.download(url).decode("utf-8-sig")
            # Never cache an HTML error page as successful API data.
            payload = json.loads(body, object_pairs_hook=unique_keys)
            require(isinstance(payload, (dict, list)), f"unexpected JSON response: {url}")
            if page is not None:
                has_more(payload)
            else:
                require(isinstance(payload, dict) and payload.get("id") == int(path.rsplit("/", 1)[-1]), f"detail ID mismatch: {url}")
            if envelope is not None:
                version = self.archive / "versions" / f"{cache_path.stem}-{envelope['sha256']}.gz"
                version.parent.mkdir(parents=True, exist_ok=True)
                if not version.exists():
                    shutil.copyfile(cache_path, version)
            envelope = {"url": url, "path": path, "language": language, "page": page, "source_updated": source_updated,
                        "retrieved_at": utc_now(), "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(), "body": body}
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = cache_path.with_name(cache_path.name + f".{threading.get_ident()}.tmp")
            try:
                with gzip.open(temporary, "wt", encoding="utf-8") as stream:
                    stream.write(encode(envelope))
                os.replace(temporary, cache_path)
            finally:
                temporary.unlink(missing_ok=True)
            with self.lock:
                self.downloaded += 1
                self.bytes += len(body.encode("utf-8"))
                if self.downloaded % 100 == 0:
                    print(f"Archived {self.downloaded:,} responses ({self.bytes / 1048576:.1f} MiB this run); {language}/{path}", flush=True)
        else:
            with self.lock:
                self.cached += 1
        return json.loads(envelope["body"], object_pairs_hook=unique_keys)


@contextmanager
def archive_lock(archive):
    Path(archive).mkdir(parents=True, exist_ok=True)
    with (Path(archive) / "import.lock").open("a+b") as stream:
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            if stream.read(1) == b"":
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise ImportFailure("another importer is using this archive") from error
        else:
            import fcntl
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise ImportFailure("another importer is using this archive") from error
        try:
            yield
        finally:
            if os.name == "nt":
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


def import_archive(archive, languages=LANGUAGES, workers=4, interval=0.2, max_requests=None,
                   resources=RESOURCES, client=None, max_seconds=None, refresh=False):
    require(1 <= workers <= 8, "workers must be between 1 and 8")
    require(interval >= 0.1, "request interval must be at least 0.1 seconds")
    require(languages and set(languages) <= set(LANGUAGES), "invalid languages")
    require(len(languages) == len(set(languages)), "duplicate languages")
    require(max_requests is None or max_requests > 0, "max_requests must be positive")
    require(max_seconds is None or max_seconds > 0, "max_seconds must be positive")
    archive = Path(archive)
    client = client or Client(archive, interval=interval, max_requests=max_requests, max_seconds=max_seconds)
    state = {"source": BASE_URL, "started_at": utc_now(), "status": "running",
             "languages": list(languages), "collections": {}, "details": {}, "errors": [],
             "unavailable_details": [],
             "unavailable_views": {"parties": "HTTP 404; parties/historic is imported", "votes": "No default view; both vote views are imported"}}
    state_lock = threading.Lock()
    detail_tasks = {}
    previous = archive / "manifest.json"
    previous_state = json.loads(previous.read_text(encoding="utf-8")) if previous.exists() else {}
    known_unavailable = {item["task"]: item for item in previous_state.get("unavailable_details", [])
                         if isinstance(item, dict) and isinstance(item.get("task"), str)}
    # Migrate failures written by older importer versions. Permanent 404s can
    # be skipped forever; the unusually large vote responses get another
    # attempt after a cooling-off period.
    retry_after = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    for item in previous_state.get("errors", []):
        if not isinstance(item, dict) or not isinstance(item.get("task"), str):
            continue
        error = item.get("error", "")
        if error.startswith("HTTP 404:"):
            known_unavailable[item["task"]] = {**item, "permanent": True}
        elif item["task"].startswith("('votes/") and "timed out" in error.lower():
            known_unavailable[item["task"]] = {**item, "retry_after": retry_after}
    # Refresh listing pages once per cycle, then resume that cycle from cache.
    refresh_pages = refresh and previous_state.get("status") == "complete"
    state["cycle_started_at"] = utc_now() if refresh_pages else previous_state.get("cycle_started_at", utc_now())

    def fetch_page(path, language, page):
        # On a paused refresh cycle, only listing pages older than the cycle need
        # refreshing. Newly fetched pages survive runner timeouts.
        should_refresh = refresh_pages
        cache_path = client.cache_path(request_url(path, language, page))
        if refresh and cache_path.exists():
            with gzip.open(cache_path, "rt", encoding="utf-8") as stream:
                cached = json.load(stream)
            should_refresh = cached["retrieved_at"] < state["cycle_started_at"]
        return client.fetch(path, language, page, refresh=should_refresh)

    def save():
        with state_lock:
            state.update(updated_at=utc_now(), downloaded_requests=client.downloaded,
                         cached_requests=client.cached, downloaded_bytes=client.bytes)
            atomic_json(archive / "manifest.json", state)

    def listing(resource, language):
        key = f"{language}/{resource.path}"
        progress = {"pages": 0, "records": 0, "complete": False}
        with state_lock:
            state["collections"][key] = progress
        fingerprints = set()
        page = 1
        while True:
            payload = fetch_page(resource.path, language, page)
            more = has_more(payload)
            fingerprint = page_fingerprint(payload)
            require(not payload or fingerprint not in fingerprints, f"repeated page from {resource.path}; pagination may be ignored")
            fingerprints.add(fingerprint)
            with state_lock:
                progress.update(pages=page, records=progress["records"] + len(payload), complete=not more)
                if resource.detail_path:
                    for row in payload:
                        identifier = row.get("id")
                        require(type(identifier) is int and identifier >= 0, f"missing numeric ID in {resource.path}")
                        task = (resource.detail_path, language, identifier)
                        # The historic list has request-time timestamps. Prefer
                        # revisions from the primary list, never those timestamps.
                        if resource.path == resource.detail_path:
                            detail_tasks[task] = row.get("updated")
                        else:
                            detail_tasks.setdefault(task, None)
            save()
            if not more:
                return
            page += 1

    def detail(task):
        resource, language, identifier = task
        task_key = str(task)
        known = known_unavailable.get(task_key)
        if known and (known.get("permanent") is True or known.get("retry_after", "") > utc_now()):
            with state_lock:
                state["unavailable_details"].append(known)
                state["details"][f"{language}/{resource}"]["unavailable"] += 1
            return
        try:
            payload = client.fetch(f"{resource}/{identifier}", language, source_updated=detail_tasks[task])
        except NotFound as error:
            # Some historic list rows in the legacy API point to detail routes
            # that no longer exist. Retrying those permanent gaps makes every
            # resumed import fail without adding data.
            with state_lock:
                state["unavailable_details"].append({"task": task_key, "error": str(error), "permanent": True})
                state["details"][f"{language}/{resource}"]["unavailable"] += 1
            return
        except RequestTimedOut as error:
            if not resource.startswith("votes/"):
                raise
            # A small set of very large legacy vote responses regularly takes
            # longer than the service and runner allow, even after all retries.
            # Quarantine them temporarily instead of retrying for hours nightly.
            unavailable = {"task": task_key, "error": str(error),
                           "retry_after": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()}
            with state_lock:
                state["unavailable_details"].append(unavailable)
                state["details"][f"{language}/{resource}"]["unavailable"] += 1
            return
        require(isinstance(payload, dict), f"detail response is not an object: {resource}/{identifier}")
        require(payload.get("id") == identifier, f"detail ID mismatch: {resource}/{identifier}")
        with state_lock:
            state["details"][f"{language}/{resource}"]["completed"] += 1

    def run_jobs(pool, jobs, operation):
        # Keep only a small number of pending futures; avoid hundreds of thousands
        # of Future objects when archiving every affair in four languages.
        iterator = iter(jobs)
        pending = {}
        for _ in range(workers):
            item = next(iterator, None)
            if item is not None:
                pending[pool.submit(operation, item)] = item
        completed = 0
        while pending:
            future = next(as_completed(pending))
            item = pending.pop(future)
            try:
                future.result()
            except (BudgetReached, AccessDenied):
                client.stop.set()
                raise
            except Exception as error:
                with state_lock:
                    state["errors"].append({"task": str(item), "error": str(error)})
            completed += 1
            if completed % 100 == 0:
                save()
                print(f"Downloaded {client.downloaded:,}; cached {client.cached:,}; errors {len(state['errors'])}", flush=True)
            item = next(iterator, None)
            if item is not None:
                pending[pool.submit(operation, item)] = item

    with archive_lock(archive):
        save()
        try:
            client.check_robots()
            with ThreadPoolExecutor(max_workers=workers) as pool:
                run_jobs(pool, [(resource, lang) for resource in resources for lang in languages], lambda task: listing(*task))
                for resource, language, _ in detail_tasks:
                    key = f"{language}/{resource}"
                    state["details"].setdefault(key, {"total": 0, "completed": 0, "unavailable": 0})["total"] += 1
                save()
                order = {resource.detail_path: index for index, resource in enumerate(resources) if resource.detail_path}
                tasks = sorted(detail_tasks, key=lambda task: (order[task[0]], task[2], languages.index(task[1])))
                print(f"Collections fetched; {len(tasks):,} detail requests queued.", flush=True)
                # Save the planned detail keys for offline normalization without
                # decompressing every vote record just to discover its resource.
                atomic_json(archive / "catalog.json", {
                    "source": BASE_URL, "languages": list(languages),
                    "details": [list(task) for task in tasks],
                    "collections": state["collections"],
                })
                run_jobs(pool, tasks, detail)
            state["status"] = "complete" if not state["errors"] else "incomplete"
        except (Exception, KeyboardInterrupt) as error:
            client.stop.set()
            state["status"] = "paused" if isinstance(error, (KeyboardInterrupt, BudgetReached)) else "blocked"
            state["errors"].append({"error": str(error) or "interrupted"})
        finally:
            save()
    return state
