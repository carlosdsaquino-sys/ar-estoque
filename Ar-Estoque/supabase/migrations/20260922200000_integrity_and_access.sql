-- Run after the three original migrations. No business records are deleted.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ALTER COLUMN is_active SET DEFAULT false;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
CREATE TABLE public.operation_requests (
  actor uuid NOT NULL REFERENCES auth.users(id), request_id uuid NOT NULL,
  operation text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(actor, request_id)
);
ALTER TABLE public.operation_requests ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.app_member() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active);
$$;
CREATE FUNCTION public.app_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='admin');
$$;
CREATE FUNCTION public.require_member(p_admin boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.app_member() THEN RAISE EXCEPTION 'Acesso não autorizado. Aguarde a liberação do administrador.'; END IF;
 IF p_admin AND NOT public.app_admin() THEN RAISE EXCEPTION 'Apenas administradores podem executar esta ação.'; END IF;
END; $$;
-- Remove recursive / unrestricted policies, including direct ledger and service writes.
DO $$ DECLARE r record; t text; BEGIN
 FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('profiles','categories','units','suppliers','products','clients','services','service_materials','movements','service_history') LOOP
  EXECUTE format('DROP POLICY %I ON %I.%I',r.policyname,r.schemaname,r.tablename);
 END LOOP;
 FOR t IN SELECT unnest(ARRAY['categories','units','suppliers','products','clients','services','service_materials','movements','service_history']) LOOP
  EXECUTE format('CREATE POLICY member_read ON public.%I FOR SELECT TO authenticated USING (public.app_member())', t);
 END LOOP;
 FOR t IN SELECT unnest(ARRAY['categories','units','suppliers','products','clients']) LOOP
  EXECUTE format('CREATE POLICY admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_admin())',t);
  EXECUTE format('CREATE POLICY admin_update ON public.%I FOR UPDATE TO authenticated USING (public.app_admin()) WITH CHECK (public.app_admin())',t);
 END LOOP;
END $$;
CREATE POLICY profile_read ON public.profiles FOR SELECT TO authenticated USING (id=auth.uid() OR public.app_admin());
-- Profile creation is performed by a trigger, never by an untrusted role sent by the browser.
CREATE FUNCTION public.create_user_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.profiles(id,name,role,is_active) VALUES(NEW.id,coalesce(nullif(trim(NEW.raw_user_meta_data->>'name'),''),'Usuário'),'operador',false) ON CONFLICT(id) DO NOTHING;
 RETURN NEW;
END; $$;
CREATE TRIGGER app_user_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_user_profile();
INSERT INTO public.profiles(id,name,role,is_active)
 SELECT id,coalesce(nullif(trim(raw_user_meta_data->>'name'),''),'Usuário'),'operador',false FROM auth.users ON CONFLICT(id) DO NOTHING;
CREATE FUNCTION public.set_user_access(p_user_id uuid,p_role text,p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.require_member(true);
 PERFORM pg_advisory_xact_lock(82022026);
 IF p_role IS NULL OR p_role NOT IN ('admin','operador') OR p_active IS NULL THEN RAISE EXCEPTION 'Perfil inválido'; END IF;
 IF p_user_id=auth.uid() AND (p_role<>'admin' OR NOT p_active) THEN RAISE EXCEPTION 'Não altere seu próprio acesso administrativo.'; END IF;
 UPDATE public.profiles SET role=p_role,is_active=p_active WHERE id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado'; END IF;
END; $$;

-- NOT VALID preserves historical records; new writes must obey the checks.
ALTER TABLE public.products ADD CONSTRAINT product_values_valid CHECK (length(trim(code))>0 AND length(trim(name))>0 AND min_stock>=0 AND min_stock<'Infinity'::numeric AND unit_cost>=0 AND unit_cost<'Infinity'::numeric AND unit_price>=0 AND unit_price<'Infinity'::numeric) NOT VALID;
ALTER TABLE public.clients ADD CONSTRAINT client_name_valid CHECK(length(trim(name))>0) NOT VALID;
ALTER TABLE public.services ADD CONSTRAINT service_values_valid CHECK(labor_value>=0 AND labor_value<'Infinity'::numeric AND discount>=0 AND discount<'Infinity'::numeric AND total_value>=0 AND total_value<'Infinity'::numeric) NOT VALID;
ALTER TABLE public.service_materials ADD CONSTRAINT material_values_valid CHECK(quantity>0 AND quantity<'Infinity'::numeric AND unit_cost>=0 AND unit_cost<'Infinity'::numeric AND unit_price>=0 AND unit_price<'Infinity'::numeric AND subtotal>=0 AND subtotal<'Infinity'::numeric) NOT VALID;
ALTER TABLE public.movements ADD CONSTRAINT movement_values_valid CHECK(quantity<>0 AND quantity>'-Infinity'::numeric AND quantity<'Infinity'::numeric AND unit_cost>=0 AND unit_cost<'Infinity'::numeric AND (type NOT IN ('entrada','saldo_inicial') OR quantity>0) AND (type<>'saida' OR quantity<0)) NOT VALID;

CREATE OR REPLACE FUNCTION public.get_product_balance(p_product_id uuid) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.require_member();
 RETURN (SELECT coalesce(sum(quantity),0) FROM public.movements WHERE product_id=p_product_id);
END; $$;
CREATE FUNCTION public.get_product_balances() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.require_member();
 RETURN coalesce((SELECT jsonb_object_agg(id,balance) FROM (SELECT p.id,coalesce(sum(m.quantity),0) balance FROM public.products p LEFT JOIN public.movements m ON m.product_id=p.id GROUP BY p.id) b),'{}'::jsonb);
END; $$;
-- Serialize business mutations for this small single-company application. All ledger writes go through these RPCs.
CREATE FUNCTION public.stock_delta(p_product uuid,p_qty numeric,p_cost numeric,p_type text,p_responsible text,p_notes text,p_client uuid DEFAULT NULL,p_service uuid DEFAULT NULL,p_reversal uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_balance numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(82022026);
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p_product) THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;
 IF p_qty IS NULL OR p_qty=0 OR NOT(p_qty>'-Infinity'::numeric AND p_qty<'Infinity'::numeric) OR p_cost IS NULL OR NOT(p_cost>=0 AND p_cost<'Infinity'::numeric) THEN RAISE EXCEPTION 'Quantidade ou custo inválido'; END IF;
 SELECT coalesce(sum(quantity),0) INTO v_balance FROM public.movements WHERE product_id=p_product;
 IF v_balance+p_qty<0 THEN RAISE EXCEPTION 'Saldo insuficiente. Disponível: %, alteração: %',v_balance,p_qty; END IF;
 IF p_reversal IS NOT NULL AND EXISTS(SELECT 1 FROM public.movements WHERE reversal_of=p_reversal) THEN RAISE EXCEPTION 'Movimentação já estornada'; END IF;
 INSERT INTO public.movements(product_id,type,quantity,unit_cost,responsible,notes,client_id,service_id,reversal_of,created_by) VALUES(p_product,p_type,p_qty,p_cost,coalesce(p_responsible,''),coalesce(p_notes,''),p_client,p_service,p_reversal,auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END; $$;
DROP FUNCTION public.register_movement(uuid,text,numeric,numeric,text,text,uuid,uuid,uuid);
CREATE FUNCTION public.register_movement(p_product_id uuid,p_type text,p_quantity numeric,p_unit_cost numeric DEFAULT 0,p_responsible text DEFAULT '',p_notes text DEFAULT '',p_request_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_req record; v_payload jsonb;
BEGIN
 PERFORM public.require_member(p_type='ajuste');
 PERFORM pg_advisory_xact_lock(82022026);
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identificador da operação é obrigatório'; END IF;
 v_payload:=jsonb_build_array(p_product_id,p_type,p_quantity,p_unit_cost,p_responsible,p_notes);
 SELECT * INTO v_req FROM public.operation_requests WHERE actor=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF v_req.operation<>'movement' OR v_req.payload<>v_payload THEN RAISE EXCEPTION 'Identificador reutilizado com dados diferentes'; END IF;
  RETURN (v_req.result->>0)::uuid;
 END IF;
 IF p_type IS NULL OR p_type NOT IN ('entrada','saida','ajuste') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
 IF p_quantity IS NULL OR (p_type<>'ajuste' AND p_quantity<=0) OR p_quantity=0 THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;
 IF p_type='ajuste' AND coalesce(length(trim(p_notes)),0)=0 THEN RAISE EXCEPTION 'Justifique o ajuste'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p_product_id AND is_active) THEN RAISE EXCEPTION 'Produto inativo ou inexistente'; END IF;
 v_id:=public.stock_delta(p_product_id,CASE WHEN p_type='saida' THEN -p_quantity ELSE p_quantity END,p_unit_cost,p_type,p_responsible,p_notes);
 INSERT INTO public.operation_requests VALUES(auth.uid(),p_request_id,'movement',v_payload,jsonb_build_array(v_id));
 RETURN v_id;
END; $$;
CREATE OR REPLACE FUNCTION public.reverse_movement(p_movement_id uuid,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m public.movements; v_id uuid;
BEGIN
 PERFORM public.require_member(true); PERFORM pg_advisory_xact_lock(82022026);
 IF coalesce(length(trim(p_reason)),0)=0 THEN RAISE EXCEPTION 'Informe o motivo do estorno'; END IF;
 SELECT * INTO m FROM public.movements WHERE id=p_movement_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Movimentação não encontrada'; END IF;
 IF m.type='estorno' THEN RAISE EXCEPTION 'Não é possível estornar um estorno'; END IF;
 IF m.service_id IS NOT NULL THEN RAISE EXCEPTION 'Corrija os materiais na tela do serviço ou cancele o serviço.'; END IF;
 SELECT id INTO v_id FROM public.movements WHERE reversal_of=m.id;
 IF FOUND THEN RETURN v_id; END IF;
 RETURN public.stock_delta(m.product_id,-m.quantity,m.unit_cost,'estorno',m.responsible,'Estorno: '||p_reason,m.client_id,NULL,m.id);
END; $$;

CREATE FUNCTION public.service_audit(p_id uuid,p_action text,p_description text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO public.service_history(service_id,action,description,user_name) VALUES(p_id,p_action,p_description,coalesce((SELECT name FROM public.profiles WHERE id=auth.uid()),auth.uid()::text));
$$;
CREATE OR REPLACE FUNCTION public.confirm_service(p_service_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.services; m record; v_total numeric;
BEGIN
 PERFORM public.require_member(); PERFORM pg_advisory_xact_lock(82022026);
 SELECT * INTO s FROM public.services WHERE id=p_service_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
 IF s.status='confirmado' THEN RETURN; END IF;
 IF s.status<>'rascunho' THEN RAISE EXCEPTION 'Serviço cancelado'; END IF;
 SELECT coalesce(sum(round(quantity*unit_price,2)),0)+s.labor_value-s.discount INTO v_total FROM public.service_materials WHERE service_id=s.id;
 IF v_total<0 OR length(trim(coalesce(s.description,'')))=0 THEN RAISE EXCEPTION 'Confira descrição, materiais e desconto'; END IF;
 FOR m IN SELECT * FROM public.service_materials WHERE service_id=s.id ORDER BY product_id LOOP
  IF m.quantity<=0 OR NOT EXISTS(SELECT 1 FROM public.products WHERE id=m.product_id AND is_active) THEN RAISE EXCEPTION 'Material inválido ou inativo'; END IF;
  PERFORM public.stock_delta(m.product_id,-m.quantity,m.unit_cost,'saida',s.technician,'Serviço #'||s.number,s.client_id,s.id);
 END LOOP;
 UPDATE public.services SET status='confirmado',total_value=round(v_total,2),version=version+1,updated_at=clock_timestamp() WHERE id=s.id;
 PERFORM public.service_audit(s.id,'confirmacao','Serviço confirmado; materiais baixados.');
END; $$;

CREATE FUNCTION public.save_service(p_service_id uuid,p_data jsonb,p_materials jsonb,p_confirm boolean,p_request_id uuid,p_expected_version integer DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.services; v_id uuid; v_old jsonb; v_old_materials jsonb; j jsonb; p public.products; v_cost numeric; v_unit uuid; v_total numeric:=0; v_labor numeric; v_discount numeric; v_qty numeric; v_price numeric; m record; req record; payload jsonb; v_was_confirmed boolean:=false;
BEGIN
 PERFORM public.require_member(); PERFORM pg_advisory_xact_lock(82022026);
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identificador obrigatório'; END IF;
 payload:=jsonb_build_array(p_service_id,p_data,p_materials,p_confirm,p_expected_version);
 SELECT * INTO req FROM public.operation_requests WHERE actor=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF req.operation<>'service' OR req.payload<>payload THEN RAISE EXCEPTION 'Identificador reutilizado com dados diferentes'; END IF;
  RETURN (req.result->>0)::uuid;
 END IF;
 IF jsonb_typeof(p_materials) IS DISTINCT FROM 'array' OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
 IF coalesce(length(trim(p_data->>'description')),0)=0 OR nullif(p_data->>'service_date','') IS NULL OR nullif(p_data->>'client_id','') IS NULL THEN RAISE EXCEPTION 'Preencha cliente, data e descrição'; END IF;
 v_labor:=round((p_data->>'labor_value')::numeric,2); v_discount:=round((p_data->>'discount')::numeric,2);
 IF v_labor IS NULL OR v_discount IS NULL OR NOT(v_labor>=0 AND v_labor<'Infinity'::numeric AND v_discount>=0 AND v_discount<'Infinity'::numeric) THEN RAISE EXCEPTION 'Valores inválidos'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_materials) x GROUP BY x->>'product_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Não repita o mesmo produto; some as quantidades.'; END IF;
 IF p_service_id IS NOT NULL THEN
  SELECT * INTO s FROM public.services WHERE id=p_service_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
  IF s.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'O serviço foi alterado por outro usuário. Feche e atualize a lista.'; END IF;
  IF s.status='cancelado' THEN RAISE EXCEPTION 'Serviço cancelado não pode ser editado'; END IF;
  IF s.payment_status='pago' THEN RAISE EXCEPTION 'Corrija primeiro o pagamento antes de editar o serviço.'; END IF;
  v_id:=s.id; v_old:=to_jsonb(s); v_was_confirmed:=s.status='confirmado';
  SELECT coalesce(jsonb_agg(to_jsonb(sm)),'[]'::jsonb) INTO v_old_materials FROM public.service_materials sm WHERE service_id=s.id;
  IF v_was_confirmed THEN
   FOR m IN SELECT mm.* FROM public.movements mm WHERE mm.service_id=s.id AND mm.type='saida' AND NOT EXISTS(SELECT 1 FROM public.movements r WHERE r.reversal_of=mm.id) ORDER BY mm.product_id LOOP
    PERFORM public.stock_delta(m.product_id,-m.quantity,m.unit_cost,'estorno',m.responsible,'Correção dos materiais do serviço',m.client_id,s.id,m.id);
   END LOOP;
  END IF;
  DELETE FROM public.service_materials WHERE service_id=s.id;
 ELSE
  v_old_materials:='[]'::jsonb;
  INSERT INTO public.services(client_id,created_by) VALUES((p_data->>'client_id')::uuid,auth.uid()) RETURNING id INTO v_id;
 END IF;
 FOR j IN SELECT * FROM jsonb_array_elements(p_materials) LOOP
  SELECT * INTO p FROM public.products WHERE id=(j->>'product_id')::uuid;
  IF NOT FOUND OR NOT p.is_active THEN RAISE EXCEPTION 'Produto inativo ou inexistente'; END IF;
  v_qty:=(j->>'quantity')::numeric; v_price:=round((j->>'unit_price')::numeric,2);
  IF v_qty IS NULL OR v_price IS NULL OR NOT(v_qty>0 AND v_qty<'Infinity'::numeric AND v_price>=0 AND v_price<'Infinity'::numeric) THEN RAISE EXCEPTION 'Quantidade ou preço inválido'; END IF;
  SELECT (o->>'unit_cost')::numeric,(o->>'unit_id')::uuid INTO v_cost,v_unit FROM jsonb_array_elements(v_old_materials) o WHERE o->>'product_id'=p.id::text LIMIT 1;
  IF NOT FOUND THEN v_cost:=p.unit_cost; v_unit:=p.unit_id; END IF;
  INSERT INTO public.service_materials(service_id,product_id,unit_id,quantity,unit_cost,unit_price,subtotal) VALUES(v_id,p.id,v_unit,v_qty,v_cost,v_price,round(v_qty*v_price,2));
  v_total:=v_total+round(v_qty*v_price,2);
 END LOOP;
 v_total:=v_total+v_labor-v_discount;
 IF v_total<0 THEN RAISE EXCEPTION 'Desconto maior que o valor do serviço'; END IF;
 UPDATE public.services SET client_id=(p_data->>'client_id')::uuid,service_date=(p_data->>'service_date')::date,description=trim(p_data->>'description'),technician=coalesce(p_data->>'technician',''),labor_value=v_labor,discount=v_discount,total_value=v_total,notes=coalesce(p_data->>'notes',''),status='rascunho',version=version+1,updated_at=clock_timestamp() WHERE id=v_id;
 PERFORM public.service_audit(v_id,CASE WHEN p_service_id IS NULL THEN 'criacao' ELSE 'edicao' END,jsonb_build_object('antes',v_old,'materiais_antes',v_old_materials,'depois',p_data,'materiais_depois',p_materials)::text);
 IF coalesce(p_confirm,false) OR v_was_confirmed THEN PERFORM public.confirm_service(v_id); END IF;
 INSERT INTO public.operation_requests VALUES(auth.uid(),p_request_id,'service',payload,jsonb_build_array(v_id));
 RETURN v_id;
END; $$;

DROP FUNCTION public.register_payment(uuid,date,text);
CREATE FUNCTION public.register_payment(p_service_id uuid,p_payment_date date,p_payment_method text,p_expected_version integer DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.services;
BEGIN
 PERFORM public.require_member(); PERFORM pg_advisory_xact_lock(82022026);
 SELECT * INTO s FROM public.services WHERE id=p_service_id FOR UPDATE;
 IF NOT FOUND OR s.status<>'confirmado' THEN RAISE EXCEPTION 'Apenas serviços confirmados podem receber pagamento'; END IF;
 IF p_payment_date IS NULL OR p_payment_date>(now() AT TIME ZONE 'America/Sao_Paulo')::date OR p_payment_method IS NULL OR p_payment_method NOT IN ('pix','dinheiro','cartao','transferencia','outro') THEN RAISE EXCEPTION 'Confira data e forma de pagamento'; END IF;
 IF s.payment_status='pago' THEN
  IF s.payment_date=p_payment_date AND s.payment_method=p_payment_method THEN RETURN; END IF;
  RAISE EXCEPTION 'Pagamento já registrado. Use a correção de pagamento.';
 END IF;
 IF p_expected_version IS NULL OR s.version<>p_expected_version THEN RAISE EXCEPTION 'O serviço mudou. Atualize a lista e confira o valor antes de receber.'; END IF;
 UPDATE public.services SET payment_status='pago',payment_date=p_payment_date,payment_method=p_payment_method,version=version+1,updated_at=clock_timestamp() WHERE id=s.id;
 PERFORM public.service_audit(s.id,'pagamento',jsonb_build_object('valor',s.total_value,'data',p_payment_date,'forma',p_payment_method)::text);
END; $$;
CREATE FUNCTION public.reverse_payment(p_service_id uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.services;
BEGIN
 PERFORM public.require_member(true); PERFORM pg_advisory_xact_lock(82022026);
 IF coalesce(length(trim(p_reason)),0)=0 THEN RAISE EXCEPTION 'Informe a justificativa'; END IF;
 SELECT * INTO s FROM public.services WHERE id=p_service_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
 IF s.payment_status<>'pago' THEN RETURN; END IF;
 PERFORM public.service_audit(s.id,'correcao_pagamento',jsonb_build_object('motivo',p_reason,'valor',s.total_value,'data_anterior',s.payment_date,'forma_anterior',s.payment_method)::text);
 UPDATE public.services SET payment_status='pendente',payment_date=NULL,payment_method=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=s.id;
END; $$;
CREATE OR REPLACE FUNCTION public.cancel_service(p_service_id uuid,p_return_materials uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.services; m record; v_id uuid;
BEGIN
 PERFORM public.require_member(); PERFORM pg_advisory_xact_lock(82022026);
 SELECT * INTO s FROM public.services WHERE id=p_service_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
 IF s.status='cancelado' THEN RETURN; END IF;
 IF s.payment_status='pago' THEN RAISE EXCEPTION 'Regularize o pagamento antes de cancelar: registre a correção e a justificativa de devolução, se aplicável.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(coalesce(p_return_materials,ARRAY[]::uuid[])) x WHERE NOT EXISTS(SELECT 1 FROM public.service_materials WHERE id=x AND service_id=s.id)) THEN RAISE EXCEPTION 'Material não pertence ao serviço'; END IF;
 IF s.status='confirmado' THEN
  FOR m IN SELECT * FROM public.service_materials WHERE service_id=s.id AND id=ANY(p_return_materials) LOOP
   SELECT mm.id INTO v_id FROM public.movements mm WHERE mm.service_id=s.id AND mm.product_id=m.product_id AND mm.type='saida' AND mm.quantity=-m.quantity AND NOT EXISTS(SELECT 1 FROM public.movements r WHERE r.reversal_of=mm.id) ORDER BY mm.created_at DESC LIMIT 1;
   IF v_id IS NULL THEN RAISE EXCEPTION 'Baixa original não encontrada. Confira o histórico desse serviço.'; END IF;
   PERFORM public.stock_delta(m.product_id,m.quantity,m.unit_cost,'estorno',s.technician,'Devolução no cancelamento #'||s.number,s.client_id,s.id,v_id);
  END LOOP;
 END IF;
 UPDATE public.services SET status='cancelado',version=version+1,updated_at=clock_timestamp() WHERE id=s.id;
 PERFORM public.service_audit(s.id,'cancelamento',jsonb_build_object('materiais_devolvidos',p_return_materials)::text);
END; $$;
CREATE FUNCTION public.delete_draft_service(p_service_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.require_member(true); PERFORM pg_advisory_xact_lock(82022026);
 -- Preserve audit and references: archive drafts using cancellation.
 PERFORM public.cancel_service(p_service_id,ARRAY[]::uuid[]);
END; $$;

-- Add authorization and serialization to the original import; preserve its implementation.
ALTER FUNCTION public.import_products(jsonb) RENAME TO import_products_internal;
ALTER FUNCTION public.import_products_internal(jsonb) SET search_path=public,pg_temp;
CREATE FUNCTION public.import_products(p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j jsonb; k text;
BEGIN
 PERFORM public.require_member(true); PERFORM pg_advisory_xact_lock(82022026);
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Importação inválida'; END IF;
 FOR j IN SELECT * FROM jsonb_array_elements(p_data) LOOP
  IF coalesce(length(trim(j->>'code')),0)=0 OR coalesce(length(trim(j->>'name')),0)=0 THEN RAISE EXCEPTION 'Código e nome são obrigatórios'; END IF;
  FOREACH k IN ARRAY ARRAY['stock','min_stock','unit_cost','unit_price'] LOOP
   IF j->>k IS NULL OR NOT((j->>k)::numeric>=0 AND (j->>k)::numeric<'Infinity'::numeric) THEN RAISE EXCEPTION 'Valor inválido: %, produto %',k,j->>'code'; END IF;
  END LOOP;
 END LOOP;
 RETURN public.import_products_internal(p_data);
END; $$;
-- Definer helper functions are PRIVATE. Public RPCs require authenticated users and active profiles.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('app_member','app_admin','require_member','create_user_profile','set_user_access','get_product_balance','get_product_balances','stock_delta','register_movement','reverse_movement','service_audit','confirm_service','save_service','register_payment','reverse_payment','cancel_service','delete_draft_service','import_products','import_products_internal') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',r.signature);
  IF r.proname IN ('app_member','app_admin','set_user_access','get_product_balance','get_product_balances','register_movement','reverse_movement','confirm_service','save_service','register_payment','reverse_payment','cancel_service','delete_draft_service','import_products') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.signature);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON public.operation_requests FROM anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.movements,public.services,public.service_materials,public.service_history,public.profiles FROM anon,authenticated;
CREATE POLICY admin_delete_client ON public.clients FOR DELETE TO authenticated USING (public.app_admin());
COMMIT;
