# Verified manual backup capture

`nexus-forge1/no-dispatch` is the single home for this workflow (`.github/workflows/nexus-forge-backup-capture.yml`). The main repository `nexus-forge1/nexus-forge-` does not carry a backup workflow.

This workflow is intentionally manual-only. It exports the **Live** Convex deployment only when an operator explicitly sets `confirm_live_export=true` in the GitHub Actions dispatch form.

## Required GitHub Actions configuration

Secrets:
- `CONVEX_DEPLOY_KEY`: a Convex deploy key authorized for the Live deployment.
- `BACKUP_S3_ACCESS_KEY_ID`: dedicated S3-compatible storage access key.
- `BACKUP_S3_SECRET_ACCESS_KEY`: matching secret key.

Variables:
- `BACKUP_S3_BUCKET`: private bucket name, without a path.
- `BACKUP_S3_REGION`: region required by the storage provider.
- `BACKUP_S3_ENDPOINT`: optional S3-compatible endpoint URL; set this for Supabase Storage S3 API.

Prefer a dedicated Supabase project and private bucket for backups. Supabase S3 access keys can have broad project-level access; do not use public buckets or reuse broad production credentials. Do not put credentials in source control, workflow inputs, logs, or chat.

## Workflow behavior

1. Requires explicit confirmation before running a Live export. A dispatch without `confirm_live_export=true` runs only the `confirmation-required` job, which fails on purpose with "No backup was taken" so it can never be mistaken for a backup.
2. Fails before exporting if any required secret or variable is missing (names are reported, values never are).
3. Exports Convex data including Convex file storage.
4. Records the archive's SHA-256 and byte count **before** upload, refuses to overwrite an existing object key, and requires the upload to return an ETag.
5. In a separate step, fetches the object metadata and bytes fresh from storage into a new directory, recomputes SHA-256 and byte count from the retrieved bytes, and compares them exactly with the pre-upload values and the stored object size (`scripts/backup-receipt.py compare`).
6. Also requires a byte-for-byte `cmp` match, then runs `scripts/check-recovery-point.py` (ZIP CRC, table registry, relationships, private media, 24h freshness) against the source and independently retrieved archive.
7. Uploads a verification report, including a failure report when available.
8. Writes a receipt only when the report passed and its digest, byte count and capture time match the archive (`scripts/backup-receipt.py build`), then uploads it.
9. Retrieves the stored receipt and report back from storage and validates that both refer to the same capture, archive key, digest, byte count, commit and run (`scripts/backup-receipt.py validate`).

The receipt (`verified-backup-receipt-v2`) records the capture key, Live source, manual trigger, capture time, bucket, object keys, ETag/version ID when provided, SHA-256 and bytes as reported before upload, SHA-256 and bytes recomputed from the retrieved copy, verification outcome, commit SHA, and GitHub Actions run URL and ID. It does not contain credentials or raw exported records.

## Object layout in the bucket

- Archive: `nexus-forge/live/live-<UTC time>-run-<run id>-<attempt>.zip`
- Verification report: `<archive key>.verification.json` (uploaded even when verification fails, so failures are inspectable)
- Receipt: `nexus-forge/receipts/live-<UTC time>-run-<run id>-<attempt>.json` (written only after every check passes)

This is the same layout used by earlier runs, so existing captures stay alongside new ones. Receipts written before this hardening use `schemaVersion: 1`; new receipts use `verified-backup-receipt-v2`.

## Important scope limits

- This workflow does not restore data; a restore drill is a separate operation.
- It covers the Convex export and Convex file storage included in that export. It does not claim coverage of external Macaly assets, environment secrets, source control, or full-service recovery.
- It does not create a schedule or change any existing scheduled backup configuration.
- A successful workflow receipt does not automatically populate the application's backup inventory; that inventory must be updated only from the verified receipt.
- The recovery verifier intentionally applies archive size, entry, structure, and relationship checks. A failure is a failed verification, not a successful backup.

## Supabase Storage destination

The destination is Supabase Storage through its S3-compatible API.

| Name | Kind (GitHub → Settings → Secrets and variables → Actions) | Source in Supabase dashboard |
|---|---|---|
| `BACKUP_S3_ACCESS_KEY_ID` | Secret | Project Settings → Storage → S3 Connection → S3 Access Keys → New access key |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Secret | Shown once when that access key is created |
| `BACKUP_S3_ENDPOINT` | Variable | S3 Connection → Endpoint, exactly `https://<project-ref>.storage.supabase.co/storage/v1/s3` |
| `BACKUP_S3_REGION` | Variable | S3 Connection → Region (the project's region, e.g. `us-east-1`) |
| `BACKUP_S3_BUCKET` | Variable | Name of a **private** bucket under Storage → Buckets |
| `CONVEX_DEPLOY_KEY` | Secret | Convex dashboard → production deployment → Settings → Deploy key |

Compatibility notes (Supabase S3 compatibility table):
- Path-style addressing is forced whenever an endpoint is set.
- Flexible checksum headers are disabled (`AWS_REQUEST_CHECKSUM_CALCULATION=when_required`), because Supabase does not implement `x-amz-checksum-*`. Integrity comes from the independent SHA-256 retrieval comparison.
- PutObject has no `If-None-Match`, so the workflow checks with HeadObject first and only proceeds on a 404. Keys are also unique per run and attempt.
- Supabase does not return object version IDs, so the receipt records `archiveVersionId: null` and the ETag.
- The Free plan caps any single object at 50 MB (global file size limit). A larger export fails at upload, and the run is red. Raise the limit (Pro plan) if the Live export exceeds it.
- S3 access keys bypass Row Level Security, so keep them in GitHub Secrets only.
