BEGIN;

-- Auth users cannot be removed while operation_requests reference their actor.
-- Clean only this idempotency metadata as part of the same Auth deletion
-- transaction; business and audit snapshots remain intact.
CREATE FUNCTION public.guard_auth_user_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_profile public.profiles;
  v_admin_count integer;
  v_active_admin_count integer;
BEGIN
  -- Serialize account deletion with role/access changes and other deletes.
  PERFORM pg_advisory_xact_lock(82022026);

  SELECT * INTO v_profile FROM public.profiles WHERE id=OLD.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O perfil deste usuário não foi encontrado; a exclusão foi cancelada.';
  END IF;

  IF v_profile.role='admin' THEN
    SELECT count(*), count(*) FILTER (WHERE is_active)
      INTO v_admin_count, v_active_admin_count
    FROM public.profiles WHERE role='admin';

    IF (v_profile.is_active AND v_active_admin_count <= 1)
       OR (NOT v_profile.is_active AND v_admin_count <= 1) THEN
      RAISE EXCEPTION 'Não é possível excluir o último administrador do sistema.';
    END IF;
  END IF;

  DELETE FROM public.operation_requests WHERE actor=OLD.id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_auth_user_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_auth_user_delete
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_auth_user_delete();

COMMIT;
