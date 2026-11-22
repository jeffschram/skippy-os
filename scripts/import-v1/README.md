# The one-time import from the old project

Brings the old Skippy's records into Skippy OS, following the table in spec §10. It is a script, not a feature: it is run a few times, checked, and then removed together with the `importMap` table.

The old project is only ever read. Skippy OS never connects to it.

## The parts

| File | What it does |
| --- | --- |
| `transform.ts` | Decides what comes across and reshapes it. Pure, so the dry run and the real run make the same decisions. |
| `run.ts` | Reads the snapshot, prints the plan, and (with `--write`) sends the batches to Convex. |
| `convex/importV1.ts` | Loads the batches. Turns old ids into new ones through `importMap`, and leaves alone anything already loaded. |

## Steps

The snapshot holds real personal data. Keep it, and the reports written beside it, outside the repo.

1. Take a snapshot, from the old project's folder. Its data is in its dev deployment, which is what `export` reads by default:

   ```bash
   npx convex export --include-file-storage --path ~/.skippy-os/import-v1/snapshot.zip
   ```

2. Unzip it to `~/.skippy-os/import-v1/snapshot`.

3. Dry run. Prints, for every table in the snapshot, how many records are exported, imported, held for later and skipped, with reasons. Writes nothing:

   ```bash
   node scripts/import-v1/run.ts --snapshot ~/.skippy-os/import-v1/snapshot
   ```

4. Rehearse on the dev deployment, then spot-check it:

   ```bash
   node scripts/import-v1/run.ts --snapshot ~/.skippy-os/import-v1/snapshot --write --target dev
   ```

   ```bash
   node scripts/import-v1/run.ts --snapshot ~/.skippy-os/import-v1/snapshot --spot-check --target dev
   ```

5. If production holds only records made while testing, clear them first. This empties every record table, so it refuses to run once the import has started or if any table holds more than 20 rows. Add `"dryRun":true` to count without deleting:

   ```bash
   npx convex run --prod importV1:clearTestRecords '{"confirm":"delete the test records"}'
   ```

6. Load production the same way as dev, with `--target prod`, and spot-check it.

7. When the counts add up and the spot check has been read, empty the map. Run this until it prints `0`, then remove `importMap`, `convex/importV1.ts` and this folder:

   ```bash
   npx convex run --prod importV1:dropMap
   ```

## What a run reports

Each batch ends as four numbers that add up to what was sent:

- **new**: loaded in this run.
- **already**: loaded by an earlier run, or a link that was already there. A second run should show everything here.
- **merged**: folded into a record that was already there, such as the same link saved twice.
- **skipped**: not loaded, with a reason. The id of every skipped record is in the JSON report.

## What is held for Phase 4

Recurrences, calendar events that Skippy made, and files on non-code projects have no table yet. The dry run counts them under "later". Keep the snapshot until they have come across.
