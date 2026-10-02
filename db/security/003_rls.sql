-- 003_rls.sql — row-level security: immutability + append-only (spec §9)
-- FORCE applies to table owner too; superuser (migration runner) bypasses.

-- Swatch immutability: Approved attempts can never change
ALTER TABLE swatch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE swatch_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS swatch_attempts_select ON swatch_attempts;
CREATE POLICY swatch_attempts_select ON swatch_attempts FOR SELECT USING (true);
DROP POLICY IF EXISTS swatch_attempts_insert ON swatch_attempts;
CREATE POLICY swatch_attempts_insert ON swatch_attempts FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS swatch_attempts_update ON swatch_attempts;
-- USING: an approved row can never be touched (immutability).
-- WITH CHECK (true): the single approval transition must be allowed to land;
-- once landed, USING blocks every later update.
CREATE POLICY swatch_attempts_update ON swatch_attempts FOR UPDATE
  USING (status <> 'approved') WITH CHECK (true);
-- no DELETE policy → delete denied

-- Append-only logs: INSERT + SELECT only, no UPDATE/DELETE, no truncate
ALTER TABLE stock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_events_insert ON stock_events;
CREATE POLICY stock_events_insert ON stock_events FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS stock_events_select ON stock_events;
CREATE POLICY stock_events_select ON stock_events FOR SELECT USING (true);

ALTER TABLE operational_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_audit_insert ON operational_audit;
CREATE POLICY operational_audit_insert ON operational_audit FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS operational_audit_select ON operational_audit;
CREATE POLICY operational_audit_select ON operational_audit FOR SELECT USING (true);

ALTER TABLE swatch_attempt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE swatch_attempt_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS swatch_attempt_events_insert ON swatch_attempt_events;
CREATE POLICY swatch_attempt_events_insert ON swatch_attempt_events FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS swatch_attempt_events_select ON swatch_attempt_events;
CREATE POLICY swatch_attempt_events_select ON swatch_attempt_events FOR SELECT USING (true);

ALTER TABLE artwork_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE artwork_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artwork_events_insert ON artwork_events;
CREATE POLICY artwork_events_insert ON artwork_events FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS artwork_events_select ON artwork_events;
CREATE POLICY artwork_events_select ON artwork_events FOR SELECT USING (true);

ALTER TABLE shipment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipment_events_insert ON shipment_events;
CREATE POLICY shipment_events_insert ON shipment_events FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS shipment_events_select ON shipment_events;
CREATE POLICY shipment_events_select ON shipment_events FOR SELECT USING (true);
