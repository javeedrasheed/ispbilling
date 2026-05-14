-- Run on existing ISP Billing databases that already have public.payments with recharge_month.
-- Adds per-line dues ledger and payment→charge allocation rows.

CREATE TABLE IF NOT EXISTS public.customer_due_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  amount_remaining NUMERIC(12, 2) NOT NULL CHECK (amount_remaining >= 0),
  category VARCHAR(40) NOT NULL,
  recharge_month VARCHAR(120),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_due_charge_remaining_le_amount CHECK (amount_remaining <= amount)
);

CREATE INDEX IF NOT EXISTS idx_due_charges_customer ON public.customer_due_charges (customer_id);
CREATE INDEX IF NOT EXISTS idx_due_charges_created ON public.customer_due_charges (created_at);

CREATE TABLE IF NOT EXISTS public.payment_due_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments (id) ON DELETE CASCADE,
  due_charge_id UUID NOT NULL REFERENCES public.customer_due_charges (id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_pda_payment ON public.payment_due_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_pda_charge ON public.payment_due_allocations (due_charge_id);

ALTER TABLE public.customer_due_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_due_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "due_charges_all_anon" ON public.customer_due_charges;
DROP POLICY IF EXISTS "due_charges_all_authenticated" ON public.customer_due_charges;
DROP POLICY IF EXISTS "pda_all_anon" ON public.payment_due_allocations;
DROP POLICY IF EXISTS "pda_all_authenticated" ON public.payment_due_allocations;

CREATE POLICY "due_charges_all_anon" ON public.customer_due_charges FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "due_charges_all_authenticated" ON public.customer_due_charges FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "pda_all_anon" ON public.payment_due_allocations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "pda_all_authenticated" ON public.payment_due_allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);
