BEGIN;

-- Keep the selected technician separate from the authenticated creator.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS technician_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Link historical snapshots only when a profile name is an unambiguous match.
WITH unique_matches AS (
  SELECT lower(btrim(p.name)) AS normalized_name, min(p.id::text)::uuid AS id
  FROM public.profiles p
  GROUP BY lower(btrim(p.name))
  HAVING count(*) = 1
)
UPDATE public.services s
SET technician_id = matches.id
FROM unique_matches matches
WHERE s.technician_id IS NULL
  AND lower(btrim(s.technician)) = matches.normalized_name;

-- Expose only the fields needed by the technician selector. Profile RLS remains
-- unchanged, so operators do not gain broad access to other profile records.
CREATE FUNCTION public.list_service_technicians()
RETURNS TABLE(id uuid, name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.require_member();
  RETURN QUERY
    SELECT p.id, p.name
    FROM public.profiles p
    WHERE p.is_active AND p.role IN ('admin', 'operador') AND nullif(btrim(p.name), '') IS NOT NULL
    ORDER BY p.name, p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.list_service_technicians() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_service_technicians() TO authenticated;

-- The save RPC passes its selected technician through transaction-local state.
-- This trigger validates and canonicalizes the profile name. The retained legacy
-- RPC can still resolve a supplied name, but only to one active profile.
CREATE OR REPLACE FUNCTION public.set_service_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_id uuid;
  v_name text;
  v_context_id text;
  v_matches integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;

  v_context_id := nullif(current_setting('ar_estoque.selected_technician_id', true), '');
  IF v_context_id IS NOT NULL THEN
    BEGIN
      v_id := v_context_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Técnico responsável inválido';
    END;
  ELSE
    v_id := NEW.technician_id;
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT p.name INTO v_name
    FROM public.profiles p
    WHERE p.id = v_id AND p.is_active AND p.role IN ('admin', 'operador');
    IF NOT FOUND OR nullif(btrim(v_name), '') IS NULL THEN
      RAISE EXCEPTION 'Técnico inativo, inexistente ou sem perfil compatível';
    END IF;
  ELSE
    -- Service rows are initially inserted with only client_id/created_by by the
    -- legacy atomic save functions. They set a technician in their final UPDATE.
    IF TG_OP = 'INSERT' AND nullif(btrim(coalesce(NEW.technician, '')), '') IS NULL THEN
      NEW.created_by := auth.uid();
      RETURN NEW;
    END IF;
    SELECT count(*) INTO v_matches
    FROM public.profiles p
    WHERE p.is_active AND p.role IN ('admin', 'operador')
      AND lower(btrim(p.name)) = lower(btrim(coalesce(NEW.technician, '')));
    IF v_matches <> 1 THEN
      RAISE EXCEPTION 'Selecione um técnico ativo válido';
    END IF;
    SELECT p.id, p.name INTO v_id, v_name
    FROM public.profiles p
    WHERE p.is_active AND p.role IN ('admin', 'operador')
      AND lower(btrim(p.name)) = lower(btrim(coalesce(NEW.technician, '')));
  END IF;

  NEW.technician_id := v_id;
  NEW.technician := v_name;
  IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS services_authenticated_actor ON public.services;
CREATE TRIGGER services_authenticated_actor
BEFORE INSERT OR UPDATE OF technician, technician_id ON public.services
FOR EACH ROW EXECUTE FUNCTION public.set_service_actor();

-- Validate the selected profile before delegating to the existing atomic save
-- operation. The original RPC still derives created_by from auth.uid().
CREATE FUNCTION public.save_service_visit_as_technician(
  p_service_id uuid,
  p_data jsonb,
  p_appliances jsonb,
  p_confirm boolean,
  p_request_id uuid,
  p_expected_version integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_technician_id uuid;
  v_name text;
  v_result uuid;
BEGIN
  PERFORM public.require_member();
  BEGIN
    v_technician_id := nullif(p_data->>'technician_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Técnico responsável inválido';
  END;
  IF v_technician_id IS NULL THEN RAISE EXCEPTION 'Selecione o técnico responsável'; END IF;

  SELECT p.name INTO v_name
  FROM public.profiles p
  WHERE p.id = v_technician_id AND p.is_active AND p.role IN ('admin', 'operador');
  IF NOT FOUND OR nullif(btrim(v_name), '') IS NULL THEN
    RAISE EXCEPTION 'Técnico inativo, inexistente ou sem perfil compatível';
  END IF;

  PERFORM set_config('ar_estoque.selected_technician_id', v_technician_id::text, true);
  v_result := public.save_service_visit(p_service_id, p_data, p_appliances, p_confirm, p_request_id, p_expected_version);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.save_service_visit_as_technician(uuid,jsonb,jsonb,boolean,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_service_visit_as_technician(uuid,jsonb,jsonb,boolean,uuid,integer) TO authenticated;
-- Prevent clients from bypassing the wrapper's required selected-technician check.
REVOKE ALL ON FUNCTION public.save_service_visit(uuid,jsonb,jsonb,boolean,uuid,integer) FROM PUBLIC, anon, authenticated;

COMMIT;
