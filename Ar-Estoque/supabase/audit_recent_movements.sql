-- Auditoria somente leitura. Não altera saldos ou registros.
-- IDs, service_id e reversal_of distinguem lançamentos visualmente iguais.
SELECT m.id, p.name AS product_name, m.type, m.quantity,
       m.created_at, m.service_id, m.reversal_of, m.created_by, m.notes
FROM public.movements m
LEFT JOIN public.products p ON p.id = m.product_id
ORDER BY m.created_at DESC NULLS LAST, m.id DESC
LIMIT 10;

-- Histórico do produto citado, incluindo vínculos de estorno.
SELECT m.*, p.name AS product_name
FROM public.movements m
JOIN public.products p ON p.id = m.product_id
WHERE p.name ILIKE '%Fita PVC%'
ORDER BY m.created_at DESC NULLS LAST, m.id DESC;
