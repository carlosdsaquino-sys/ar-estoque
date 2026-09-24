BEGIN;

ALTER TABLE public.clients
  ADD COLUMN archived_at timestamptz;

CREATE INDEX clients_archived_at_idx ON public.clients(archived_at);

-- Permanent deletion is available only through the guarded transaction below.
DROP POLICY IF EXISTS admin_delete_client ON public.clients;
REVOKE DELETE ON public.clients FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_client_archived(p_client_id uuid, p_archived boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_client public.clients;
BEGIN
  PERFORM public.require_member(true);
  PERFORM pg_advisory_xact_lock(82022026);

  SELECT * INTO v_client FROM public.clients WHERE id=p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado.'; END IF;

  UPDATE public.clients
  SET archived_at = CASE
        WHEN p_archived THEN coalesce(v_client.archived_at, clock_timestamp())
        ELSE NULL
      END,
      updated_at = clock_timestamp()
  WHERE id=p_client_id;
END;
$$;

CREATE FUNCTION public.permanently_delete_archived_client(p_client_id uuid, p_confirmation_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_client public.clients;
BEGIN
  PERFORM public.require_member(true);
  PERFORM pg_advisory_xact_lock(82022026);

  SELECT * INTO v_client FROM public.clients WHERE id=p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado.'; END IF;
  IF v_client.archived_at IS NULL THEN
    RAISE EXCEPTION 'O cliente precisa ser arquivado antes da exclusão permanente.';
  END IF;
  IF p_confirmation_name IS DISTINCT FROM v_client.name THEN
    RAISE EXCEPTION 'O nome informado não corresponde exatamente ao cliente.';
  END IF;

  -- Service-owned rows (materials, appliances, performed services and service
  -- audit history) cascade from services. Movement rows intentionally survive:
  -- their client_id/service_id foreign keys are ON DELETE SET NULL, preserving
  -- the stock ledger and its effect on balances.
  DELETE FROM public.services WHERE client_id=p_client_id;
  DELETE FROM public.clients WHERE id=p_client_id;
END;
$$;

CREATE FUNCTION public.guard_active_client_on_service() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.client_id = NEW.client_id THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(82022026);
  IF EXISTS (
    SELECT 1 FROM public.clients
    WHERE id=NEW.client_id AND archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cliente arquivado não pode ser vinculado a um novo atendimento.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER services_require_active_client
  BEFORE INSERT OR UPDATE OF client_id ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.guard_active_client_on_service();

REVOKE ALL ON FUNCTION public.set_client_archived(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_archived(uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.permanently_delete_archived_client(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.permanently_delete_archived_client(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.guard_active_client_on_service() FROM PUBLIC, anon, authenticated;

COMMIT;
