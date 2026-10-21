CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
 name text NOT NULL, password_hash text, facebook_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL DEFAULT 'Meu workspace', public_key text UNIQUE NOT NULL,
 cakto_secret text, pixel_id text, capi_token text, test_event_code text,
 allowed_origins text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_limits (
 key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS meta_connections (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
 meta_user_id text NOT NULL, token text NOT NULL, expires_at timestamptz NOT NULL,
 last_sync_at timestamptz
);
CREATE TABLE IF NOT EXISTS ad_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 external_id text NOT NULL, name text NOT NULL, currency text NOT NULL, timezone text NOT NULL,
 selected boolean NOT NULL DEFAULT false, UNIQUE(workspace_id, external_id)
);
CREATE TABLE IF NOT EXISTS campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 account_id text NOT NULL, external_id text NOT NULL, name text NOT NULL, status text NOT NULL,
 daily_budget bigint, objective text, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id, external_id)
);
CREATE TABLE IF NOT EXISTS adsets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 external_id text NOT NULL, campaign_id text NOT NULL, name text NOT NULL, status text NOT NULL,
 daily_budget bigint, UNIQUE(workspace_id, external_id)
);
CREATE TABLE IF NOT EXISTS ads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 external_id text NOT NULL, adset_id text NOT NULL, campaign_id text NOT NULL, name text NOT NULL, status text NOT NULL,
 UNIQUE(workspace_id, external_id)
);
CREATE TABLE IF NOT EXISTS ad_insights (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 ad_id text NOT NULL, adset_id text NOT NULL, campaign_id text NOT NULL, day date NOT NULL,
 spend bigint NOT NULL DEFAULT 0, clicks integer NOT NULL DEFAULT 0, impressions integer NOT NULL DEFAULT 0,
 PRIMARY KEY(workspace_id, ad_id, day)
);
CREATE TABLE IF NOT EXISTS clicks (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 campaign_id text, adset_id text, ad_id text, utm_source text, utm_medium text, utm_campaign text,
 utm_content text, utm_term text, fbc text, fbp text, landing_url text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clicks_workspace_created ON clicks(workspace_id, created_at);
CREATE TABLE IF NOT EXISTS tracking_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 event_id text NOT NULL, event_name text NOT NULL, click_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id, event_id)
);
CREATE TABLE IF NOT EXISTS orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 provider text NOT NULL DEFAULT 'cakto', external_id text NOT NULL, status text NOT NULL,
 amount bigint NOT NULL CHECK(amount >= 0), currency text NOT NULL DEFAULT 'BRL', product text NOT NULL,
 customer_hash text, campaign_id text, adset_id text, ad_id text, click_id uuid,
 attribution text NOT NULL, payment_method text, occurred_at timestamptz NOT NULL,
 purchased_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id, provider, external_id)
);
CREATE INDEX IF NOT EXISTS orders_workspace_occurred ON orders(workspace_id, occurred_at);
CREATE TABLE IF NOT EXISTS webhook_receipts (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 event_key text NOT NULL, event_name text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id, event_key)
);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 kind text NOT NULL, dedupe_key text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 run_at timestamptz NOT NULL DEFAULT now(), locked_until timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(workspace_id, kind, dedupe_key)
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, run_at);
CREATE TABLE IF NOT EXISTS audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 action text NOT NULL, target text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
