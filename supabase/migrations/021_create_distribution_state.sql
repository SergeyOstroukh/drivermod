-- Shared distribution state per day (sync across computers)
CREATE TABLE IF NOT EXISTS public.distribution_state (
    id BIGSERIAL PRIMARY KEY,
    state_date DATE NOT NULL DEFAULT CURRENT_DATE,
    state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_distribution_state_date
    ON public.distribution_state(state_date);

CREATE OR REPLACE FUNCTION update_distribution_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_distribution_state_updated_at ON public.distribution_state;
CREATE TRIGGER trigger_distribution_state_updated_at
    BEFORE UPDATE ON public.distribution_state
    FOR EACH ROW
    EXECUTE FUNCTION update_distribution_state_updated_at();

ALTER TABLE public.distribution_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to distribution_state" ON public.distribution_state
    FOR ALL USING (true) WITH CHECK (true);
