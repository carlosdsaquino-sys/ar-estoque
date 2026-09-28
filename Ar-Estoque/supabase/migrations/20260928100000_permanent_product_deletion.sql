BEGIN;

-- Product-owned ledger and service-material rows use ON DELETE RESTRICT.
-- Delete them explicitly inside this RPC so the complete operation remains
-- atomic and the existing admin check stays enforced on the server.
CREATE OR REPLACE FUNCTION public.delete_product(p_product_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.require_member(true);
  -- Match the lock used by stock and service mutations to serialize this
  -- destructive operation with operations that can add product history.
  PERFORM pg_advisory_xact_lock(82022026);

  PERFORM 1 FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;

  -- These are the only direct product references that restrict deletion.
  -- Other product dependents (such as code aliases) follow their declared
  -- foreign-key behavior, including ON DELETE CASCADE.
  DELETE FROM public.movements WHERE product_id = p_product_id;
  DELETE FROM public.service_materials WHERE product_id = p_product_id;
  DELETE FROM public.products WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_product(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product(uuid) TO authenticated;

COMMIT;
