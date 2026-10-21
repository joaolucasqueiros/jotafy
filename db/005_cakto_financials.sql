ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS cakto_account_email text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_fees bigint CHECK(provider_fees >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_breakdown jsonb;
