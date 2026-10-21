#!/usr/bin/env python3
"""Compare a Convex snapshot ZIP with a re-export taken from a restore target.

Offline, standard library only. Never prints document contents or credentials; the
report carries table names, per-table counts and digests of the sorted document IDs.
Exits non-zero with an upper-case failure code on any mismatch.
"""
import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path, PurePosixPath

METADATA_TABLES = {"_tables", "_storage"}


class Refused(Exception):
    pass


def inventory(path):
    p = Path(path)
    if not p.is_file() or p.stat().st_size <= 0:
        raise Refused("SNAPSHOT_MISSING")
    tables = {}
    try:
        with zipfile.ZipFile(p) as z:
            if z.testzip() is not None:
                raise Refused("SNAPSHOT_CRC_FAILED")
            for name in z.namelist():
                parts = PurePosixPath(name).parts
                if len(parts) != 2 or parts[1] != "documents.jsonl" or parts[0] in METADATA_TABLES:
                    continue
                ids = []
                with z.open(name) as f:
                    for line in f:
                        if not line.strip():
                            continue
                        row = json.loads(line)
                        if not isinstance(row, dict) or not isinstance(row.get("_id"), str):
                            raise Refused("SNAPSHOT_DOCUMENT_INVALID")
                        ids.append(row["_id"])
                if len(ids) != len(set(ids)):
                    raise Refused("SNAPSHOT_DUPLICATE_ID")
                tables[parts[0]] = {"count": len(ids), "idDigest": hashlib.sha256("\n".join(sorted(ids)).encode()).hexdigest()}
    except zipfile.BadZipFile:
        raise Refused("SNAPSHOT_NOT_ZIP") from None
    except (ValueError, UnicodeError):
        raise Refused("SNAPSHOT_DOCUMENT_INVALID") from None
    return tables


def compare(expected_path, actual_path):
    exp, act = inventory(expected_path), inventory(actual_path)
    # Tables with zero documents may be omitted by either export; compare the non-empty sets.
    exp_nonempty = {k for k, v in exp.items() if v["count"] > 0}
    act_nonempty = {k for k, v in act.items() if v["count"] > 0}
    missing = sorted(exp_nonempty - act_nonempty)
    extra = sorted(act_nonempty - exp_nonempty)
    count_mismatch = sorted(t for t in exp_nonempty & act_nonempty if exp[t]["count"] != act[t]["count"])
    id_mismatch = sorted(t for t in exp_nonempty & act_nonempty if t not in count_mismatch and exp[t]["idDigest"] != act[t]["idDigest"])
    report = {
        "version": "restore-comparison-v1",
        "expectedTables": len(exp_nonempty),
        "actualTables": len(act_nonempty),
        "expectedDocuments": sum(exp[t]["count"] for t in exp_nonempty),
        "actualDocuments": sum(act[t]["count"] for t in act_nonempty),
        "missingTables": missing,
        "extraTables": extra,
        "countMismatches": {t: {"expected": exp[t]["count"], "actual": act[t]["count"]} for t in count_mismatch},
        "idSetMismatches": id_mismatch,
        "tableCounts": {t: exp[t]["count"] for t in sorted(exp_nonempty)},
    }
    report["passed"] = not (missing or extra or count_mismatch or id_mismatch)
    return report


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--expected", required=True, help="snapshot that was imported")
    p.add_argument("--actual", required=True, help="re-export taken from the restore target")
    p.add_argument("--report", required=True)
    a = p.parse_args(argv)
    try:
        if Path(a.expected).resolve() == Path(a.actual).resolve():
            raise Refused("DISTINCT_SNAPSHOTS_REQUIRED")
        report = compare(a.expected, a.actual)
    except Refused as error:
        print(json.dumps({"passed": False, "failureCode": str(error)}))
        return 1
    with Path(a.report).open("x", encoding="utf8") as f:
        f.write(json.dumps(report, indent=2) + "\n")
    summary = {k: v for k, v in report.items() if k != "tableCounts"}
    print(json.dumps(summary))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
