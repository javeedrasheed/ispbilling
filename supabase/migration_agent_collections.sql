-- Run this on existing ISP Billing databases to track agent-wise collections
-- and record cash/amount received from collection agents.

ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS collected_by_user_id UUID REFERENCES public.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_collected_by
ON public.payments (collected_by_user_id);

CREATE TABLE IF NOT EXISTS public.agent_collection_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  received_by_user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  received_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_collection_receipts_agent
ON public.agent_collection_receipts (agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_collection_receipts_date
ON public.agent_collection_receipts (received_date);

ALTER TABLE public.agent_collection_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acr_all_anon" ON public.agent_collection_receipts;
DROP POLICY IF EXISTS "acr_all_authenticated" ON public.agent_collection_receipts;

CREATE POLICY "acr_all_anon"
ON public.agent_collection_receipts
FOR ALL TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "acr_all_authenticated"
ON public.agent_collection_receipts
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.agent_area_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  area_id UUID NOT NULL REFERENCES public.areas (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, area_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_area_access_agent
ON public.agent_area_access (agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_area_access_area
ON public.agent_area_access (area_id);

ALTER TABLE public.agent_area_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aaa_all_anon" ON public.agent_area_access;
DROP POLICY IF EXISTS "aaa_all_authenticated" ON public.agent_area_access;

CREATE POLICY "aaa_all_anon"
ON public.agent_area_access
FOR ALL TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "aaa_all_authenticated"
ON public.agent_area_access
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);
