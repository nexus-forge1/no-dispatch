#!/usr/bin/env python3
"""Count matching archive/receipt objects by UTC capture day; never deletes."""
import datetime as dt
import json
import re
import sys

def inventory(live, receipts):
    if live.get("IsTruncated") or receipts.get("IsTruncated"):
        raise ValueError("Incomplete storage inventory")
    archives = {o["Key"] for o in live.get("Contents", []) if o["Key"].startswith("nexus-forge/live/") and o["Key"].endswith(".zip")}
    receipt_keys = {o["Key"] for o in receipts.get("Contents", [])}
    days = set()
    paired = 0
    unrecognized = 0
    for key in archives:
        capture = key.rsplit("/", 1)[-1][:-4]
        if "nexus-forge/receipts/" + capture + ".json" not in receipt_keys:
            continue
        paired += 1
        match = re.fullmatch(r"live-(\d{4}-\d{2}-\d{2})T\d{6}Z-run-\d+-\d+", capture)
        if match:
            try:
                days.add(dt.date.fromisoformat(match.group(1)).isoformat())
            except ValueError:
                unrecognized += 1
        else:
            unrecognized += 1
    return {"archiveObjects": len(archives), "receiptObjects": len(receipt_keys),
            "archiveReceiptPairs": paired, "distinctUtcCaptureDays": len(days),
            "oldestUtcCaptureDay": min(days) if days else None,
            "newestUtcCaptureDay": max(days) if days else None,
            "unrecognizedPairedCaptureKeys": unrecognized,
            "receiptContentsRevalidated": False, "deletedObjects": 0}

if __name__ == "__main__":
    with open(sys.argv[1]) as f:
        live = json.load(f)
    with open(sys.argv[2]) as f:
        receipts = json.load(f)
    print(json.dumps(inventory(live, receipts), sort_keys=True))
