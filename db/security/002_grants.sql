-- 002_grants.sql — least-privilege table grants for fanela_app
-- Order: schema migration → this file → 003_rls.sql → app deploy (spec §6.3)

-- Append-only tables: INSERT + SELECT only
GRANT INSERT, SELECT ON stock_events TO fanela_app;
GRANT INSERT, SELECT ON operational_audit TO fanela_app;
GRANT INSERT, SELECT ON swatch_attempt_events TO fanela_app;
GRANT INSERT, SELECT ON artwork_events TO fanela_app;
GRANT INSERT, SELECT ON shipment_events TO fanela_app;
GRANT INSERT, SELECT ON login_attempts TO fanela_app;
GRANT INSERT, SELECT ON upload_attempts TO fanela_app;

-- Everything else: full DML (RLS narrows UPDATE where needed)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  departments, users, roles, permissions, role_permissions, user_roles,
  user_departments, sessions, pending_mfa,
  customers, products, product_skus,
  jobs, job_contact_snapshot, job_dispatch_snapshot, job_lines, job_line_sizes,
  job_stages, print_positions, screen_records,
  artworks, artwork_versions, artwork_assets,
  swatch_requirements, swatch_attempts, swatch_assets,
  shipments, shipment_attachments, files,
  import_batches, integration_outbox
TO fanela_app;

-- Belt + braces: revoke dangerous privileges even if a future grant adds them
REVOKE UPDATE, DELETE, TRUNCATE ON stock_events, operational_audit,
  swatch_attempt_events, artwork_events, shipment_events, login_attempts, upload_attempts FROM fanela_app;
-- Swatch attempts are never deleted (spec §9: attempts immutable once approved)
REVOKE DELETE, TRUNCATE ON swatch_attempts FROM fanela_app;
