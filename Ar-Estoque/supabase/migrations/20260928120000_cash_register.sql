BEGIN;

-- A single company-wide register may be open at a time. A business date can
-- have only one register ever, so a closed day cannot be silently reopened.
CREATE TABLE public.cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  register_date date NOT NULL UNIQUE,
  opening_balance numeric(14,2) NOT NULL CHECK (opening_balance >= 0),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado')),
  opening_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  opening_user_name text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closing_balance numeric(14,2),
  expected_cash numeric(14,2),
  counted_cash numeric(14,2),
  difference numeric(14,2),
  closing_reason text,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by_name text NOT NULL DEFAULT '',
  closed_at timestamptz,
  CHECK (
    (status='aberto' AND closed_by IS NULL AND closed_at IS NULL AND closing_balance IS NULL AND expected_cash IS NULL AND counted_cash IS NULL AND difference IS NULL)
    OR
    (status='fechado' AND closed_at IS NOT NULL AND closing_balance IS NOT NULL AND expected_cash IS NOT NULL AND counted_cash IS NOT NULL AND difference IS NOT NULL)
  ),
  CHECK (status <> 'fechado' OR difference = counted_cash - expected_cash),
  CHECK (status <> 'fechado' OR difference = 0 OR length(btrim(coalesce(closing_reason,''))) > 0)
);
CREATE UNIQUE INDEX cash_registers_one_open_idx ON public.cash_registers ((status)) WHERE status='aberto';

-- Payment events persist every register/reversal cycle even if older services
-- predate this module. Legacy events are backfilled but not added to a new
-- register, since their historic cash was never part of this ledger.
CREATE TABLE public.service_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  payment_date date NOT NULL,
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('pix','dinheiro','cartao','transferencia','outro')),
  paid_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  posted_to_cash boolean NOT NULL DEFAULT false,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reversal_reason text,
  CHECK ((reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL) OR (reversed_at IS NOT NULL AND length(btrim(coalesce(reversal_reason,''))) > 0))
);
CREATE UNIQUE INDEX service_payment_events_one_active_idx ON public.service_payment_events(service_id) WHERE reversed_at IS NULL;
CREATE INDEX service_payment_events_service_idx ON public.service_payment_events(service_id,paid_at DESC);

INSERT INTO public.service_payment_events(service_id,amount,payment_date,payment_method,paid_at,paid_by,posted_to_cash)
SELECT id,round(total_value,2),coalesce(payment_date,service_date),payment_method,coalesce(updated_at,created_at,clock_timestamp()),NULL,false
FROM public.services
WHERE payment_status='pago';

CREATE TABLE public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_register_id uuid NOT NULL REFERENCES public.cash_registers(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('entrada','saida','ajuste')),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  payment_method text NOT NULL CHECK (payment_method IN ('pix','dinheiro','cartao','transferencia','outro')),
  source text NOT NULL CHECK (source IN ('manual','service_payment','payment_reversal')),
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  payment_event_id uuid UNIQUE REFERENCES public.service_payment_events(id) ON DELETE RESTRICT,
  reversed_payment_event_id uuid UNIQUE REFERENCES public.service_payment_events(id) ON DELETE RESTRICT,
  reversal_of uuid REFERENCES public.cash_movements(id) ON DELETE RESTRICT,
  reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((type='entrada' AND amount>0) OR (type='saida' AND amount<0) OR type='ajuste'),
  CHECK ((type='ajuste' AND length(btrim(coalesce(reason,'')))>0) OR type<>'ajuste'),
  CHECK (
    (source='manual' AND payment_event_id IS NULL AND reversed_payment_event_id IS NULL)
    OR (source='service_payment' AND payment_event_id IS NOT NULL AND reversed_payment_event_id IS NULL)
    OR (source='payment_reversal' AND payment_event_id IS NULL AND reversed_payment_event_id IS NOT NULL AND reversal_of IS NOT NULL)
  )
);
CREATE INDEX cash_movements_register_idx ON public.cash_movements(cash_register_id,created_at DESC);
CREATE INDEX cash_movements_service_idx ON public.cash_movements(service_id);

ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_registers_member_read ON public.cash_registers FOR SELECT TO authenticated USING (public.app_member());
CREATE POLICY cash_movements_member_read ON public.cash_movements FOR SELECT TO authenticated USING (public.app_member());
CREATE POLICY service_payment_events_member_read ON public.service_payment_events FOR SELECT TO authenticated USING (public.app_member());
REVOKE ALL ON public.cash_registers,public.cash_movements,public.service_payment_events FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.open_cash_register(p_register_date date,p_opening_balance numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.require_member();
  PERFORM pg_advisory_xact_lock(82022026);
  IF p_register_date IS NULL OR p_register_date <> (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'O caixa só pode ser aberto para a data atual';
  END IF;
  IF p_opening_balance IS NULL OR p_opening_balance < 0 OR p_opening_balance::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Informe um saldo inicial válido, igual ou maior que zero';
  END IF;
  INSERT INTO public.cash_registers(register_date,opening_balance,opening_user,opening_user_name)
  SELECT p_register_date,round(p_opening_balance,2),auth.uid(),coalesce(nullif(btrim(name),''),'Usuário')
  FROM public.profiles WHERE id=auth.uid() RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um caixa para esta data ou outro caixa está aberto';
END;
$$;

CREATE FUNCTION public.record_cash_movement(
  p_cash_register_id uuid,p_type text,p_description text,p_amount numeric,p_payment_method text,p_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_register public.cash_registers; v_amount numeric; v_id uuid;
BEGIN
  PERFORM public.require_member(p_type='ajuste');
  PERFORM pg_advisory_xact_lock(82022026);
  IF p_type NOT IN ('entrada','saida','ajuste') OR p_type IS NULL THEN RAISE EXCEPTION 'Tipo de movimentação inválido'; END IF;
  IF coalesce(length(btrim(p_description)),0)=0 THEN RAISE EXCEPTION 'Informe a descrição'; END IF;
  IF p_payment_method NOT IN ('pix','dinheiro','cartao','transferencia','outro') OR p_payment_method IS NULL THEN RAISE EXCEPTION 'Forma de pagamento inválida'; END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Informe um valor válido'; END IF;
  IF p_type IN ('entrada','saida') AND p_amount<=0 THEN RAISE EXCEPTION 'O valor deve ser maior que zero'; END IF;
  IF p_type='ajuste' AND (p_amount=0 OR coalesce(length(btrim(p_reason)),0)=0) THEN RAISE EXCEPTION 'O ajuste precisa de valor diferente de zero e motivo'; END IF;
  SELECT * INTO v_register FROM public.cash_registers WHERE id=p_cash_register_id FOR UPDATE;
  IF NOT FOUND OR v_register.status<>'aberto' THEN RAISE EXCEPTION 'É necessário um caixa aberto para registrar movimentações'; END IF;
  v_amount:=round(CASE WHEN p_type='saida' THEN -p_amount ELSE p_amount END,2);
  IF v_amount=0 THEN RAISE EXCEPTION 'O valor precisa ser de pelo menos R$ 0,01'; END IF;
  INSERT INTO public.cash_movements(cash_register_id,type,description,amount,payment_method,source,reason,created_by,created_by_name)
  SELECT p_cash_register_id,p_type,btrim(p_description),v_amount,p_payment_method,'manual',nullif(btrim(p_reason),''),auth.uid(),coalesce(nullif(btrim(name),''),'Usuário')
  FROM public.profiles WHERE id=auth.uid() RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.close_cash_register(p_cash_register_id uuid,p_counted_cash numeric,p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_register public.cash_registers; v_balance numeric(14,2); v_cash numeric(14,2); v_difference numeric(14,2);
BEGIN
  PERFORM public.require_member();
  PERFORM pg_advisory_xact_lock(82022026);
  IF p_counted_cash IS NULL OR p_counted_cash<0 OR p_counted_cash::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Informe um valor contado válido, igual ou maior que zero';
  END IF;
  SELECT * INTO v_register FROM public.cash_registers WHERE id=p_cash_register_id FOR UPDATE;
  IF NOT FOUND OR v_register.status<>'aberto' THEN RAISE EXCEPTION 'Este caixa já está fechado ou não existe'; END IF;
  SELECT round(v_register.opening_balance+coalesce(sum(amount),0),2),
         round(v_register.opening_balance+coalesce(sum(amount) FILTER (WHERE payment_method='dinheiro'),0),2)
  INTO v_balance,v_cash FROM public.cash_movements WHERE cash_register_id=v_register.id;
  IF v_balance IS NULL THEN v_balance:=v_register.opening_balance; END IF;
  IF v_cash IS NULL THEN v_cash:=v_register.opening_balance; END IF;
  v_difference:=round(p_counted_cash-v_cash,2);
  IF v_difference<>0 AND coalesce(length(btrim(p_reason)),0)=0 THEN RAISE EXCEPTION 'Informe o motivo da diferença do caixa'; END IF;
  UPDATE public.cash_registers SET status='fechado',closing_balance=v_balance,expected_cash=v_cash,
    counted_cash=round(p_counted_cash,2),difference=v_difference,closing_reason=nullif(btrim(p_reason),''),
    closed_by=auth.uid(),closed_by_name=coalesce((SELECT nullif(btrim(name),'') FROM public.profiles WHERE id=auth.uid()),'Usuário'),
    closed_at=clock_timestamp() WHERE id=v_register.id;
  RETURN jsonb_build_object('closing_balance',v_balance,'expected_cash',v_cash,'counted_cash',round(p_counted_cash,2),'difference',v_difference);
END;
$$;

CREATE FUNCTION public.cash_register_snapshot(p_cash_register_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $$
DECLARE v_register public.cash_registers; v_result jsonb;
BEGIN
  PERFORM public.require_member();
  IF p_cash_register_id IS NULL THEN
    SELECT * INTO v_register FROM public.cash_registers WHERE status='aberto' ORDER BY opened_at DESC LIMIT 1;
  ELSE
    SELECT * INTO v_register FROM public.cash_registers WHERE id=p_cash_register_id;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'id',v_register.id,'register_date',v_register.register_date,'status',v_register.status,
    'opening_balance',v_register.opening_balance,'opening_user',v_register.opening_user,
    'opening_user_name',v_register.opening_user_name,'opened_at',v_register.opened_at,
    'closing_balance',v_register.closing_balance,'expected_cash',v_register.expected_cash,
    'counted_cash',v_register.counted_cash,'difference',v_register.difference,
    'closing_reason',v_register.closing_reason,'closed_by',v_register.closed_by,
    'closed_by_name',v_register.closed_by_name,'closed_at',v_register.closed_at,
    'income',coalesce(t.income,0),'outgoing',coalesce(t.outgoing,0),'adjustment',coalesce(t.adjustment,0),
    'expected_balance',round(v_register.opening_balance+coalesce(t.net,0),2),
    'expected_cash_live',round(v_register.opening_balance+coalesce(t.cash_net,0),2),
    'method_totals',jsonb_build_object(
      'dinheiro',round(v_register.opening_balance+coalesce(t.cash_net,0),2),
      'pix',coalesce(t.pix,0),'cartao',coalesce(t.cartao,0),'transferencia',coalesce(t.transferencia,0),'outro',coalesce(t.outro,0)
    ),
    'movements',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',m.id,'type',m.type,'description',m.description,'amount',m.amount,'payment_method',m.payment_method,
      'source',m.source,'service_id',m.service_id,'service_number',s.number,'reason',m.reason,
      'created_by',m.created_by,'created_by_name',m.created_by_name,'created_at',m.created_at
    ) ORDER BY m.created_at DESC,m.id DESC) FROM public.cash_movements m
      LEFT JOIN public.services s ON s.id=m.service_id
      WHERE m.cash_register_id=v_register.id),'[]'::jsonb)
  ) INTO v_result
  FROM (SELECT 1) seed
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(amount) FILTER (WHERE type='entrada'),0) AS income,
      coalesce(abs(sum(amount) FILTER (WHERE type='saida')),0) AS outgoing,
      coalesce(sum(amount) FILTER (WHERE type='ajuste'),0) AS adjustment,
      coalesce(sum(amount),0) AS net,
      coalesce(sum(amount) FILTER (WHERE payment_method='dinheiro'),0) AS cash_net,
      coalesce(sum(amount) FILTER (WHERE payment_method='pix'),0) AS pix,
      coalesce(sum(amount) FILTER (WHERE payment_method='cartao'),0) AS cartao,
      coalesce(sum(amount) FILTER (WHERE payment_method='transferencia'),0) AS transferencia,
      coalesce(sum(amount) FILTER (WHERE payment_method='outro'),0) AS outro
    FROM public.cash_movements WHERE cash_register_id=v_register.id
  ) t ON true;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.cash_register_history(p_limit integer DEFAULT 90,p_before date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $$
DECLARE v_history jsonb;
BEGIN
  PERFORM public.require_member();
  SELECT coalesce(jsonb_agg(h.entry ORDER BY h.register_date DESC),'[]'::jsonb) INTO v_history
  FROM (
    SELECT r.register_date,jsonb_build_object(
      'id',r.id,'register_date',r.register_date,'status',r.status,'opening_balance',r.opening_balance,
      'closing_balance',r.closing_balance,'expected_cash',r.expected_cash,'counted_cash',r.counted_cash,
      'difference',r.difference,'closing_reason',r.closing_reason,'opened_at',r.opened_at,
      'opening_user_name',r.opening_user_name,'closed_by_name',r.closed_by_name,'closed_at',r.closed_at,
      'income',coalesce(m.income,0),'outgoing',coalesce(m.outgoing,0),'adjustment',coalesce(m.adjustment,0)
    ) entry
    FROM public.cash_registers r
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(amount) FILTER (WHERE type='entrada'),0) income,
        coalesce(abs(sum(amount) FILTER (WHERE type='saida')),0) outgoing,
        coalesce(sum(amount) FILTER (WHERE type='ajuste'),0) adjustment
      FROM public.cash_movements WHERE cash_register_id=r.id
    ) m ON true
    WHERE r.status='fechado' AND (p_before IS NULL OR r.register_date<p_before)
    ORDER BY r.register_date DESC LIMIT greatest(1,least(coalesce(p_limit,90),200))
  ) h;
  RETURN v_history;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_payment(
  p_service_id uuid,p_payment_date date,p_payment_method text,p_expected_version integer DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.services; v_event_id uuid; v_register_id uuid;
BEGIN
  PERFORM public.require_member();
  PERFORM pg_advisory_xact_lock(82022026);
  SELECT * INTO s FROM public.services WHERE id=p_service_id FOR UPDATE;
  IF NOT FOUND OR s.status<>'confirmado' THEN RAISE EXCEPTION 'Apenas serviços confirmados podem receber pagamento'; END IF;
  IF p_payment_date IS NULL OR p_payment_date>(now() AT TIME ZONE 'America/Sao_Paulo')::date OR p_payment_method IS NULL OR p_payment_method NOT IN ('pix','dinheiro','cartao','transferencia','outro') THEN RAISE EXCEPTION 'Confira data e forma de pagamento'; END IF;
  IF s.payment_status='pago' THEN
    IF s.payment_date=p_payment_date AND s.payment_method=p_payment_method THEN RETURN; END IF;
    RAISE EXCEPTION 'Pagamento já registrado. Use a correção de pagamento.';
  END IF;
  IF p_expected_version IS NULL OR s.version<>p_expected_version THEN RAISE EXCEPTION 'O serviço mudou. Atualize a lista e confira o valor antes de receber.'; END IF;
  SELECT id INTO v_register_id FROM public.cash_registers WHERE status='aberto' FOR UPDATE;
  IF v_register_id IS NULL THEN RAISE EXCEPTION 'Abra o caixa antes de registrar o pagamento'; END IF;
  UPDATE public.services SET payment_status='pago',payment_date=p_payment_date,payment_method=p_payment_method,version=version+1,updated_at=clock_timestamp() WHERE id=s.id;
  INSERT INTO public.service_payment_events(service_id,amount,payment_date,payment_method,paid_by,posted_to_cash)
  VALUES(s.id,round(s.total_value,2),p_payment_date,p_payment_method,auth.uid(),s.total_value>0) RETURNING id INTO v_event_id;
  IF s.total_value>0 THEN
    INSERT INTO public.cash_movements(cash_register_id,type,description,amount,payment_method,source,service_id,payment_event_id,created_by,created_by_name)
    SELECT v_register_id,'entrada','Pagamento do Serviço #'||s.number,round(s.total_value,2),p_payment_method,'service_payment',s.id,v_event_id,auth.uid(),coalesce(nullif(btrim(name),''),'Usuário')
    FROM public.profiles WHERE id=auth.uid();
  END IF;
  PERFORM public.service_audit(s.id,'pagamento',jsonb_build_object('valor',s.total_value,'data',p_payment_date,'forma',p_payment_method,'caixa',v_register_id)::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_payment(p_service_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.services; e public.service_payment_events; v_register_id uuid;
BEGIN
  PERFORM public.require_member(true);
  PERFORM pg_advisory_xact_lock(82022026);
  IF coalesce(length(trim(p_reason)),0)=0 THEN RAISE EXCEPTION 'Informe a justificativa'; END IF;
  SELECT * INTO s FROM public.services WHERE id=p_service_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
  IF s.payment_status<>'pago' THEN RETURN; END IF;
  SELECT * INTO e FROM public.service_payment_events WHERE service_id=s.id AND reversed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Histórico do pagamento não encontrado; a correção foi cancelada'; END IF;
  IF e.posted_to_cash AND e.amount>0 THEN
    SELECT id INTO v_register_id FROM public.cash_registers WHERE status='aberto' FOR UPDATE;
    IF v_register_id IS NULL THEN RAISE EXCEPTION 'Abra o caixa para registrar o estorno deste pagamento'; END IF;
    INSERT INTO public.cash_movements(cash_register_id,type,description,amount,payment_method,source,service_id,reversed_payment_event_id,reversal_of,reason,created_by,created_by_name)
    VALUES(v_register_id,'saida','Estorno do pagamento do Serviço #'||s.number,-e.amount,e.payment_method,'payment_reversal',s.id,
      e.id,(SELECT id FROM public.cash_movements WHERE payment_event_id=e.id),btrim(p_reason),auth.uid(),
      coalesce((SELECT nullif(btrim(name),'') FROM public.profiles WHERE id=auth.uid()),'Usuário'));
  END IF;
  UPDATE public.service_payment_events SET reversed_at=clock_timestamp(),reversed_by=auth.uid(),reversal_reason=btrim(p_reason) WHERE id=e.id;
  PERFORM public.service_audit(s.id,'correcao_pagamento',jsonb_build_object('motivo',p_reason,'valor',s.total_value,'data_anterior',s.payment_date,'forma_anterior',s.payment_method,'estorno_no_caixa',e.posted_to_cash)::text);
  UPDATE public.services SET payment_status='pendente',payment_date=NULL,payment_method=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=s.id;
END;
$$;

REVOKE ALL ON FUNCTION public.open_cash_register(date,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_cash_movement(uuid,text,text,numeric,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.close_cash_register(uuid,numeric,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cash_register_snapshot(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cash_register_history(integer,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.register_payment(uuid,date,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reverse_payment(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_register(date,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_movement(uuid,text,text,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_register_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_register_history(integer,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_payment(uuid,date,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_payment(uuid,text) TO authenticated;

COMMIT;
