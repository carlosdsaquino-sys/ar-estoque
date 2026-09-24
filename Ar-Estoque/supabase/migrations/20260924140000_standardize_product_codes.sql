BEGIN;

LOCK TABLE public.products IN ACCESS EXCLUSIVE MODE;

CREATE TABLE public.product_code_aliases (
  legacy_code text PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_code_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_code_aliases FROM PUBLIC, anon, authenticated;

CREATE TABLE public.product_code_reservations (
  code text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.product_code_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_code_reservations FROM PUBLIC, anon, authenticated;

CREATE SEQUENCE public.products_code_seq MINVALUE 1 START 1;

CREATE TEMP TABLE product_code_migration_map (
  product_id uuid PRIMARY KEY,
  old_code text NOT NULL UNIQUE,
  new_code text NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO product_code_migration_map(product_id,old_code,new_code)
SELECT id,code,'PROD-'||lpad(row_number() OVER (ORDER BY created_at NULLS LAST,id)::text,4,'0')
FROM public.products;

-- Stop safely if an old imported code would become another product's new code.
-- In that uncommon case the migration aborts without changing any product, so
-- the import alias remains unambiguous and can be reviewed before retrying.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM product_code_migration_map old_product
    JOIN product_code_migration_map new_product
      ON new_product.new_code=old_product.old_code
     AND new_product.product_id<>old_product.product_id
  ) THEN
    RAISE EXCEPTION 'Migração interrompida: um código legado coincide com o novo código de outro produto. Revise esse mapeamento antes de repetir.';
  END IF;
END;
$$;

INSERT INTO public.product_code_aliases(legacy_code,product_id)
SELECT old_code,product_id FROM product_code_migration_map;

DO $$
DECLARE v_constraint text;
BEGIN
  SELECT c.conname INTO v_constraint
  FROM pg_constraint c
  WHERE c.conrelid='public.products'::regclass
    AND c.contype='u'
    AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid='public.products'::regclass AND attname='code')]::smallint[];
  IF v_constraint IS NULL THEN
    RAISE EXCEPTION 'A restrição UNIQUE de products.code não foi encontrada.';
  END IF;
  EXECUTE format('ALTER TABLE public.products DROP CONSTRAINT %I',v_constraint);
END;
$$;

UPDATE public.products p
SET code=m.new_code
FROM product_code_migration_map m
WHERE p.id=m.product_id;

ALTER TABLE public.products ADD CONSTRAINT products_code_key UNIQUE(code);
ALTER TABLE public.products
  ADD CONSTRAINT products_code_format CHECK (code ~ '^PROD-[0-9]{4,}$');

SELECT setval(
  'public.products_code_seq',
  greatest((SELECT count(*) FROM public.products),1),
  (SELECT count(*)>0 FROM public.products)
);

CREATE FUNCTION public.reserve_product_code() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_code text;
BEGIN
  PERFORM public.require_member(true);
  DELETE FROM public.product_code_reservations WHERE expires_at<=clock_timestamp();
  v_code:='PROD-'||lpad(nextval('public.products_code_seq')::text,4,'0');
  INSERT INTO public.product_code_reservations(code,user_id,expires_at)
  VALUES(v_code,auth.uid(),clock_timestamp()+interval '24 hours');
  RETURN v_code;
END;
$$;

CREATE FUNCTION public.release_product_code_reservation(p_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.require_member(true);
  DELETE FROM public.product_code_reservations
  WHERE code=p_code AND user_id=auth.uid();
END;
$$;

CREATE FUNCTION public.create_product(p_data jsonb,p_code text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.require_member(true);
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object'
     OR nullif(btrim(p_data->>'name'),'') IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do produto.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_code_reservations
    WHERE code=p_code AND user_id=auth.uid() AND expires_at>clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'O código do produto expirou ou não pertence a esta sessão. Feche e abra o cadastro novamente.';
  END IF;

  INSERT INTO public.products(code,category_id,name,unit_id,brand,supplier_id,min_stock,unit_cost,unit_price,notes,is_active)
  VALUES(
    p_code,
    nullif(p_data->>'category_id','')::uuid,
    btrim(p_data->>'name'),
    nullif(p_data->>'unit_id','')::uuid,
    coalesce(p_data->>'brand',''),
    nullif(p_data->>'supplier_id','')::uuid,
    coalesce((p_data->>'min_stock')::numeric,0),
    coalesce((p_data->>'unit_cost')::numeric,0),
    coalesce((p_data->>'unit_price')::numeric,0),
    coalesce(p_data->>'notes',''),
    coalesce((p_data->>'is_active')::boolean,true)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.consume_product_code_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.code IS DISTINCT FROM OLD.code THEN
      RAISE EXCEPTION 'O código do produto não pode ser alterado após o cadastro.';
    END IF;
    RETURN NEW;
  END IF;

  DELETE FROM public.product_code_reservations
  WHERE code=NEW.code AND user_id=auth.uid() AND expires_at>clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O código precisa ser reservado pelo sistema antes do cadastro.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_code_guard
BEFORE INSERT OR UPDATE OF code ON public.products
FOR EACH ROW EXECUTE FUNCTION public.consume_product_code_reservation();

REVOKE INSERT ON public.products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_product_code_reservation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_product_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_product_code_reservation(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_product(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_product_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_product_code_reservation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_product(jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_products(p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  j jsonb;
  k text;
  v_external_code text;
  v_new_code text;
  v_existing uuid;
  v_product_id uuid;
  v_result jsonb;
  v_imported integer:=0;
  v_skipped integer:=0;
BEGIN
  PERFORM public.require_member(true);
  PERFORM pg_advisory_xact_lock(82022026);
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Importação inválida'; END IF;

  FOR j IN SELECT * FROM jsonb_array_elements(p_data) LOOP
    IF coalesce(length(btrim(j->>'code')),0)=0 OR coalesce(length(btrim(j->>'name')),0)=0 THEN
      RAISE EXCEPTION 'Código da planilha e nome são obrigatórios';
    END IF;
    FOREACH k IN ARRAY ARRAY['stock','min_stock','unit_cost','unit_price'] LOOP
      IF j->>k IS NULL OR NOT((j->>k)::numeric>=0 AND (j->>k)::numeric<'Infinity'::numeric) THEN
        RAISE EXCEPTION 'Valor inválido: %, produto %',k,j->>'code';
      END IF;
    END LOOP;
  END LOOP;

  FOR j IN SELECT * FROM jsonb_array_elements(p_data) LOOP
    v_external_code:=btrim(j->>'code');
    SELECT id INTO v_existing FROM public.products WHERE code=v_external_code LIMIT 1;
    IF v_existing IS NULL THEN
      SELECT product_id INTO v_existing FROM public.product_code_aliases WHERE legacy_code=v_external_code;
    END IF;
    IF v_existing IS NOT NULL THEN
      v_skipped:=v_skipped+1;
      CONTINUE;
    END IF;

    v_new_code:='PROD-'||lpad(nextval('public.products_code_seq')::text,4,'0');
    INSERT INTO public.product_code_reservations(code,user_id,expires_at)
    VALUES(v_new_code,auth.uid(),clock_timestamp()+interval '24 hours');
    v_result:=public.import_products_internal(jsonb_build_array(j||jsonb_build_object('code',v_new_code)));
    v_imported:=v_imported+coalesce((v_result->>'imported')::integer,0);
    v_skipped:=v_skipped+coalesce((v_result->>'skipped')::integer,0);

    SELECT id INTO v_product_id FROM public.products WHERE code=v_new_code;
    IF v_product_id IS NOT NULL THEN
      INSERT INTO public.product_code_aliases(legacy_code,product_id)
      VALUES(v_external_code,v_product_id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('imported',v_imported,'skipped',v_skipped,'errors',jsonb_build_array());
END;
$$;

REVOKE ALL ON FUNCTION public.import_products(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_products(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.import_products_internal(jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;
