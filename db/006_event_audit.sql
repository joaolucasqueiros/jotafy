-- Additive migration: preserve historical events; unknown session/time remains unknown.
ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS event_source text NOT NULL DEFAULT 'browser';
ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS test_event_code text;
ALTER TABLE ad_insights ADD COLUMN IF NOT EXISTS raw_actions jsonb;
ALTER TABLE ad_insights ADD COLUMN IF NOT EXISTS attribution_context jsonb;
ALTER TABLE ad_insights ADD COLUMN IF NOT EXISTS synced_at timestamptz;
CREATE INDEX IF NOT EXISTS tracking_events_audit_period ON tracking_events(workspace_id, (COALESCE(occurred_at,created_at)));
-- Keep attribution when the older attribution-click is purged by retention.
ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS campaign_id text;
ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS adset_id text;
ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS ad_id text;
UPDATE tracking_events e SET campaign_id=c.campaign_id,adset_id=c.adset_id,ad_id=c.ad_id
FROM clicks c WHERE e.click_id=c.id AND e.workspace_id=c.workspace_id
AND e.campaign_id IS NULL AND e.adset_id IS NULL AND e.ad_id IS NULL;
ALTER TABLE webhook_receipts ADD COLUMN IF NOT EXISTS external_order_id text;
ALTER TABLE webhook_receipts ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE webhook_receipts ADD COLUMN IF NOT EXISTS processing_status text;
ALTER TABLE webhook_receipts ADD COLUMN IF NOT EXISTS reason text;
