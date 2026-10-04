// Outbox tick worker (plan P5 groundwork) — docs/ops/runbook.md §4c.
// pg-boss = tick scheduler only (every 15 s); integration_outbox owns all
// backoff/retry state, so tick scan and delayed jobs cannot race.
//   npm run outbox:worker
import "dotenv/config";
import { PgBoss } from "pg-boss";
import { dispatchOutboxOnce, reclaimStuckOutbox } from "../lib/services/outbox";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("[outbox-worker] DATABASE_URL missing");
  process.exit(1);
}

const boss = new PgBoss({ connectionString: dbUrl });
await boss.start();
await boss.createQueue("outbox-tick");
// 15 s tick (6-field cron); key = idempotent across restarts
await boss.schedule("outbox-tick", "*/15 * * * * *", {}, { key: "outbox-tick" });

await boss.work("outbox-tick", { localConcurrency: 1 }, async () => {
  const reclaimed = await reclaimStuckOutbox();
  const res = await dispatchOutboxOnce();
  if (res.claimed > 0 || reclaimed > 0) {
    console.log(
      `[outbox-worker] reclaimed=${reclaimed} claimed=${res.claimed} sent=${res.sent} failed=${res.failed} retry=${res.retry}`,
    );
  }
});

console.log("[outbox-worker] started (tick every 15s)");

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[outbox-worker] ${signal} — stopping`);
  try {
    await boss.stop({ graceful: true, timeout: 10_000 });
  } catch {
    // force-stop path — exiting anyway
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
