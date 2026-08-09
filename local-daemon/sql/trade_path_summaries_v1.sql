BEGIN;

CREATE TABLE IF NOT EXISTS public.trade_path_summaries (
  trade_id UUID PRIMARY KEY REFERENCES public.trade_logs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  interval TEXT,
  opened_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary JSONB NOT NULL,
  CONSTRAINT trade_path_summary_version CHECK (summary ? 'path_version'),
  CONSTRAINT trade_path_summary_size CHECK (pg_column_size(summary) <= 16384)
);

-- CREATE TABLE IF NOT EXISTS does not repair a partially created table.
-- Keep the migration additive so rerunning it can complete that state.
ALTER TABLE public.trade_path_summaries
  ADD COLUMN IF NOT EXISTS trade_id UUID,
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS interval TEXT,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS summary JSONB;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.trade_path_summaries
    WHERE trade_id IS NULL OR symbol IS NULL OR
      updated_at IS NULL OR summary IS NULL
  ) THEN
    RAISE EXCEPTION
      'Refusing to enforce live path schema: existing rows have required NULL fields';
  END IF;
END
$$;

ALTER TABLE public.trade_path_summaries
  ALTER COLUMN trade_id SET NOT NULL,
  ALTER COLUMN symbol SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN summary SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS trade_path_summaries_trade_id_uidx
  ON public.trade_path_summaries(trade_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.trade_path_summaries'::regclass
      AND conname = 'trade_path_summaries_trade_id_fkey'
  ) THEN
    ALTER TABLE public.trade_path_summaries
      ADD CONSTRAINT trade_path_summaries_trade_id_fkey
      FOREIGN KEY (trade_id) REFERENCES public.trade_logs(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

ALTER TABLE public.trade_path_summaries
  DROP CONSTRAINT IF EXISTS trade_path_summary_version,
  DROP CONSTRAINT IF EXISTS trade_path_summary_size;

ALTER TABLE public.trade_path_summaries
  ADD CONSTRAINT trade_path_summary_version
    CHECK (summary ? 'path_version'),
  ADD CONSTRAINT trade_path_summary_size
    CHECK (pg_column_size(summary) <= 16384);

CREATE INDEX IF NOT EXISTS trade_path_summaries_updated_at_idx
  ON public.trade_path_summaries(updated_at DESC);

ALTER TABLE public.trade_path_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_path_summaries_anon_read
  ON public.trade_path_summaries;
CREATE POLICY trade_path_summaries_anon_read
  ON public.trade_path_summaries FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS trade_path_summaries_anon_insert
  ON public.trade_path_summaries;
CREATE POLICY trade_path_summaries_anon_insert
  ON public.trade_path_summaries FOR INSERT TO anon
  WITH CHECK (summary->>'source' = 'BINANCE_FUTURES_MARK_PRICE_WS_1S');

DROP POLICY IF EXISTS trade_path_summaries_anon_update
  ON public.trade_path_summaries;
CREATE POLICY trade_path_summaries_anon_update
  ON public.trade_path_summaries FOR UPDATE TO anon
  USING (true)
  WITH CHECK (summary->>'source' = 'BINANCE_FUTURES_MARK_PRICE_WS_1S');

COMMENT ON TABLE public.trade_path_summaries IS
  'Bounded live Mark Price path summaries; no raw tick history.';

COMMIT;

-- Validation:
-- SELECT count(*), max(pg_column_size(summary)) FROM trade_path_summaries;
-- SELECT count(*) FROM trade_path_summaries WHERE summary->>'path_version' IS NULL;
-- Rollback (only before code deployment or after code rollback):
-- DROP TABLE public.trade_path_summaries;
