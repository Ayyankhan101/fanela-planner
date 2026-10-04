// Nightly storage sweep for storage/uploads (E5 + B2):
//   npm run storage:sweep        (cron it — see docs/ops/runbook.md)
// Removes orphan *.json (no files row, older than grace) and expired
// originals (files row present, older than retention — default 90 d).
import "dotenv/config";
import { sweepUploads, uploadRetentionDays } from "../lib/services/import";

const result = await sweepUploads({ retentionDays: uploadRetentionDays() });
console.log(
  `[storage-sweep] orphans=${result.removedOrphans} expired=${result.removedExpired} freed=${result.bytesFreed}B`,
);
