#!/usr/bin/env python3
"""Offline recovery-point verification. Never imports data or prints document contents."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import zipfile

LIMITS = {"archive": 256 * 1024**2, "entry": 64 * 1024**2, "expanded": 512 * 1024**2, "entries": 4096, "documents": 1000000, "line": 1024**2}
def digest(path):
    p = Path(path)
    if not p.is_file() or p.stat().st_size <= 0 or p.stat().st_size > LIMITS["archive"]:
        raise ValueError("ARCHIVE_MISSING_OR_OUTSIDE_SIZE_LIMIT")
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024**2), b""):
            h.update(chunk)
    return h.hexdigest(), p.stat().st_size

def inspect_archive(path):
    tables, payloads, ids = {}, {}, set()
    with zipfile.ZipFile(path) as z:
        entries = z.infolist()
        if len(entries) > LIMITS["entries"] or sum(e.file_size for e in entries) > LIMITS["expanded"]:
            raise ValueError("ARCHIVE_EXPANSION_LIMIT")
        names = set()
        for entry in entries:
            name = entry.filename
            parts = PurePosixPath(name).parts
            if not name or name.startswith("/") or "\\" in name or "\x00" in name or ".." in parts or ":" in parts[0] or name in names:
                raise ValueError("UNSAFE_OR_DUPLICATE_ARCHIVE_PATH")
            names.add(name)
            if entry.file_size > LIMITS["entry"] or entry.flag_bits & 1 or stat.S_ISLNK(entry.external_attr >> 16) or entry.compress_type not in (0, 8):
                raise ValueError("UNSUPPORTED_ARCHIVE_ENTRY")
            # Fully consume every entry: zipfile checks each CRC, including schemas/media.
            with z.open(entry) as f:
                h, size = hashlib.sha256(), 0
                for chunk in iter(lambda: f.read(1024**2), b""):
                    size += len(chunk)
                    if size > LIMITS["entry"]:
                        raise ValueError("ENTRY_EXPANSION_LIMIT")
                    h.update(chunk)
            if size != entry.file_size:
                raise ValueError("ENTRY_SIZE_MISMATCH")
            if name.startswith("_storage/") and not name.endswith("/") and not name.endswith(".jsonl"):
                payloads[PurePosixPath(name).name.split(".", 1)[0]] = {"bytes": size, "sha256": h.hexdigest()}
            if len(parts) == 2 and parts[1] == "documents.jsonl":
                table = parts[0]
                rows = []
                with z.open(entry) as f:
                    while True:
                        line = f.readline(LIMITS["line"] + 1)
                        if not line:
                            break
                        if len(line) > LIMITS["line"]:
                            raise ValueError("DOCUMENT_LINE_LIMIT")
                        if not line.strip():
                            continue
                        try:
                            row = json.loads(line)
                        except (ValueError, UnicodeError):
                            raise ValueError("INVALID_DOCUMENT_JSON") from None
                        if table == "_tables":
                            if not isinstance(row, dict) or not isinstance(row.get("name"), str) or not isinstance(row.get("id"), (str, int)):
                                raise ValueError("INVALID_EXPORT_TABLE_METADATA")
                            rows.append(row)
                            continue
                        if not isinstance(row, dict) or not isinstance(row.get("_id"), str) or not row["_id"] or (table, row["_id"]) in ids:
                            raise ValueError("INVALID_OR_DUPLICATE_DOCUMENT_ID")
                        ids.add((table, row["_id"]))
                        if len(ids) > LIMITS["documents"]:
                            raise ValueError("DOCUMENT_COUNT_LIMIT")
                        rows.append(row)
                tables[table] = rows
    if "missions" not in tables or "_tables" not in tables:
        raise ValueError("REQUIRED_SNAPSHOT_TABLE_MISSING")
    registry = [r["name"] for r in tables["_tables"]]
    if len(registry) != len(set(registry)) or set(registry) != set(tables) - {"_tables"}:
        raise ValueError("EXPORT_TABLE_REGISTRY_MISMATCH")
    return tables, payloads

def verify(archive, source, expected_sha256, captured_at, now=None):
    if len(expected_sha256) != 64 or any(c not in "0123456789abcdef" for c in expected_sha256):
        raise ValueError("EXPECTED_SHA256_REQUIRED")
    if Path(archive).samefile(source):
        raise ValueError("DISTINCT_SAVED_COPY_REQUIRED")
    archive_sha, size = digest(archive)
    source_sha, source_size = digest(source)
    if archive_sha != expected_sha256 or source_sha != expected_sha256 or size != source_size:
        raise ValueError("SAVED_COPY_OR_SOURCE_DIGEST_MISMATCH")
    tables, payloads = inspect_archive(archive)
    if digest(archive) != (archive_sha, size):
        raise ValueError("ARCHIVE_CHANGED_DURING_VERIFICATION")
    by_id = {name: {row["_id"]: row for row in rows} for name, rows in tables.items() if name != "_tables"}
    issues = {}
    def issue(code):
        issues[code] = issues.get(code, 0) + 1
    mission_tables = ["artifacts", "deliveries", "research", "verifications", "measurements", "missionRuns", "agentRuns", "auditEvents", "memories", "evidence", "providerInvocations", "researchClaims", "researchSourceCaptures", "missionResources", "missionDependencies"]
    for name in mission_tables:
        for row in tables.get(name, []):
            if row.get("missionId") is not None and row["missionId"] not in by_id["missions"]:
                issue(name + ":missing-mission")
    for name, field, parent in [("deliveries","artifactId","artifacts"), ("verifications","deliveryId","deliveries"), ("measurements","verificationId","verifications"), ("providerInvocations","missionRunId","missionRuns"), ("researchClaims","researchId","research"), ("researchSourceCaptures","researchId","research")]:
        for row in tables.get(name, []):
            ref = row.get(field)
            if ref is None:
                continue
            linked = by_id.get(parent, {}).get(ref)
            if linked is None:
                issue(name + ":missing-" + parent)
            elif row.get("missionId") != linked.get("missionId"):
                issue(name + ":parent-mission-mismatch")
    for row in tables.get("providerResults", []):
        if row.get("invocationId") not in by_id.get("providerInvocations", {}):
            issue("providerResults:missing-invocation")
    for row in tables.get("privateMedia", []):
        obj = payloads.get(row.get("storageId"))
        if obj is None:
            issue("privateMedia:missing-original-file")
    captured = dt.datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
    if captured.tzinfo is None:
        raise ValueError("CAPTURE_TIME_REQUIRES_TIMEZONE")
    now = now or dt.datetime.now(dt.timezone.utc)
    age = (now - captured).total_seconds()
    if age < -300:
        raise ValueError("CAPTURE_TIME_IS_IN_FUTURE")
    freshness = "fresh" if age <= 86400 else "stale"
    counts = {name: len(rows) for name, rows in tables.items() if name != "_tables"}
    return {"version":"recovery-point-verification-v1", "verifiedAt":now.isoformat(), "capturedAt":captured.isoformat(), "captureTimeBasis":"supplied capture receipt; not inferred from file modification time", "bytes":size, "sha256":archive_sha, "savedCopyMatchesSource":True, "zipCrcPassed":True, "tableCount":len(counts), "documentCount":sum(counts.values()), "tableCounts":counts, "storagePayloads":len(payloads), "privateMediaRecords":len(tables.get("privateMedia", [])), "relationshipIssues":issues, "freshness":freshness, "ageHours":round(max(0, age)/3600, 3), "passed":not issues and freshness == "fresh", "restorePerformed":False, "fullServiceRecoveryEstablished":False, "externalMacalyAssetsCovered":False}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--archive", required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--expected-sha256", required=True)
    p.add_argument("--captured-at", required=True)
    p.add_argument("--report", required=True)
    a = p.parse_args()
    try:
        result = verify(a.archive, a.source, a.expected_sha256, a.captured_at)
    except Exception as error:
        # No exception text, file paths, tokens or raw records escape into reports.
        code = str(error) if isinstance(error, ValueError) and str(error).isupper() and len(str(error)) < 100 else "ARCHIVE_VERIFICATION_FAILED"
        result = {"version":"recovery-point-verification-v1","passed":False,"failureCode":code,"restorePerformed":False}
    target = Path(a.report)
    try:
        with target.open("x", encoding="utf8") as f:
            target.chmod(0o600)
            json.dump(result, f, indent=2)
    except OSError:
        print(json.dumps({"version":"recovery-point-verification-v1","passed":False,"failureCode":"REPORT_NOT_WRITTEN","restorePerformed":False}))
        return 2
    print(json.dumps({k:v for k,v in result.items() if k != "tableCounts"}))
    return 0 if result["passed"] else 1
if __name__ == "__main__":
    raise SystemExit(main())
