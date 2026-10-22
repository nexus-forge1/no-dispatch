# Isolated restore test

`.github/workflows/nexus-forge-restore-test.yml` restores a verified backup from the private Supabase bucket into an **isolated non-production** Convex deployment. It compares the result with the backup, then puts the target back the way it was. It is manual-only and never touches production.

## Safety guards
- The production `CONVEX_DEPLOY_KEY` is never loaded. The only key used is the secret `CONVEX_RESTORE_TEST_DEPLOY_KEY`.
- That key must be a deploy key for **exactly** the `target_deployment` input, in either `dev:` or `prod:` kind (the platform's Testing deployment is itself a Convex production-kind deployment, so its key carries `prod:`). Preview keys and any key for a different deployment are refused.
- `target_deployment` may not be the production deployment (`vars.CONVEX_PRODUCTION_DEPLOYMENT`, default `tame-rat-826`).
- If you start it without `confirm_restore_test=true`, it fails on purpose with "Nothing was restored".

## What a run does
1. Downloads the archive and refuses to continue unless its SHA-256 equals `expected_sha256`, taken from the receipt.
2. Exports the target first (including file storage) and stores that copy at `nexus-forge/restore-tests/<capture>/run-<id>-<attempt>/pre-restore.zip`.
3. Runs `convex import --replace-all --yes` with the backup into the target only.
4. Re-exports the target and runs `scripts/compare-restore.py`. This checks that the set of non-empty tables, each table's document count, and a digest of each table's sorted document IDs match exactly. It then runs `scripts/check-recovery-point.py` (ZIP CRC, table registry, relationships) on the restored export.
5. Whenever an import has started, even after a failure, it re-imports the pre-test copy and checks that the target matches it again.

## Setup (one time)
1. Obtain the deploy key for the Testing deployment (Macaly Managed Testing `quick-rabbit-810`) — its Convex kind is `prod:quick-rabbit-810|…` because the Testing deployment is Convex production-kind.
2. Add it to GitHub under no-dispatch → Settings → Secrets and variables → Actions → New repository secret, with the name `CONVEX_RESTORE_TEST_DEPLOY_KEY`. Never paste it into chat.

## Run history
- 2026-10-22 run `39801571528` (passed, ~8m10s): restored verified Live backup `live-2026-10-22T071018Z-run-39738421885-1.zip` into Testing `quick-rabbit-810`; restore comparison 53 non-empty tables / 2,119 documents, zero mismatches; target returned to pre-test state (93 tables / 3,139 documents, passed). Evidence in the bucket under `nexus-forge/restore-tests/…/run-39801571528-1/`.

## Scope
This proves the database restores into an isolated deployment. It does not prove that application code, auth, external Macaly assets, or the whole service can be recovered within the four-hour target.
