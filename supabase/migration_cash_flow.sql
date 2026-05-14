-- Cash flow, payroll, expenses, material purchase, and daily wage module.
-- Run in Supabase SQL Editor before using the Cash Flow menu.

CREATE TABLE IF NOT EXISTS public.cash_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name VARCHAR(150) NOT NULL,
  account_type VARCHAR(40) NOT NULL CHECK (account_type IN ('cash_in_hand', 'bank', 'wallet', 'other')),
  opening_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.cash_accounts (id) ON DELETE CASCADE,
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('income', 'expense')),
  category VARCHAR(80) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  source_type VARCHAR(80),
  source_id UUID,
  created_by_user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  designation VARCHAR(120),
  salary_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.salary_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.cash_accounts (id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  salary_month VARCHAR(40) NOT NULL,
  paid_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by_user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.cash_accounts (id) ON DELETE SET NULL,
  expense_type VARCHAR(80) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  created_by_user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.material_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.cash_accounts (id) ON DELETE SET NULL,
  material_name VARCHAR(180) NOT NULL,
  material_type VARCHAR(120),
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
  unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  vendor TEXT,
  notes TEXT,
  created_by_user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.daily_wage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.cash_accounts (id) ON DELETE SET NULL,
  worker_name VARCHAR(180) NOT NULL,
  work_type VARCHAR(150) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by_user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_transactions_account ON public.cash_transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_date ON public.cash_transactions (transaction_date);
CREATE INDEX IF NOT EXISTS idx_salary_records_employee ON public.salary_records (employee_id);
CREATE INDEX IF NOT EXISTS idx_expense_records_date ON public.expense_records (expense_date);
CREATE INDEX IF NOT EXISTS idx_material_purchases_date ON public.material_purchases (purchase_date);
CREATE INDEX IF NOT EXISTS idx_daily_wage_records_date ON public.daily_wage_records (work_date);

ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_wage_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_accounts_all_anon" ON public.cash_accounts;
DROP POLICY IF EXISTS "cash_accounts_all_authenticated" ON public.cash_accounts;
DROP POLICY IF EXISTS "cash_transactions_all_anon" ON public.cash_transactions;
DROP POLICY IF EXISTS "cash_transactions_all_authenticated" ON public.cash_transactions;
DROP POLICY IF EXISTS "employees_all_anon" ON public.employees;
DROP POLICY IF EXISTS "employees_all_authenticated" ON public.employees;
DROP POLICY IF EXISTS "salary_records_all_anon" ON public.salary_records;
DROP POLICY IF EXISTS "salary_records_all_authenticated" ON public.salary_records;
DROP POLICY IF EXISTS "expense_records_all_anon" ON public.expense_records;
DROP POLICY IF EXISTS "expense_records_all_authenticated" ON public.expense_records;
DROP POLICY IF EXISTS "material_purchases_all_anon" ON public.material_purchases;
DROP POLICY IF EXISTS "material_purchases_all_authenticated" ON public.material_purchases;
DROP POLICY IF EXISTS "daily_wage_records_all_anon" ON public.daily_wage_records;
DROP POLICY IF EXISTS "daily_wage_records_all_authenticated" ON public.daily_wage_records;

CREATE POLICY "cash_accounts_all_anon" ON public.cash_accounts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "cash_accounts_all_authenticated" ON public.cash_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "cash_transactions_all_anon" ON public.cash_transactions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "cash_transactions_all_authenticated" ON public.cash_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "employees_all_anon" ON public.employees FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "employees_all_authenticated" ON public.employees FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "salary_records_all_anon" ON public.salary_records FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "salary_records_all_authenticated" ON public.salary_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "expense_records_all_anon" ON public.expense_records FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "expense_records_all_authenticated" ON public.expense_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "material_purchases_all_anon" ON public.material_purchases FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "material_purchases_all_authenticated" ON public.material_purchases FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "daily_wage_records_all_anon" ON public.daily_wage_records FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "daily_wage_records_all_authenticated" ON public.daily_wage_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
