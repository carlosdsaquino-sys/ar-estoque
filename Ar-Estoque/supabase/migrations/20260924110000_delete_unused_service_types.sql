BEGIN;

CREATE FUNCTION public.delete_service_type(p_service_type_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.require_member(true);
  PERFORM pg_advisory_xact_lock(82022026);

  PERFORM 1 FROM public.service_types WHERE id=p_service_type_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de serviço não encontrado.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.performed_services WHERE service_type_id=p_service_type_id) THEN
    RAISE EXCEPTION 'Este tipo de serviço já foi utilizado em atendimentos e não pode ser excluído. Inative-o para preservar o histórico.';
  END IF;

  DELETE FROM public.service_types WHERE id=p_service_type_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_service_type(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_service_type(uuid) TO authenticated;

COMMIT;
