CREATE TABLE IF NOT EXISTS cost_settings (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
 sales_tax_bps integer NOT NULL DEFAULT 0 CHECK(sales_tax_bps BETWEEN 0 AND 10000),
 fee_bps integer NOT NULL DEFAULT 0 CHECK(fee_bps BETWEEN 0 AND 10000),
 ad_tax_bps integer NOT NULL DEFAULT 0 CHECK(ad_tax_bps BETWEEN 0 AND 10000),
 product_cost bigint NOT NULL DEFAULT 0 CHECK(product_cost >= 0),
 daily_expenses bigint NOT NULL DEFAULT 0 CHECK(daily_expenses >= 0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
