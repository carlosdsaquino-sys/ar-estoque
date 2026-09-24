BEGIN;

CREATE TABLE public.service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  default_price numeric NOT NULL DEFAULT 0 CHECK (default_price >= 0 AND default_price < 'Infinity'::numeric),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(name)) > 0)
);
ALTER TABLE public.service_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_types_member_read ON public.service_types FOR SELECT TO authenticated USING (public.app_member());
CREATE POLICY service_types_admin_insert ON public.service_types FOR INSERT TO authenticated WITH CHECK (public.app_admin());
CREATE POLICY service_types_admin_update ON public.service_types FOR UPDATE TO authenticated USING (public.app_admin()) WITH CHECK (public.app_admin());
REVOKE DELETE ON public.service_types FROM anon, authenticated;

CREATE TABLE public.service_appliances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  appliance_number integer NOT NULL CHECK (appliance_number > 0),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, appliance_number)
);
CREATE INDEX service_appliances_service_idx ON public.service_appliances(service_id);
ALTER TABLE public.service_appliances ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_appliances_member_read ON public.service_appliances FOR SELECT TO authenticated USING (public.app_member());
REVOKE INSERT, UPDATE, DELETE ON public.service_appliances FROM anon, authenticated;

CREATE TABLE public.performed_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appliance_id uuid NOT NULL REFERENCES public.service_appliances(id) ON DELETE CASCADE,
  service_type_id uuid REFERENCES public.service_types(id) ON DELETE SET NULL,
  name_snapshot text NOT NULL,
  description_snapshot text NOT NULL DEFAULT '',
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0 AND unit_price < 'Infinity'::numeric),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(name_snapshot)) > 0)
);
CREATE INDEX performed_services_appliance_idx ON public.performed_services(appliance_id);
CREATE INDEX performed_services_type_idx ON public.performed_services(service_type_id);
ALTER TABLE public.performed_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY performed_services_member_read ON public.performed_services FOR SELECT TO authenticated USING (public.app_member());
REVOKE INSERT, UPDATE, DELETE ON public.performed_services FROM anon, authenticated;

ALTER TABLE public.service_materials
  ADD COLUMN appliance_id uuid REFERENCES public.service_appliances(id) ON DELETE SET NULL;
CREATE INDEX service_materials_appliance_idx ON public.service_materials(appliance_id);

-- Existing appointments had no appliance breakdown. Preserve their values as
-- one legacy appliance and one snapshot service line, then associate materials.
INSERT INTO public.service_appliances(service_id, appliance_number)
SELECT id, 1 FROM public.services
ON CONFLICT (service_id, appliance_number) DO NOTHING;

INSERT INTO public.performed_services(appliance_id, name_snapshot, description_snapshot, unit_price)
SELECT a.id,
       coalesce(nullif(trim(s.description), ''), 'Serviço registrado'),
       'Item migrado do registro anterior',
       coalesce(s.labor_value, 0)
FROM public.services s
JOIN public.service_appliances a ON a.service_id = s.id AND a.appliance_number = 1
WHERE NOT EXISTS (SELECT 1 FROM public.performed_services ps WHERE ps.appliance_id = a.id);

UPDATE public.service_materials m
SET appliance_id = a.id
FROM public.service_appliances a
WHERE a.service_id = m.service_id AND a.appliance_number = 1 AND m.appliance_id IS NULL;

-- Enforce authenticated ownership and technician naming even for the retained
-- legacy save_service RPC or an older browser tab still open during rollout.
CREATE FUNCTION public.set_service_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;
  SELECT coalesce(nullif(btrim(name), ''), 'Usuário') INTO v_name FROM public.profiles WHERE id = auth.uid();
  IF v_name IS NULL THEN RAISE EXCEPTION 'Perfil do usuário autenticado não encontrado'; END IF;
  NEW.technician := v_name;
  IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER services_authenticated_actor
BEFORE INSERT OR UPDATE OF technician ON public.services
FOR EACH ROW EXECUTE FUNCTION public.set_service_actor();

CREATE FUNCTION public.save_service_visit(
  p_service_id uuid,
  p_data jsonb,
  p_appliances jsonb,
  p_confirm boolean,
  p_request_id uuid,
  p_expected_version integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  s public.services;
  v_id uuid;
  v_old jsonb;
  v_old_appliances jsonb;
  v_old_tasks jsonb;
  v_old_materials jsonb;
  v_new_appliances jsonb;
  v_appliance_id uuid;
  v_appliance_number integer := 0;
  v_device jsonb;
  v_task jsonb;
  v_material jsonb;
  v_type public.service_types;
  v_product public.products;
  v_task_id uuid;
  v_name text;
  v_description text;
  v_price numeric;
  v_unit_cost numeric;
  v_unit_id uuid;
  v_quantity numeric;
  v_material_total numeric := 0;
  v_service_total numeric := 0;
  v_discount numeric;
  v_total numeric;
  v_actor_name text;
  v_was_confirmed boolean := false;
  v_old_material record;
  v_old_movement record;
  v_req record;
  v_payload jsonb;
BEGIN
  PERFORM public.require_member();
  PERFORM pg_advisory_xact_lock(82022026);
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identificador obrigatório'; END IF;
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR jsonb_typeof(p_appliances) IS DISTINCT FROM 'array' OR jsonb_array_length(p_appliances) = 0 THEN
    RAISE EXCEPTION 'Informe os dados do atendimento e ao menos um aparelho';
  END IF;
  SELECT nullif(btrim(name), '') INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
  IF v_actor_name IS NULL THEN RAISE EXCEPTION 'Perfil do usuário autenticado não encontrado'; END IF;
  v_discount := round((p_data->>'discount')::numeric, 2);
  IF v_discount IS NULL OR v_discount < 0 OR v_discount >= 'Infinity'::numeric THEN RAISE EXCEPTION 'Desconto inválido'; END IF;
  IF nullif(trim(p_data->>'client_id'), '') IS NULL OR nullif(trim(p_data->>'service_date'), '') IS NULL OR nullif(trim(p_data->>'description'), '') IS NULL THEN
    RAISE EXCEPTION 'Preencha cliente, data e descrição do atendimento';
  END IF;
  v_payload := jsonb_build_array(p_service_id, p_data - 'technician', p_appliances, p_confirm, p_expected_version);
  SELECT * INTO v_req FROM public.operation_requests WHERE actor = auth.uid() AND request_id = p_request_id;
  IF FOUND THEN
    IF v_req.operation <> 'service_visit' OR v_req.payload <> v_payload THEN RAISE EXCEPTION 'Identificador reutilizado com dados diferentes'; END IF;
    RETURN (v_req.result->>0)::uuid;
  END IF;

  IF p_service_id IS NOT NULL THEN
    SELECT * INTO s FROM public.services WHERE id = p_service_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
    IF s.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'O serviço foi alterado por outro usuário. Feche e atualize a lista.'; END IF;
    IF s.status = 'cancelado' THEN RAISE EXCEPTION 'Serviço cancelado não pode ser editado'; END IF;
    IF s.payment_status = 'pago' THEN RAISE EXCEPTION 'Corrija primeiro o pagamento antes de editar o serviço.'; END IF;
    v_id := s.id;
    v_was_confirmed := s.status = 'confirmado';
    v_old := to_jsonb(s);
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'appliance_number', a.appliance_number, 'notes', a.notes,
      'services', coalesce((SELECT jsonb_agg(jsonb_build_object('name', t.name_snapshot, 'description', t.description_snapshot, 'unit_price', t.unit_price) ORDER BY t.created_at)
        FROM public.performed_services t WHERE t.appliance_id = a.id), '[]'::jsonb),
      'materials', coalesce((SELECT jsonb_agg(jsonb_build_object('product_name', p.name, 'quantity', m.quantity, 'unit_price', m.unit_price, 'subtotal', m.subtotal) ORDER BY p.name)
        FROM public.service_materials m JOIN public.products p ON p.id = m.product_id WHERE m.appliance_id = a.id), '[]'::jsonb)
    ) ORDER BY a.appliance_number), '[]'::jsonb) INTO v_old_appliances FROM public.service_appliances a WHERE a.service_id = s.id;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_old_tasks
      FROM public.performed_services t JOIN public.service_appliances a ON a.id = t.appliance_id WHERE a.service_id = s.id;
    SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb) INTO v_old_materials FROM public.service_materials m WHERE m.service_id = s.id;
    IF v_was_confirmed THEN
      FOR v_old_movement IN
        SELECT mm.* FROM public.movements mm
        WHERE mm.service_id = s.id AND mm.type = 'saida'
          AND NOT EXISTS (SELECT 1 FROM public.movements r WHERE r.reversal_of = mm.id)
        ORDER BY mm.id
      LOOP
        PERFORM public.stock_delta(v_old_movement.product_id, -v_old_movement.quantity, v_old_movement.unit_cost, 'estorno', s.technician,
          'Correção dos materiais do serviço', s.client_id, s.id, v_old_movement.id);
      END LOOP;
    END IF;
  ELSE
    v_old := NULL;
    v_old_appliances := '[]'::jsonb;
    v_old_tasks := '[]'::jsonb;
    v_old_materials := '[]'::jsonb;
    INSERT INTO public.services(client_id, created_by) VALUES ((p_data->>'client_id')::uuid, auth.uid()) RETURNING id INTO v_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_appliances) d
    WHERE jsonb_typeof(d->'services') IS DISTINCT FROM 'array'
       OR jsonb_array_length(d->'services') = 0
       OR jsonb_typeof(coalesce(d->'materials', '[]'::jsonb)) IS DISTINCT FROM 'array'
  ) THEN RAISE EXCEPTION 'Cada aparelho precisa ter ao menos um serviço e uma lista válida de materiais'; END IF;

  IF p_service_id IS NOT NULL THEN
    DELETE FROM public.service_materials WHERE service_id = v_id;
    DELETE FROM public.service_appliances WHERE service_id = v_id;
  END IF;

  FOR v_device IN SELECT value FROM jsonb_array_elements(p_appliances) LOOP
    v_appliance_number := v_appliance_number + 1;
    INSERT INTO public.service_appliances(service_id, appliance_number, notes)
    VALUES (v_id, v_appliance_number, coalesce(v_device->>'notes', '')) RETURNING id INTO v_appliance_id;

    FOR v_task IN SELECT value FROM jsonb_array_elements(v_device->'services') LOOP
      v_name := NULL;
      v_description := NULL;
      v_price := round((v_task->>'unit_price')::numeric, 2);
      IF v_price IS NULL OR v_price < 0 OR v_price >= 'Infinity'::numeric THEN RAISE EXCEPTION 'Preço de serviço inválido'; END IF;
      IF nullif(v_task->>'service_type_id', '') IS NULL THEN
        IF nullif(v_task->>'id', '') IS NOT NULL THEN
          SELECT x->>'name_snapshot', x->>'description_snapshot' INTO v_name, v_description
          FROM jsonb_array_elements(v_old_tasks) x
          WHERE x->>'id' = v_task->>'id' AND x->>'service_type_id' IS NULL;
        ELSIF p_service_id IS NOT NULL AND jsonb_array_length(v_old_tasks) = 0 AND v_task->>'is_legacy' = 'true'
          AND (SELECT count(*) FROM jsonb_array_elements(p_appliances) d CROSS JOIN jsonb_array_elements(d->'services') t WHERE t->>'is_legacy' = 'true') = 1 THEN
          v_name := coalesce(nullif(trim(s.description), ''), 'Serviço registrado');
          v_description := 'Registro anterior';
        END IF;
        IF v_name IS NULL THEN RAISE EXCEPTION 'Selecione um tipo de serviço cadastrado'; END IF;
      ELSE
        SELECT * INTO v_type FROM public.service_types WHERE id = (v_task->>'service_type_id')::uuid;
        IF NOT FOUND THEN RAISE EXCEPTION 'Tipo de serviço inativo ou inexistente'; END IF;
        IF NOT v_type.is_active AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_old_tasks) old_task
          WHERE old_task->>'id' = v_task->>'id' AND old_task->>'service_type_id' = v_type.id::text
        ) THEN RAISE EXCEPTION 'Tipo de serviço inativo ou inexistente'; END IF;
        v_name := v_type.name;
        v_description := v_type.description;
      END IF;
      INSERT INTO public.performed_services(appliance_id, service_type_id, name_snapshot, description_snapshot, unit_price)
      VALUES (v_appliance_id, nullif(v_task->>'service_type_id', '')::uuid, v_name, coalesce(v_description, ''), v_price);
      v_service_total := v_service_total + v_price;
    END LOOP;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(v_device->'materials', '[]'::jsonb)) x
      GROUP BY x->>'product_id' HAVING count(*) > 1
    ) THEN RAISE EXCEPTION 'Não repita o material no mesmo aparelho; some as quantidades.'; END IF;
    FOR v_material IN SELECT value FROM jsonb_array_elements(coalesce(v_device->'materials', '[]'::jsonb)) LOOP
      SELECT * INTO v_product FROM public.products WHERE id = (v_material->>'product_id')::uuid AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Material inativo ou inexistente'; END IF;
      v_quantity := (v_material->>'quantity')::numeric;
      v_price := round((v_material->>'unit_price')::numeric, 2);
      IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity >= 'Infinity'::numeric OR v_price IS NULL OR v_price < 0 OR v_price >= 'Infinity'::numeric THEN
        RAISE EXCEPTION 'Quantidade ou preço de material inválido';
      END IF;
      SELECT (old_material->>'unit_cost')::numeric, (old_material->>'unit_id')::uuid INTO v_unit_cost, v_unit_id
      FROM jsonb_array_elements(v_old_materials) old_material
      WHERE old_material->>'id' = nullif(v_material->>'id', '') AND old_material->>'product_id' = v_product.id::text LIMIT 1;
      IF NOT FOUND THEN v_unit_cost := v_product.unit_cost; v_unit_id := v_product.unit_id; END IF;
      INSERT INTO public.service_materials(service_id, appliance_id, product_id, unit_id, quantity, unit_cost, unit_price, subtotal)
      VALUES (v_id, v_appliance_id, v_product.id, v_unit_id, v_quantity, v_unit_cost, v_price, round(v_quantity * v_price, 2));
      v_material_total := v_material_total + round(v_quantity * v_price, 2);
    END LOOP;
  END LOOP;

  v_total := v_service_total + v_material_total - v_discount;
  IF v_total < 0 OR v_total >= 'Infinity'::numeric THEN RAISE EXCEPTION 'Total inválido'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'appliance_number', a.appliance_number, 'notes', a.notes,
    'services', coalesce((SELECT jsonb_agg(jsonb_build_object('name', t.name_snapshot, 'description', t.description_snapshot, 'unit_price', t.unit_price) ORDER BY t.created_at)
      FROM public.performed_services t WHERE t.appliance_id = a.id), '[]'::jsonb),
    'materials', coalesce((SELECT jsonb_agg(jsonb_build_object('product_name', p.name, 'quantity', m.quantity, 'unit_price', m.unit_price, 'subtotal', m.subtotal) ORDER BY p.name)
      FROM public.service_materials m JOIN public.products p ON p.id = m.product_id WHERE m.appliance_id = a.id), '[]'::jsonb)
  ) ORDER BY a.appliance_number), '[]'::jsonb)
  INTO v_new_appliances FROM public.service_appliances a WHERE a.service_id = v_id;
  UPDATE public.services SET client_id = (p_data->>'client_id')::uuid,
    service_date = (p_data->>'service_date')::date,
    description = trim(p_data->>'description'), technician = v_actor_name,
    labor_value = v_service_total, discount = v_discount, total_value = v_total,
    notes = coalesce(p_data->>'notes', ''), status = 'rascunho', version = version + 1, updated_at = clock_timestamp()
  WHERE id = v_id;
  PERFORM public.service_audit(v_id, CASE WHEN p_service_id IS NULL THEN 'criacao' ELSE 'edicao' END,
    jsonb_build_object('antes', v_old, 'aparelhos_antes', v_old_appliances, 'servicos_antes', v_old_tasks, 'materiais_antes', v_old_materials,
      'depois', p_data - 'technician', 'aparelhos_depois', v_new_appliances)::text);
  IF coalesce(p_confirm, false) OR v_was_confirmed THEN PERFORM public.confirm_service(v_id); END IF;
  INSERT INTO public.operation_requests VALUES (auth.uid(), p_request_id, 'service_visit', v_payload, jsonb_build_array(v_id));
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.delete_product(p_product_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.require_member(true);
  PERFORM pg_advisory_xact_lock(82022026);
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;
  IF EXISTS (SELECT 1 FROM public.movements WHERE product_id = p_product_id)
     OR EXISTS (SELECT 1 FROM public.service_materials WHERE product_id = p_product_id) THEN
    RAISE EXCEPTION 'Produto possui histórico em movimentações ou serviços; inative-o para preservar os registros.';
  END IF;
  DELETE FROM public.products WHERE id = p_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_service(p_service_id uuid, p_return_materials uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.services; m record; v_id uuid;
BEGIN
  PERFORM public.require_member();
  PERFORM pg_advisory_xact_lock(82022026);
  SELECT * INTO s FROM public.services WHERE id = p_service_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
  IF s.status = 'cancelado' THEN RETURN; END IF;
  IF s.payment_status = 'pago' THEN RAISE EXCEPTION 'Regularize o pagamento antes de cancelar: registre a correção e a justificativa de devolução, se aplicável.'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_return_materials, ARRAY[]::uuid[])) x WHERE NOT EXISTS (SELECT 1 FROM public.service_materials WHERE id=x AND service_id=s.id)) THEN
    RAISE EXCEPTION 'Material não pertence ao serviço';
  END IF;
  IF s.status = 'confirmado' THEN
    FOR m IN SELECT * FROM public.service_materials WHERE service_id=s.id AND id=ANY(p_return_materials) ORDER BY id LOOP
      SELECT mm.id INTO v_id FROM public.movements mm
      WHERE mm.service_id=s.id AND mm.product_id=m.product_id AND mm.type='saida' AND mm.quantity=-m.quantity
        AND NOT EXISTS(SELECT 1 FROM public.movements r WHERE r.reversal_of=mm.id)
      ORDER BY mm.created_at DESC LIMIT 1;
      IF v_id IS NULL THEN RAISE EXCEPTION 'Baixa original não encontrada. Confira o histórico desse serviço.'; END IF;
      PERFORM public.stock_delta(m.product_id,m.quantity,m.unit_cost,'estorno',s.technician,'Devolução no cancelamento #'||s.number,s.client_id,s.id,v_id);
    END LOOP;
  END IF;
  UPDATE public.services SET status='cancelado',version=version+1,updated_at=clock_timestamp() WHERE id=s.id;
  PERFORM public.service_audit(s.id,'cancelamento',jsonb_build_object('materiais_devolvidos',p_return_materials)::text);
END;
$$;

REVOKE ALL ON FUNCTION public.save_service_visit(uuid,jsonb,jsonb,boolean,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_service_visit(uuid,jsonb,jsonb,boolean,uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_product(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_service(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_service(uuid,uuid[]) TO authenticated;
COMMIT;
