-- Additive migration for bounded, candle-derived lifecycle path signatures.
-- Apply explicitly in Supabase before deploying code that writes the column.
-- No historical rows are mutated by this migration.
ALTER TABLE trade_logs
  ADD COLUMN IF NOT EXISTS excursion_path JSONB;

COMMENT ON COLUMN trade_logs.excursion_path IS
  'Bounded lossy 1m R-path; <=96 events, OHLC high/low order is ambiguous.';

ALTER TABLE trade_logs
  DROP CONSTRAINT IF EXISTS trade_logs_excursion_path_bounded;

ALTER TABLE trade_logs
  ADD CONSTRAINT trade_logs_excursion_path_bounded CHECK (
    excursion_path IS NULL OR (
      jsonb_typeof(excursion_path) = 'object' AND
      jsonb_typeof(excursion_path -> 'events') = 'array' AND
      jsonb_array_length(excursion_path -> 'events') <= 96
    )
  ) NOT VALID;
