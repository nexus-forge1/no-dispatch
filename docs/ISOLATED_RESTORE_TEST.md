# Isolated restore test

`.github/workflows/nexus-forge-restore-test.yml` restores a verified backup from the private Supabase bucket into an **isolated non-production** Convex deployment. It compares the result with the backup, then puts the target back the way it was. It is manual-only and never touches production.

## Safety guards
- The production `CONVEX_DEPLOY_KEY` is never loaded. The only key used is the secret `CONVEX_RESTORE_TEST_DEPLOY_KEY`.
- That key must be a **dev** deploy key for exactly the `target_deployment` input. Production (`prod:`) and preview keys are refused, as is any key for a different deployment.
- `target_deployment` may not be the production deployment (`vars.CONVEX_PRODUCTION_DEPLOYMENT`, default `tame-rat-826`).
- If you start it without `confirm_restore_test=true`, it fails on purpose with "Nothing was restored".

## What a run does
1. Downloads the archive and refuses to continue unless its SHA-256 equals `expected_sha256`, taken from the receipt.
2. Exports the target first (including file storage) and stores that copy at `nexus-forge/restore-tests/<capture>/run-<id>-<attempt>/pre-restore.zip`.
3. Runs `convex import --replace-all --yes` with the backup into the target only.
4. Re-exports the target and runs `scripts/compare-restore.py`. This checks that the set of non-empty tables, each table's document count, and a digest of each table's sorted document IDs match exactly. It then runs `scripts/check-recovery-point.py` (ZIP CRC, table registry, relationships) on the restored export.
5. Whenever an import has started, even after a failure, it re-imports the pre-test copy and checks that the target matches it again.

## Setup (one time)
1. Create a dev deploy key for the Testing deployment (Macaly Managed Testing `quick-rabbit-810`) in Convex: Dashboard → that deployment → Settings → Deploy keys.
2. Add it to GitHub under no-dispatch → Settings → Secrets and variables → Actions → New repository secret, with the name `CONVEX_RESTORE_TEST_DEPLOY_KEY`. Never paste it into chat.

## Scope
This proves the database restores into an isolated deployment. It does not prove that application code, auth, external Macaly assets, or the whole service can be recovered within the four-hour target.
