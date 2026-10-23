import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { registrarAcesso } from "@/lib/actions/utils";

/**
 * Portabilidade (LGPD art. 18, V): exporta todos os dados da empresa em NDJSON (uma linha por registro:
 * {"tabela": ..., "dados": {...}}). Só o administrador master; auditado; limitado a 3 por dia.
 * Segredos (tokens de integração, chaves de push, dados bancários criptografados) ficam de fora.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TABELAS = [
  "empresas", "configuracoes", "departamentos", "departamento_niveis", "departamento_membros", "empresa_membros", "funcionarios", "funcionario_documentos",
  "clientes", "cliente_carteira_historico", "interacoes", "documentos", "documento_tipos", "oportunidades", "consorcio_cotas", "seguro_apolices", "seguro_sinistros",
  "comissoes", "metas", "visitas", "tarefas", "agenda_eventos", "atendimentos", "processos", "processo_partes", "processo_andamentos", "prazos", "audiencias",
  "publicacoes", "contratos_honorarios", "financeiro_lancamentos", "financeiro_recorrencias", "centros_custo", "contas_bancarias", "extrato_movimentos",
  "horas_lancamentos", "rotas", "rota_paradas", "checkins", "despesas_rota", "veiculos", "leads", "distribuicao_regras", "lead_formularios",
  "wa_numeros", "wa_contatos", "wa_conversas", "wa_mensagens", "wa_modelos", "wa_campanhas", "jornadas", "cercas", "ponto_marcacoes", "ponto_ajustes",
  "ausencias", "ponto_espelhos", "folha_competencias", "folha_itens", "relatorios_mensais",
];
const OMITIR: Record<string, string[]> = { wa_numeros: [], funcionario_documentos: [], empresas: ["dominio_info"] };

export async function GET() {
  const session = await getSession();
  if (!session?.empresa || !session.profile.admin_master) return NextResponse.json({ error: "Somente o administrador master." }, { status: 403 });
  if (!hasServiceRole()) return NextResponse.json({ error: "indisponível" }, { status: 503 });
  const supabase = await createClient();
  const { data: permitido } = await supabase.rpc("rate_limit", { p_acao: "exportar_empresa", p_max: 3, p_janela_seg: 86400 });
  if (permitido === false) return NextResponse.json({ error: "Limite de 3 exportações por dia." }, { status: 429 });
  const empresaId = session.empresa.id;
  await registrarAcesso("EXPORTACAO_EMPRESA", "empresas", empresaId, { tabelas: TABELAS.length });
  const admin = createAdminClient();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(enc.encode(JSON.stringify({ exportacao: { empresa_id: empresaId, gerada_em: new Date().toISOString(), formato: "ndjson" } }) + "\n"));
      for (const t of TABELAS) {
        for (let de = 0; ; de += 1000) {
          const q = admin.from(t).select("*").range(de, de + 999);
          const { data, error } = await (t === "empresas" ? q.eq("id", empresaId) : q.eq("empresa_id", empresaId));
          if (error || !data?.length) break;
          for (const linha of data) {
            const l = { ...linha } as Record<string, unknown>;
            for (const k of Object.keys(l)) if (k.endsWith("_enc") || (OMITIR[t] ?? []).includes(k)) delete l[k];
            ctrl.enqueue(enc.encode(JSON.stringify({ tabela: t, dados: l }) + "\n"));
          }
          if (data.length < 1000) break;
        }
      }
      ctrl.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="geeasy-${session.empresa.slug}-${new Date().toISOString().slice(0, 10)}.ndjson"`,
      "Cache-Control": "no-store",
    },
  });
}
