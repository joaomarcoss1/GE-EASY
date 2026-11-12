import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { CASO_PENDENCIAS, CASO_STATUS } from "@/lib/constants";
import { date, maskDocumento, maskPhone, todayISO } from "@/lib/format";
import { csvResponse, toCsv } from "@/lib/csv";
import { aplicarFiltros, lerFiltros, SELECT_CASOS } from "@/lib/casos";
import { registrarAcesso } from "@/lib/actions/utils";

export const dynamic = "force-dynamic";

/** Exporta (CSV) os processos dos clientes com os mesmos filtros da tela. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(session.profile, "clientes.exportar") || !can(session.profile, "clientes.ver_todos")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const f = lerFiltros(Object.fromEntries(req.nextUrl.searchParams));
  const supabase = await createClient();
  const linhas: Record<string, unknown>[] = [];
  for (let i = 0; i < 20_000; i += 1000) {
    const { data, error } = await aplicarFiltros(supabase.from("cliente_casos").select(SELECT_CASOS).order("recebido_em", { ascending: false, nullsFirst: false }).order("id").range(i, i + 999), f);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const rot = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? (v == null ? "" : String(v));
  const sn = (v: unknown) => (v === true ? "Sim" : v === false ? "Não" : "");
  const d = (v: unknown) => (v ? date(String(v)) : "");
  const csv = toCsv(
    ["Cliente", "CPF", "Telefone", "Tipo", "Consultor", "Cidade", "UF", "Ano", "Recebido", "Habilitado", "Perícia", "Avaliação", "Situação", "Pendência", "Exigência cumprida", "Contrato assinado", "Procuração assinada", "Retroativo", "Situação na planilha", "Observações"],
    linhas.map((r) => {
      const c = r.clientes as { nome: string; documento: string | null; whatsapp: string | null; telefone: string | null };
      return [c.nome, c.documento ? maskDocumento(c.documento) : "", maskPhone(c.whatsapp || c.telefone), r.tipo as string, r.corretor as string, r.cidade as string, r.uf as string, r.ano as number,
        d(r.recebido_em), d(r.habilitado_em), d(r.pericia_em), d(r.avaliacao_em), rot(CASO_STATUS, r.status), rot(CASO_PENDENCIAS, r.pendencia), r.exigencia_cumprida ? "Sim" : "",
        sn(r.contrato_assinado), sn(r.procuracao_assinada), r.retroativo as string, r.situacao_planilha as string, r.observacoes as string];
    }),
  );
  await registrarAcesso("EXPORTACAO", "cliente_casos", null, { linhas: linhas.length, filtros: f });
  return csvResponse(`processos-clientes-${todayISO()}.csv`, csv);
}
