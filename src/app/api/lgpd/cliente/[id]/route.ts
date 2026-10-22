import { NextResponse, type NextRequest } from "next/server";
import { getSession, getSituacao2fa } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * LGPD art. 18, II e V: relatório (JSON) com os dados pessoais do titular tratados pelo escritório.
 * Leitura com a sessão do usuário (RLS); restrito à gestão; limitado e registrado na auditoria.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
  const session = await getSession();
  if (!session?.profile.active) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(session.profile, "lgpd.exportar")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if ((await getSituacao2fa(session.profile)).bloqueado) return NextResponse.json({ error: "Conclua a autenticação em dois fatores." }, { status: 403 });

  const supabase = await createClient();
  const { data: permitido } = await supabase.rpc("rate_limit", { p_acao: "lgpd-exportar", p_max: 20, p_janela_seg: 3600 });
  if (permitido !== true) return NextResponse.json({ error: "Muitas exportações em pouco tempo. Tente mais tarde." }, { status: 429 });

  const { data: cliente } = await supabase.from("clientes").select("*").eq("id", id).maybeSingle();
  if (!cliente) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const [interacoes, atendimentos, processos, contratos, financeiro, documentos, agenda] = await Promise.all([
    supabase.from("interacoes").select("tipo, descricao, created_at").eq("cliente_id", id),
    supabase.from("atendimentos").select("nome_contato, telefone, email, canal, data, area, assunto, relato, status, created_at").eq("cliente_id", id),
    supabase.from("processos").select("numero_cnj, titulo, area, classe, assunto, tribunal, orgao, fase, status, polo_cliente, parte_contraria, data_distribuicao, created_at").eq("cliente_id", id),
    supabase.from("contratos_honorarios").select("numero, titulo, tipo, status, data_inicio, data_fim, created_at").eq("cliente_id", id),
    supabase.from("financeiro_lancamentos").select("tipo, descricao, valor, vencimento, status, created_at").eq("cliente_id", id),
    supabase.from("documentos").select("nome, categoria, mime_type, tamanho, created_at").eq("cliente_id", id),
    supabase.from("agenda_eventos").select("titulo, tipo, inicio, fim, local").eq("cliente_id", id),
  ]);
  const { data: empresa } = await supabase.from("configuracoes").select("valor").eq("chave", "empresa").maybeSingle();

  const dadosCadastrais = Object.fromEntries(Object.entries(cliente as Record<string, unknown>).filter(([k]) => !["id", "drive_folder_id", "created_by"].includes(k)));
  const relatorio = {
    titulo: "Relatório de dados pessoais do titular (LGPD, art. 18)",
    gerado_em: new Date().toISOString(),
    controlador: (empresa?.valor as Record<string, unknown> | null) ?? null,
    bases_legais: [
      "Execução de contrato e procedimentos preliminares (art. 7º, V)",
      "Exercício regular de direitos em processo judicial, administrativo ou arbitral (art. 7º, VI)",
      "Cumprimento de obrigação legal ou regulatória (art. 7º, II)",
    ],
    titular: dadosCadastrais,
    interacoes: interacoes.data ?? [],
    atendimentos: atendimentos.data ?? [],
    processos: processos.data ?? [],
    contratos_honorarios: contratos.data ?? [],
    lancamentos_financeiros: financeiro.data ?? [],
    documentos: documentos.data ?? [],
    agenda: agenda.data ?? [],
  };
  await supabase.rpc("registrar_acesso", { p_acao: "LGPD_EXPORTACAO", p_tabela: "clientes", p_registro: id, p_detalhes: null });

  const nome = `dados-titular-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(relatorio, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
