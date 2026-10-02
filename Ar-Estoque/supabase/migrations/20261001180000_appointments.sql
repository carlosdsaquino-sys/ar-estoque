BEGIN;
CREATE TABLE IF NOT EXISTS public.appointments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
 scheduled_date date NOT NULL, scheduled_time time NOT NULL,
 duration_minutes integer CHECK (duration_minutes > 0),
 technician text NOT NULL DEFAULT '',
 service_type_id uuid REFERENCES public.service_types(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','confirmado','concluido','cancelado','nao_compareceu')),
 notes text NOT NULL DEFAULT '', created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 completed_service_id uuid UNIQUE REFERENCES public.services(id) ON DELETE RESTRICT,
 version integer NOT NULL DEFAULT 1,
 CHECK (status <> 'concluido' OR completed_service_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.appointment_appliances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
 client_appliance_id uuid NOT NULL REFERENCES public.client_appliances(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(appointment_id,client_appliance_id)
);
-- Extend the existing audit trail instead of introducing a second audit system.
ALTER TABLE public.service_history ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE;
ALTER TABLE public.service_history ALTER COLUMN service_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS service_history_appointment_idx ON public.service_history(appointment_id);
CREATE INDEX IF NOT EXISTS appointments_client_idx ON public.appointments(client_id);
CREATE INDEX IF NOT EXISTS appointments_date_status_idx ON public.appointments(scheduled_date,status);
CREATE INDEX IF NOT EXISTS appointments_type_idx ON public.appointments(service_type_id);
CREATE INDEX IF NOT EXISTS appointment_appliances_device_idx ON public.appointment_appliances(client_appliance_id);
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_appliances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appointments_read ON public.appointments;
CREATE POLICY appointments_read ON public.appointments FOR SELECT TO authenticated USING(public.app_member());
DROP POLICY IF EXISTS appointment_appliances_read ON public.appointment_appliances;
CREATE POLICY appointment_appliances_read ON public.appointment_appliances FOR SELECT TO authenticated USING(public.app_member());
REVOKE ALL ON public.appointments,public.appointment_appliances FROM anon,authenticated;
GRANT SELECT ON public.appointments,public.appointment_appliances TO authenticated;

CREATE OR REPLACE FUNCTION public.save_appointment(p_id uuid,p_data jsonb,p_appliance_ids uuid[],p_expected_version integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.appointments; v_id uuid; v_client uuid := (p_data->>'client_id')::uuid; v_status text := coalesce(p_data->>'status','agendado'); v_before jsonb;
BEGIN
 PERFORM public.require_member();
 IF p_id IS NOT NULL THEN
  SELECT * INTO a FROM public.appointments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF p_expected_version IS DISTINCT FROM a.version THEN RAISE EXCEPTION 'Agendamento alterado por outro usuário. Atualize a agenda.'; END IF;
  v_before := to_jsonb(a);
  IF a.completed_service_id IS NOT NULL THEN RAISE EXCEPTION 'Agendamento já vinculado a serviço; preserve o histórico'; END IF;
 END IF;
 IF v_status='concluido' THEN RAISE EXCEPTION 'Conclua pelo fluxo de serviços'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=v_client AND archived_at IS NULL) THEN RAISE EXCEPTION 'Cliente inativo ou inexistente'; END IF;
 IF (p_data->>'service_type_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.service_types WHERE id=(p_data->>'service_type_id')::uuid AND is_active) THEN RAISE EXCEPTION 'Tipo de serviço inativo'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_appliance_ids) d(id) WHERE NOT EXISTS(SELECT 1 FROM public.client_appliances ca WHERE ca.id=d.id AND ca.client_id=v_client AND ca.is_active)) THEN RAISE EXCEPTION 'Aparelho não pertence ao cliente ou está inativo'; END IF;
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

-- Delegates to the existing transactional service flow. The appointment lock
-- prevents two attendances for the same appointment and retries remain idempotent.
CREATE OR REPLACE FUNCTION public.save_appointment_service(p_appointment_id uuid,p_service_id uuid,p_data jsonb,p_appliances jsonb,p_confirm boolean,p_request_id uuid,p_expected_version integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.appointments; v_id uuid;
BEGIN
 PERFORM public.require_member();
 SELECT * INTO a FROM public.appointments WHERE id=p_appointment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
 IF a.status IN ('cancelado','nao_compareceu') THEN RAISE EXCEPTION 'Agendamento não está pendente'; END IF;
 IF a.client_id IS DISTINCT FROM (p_data->>'client_id')::uuid THEN RAISE EXCEPTION 'O cliente do serviço deve corresponder ao agendamento'; END IF;
 IF a.completed_service_id IS NULL AND p_service_id IS NOT NULL THEN RAISE EXCEPTION 'Inicie um novo atendimento para este agendamento'; END IF;
 IF a.completed_service_id IS NOT NULL AND p_service_id IS DISTINCT FROM a.completed_service_id THEN
  -- Replaying the original request returns its service; a new request cannot create another.
  IF NOT EXISTS(SELECT 1 FROM public.services WHERE id=a.completed_service_id) THEN RAISE EXCEPTION 'Serviço vinculado inexistente'; END IF;
  RETURN a.completed_service_id;
 END IF;
 v_id := public.save_service_visit(p_service_id,p_data,p_appliances,p_confirm,p_request_id,p_expected_version);
 UPDATE public.appointments SET completed_service_id=v_id,status=CASE WHEN (SELECT status FROM public.services WHERE id=v_id)='confirmado' THEN 'concluido' ELSE status END,updated_at=clock_timestamp(),version=version+1 WHERE id=a.id;
 INSERT INTO public.service_history(appointment_id,service_id,action,description,user_name) VALUES(a.id,v_id,CASE WHEN a.completed_service_id IS NULL AND (SELECT status FROM public.services WHERE id=v_id)='confirmado' THEN 'conclusao' ELSE 'atendimento' END,'Serviço vinculado ao agendamento',(SELECT name FROM public.profiles WHERE id=auth.uid()));
 PERFORM public.service_audit(v_id,'agendamento','Atendimento originado de agendamento '||a.id);
 RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.complete_linked_appointment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='confirmado' AND OLD.status IS DISTINCT FROM NEW.status THEN
  WITH completed AS (UPDATE public.appointments SET status='concluido',updated_at=clock_timestamp(),version=version+1 WHERE completed_service_id=NEW.id AND status<>'concluido' RETURNING id)
  INSERT INTO public.service_history(appointment_id,service_id,action,description,user_name) SELECT id,NEW.id,'conclusao','Serviço confirmado',(SELECT name FROM public.profiles WHERE id=auth.uid()) FROM completed;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS services_complete_appointment ON public.services;
CREATE TRIGGER services_complete_appointment AFTER UPDATE OF status ON public.services FOR EACH ROW EXECUTE FUNCTION public.complete_linked_appointment();
REVOKE ALL ON FUNCTION public.save_appointment(uuid,jsonb,uuid[],integer),public.save_appointment_service(uuid,uuid,jsonb,jsonb,boolean,uuid,integer),public.complete_linked_appointment() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_appointment(uuid,jsonb,uuid[],integer),public.save_appointment_service(uuid,uuid,jsonb,jsonb,boolean,uuid,integer) TO authenticated;
DROP FUNCTION IF EXISTS public.maintenance_overview(date);
CREATE OR REPLACE FUNCTION public.maintenance_overview(p_today date)
RETURNS TABLE (
  service_type_id uuid,
  client_appliance_id uuid,
  client_id uuid,
  client_name text,
  appliance_name text,
  appliance_description text,
  appliance_location text,
  last_maintenance_date date,
  next_maintenance_date date,
  interval_months integer,
  alert_days integer,
  days_until integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.require_member();
  IF p_today IS NULL THEN RAISE EXCEPTION 'Data local obrigatória'; END IF;

  RETURN QUERY
  SELECT last_visit.service_type_id, ca.id, ca.client_id, c.name, ca.name, ca.description, ca.location,
         last_visit.service_date,
         (last_visit.service_date + make_interval(months => last_visit.interval_months))::date,
         last_visit.interval_months, last_visit.alert_days,
         ((last_visit.service_date + make_interval(months => last_visit.interval_months))::date - p_today)::integer
  FROM public.client_appliances ca
  JOIN public.clients c ON c.id = ca.client_id
  JOIN LATERAL (
    SELECT ps.service_type_id, s.service_date, ps.maintenance_interval_months_snapshot AS interval_months,
           ps.maintenance_alert_days_snapshot AS alert_days
    FROM public.service_appliances sa
    JOIN public.services s ON s.id = sa.service_id
    JOIN public.performed_services ps ON ps.appliance_id = sa.id
    WHERE sa.client_appliance_id = ca.id
      AND s.status = 'confirmado'
      AND ps.maintenance_enabled_snapshot
      AND ps.maintenance_interval_months_snapshot >= 1
    ORDER BY s.service_date DESC, s.id DESC, ps.created_at DESC, ps.id DESC
    LIMIT 1
  ) last_visit ON true
  WHERE ca.is_active
  ORDER BY (last_visit.service_date + make_interval(months => last_visit.interval_months))::date,
           c.name, ca.name;
END;
$$;
REVOKE ALL ON FUNCTION public.maintenance_overview(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maintenance_overview(date) TO authenticated;


COMMIT;
