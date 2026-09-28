BEGIN;

-- A permanent client deletion removes its service rows, while cash movements
-- and payment event snapshots must remain available for financial history.
-- Detach the payment event from its deleted service instead of blocking the
-- client deletion or deleting the financial record.
ALTER TABLE public.service_payment_events
  DROP CONSTRAINT service_payment_events_service_id_fkey;

ALTER TABLE public.service_payment_events
  ALTER COLUMN service_id DROP NOT NULL;

ALTER TABLE public.service_payment_events
  ADD CONSTRAINT service_payment_events_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE SET NULL;

COMMIT;
