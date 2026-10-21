ALTER TABLE ad_insights ADD COLUMN IF NOT EXISTS landing_page_views integer NOT NULL DEFAULT 0;
