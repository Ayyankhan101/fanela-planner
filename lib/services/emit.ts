// P5 emission groundwork (plan: domain-event emission without senders). Builds the
// frozen envelope (docs/phase0/09 §3) and enqueues into integration_outbox riding
// the ambient transaction — rollback removes the row with the business write.
// kind = frozen event name; dpd|xero routing arrives with the senders (09 §5).
// No senders registered yet → rows sit pending/attempts=0 (outbox.ts contract).
import {
  SCHEMA_VERSION,
  domainEventSchema,
  type AuditEvent,
  type DomainEventName,
  type StockEvent,
} from "@/lib/events/domain-events";
import { enqueueOutbox } from "./outbox";

type EventSource = AuditEvent["source"] | StockEvent["source"];

// Parse is defense-in-depth: a contract-shaped payload fails loud here instead of
// reaching a future sender as an unparseable row.
export async function enqueueDomainEvent(name: DomainEventName, source: EventSource): Promise<void> {
  const envelope = domainEventSchema.parse({
    event: name,
    schemaVersion: SCHEMA_VERSION,
    occurredAt: new Date().toISOString(),
    source,
  });
  await enqueueOutbox(envelope.event, envelope);
}
