-- ISP Billing Management System — Supabase schema
-- Run in Supabase SQL Editor (or migrations). Enable pgcrypto for password hash seeding.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'manager', 'collector')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_name VARCHAR(255) NOT NULL,
  parent_area_id UUID REFERENCES public.areas (id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_name VARCHAR(255) NOT NULL,
  speed_mbps INTEGER NOT NULL,
  price NUMERIC(12, 2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.area_package_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id UUID NOT NULL REFERENCES public.areas (id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES public.packages (id) ON DELETE CASCADE,
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(12, 2) NOT NULL,
  UNIQUE (area_id, package_id)
);

CREATE TABLE IF NOT EXISTS public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method_name VARCHAR(100) NOT NULL,
  method_type VARCHAR(50) NOT NULL DEFAULT 'other',
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pppoe_id VARCHAR(100) NOT NULL UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  area_id UUID REFERENCES public.areas (id) ON DELETE SET NULL,
  address TEXT,
  package_id UUID REFERENCES public.packages (id) ON DELETE SET NULL,
  installation_date DATE,
  package_expiry_date DATE,
  due_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  individual_discount_type VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (individual_discount_type IN ('percentage', 'fixed', 'none')),
  individual_discount_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  payment_method_id UUID REFERENCES public.payment_methods (id) ON DELETE SET NULL,
  total_amount NUMERIC(12, 2) NOT NULL,
  paid_amount NUMERIC(12, 2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  old_expiry_date DATE,
  new_expiry_date DATE,
  recharge_month VARCHAR(120),
  transaction_id VARCHAR(255),
  notes TEXT,
  invoice_number VARCHAR(100) NOT NULL,
  is_partial BOOLEAN NOT NULL DEFAULT FALSE,
  payment_status VARCHAR(50) NOT NULL DEFAULT 'completed'
);

CREATE INDEX IF NOT EXISTS idx_customers_area ON public.customers (area_id);
CREATE INDEX IF NOT EXISTS idx_customers_package ON public.customers (package_id);
CREATE INDEX IF NOT EXISTS idx_customers_status ON public.customers (status);
CREATE INDEX IF NOT EXISTS idx_customers_expiry ON public.customers (package_expiry_date);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON public.payments (customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments (payment_date);

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

-- ---------------------------------------------------------------------------
-- Row Level Security (permissive for anon — replace in production)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "users_all_anon" ON public.users;
DROP POLICY IF EXISTS "users_all_authenticated" ON public.users;
DROP POLICY IF EXISTS "areas_all_anon" ON public.areas;
DROP POLICY IF EXISTS "areas_all_authenticated" ON public.areas;
DROP POLICY IF EXISTS "packages_all_anon" ON public.packages;
DROP POLICY IF EXISTS "packages_all_authenticated" ON public.packages;
DROP POLICY IF EXISTS "apd_all_anon" ON public.area_package_discounts;
DROP POLICY IF EXISTS "apd_all_authenticated" ON public.area_package_discounts;
DROP POLICY IF EXISTS "pm_all_anon" ON public.payment_methods;
DROP POLICY IF EXISTS "pm_all_authenticated" ON public.payment_methods;
DROP POLICY IF EXISTS "customers_all_anon" ON public.customers;
DROP POLICY IF EXISTS "customers_all_authenticated" ON public.customers;
DROP POLICY IF EXISTS "payments_all_anon" ON public.payments;
DROP POLICY IF EXISTS "payments_all_authenticated" ON public.payments;
DROP POLICY IF EXISTS "due_charges_all_anon" ON public.customer_due_charges;
DROP POLICY IF EXISTS "due_charges_all_authenticated" ON public.customer_due_charges;
DROP POLICY IF EXISTS "pda_all_anon" ON public.payment_due_allocations;
DROP POLICY IF EXISTS "pda_all_authenticated" ON public.payment_due_allocations;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.area_package_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_due_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_due_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_all_anon" ON public.users FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "users_all_authenticated" ON public.users FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "areas_all_anon" ON public.areas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "areas_all_authenticated" ON public.areas FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "packages_all_anon" ON public.packages FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "packages_all_authenticated" ON public.packages FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "apd_all_anon" ON public.area_package_discounts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "apd_all_authenticated" ON public.area_package_discounts FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "pm_all_anon" ON public.payment_methods FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "pm_all_authenticated" ON public.payment_methods FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "customers_all_anon" ON public.customers FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "customers_all_authenticated" ON public.customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "payments_all_anon" ON public.payments FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "payments_all_authenticated" ON public.payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "due_charges_all_anon" ON public.customer_due_charges FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "due_charges_all_authenticated" ON public.customer_due_charges FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "pda_all_anon" ON public.payment_due_allocations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "pda_all_authenticated" ON public.payment_due_allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------

INSERT INTO public.users (username, email, password_hash, full_name, role, is_active)
VALUES (
  'admin',
  'admin@isp.local',
  encode(digest('Admin@123', 'sha256'), 'hex'),
  'System Administrator',
  'admin',
  TRUE
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO public.payment_methods (method_name, method_type, is_active)
SELECT v.method_name, v.method_type, v.is_active
FROM (
  VALUES
    ('Cash', 'cash', TRUE),
    ('Easypaisa', 'wallet', TRUE),
    ('JazzCash', 'wallet', TRUE),
    ('Bank Transfer', 'bank', TRUE)
) AS v(method_name, method_type, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_methods pm WHERE pm.method_name = v.method_name
);
