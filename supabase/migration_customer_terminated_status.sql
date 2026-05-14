-- Add terminated customer status.
-- Run this in Supabase SQL Editor before saving terminated customers.

ALTER TABLE public.customers
DROP CONSTRAINT IF EXISTS customers_status_check;

ALTER TABLE public.customers
ADD CONSTRAINT customers_status_check
CHECK (status IN ('active', 'expired', 'terminated', 'inactive'));
