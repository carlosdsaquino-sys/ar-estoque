BEGIN;
CREATE OR REPLACE FUNCTION public.save_appointment(p_id uuid,p_data jsonb,p_appliance_ids uuid[],p_expected_version integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.appointments; v_id uuid; v_client uuid := (p_data->>'client_id')::uuid; v_status text := coalesce(p_data->>'status','agendado'); v_before jsonb;
BEGIN
 PERFORM public.require_member();
 PERFORM pg_advisory_xact_lock(82022026);
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR p_appliance_ids IS NULL THEN RAISE EXCEPTION 'Dados do agendamento inválidos'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO a FROM public.appointments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF p_expected_version IS DISTINCT FROM a.version THEN RAISE EXCEPTION 'Agendamento alterado por outro usuário. Atualize a agenda.'; END IF;
  v_before := to_jsonb(a);
  IF a.completed_service_id IS NOT NULL THEN RAISE EXCEPTION 'Agendamento já vinculado a serviço; preserve o histórico'; END IF;
 END IF;
 IF v_status='concluido' THEN RAISE EXCEPTION 'Conclua pelo fluxo de serviços'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=v_client AND (archived_at IS NULL OR a.client_id=v_client)) THEN RAISE EXCEPTION 'Cliente inativo ou inexistente'; END IF;
 IF (p_data->>'service_type_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.service_types WHERE id=(p_data->>'service_type_id')::uuid AND (is_active OR a.service_type_id=id)) THEN RAISE EXCEPTION 'Tipo de serviço inativo'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_appliance_ids) d(id) WHERE NOT EXISTS(SELECT 1 FROM public.client_appliances ca WHERE ca.id=d.id AND ca.client_id=v_client AND (ca.is_active OR (a.client_id=v_client AND EXISTS(SELECT 1 FROM public.appointment_appliances old WHERE old.appointment_id=a.id AND old.client_appliance_id=ca.id))))) THEN RAISE EXCEPTION 'Aparelho não pertence ao cliente ou está inativo'; END IF;
 IF cardinality(p_appliance_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_appliance_ids) x) THEN RAISE EXCEPTION 'Aparelho duplicado'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.appointments(client_id,scheduled_date,scheduled_time,duration_minutes,technician,service_type_id,status,notes,created_by)
  VALUES(v_client,(p_data->>'scheduled_date')::date,(p_data->>'scheduled_time')::time,(p_data->>'duration_minutes')::integer,coalesce(p_data->>'technician',''),(p_data->>'service_type_id')::uuid,v_status,coalesce(p_data->>'notes',''),auth.uid()) RETURNING id INTO v_id;
 ELSE
  v_id := p_id;
  UPDATE public.appointments SET client_id=v_client,scheduled_date=(p_data->>'scheduled_date')::date,scheduled_time=(p_data->>'scheduled_time')::time,duration_minutes=(p_data->>'duration_minutes')::integer,technician=coalesce(p_data->>'technician',''),service_type_id=(p_data->>'service_type_id')::uuid,status=v_status,notes=coalesce(p_data->>'notes',''),updated_at=clock_timestamp(),version=version+1 WHERE id=v_id;
 END IF;
 DELETE FROM public.appointment_appliances WHERE appointment_id=v_id;
 INSERT INTO public.appointment_appliances(appointment_id,client_appliance_id) SELECT v_id,unnest(p_appliance_ids);
 INSERT INTO public.service_history(appointment_id,action,description,user_name) VALUES(v_id,CASE WHEN p_id IS NULL THEN 'criacao' WHEN v_status='cancelado' THEN 'cancelamento' ELSE 'edicao' END,jsonb_build_object('antes',v_before,'depois',p_data,'aparelhos',p_appliance_ids)::text,(SELECT name FROM public.profiles WHERE id=auth.uid()));
 RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.save_appointment_service(p_appointment_id uuid,p_service_id uuid,p_data jsonb,p_appliances jsonb,p_confirm boolean,p_request_id uuid,p_expected_version integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.appointments; v_id uuid; req public.operation_requests;
BEGIN
 PERFORM public.require_member();
 PERFORM pg_advisory_xact_lock(82022026);
 SELECT * INTO a FROM public.appointments WHERE id=p_appointment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
 IF a.status IN ('cancelado','nao_compareceu') THEN RAISE EXCEPTION 'Agendamento não está pendente'; END IF;
 IF a.client_id IS DISTINCT FROM (p_data->>'client_id')::uuid THEN RAISE EXCEPTION 'O cliente do serviço deve corresponder ao agendamento'; END IF;
 IF a.completed_service_id IS NULL AND p_service_id IS NOT NULL THEN RAISE EXCEPTION 'Inicie um novo atendimento para este agendamento'; END IF;
 SELECT * INTO req FROM public.operation_requests WHERE actor=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF req.operation<>'service_visit' OR req.payload IS DISTINCT FROM jsonb_build_array(p_service_id,p_data,p_appliances,p_confirm,p_expected_version) THEN
   RAISE EXCEPTION 'Identificador reutilizado com dados diferentes';
  END IF;
  IF (req.result->>0)::uuid IS DISTINCT FROM a.completed_service_id THEN RAISE EXCEPTION 'Identificador pertence a outro atendimento'; END IF;
  RETURN a.completed_service_id;
 END IF;
 IF a.completed_service_id IS NOT NULL AND p_service_id IS DISTINCT FROM a.completed_service_id THEN
  RAISE EXCEPTION 'Este agendamento já possui atendimento. Atualize a agenda e continue o serviço vinculado.';
 END IF;
 v_id := public.save_service_visit(p_service_id,p_data,p_appliances,p_confirm,p_request_id,p_expected_version);
 UPDATE public.appointments SET completed_service_id=v_id,status=CASE WHEN (SELECT status FROM public.services WHERE id=v_id)='confirmado' THEN 'concluido' ELSE status END,updated_at=clock_timestamp(),version=version+1 WHERE id=a.id;
 INSERT INTO public.service_history(appointment_id,service_id,action,description,user_name) VALUES(a.id,v_id,CASE WHEN a.completed_service_id IS NULL AND (SELECT status FROM public.services WHERE id=v_id)='confirmado' THEN 'conclusao' ELSE 'atendimento' END,'Serviço vinculado ao agendamento',(SELECT name FROM public.profiles WHERE id=auth.uid()));
 PERFORM public.service_audit(v_id,'agendamento','Atendimento originado de agendamento '||a.id);
 RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.save_service_visit(
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
  v_technician text;
  v_maintenance_enabled boolean := false;
  v_maintenance_interval_months integer;
  v_maintenance_alert_days integer := 14;
  v_preserve_maintenance_snapshot boolean := false;
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
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_appliances) d WHERE nullif(d->>'client_appliance_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.client_appliances ca WHERE ca.id = (d->>'client_appliance_id')::uuid AND ca.client_id = (p_data->>'client_id')::uuid)) THEN RAISE EXCEPTION 'O aparelho selecionado não pertence ao cliente deste atendimento'; END IF;
  IF EXISTS (SELECT nullif(d->>'client_appliance_id', '') FROM jsonb_array_elements(p_appliances) d WHERE nullif(d->>'client_appliance_id', '') IS NOT NULL GROUP BY nullif(d->>'client_appliance_id', '') HAVING count(*) > 1) THEN RAISE EXCEPTION 'Este aparelho já foi adicionado a este atendimento'; END IF;
  v_technician := p_data->>'technician';
  IF nullif(btrim(v_technician), '') IS NULL THEN RAISE EXCEPTION 'Informe o técnico responsável'; END IF;
  v_discount := round((p_data->>'discount')::numeric, 2);
  IF v_discount IS NULL OR v_discount < 0 OR v_discount >= 'Infinity'::numeric THEN RAISE EXCEPTION 'Desconto inválido'; END IF;
  IF nullif(trim(p_data->>'client_id'), '') IS NULL OR nullif(trim(p_data->>'service_date'), '') IS NULL OR nullif(trim(p_data->>'description'), '') IS NULL THEN
    RAISE EXCEPTION 'Preencha cliente, data e descrição do atendimento';
  END IF;
  v_payload := jsonb_build_array(p_service_id, p_data, p_appliances, p_confirm, p_expected_version);
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
      'appliance_number', a.appliance_number, 'notes', a.notes, 'client_appliance_id', a.client_appliance_id,
      'client_appliance_name', ca.name, 'client_appliance_location', ca.location,
      'services', coalesce((SELECT jsonb_agg(jsonb_build_object('name', t.name_snapshot, 'description', t.description_snapshot, 'unit_price', t.unit_price) ORDER BY t.created_at)
        FROM public.performed_services t WHERE t.appliance_id = a.id), '[]'::jsonb),
      'materials', coalesce((SELECT jsonb_agg(jsonb_build_object('product_name', p.name, 'quantity', m.quantity, 'unit_price', m.unit_price, 'subtotal', m.subtotal) ORDER BY p.name)
        FROM public.service_materials m JOIN public.products p ON p.id = m.product_id WHERE m.appliance_id = a.id), '[]'::jsonb)
    ) ORDER BY a.appliance_number), '[]'::jsonb) INTO v_old_appliances FROM public.service_appliances a LEFT JOIN public.client_appliances ca ON ca.id = a.client_appliance_id WHERE a.service_id = s.id;
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
    INSERT INTO public.service_appliances(service_id, appliance_number, notes, client_appliance_id)
    VALUES (v_id, v_appliance_number, coalesce(v_device->>'notes', ''), nullif(v_device->>'client_appliance_id', '')::uuid) RETURNING id INTO v_appliance_id;

    FOR v_task IN SELECT value FROM jsonb_array_elements(v_device->'services') LOOP
      v_name := NULL;
      v_description := NULL;
      v_maintenance_enabled := false;
      v_maintenance_interval_months := NULL;
      v_maintenance_alert_days := 14;
      v_preserve_maintenance_snapshot := false;
      v_price := round((v_task->>'unit_price')::numeric, 2);
      IF v_price IS NULL OR v_price < 0 OR v_price >= 'Infinity'::numeric THEN RAISE EXCEPTION 'Preço de serviço inválido'; END IF;
      IF nullif(v_task->>'service_type_id', '') IS NULL THEN
        IF nullif(v_task->>'id', '') IS NOT NULL THEN
          SELECT x->>'name_snapshot', x->>'description_snapshot', coalesce((x->>'maintenance_enabled_snapshot')::boolean, false), nullif(x->>'maintenance_interval_months_snapshot', '')::integer, coalesce((x->>'maintenance_alert_days_snapshot')::integer, 14) INTO v_name, v_description, v_maintenance_enabled, v_maintenance_interval_months, v_maintenance_alert_days
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
        SELECT old_task->>'name_snapshot', old_task->>'description_snapshot', coalesce((old_task->>'maintenance_enabled_snapshot')::boolean, false),
               nullif(old_task->>'maintenance_interval_months_snapshot', '')::integer,
               coalesce((old_task->>'maintenance_alert_days_snapshot')::integer, 14)
        INTO v_name, v_description, v_maintenance_enabled, v_maintenance_interval_months, v_maintenance_alert_days
        FROM jsonb_array_elements(v_old_tasks) old_task
        WHERE old_task->>'id' = v_task->>'id'
          AND old_task->>'service_type_id' = v_type.id::text;
        v_preserve_maintenance_snapshot := FOUND;
        IF NOT FOUND THEN v_name := v_type.name; v_description := v_type.description; END IF;
      END IF;
      PERFORM set_config('ar_estoque.preserve_maintenance_snapshot', CASE WHEN v_preserve_maintenance_snapshot THEN 'true' ELSE 'false' END, true);
      INSERT INTO public.performed_services(appliance_id, service_type_id, name_snapshot, description_snapshot, unit_price, maintenance_enabled_snapshot, maintenance_interval_months_snapshot, maintenance_alert_days_snapshot)
      VALUES (v_appliance_id, nullif(v_task->>'service_type_id', '')::uuid, v_name, coalesce(v_description, ''), v_price, v_maintenance_enabled, v_maintenance_interval_months, v_maintenance_alert_days);
      PERFORM set_config('ar_estoque.preserve_maintenance_snapshot', 'false', true);
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
    'appliance_number', a.appliance_number, 'notes', a.notes, 'client_appliance_id', a.client_appliance_id,
    'client_appliance_name', ca.name, 'client_appliance_location', ca.location,
    'services', coalesce((SELECT jsonb_agg(jsonb_build_object('name', t.name_snapshot, 'description', t.description_snapshot, 'unit_price', t.unit_price) ORDER BY t.created_at)
      FROM public.performed_services t WHERE t.appliance_id = a.id), '[]'::jsonb),
    'materials', coalesce((SELECT jsonb_agg(jsonb_build_object('product_name', p.name, 'quantity', m.quantity, 'unit_price', m.unit_price, 'subtotal', m.subtotal) ORDER BY p.name)
      FROM public.service_materials m JOIN public.products p ON p.id = m.product_id WHERE m.appliance_id = a.id), '[]'::jsonb)
  ) ORDER BY a.appliance_number), '[]'::jsonb)
  INTO v_new_appliances FROM public.service_appliances a LEFT JOIN public.client_appliances ca ON ca.id = a.client_appliance_id WHERE a.service_id = v_id;
  UPDATE public.services SET client_id = (p_data->>'client_id')::uuid,
    service_date = (p_data->>'service_date')::date,
    description = trim(p_data->>'description'), technician = v_technician,
    labor_value = v_service_total, discount = v_discount, total_value = v_total,
    notes = coalesce(p_data->>'notes', ''), status = 'rascunho', version = version + 1, updated_at = clock_timestamp()
  WHERE id = v_id;
  PERFORM public.service_audit(v_id, CASE WHEN p_service_id IS NULL THEN 'criacao' ELSE 'edicao' END,
    jsonb_build_object('antes', v_old, 'aparelhos_antes', v_old_appliances, 'servicos_antes', v_old_tasks, 'materiais_antes', v_old_materials,
      'depois', p_data, 'aparelhos_depois', v_new_appliances)::text);
  IF coalesce(p_confirm, false) OR v_was_confirmed THEN PERFORM public.confirm_service(v_id); END IF;
  INSERT INTO public.operation_requests VALUES (auth.uid(), p_request_id, 'service_visit', v_payload, jsonb_build_array(v_id));
  RETURN v_id;
END;
$$;



-- Optional new signatures retain compatibility with installed older frontends.
CREATE OR REPLACE FUNCTION public.save_appointment(p_id uuid,p_data jsonb,p_appliance_ids uuid[],p_expected_version integer,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE req public.operation_requests; payload jsonb := jsonb_build_array(p_id,p_data,p_appliance_ids,p_expected_version); result uuid;
BEGIN
 PERFORM public.require_member(); PERFORM pg_advisory_xact_lock(82022026);
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identificador obrigatório'; END IF;
 SELECT * INTO req FROM public.operation_requests WHERE actor=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF req.operation<>'appointment' OR req.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Identificador reutilizado com dados diferentes'; END IF;
  RETURN (req.result->>0)::uuid;
 END IF;
 result := public.save_appointment(p_id,p_data,p_appliance_ids,p_expected_version);
 INSERT INTO public.operation_requests VALUES(auth.uid(),p_request_id,'appointment',payload,jsonb_build_array(result));
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.save_appointment(uuid,jsonb,uuid[],integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_appointment(uuid,jsonb,uuid[],integer,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.record_cash_movement(p_cash_register_id uuid,p_type text,p_description text,p_amount numeric,p_payment_method text,p_reason text,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE req public.operation_requests; payload jsonb := jsonb_build_array(p_cash_register_id,p_type,p_description,p_amount,p_payment_method,p_reason); result uuid;
BEGIN
 PERFORM public.require_member(p_type='ajuste'); PERFORM pg_advisory_xact_lock(82022026);
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identificador obrigatório'; END IF;
 SELECT * INTO req FROM public.operation_requests WHERE actor=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF req.operation<>'cash_movement' OR req.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Identificador reutilizado com dados diferentes'; END IF;
  RETURN (req.result->>0)::uuid;
 END IF;
 result := public.record_cash_movement(p_cash_register_id,p_type,p_description,p_amount,p_payment_method,p_reason);
 INSERT INTO public.operation_requests VALUES(auth.uid(),p_request_id,'cash_movement',payload,jsonb_build_array(result));
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.record_cash_movement(uuid,text,text,numeric,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_movement(uuid,text,text,numeric,text,text,uuid) TO authenticated;
-- Keep appointment audit identity when an access account is permanently removed.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS created_by_name text NOT NULL DEFAULT '';
UPDATE public.appointments a SET created_by_name=p.name FROM public.profiles p WHERE p.id=a.created_by AND a.created_by_name='';
ALTER TABLE public.appointments ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_created_by_fkey;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_created_by_fkey FOREIGN KEY(created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.capture_appointment_actor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 NEW.created_by := auth.uid();
 NEW.created_by_name := coalesce((SELECT name FROM public.profiles WHERE id=auth.uid()),'Usuário');
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS appointments_capture_actor ON public.appointments;
CREATE TRIGGER appointments_capture_actor BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.capture_appointment_actor();
REVOKE ALL ON FUNCTION public.capture_appointment_actor() FROM PUBLIC,anon,authenticated;

-- Trigger helpers are invoked by triggers, not by public RPC callers.
REVOKE ALL ON FUNCTION public.set_service_actor(),public.capture_performed_service_maintenance_snapshot() FROM PUBLIC,anon,authenticated;
COMMIT;
