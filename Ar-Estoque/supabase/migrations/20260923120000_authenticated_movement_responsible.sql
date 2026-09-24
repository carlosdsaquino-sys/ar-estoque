BEGIN;

-- Store the authenticated profile name for every movement created through the
-- secured stock mutation helper. created_by remains the authenticated user ID.
CREATE OR REPLACE FUNCTION public.stock_delta(
  p_product uuid,
  p_qty numeric,
  p_cost numeric,
  p_type text,
  p_responsible text,
  p_notes text,
  p_client uuid DEFAULT NULL,
  p_service uuid DEFAULT NULL,
  p_reversal uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_id uuid;
  v_balance numeric;
  v_responsible text;
BEGIN
  PERFORM pg_advisory_xact_lock(82022026);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;
  SELECT nullif(btrim(name), '') INTO v_responsible
  FROM public.profiles WHERE id = auth.uid();
  IF v_responsible IS NULL THEN RAISE EXCEPTION 'Perfil do usuário autenticado não encontrado'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p_product) THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;
  IF p_qty IS NULL OR p_qty=0 OR NOT(p_qty>'-Infinity'::numeric AND p_qty<'Infinity'::numeric) OR p_cost IS NULL OR NOT(p_cost>=0 AND p_cost<'Infinity'::numeric) THEN RAISE EXCEPTION 'Quantidade ou custo inválido'; END IF;
  SELECT coalesce(sum(quantity),0) INTO v_balance FROM public.movements WHERE product_id=p_product;
  IF v_balance+p_qty<0 THEN RAISE EXCEPTION 'Saldo insuficiente. Disponível: %, alteração: %',v_balance,p_qty; END IF;
  IF p_reversal IS NOT NULL AND EXISTS(SELECT 1 FROM public.movements WHERE reversal_of=p_reversal) THEN RAISE EXCEPTION 'Movimentação já estornada'; END IF;
  INSERT INTO public.movements(product_id,type,quantity,unit_cost,responsible,notes,client_id,service_id,reversal_of,created_by)
  VALUES(p_product,p_type,p_qty,p_cost,v_responsible,coalesce(p_notes,''),p_client,p_service,p_reversal,auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Ignore any caller-supplied responsible name and use the authenticated profile
-- both for the movement row and for idempotency payload comparisons.
CREATE OR REPLACE FUNCTION public.register_movement(
  p_product_id uuid,
  p_type text,
  p_quantity numeric,
  p_unit_cost numeric DEFAULT 0,
  p_responsible text DEFAULT '',
  p_notes text DEFAULT '',
  p_request_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_id uuid;
  v_req record;
  v_payload jsonb;
  v_responsible text;
BEGIN
  PERFORM public.require_member(p_type='ajuste');
  PERFORM pg_advisory_xact_lock(82022026);
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identificador da operação é obrigatório'; END IF;
  SELECT nullif(btrim(name), '') INTO v_responsible
  FROM public.profiles WHERE id = auth.uid();
  IF v_responsible IS NULL THEN RAISE EXCEPTION 'Perfil do usuário autenticado não encontrado'; END IF;
  v_payload:=jsonb_build_array(p_product_id,p_type,p_quantity,p_unit_cost,v_responsible,p_notes);
  SELECT * INTO v_req FROM public.operation_requests WHERE actor=auth.uid() AND request_id=p_request_id;
  IF FOUND THEN
    IF v_req.operation<>'movement' OR v_req.payload<>v_payload THEN RAISE EXCEPTION 'Identificador reutilizado com dados diferentes'; END IF;
    RETURN (v_req.result->>0)::uuid;
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('entrada','saida','ajuste') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF p_quantity IS NULL OR (p_type<>'ajuste' AND p_quantity<=0) OR p_quantity=0 THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;
  IF p_type='ajuste' AND coalesce(length(trim(p_notes)),0)=0 THEN RAISE EXCEPTION 'Justifique o ajuste'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p_product_id AND is_active) THEN RAISE EXCEPTION 'Produto inativo ou inexistente'; END IF;
  v_id:=public.stock_delta(p_product_id,CASE WHEN p_type='saida' THEN -p_quantity ELSE p_quantity END,p_unit_cost,p_type,v_responsible,p_notes);
  INSERT INTO public.operation_requests VALUES(auth.uid(),p_request_id,'movement',v_payload,jsonb_build_array(v_id));
  RETURN v_id;
END;
$$;

COMMIT;
