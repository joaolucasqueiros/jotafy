-- Only hashes of customer access credentials are stored. Files remain in private R2.
CREATE TABLE IF NOT EXISTS delivery_access (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 grant_hash text NOT NULL UNIQUE CHECK (grant_hash ~ '^[a-f0-9]{64}$'),
 grant_expires_at timestamptz NOT NULL,
 session_hash text UNIQUE CHECK (session_hash ~ '^[a-f0-9]{64}$'),
 session_expires_at timestamptz,
 redeemed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_access_order ON delivery_access(workspace_id,order_id);
