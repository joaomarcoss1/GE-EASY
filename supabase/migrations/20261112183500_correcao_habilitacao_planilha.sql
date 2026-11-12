-- Correção de dados (já aplicada em produção): na planilha, a coluna "Dt. DE HABILITAÇÃO" tinha
-- 1 data digitada como texto (" 21/05/2024", linha 133 de 2024) e 2 senhas coladas na coluna errada
-- (linhas 881 e 882 de 2024). A data passa a valer como habilitação; as senhas saem das observações do processo.
update public.cliente_casos set habilitado_em = date '2024-05-21', observacoes = null
 where origem = 'planilha 2024' and linha = 133 and habilitado_em is null and observacoes like 'Dt. DE HABILITAÇÃO:%';
update public.cliente_casos set observacoes = regexp_replace(observacoes, '\s*\|\s*Dt\. DE HABILITAÇÃO: Bo[0-9]+', '')
 where origem = 'planilha 2024' and linha in (881, 882);
