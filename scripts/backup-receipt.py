#!/usr/bin/env python3
"""Fail-closed backup comparison, receipt construction and receipt validation.

Never prints credentials, raw exported records or document contents. Every refusal exits
non-zero with a short upper-case failure code so the workflow cannot report success
after a failed comparison.

Subcommands:
  compare   Compare independently retrieved bytes with the values reported before upload.
  build     Write a receipt only when retrieval, digest, byte count and report all agree.
  validate  Check a receipt independently retrieved from storage against the retrieved
            verification report and the expected archive identity.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

SHA_RE = re.compile(r"^[0-9a-f]{64}$")
RECEIPT_VERSION = "verified-backup-receipt-v2"
REPORT_VERSION = "recovery-point-verification-v1"


class Refused(Exception):
    pass


def measure(path):
    p = Path(path)
    if not p.is_file() or p.is_symlink():
        raise Refused("FILE_MISSING")
    size = p.stat().st_size
    if size <= 0:
        raise Refused("FILE_EMPTY")
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024**2), b""):
            h.update(chunk)
    return h.hexdigest(), size


def expect_sha(value, code):
    if not isinstance(value, str) or not SHA_RE.match(value):
        raise Refused(code)
    return value


def expect_bytes(value, code):
    try:
        n = int(str(value))
    except (TypeError, ValueError):
        raise Refused(code) from None
    if n <= 0 or str(n) != str(value).strip():
        raise Refused(code)
    return n


def load_json(path, code):
    try:
        data = json.loads(Path(path).read_text(encoding="utf8"))
    except (OSError, ValueError, UnicodeError):
        raise Refused(code) from None
    if not isinstance(data, dict):
        raise Refused(code)
    return data


def compare(args):
    reported_sha = expect_sha(args.reported_sha256, "REPORTED_SHA256_INVALID")
    reported_bytes = expect_bytes(args.reported_bytes, "REPORTED_BYTES_INVALID")
    if Path(args.retrieved).resolve() == Path(args.source).resolve():
        raise Refused("DISTINCT_RETRIEVED_COPY_REQUIRED")
    try:
        retrieved_sha, retrieved_bytes = measure(args.retrieved)
    except Refused as error:
        raise Refused("RETRIEVED_" + str(error)) from None
    try:
        source_sha, source_bytes = measure(args.source)
    except Refused as error:
        raise Refused("SOURCE_" + str(error)) from None
    if source_sha != reported_sha or source_bytes != reported_bytes:
        raise Refused("SOURCE_CHANGED_SINCE_UPLOAD")
    if retrieved_bytes != reported_bytes:
        raise Refused("RETRIEVED_BYTE_COUNT_MISMATCH")
    if retrieved_sha != reported_sha:
        raise Refused("RETRIEVED_SHA256_MISMATCH")
    if args.remote_bytes is not None and expect_bytes(args.remote_bytes, "REMOTE_BYTES_INVALID") != reported_bytes:
        raise Refused("REMOTE_OBJECT_SIZE_MISMATCH")
    return {"version": "backup-retrieval-comparison-v1", "passed": True, "reportedSha256": reported_sha,
            "reportedBytes": reported_bytes, "retrievedSha256": retrieved_sha, "retrievedBytes": retrieved_bytes}


def check_report(report, sha, size, captured_at):
    if report.get("version") != REPORT_VERSION:
        raise Refused("REPORT_VERSION_INVALID")
    if report.get("passed") is not True:
        raise Refused("REPORT_NOT_PASSED")
    if report.get("sha256") != sha:
        raise Refused("REPORT_SHA256_MISMATCH")
    if report.get("bytes") != size:
        raise Refused("REPORT_BYTES_MISMATCH")
    if report.get("savedCopyMatchesSource") is not True or report.get("zipCrcPassed") is not True:
        raise Refused("REPORT_INTEGRITY_FLAGS_MISSING")
    if report.get("restorePerformed") is not False:
        raise Refused("REPORT_RESTORE_FLAG_INVALID")
    if captured_at is not None:
        reported = str(report.get("capturedAt", "")).replace("+00:00", "Z")
        if reported != captured_at.replace("+00:00", "Z"):
            raise Refused("REPORT_CAPTURE_TIME_MISMATCH")


def build(args):
    reported_sha = expect_sha(args.reported_sha256, "REPORTED_SHA256_INVALID")
    reported_bytes = expect_bytes(args.reported_bytes, "REPORTED_BYTES_INVALID")
    for name in ("capture_key", "captured_at", "archive_key", "report_key", "commit_sha", "run_id", "run_url", "bucket"):
        if not getattr(args, name):
            raise Refused("RECEIPT_FIELD_MISSING_" + name.upper())
    # no-dispatch object layout: nexus-forge/live/<capture-key>.zip with the report at
    # <archive-key>.verification.json and the receipt under nexus-forge/receipts/.
    if not args.archive_key.endswith("/" + args.capture_key + ".zip"):
        raise Refused("ARCHIVE_KEY_CAPTURE_KEY_MISMATCH")
    if args.report_key != args.archive_key + ".verification.json":
        raise Refused("REPORT_KEY_CAPTURE_KEY_MISMATCH")
    retrieved_sha, retrieved_bytes = measure(args.retrieved)
    source_sha, source_bytes = measure(args.archive)
    if (source_sha, source_bytes) != (reported_sha, reported_bytes):
        raise Refused("SOURCE_CHANGED_SINCE_UPLOAD")
    if retrieved_bytes != reported_bytes:
        raise Refused("RETRIEVED_BYTE_COUNT_MISMATCH")
    if retrieved_sha != reported_sha:
        raise Refused("RETRIEVED_SHA256_MISMATCH")
    report = load_json(args.report, "REPORT_UNREADABLE")
    check_report(report, reported_sha, reported_bytes, args.captured_at)
    receipt = {
        "version": RECEIPT_VERSION,
        "captureKey": args.capture_key,
        "sourceEnvironment": "live",
        "triggerType": "manual",
        "liveExportConfirmed": True,
        "capturedAt": args.captured_at,
        "bucket": args.bucket,
        "archiveKey": args.archive_key,
        "archiveVersionId": args.version_id or None,
        "archiveETag": args.etag or None,
        "verificationReportKey": args.report_key,
        "sha256": reported_sha,
        "bytes": reported_bytes,
        "independentlyRetrieved": True,
        "retrievedSha256": retrieved_sha,
        "retrievedBytes": retrieved_bytes,
        "byteIdenticalAfterRetrieval": True,
        "archiveVerificationPassed": True,
        "restorePerformed": False,
        "commitSha": args.commit_sha,
        "githubActionsRunId": args.run_id,
        "githubActionsRunUrl": args.run_url,
        "scopeNote": "Convex export and included Convex file storage only; external Macaly assets and full-service recovery are not claimed.",
    }
    out = Path(args.out)
    with out.open("x", encoding="utf8") as f:
        out.chmod(0o600)
        f.write(json.dumps(receipt, indent=2) + "\n")
    return {"version": "receipt-build-v1", "passed": True, "captureKey": args.capture_key, "bytes": reported_bytes}


def validate(args):
    expected_sha = expect_sha(args.expected_sha256, "EXPECTED_SHA256_INVALID")
    expected_bytes = expect_bytes(args.expected_bytes, "EXPECTED_BYTES_INVALID")
    receipt = load_json(args.receipt, "RECEIPT_UNREADABLE")
    report = load_json(args.report, "REPORT_UNREADABLE")
    if receipt.get("version") != RECEIPT_VERSION:
        raise Refused("RECEIPT_VERSION_INVALID")
    checks = [
        ("captureKey", args.capture_key, "RECEIPT_CAPTURE_KEY_MISMATCH"),
        ("archiveKey", args.archive_key, "RECEIPT_ARCHIVE_KEY_MISMATCH"),
        ("verificationReportKey", args.report_key, "RECEIPT_REPORT_KEY_MISMATCH"),
        ("commitSha", args.commit_sha, "RECEIPT_COMMIT_MISMATCH"),
        ("githubActionsRunId", args.run_id, "RECEIPT_RUN_MISMATCH"),
        ("sha256", expected_sha, "RECEIPT_SHA256_MISMATCH"),
        ("retrievedSha256", expected_sha, "RECEIPT_RETRIEVED_SHA256_MISMATCH"),
        ("bytes", expected_bytes, "RECEIPT_BYTES_MISMATCH"),
        ("retrievedBytes", expected_bytes, "RECEIPT_RETRIEVED_BYTES_MISMATCH"),
    ]
    for key, value, code in checks:
        if receipt.get(key) != value:
            raise Refused(code)
    for key in ("independentlyRetrieved", "byteIdenticalAfterRetrieval", "archiveVerificationPassed", "liveExportConfirmed"):
        if receipt.get(key) is not True:
            raise Refused("RECEIPT_FLAG_INVALID_" + key)
    if receipt.get("restorePerformed") is not False:
        raise Refused("RECEIPT_RESTORE_FLAG_INVALID")
    check_report(report, expected_sha, expected_bytes, receipt.get("capturedAt"))
    return {"version": "receipt-validation-v1", "passed": True, "captureKey": receipt["captureKey"],
            "bytes": expected_bytes}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("compare")
    c.add_argument("--source", required=True)
    c.add_argument("--retrieved", required=True)
    c.add_argument("--reported-sha256", required=True)
    c.add_argument("--reported-bytes", required=True)
    c.add_argument("--remote-bytes")
    b = sub.add_parser("build")
    for name in ("archive", "retrieved", "report", "reported-sha256", "reported-bytes", "capture-key", "captured-at",
                 "archive-key", "report-key", "commit-sha", "run-id", "run-url", "bucket", "out"):
        b.add_argument("--" + name, required=True)
    b.add_argument("--version-id", default="")
    b.add_argument("--etag", default="")
    v = sub.add_parser("validate")
    for name in ("receipt", "report", "expected-sha256", "expected-bytes", "capture-key", "archive-key", "report-key",
                 "commit-sha", "run-id"):
        v.add_argument("--" + name, required=True)
    a = p.parse_args(argv)
    try:
        result = {"compare": compare, "build": build, "validate": validate}[a.cmd](a)
    except Refused as error:
        print(json.dumps({"passed": False, "failureCode": str(error)}))
        return 1
    except FileExistsError:
        print(json.dumps({"passed": False, "failureCode": "RECEIPT_ALREADY_EXISTS"}))
        return 1
    except Exception:
        print(json.dumps({"passed": False, "failureCode": "BACKUP_RECEIPT_CHECK_FAILED"}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
