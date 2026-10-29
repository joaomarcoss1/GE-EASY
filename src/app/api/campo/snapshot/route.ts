import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { parametrosRotas } from "@/lib/parametros";
import { onlyDigits, todayISO } from "@/lib/format";
import { custoPercurso, kmEstimado } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pacote de dados do app de campo (guardado CRIPTOGRAFADO no aparelho para funcionar sem internet):
 * rotas do consultor (hoje, em andamento e próximos 7 dias) com paradas, carteira com a contagem
 * regressiva dos 45 dias, documentos exigidos, termo LGPD vigente e contadores do painel.
 * Só dados do próprio consultor (o RLS garante) e documentos mascarados.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ mensagem: "Sessão expirada." }, { status: 401 });
  if (!session.empresa || !session.profile.active) return NextResponse.json({ revogado: true }, { status: 410 });
  const me = session.userId;
  const db = await createClient({ origem: "app" });
  const hoje = todayISO();
  const ate = new Date(Date.now() + 8 * 86400_000).toISOString().slice(0, 10);
  const [{ data: rotas }, { data: pend }, { data: carteira }, { data: tipos }, { data: termo }, { count: despesas }, parametros] = await Promise.all([
    db.from("rotas").select("id, nome, data, status, objetivo, iniciada_em, km_planejado, veiculo_id").eq("consultor_id", me)
      .or(`status.eq.em_andamento,and(status.eq.planejada,data.gte.${hoje},data.lte.${ate})`).order("data").limit(20),
    db.from("clientes").select("id, nome, cidade, prazo_documentacao, status_cadastro").eq("consultor_id", me).eq("status_cadastro", "pendente_documentacao").order("prazo_documentacao").limit(40),
    db.from("clientes").select("id, nome, documento, cidade, status_cadastro, telefone").eq("consultor_id", me).eq("carteira", "consultor").order("updated_at", { ascending: false }).limit(200),
    db.from("documento_tipos").select("categoria, nome, obrigatorio, aplica_pf, aplica_pj").eq("ativo", true).order("ordem"),
    db.from("configuracoes").select("valor").eq("chave", "lgpd_termo").maybeSingle(),
    db.from("despesas_rota").select("id", { count: "exact", head: true }).eq("consultor_id", me).eq("status", "lancada"),
    parametrosRotas(),
  ]);
  const ids = (rotas ?? []).map((r) => r.id);
  const veicIds = [...new Set((rotas ?? []).map((r) => r.veiculo_id).filter((x): x is string => !!x))];
  const [{ data: paradas }, { data: checkins }, { data: veiculos }] = ids.length
    ? await Promise.all([
        db.from("rota_paradas").select("id, rota_id, ordem, tipo, cliente_id, titulo, endereco, cidade, uf, lat, lng, raio_m, janela_inicio, janela_fim, objetivo, obrigatoria, status").in("rota_id", ids).order("ordem"),
        db.from("checkins").select("id, rota_id, parada_id, tipo, registrado_em, resultado, dentro_do_raio").in("rota_id", ids).order("registrado_em"),
        veicIds.length ? db.from("veiculos").select("id, descricao, placa, consumo_km_l").in("id", veicIds) : Promise.resolve({ data: [] }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  /** Veículo e previsão de km/combustível da rota (km planejado ou linha reta × fator entre as paradas) */
  const extras = (r: { veiculo_id: string | null; km_planejado: number | null }, ps: { lat: number | null; lng: number | null }[]) => {
    const v = (veiculos ?? []).find((x) => x.id === r.veiculo_id) ?? null;
    const pts = ps.filter((p) => p.lat != null && p.lng != null).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    const km = r.km_planejado != null ? Number(r.km_planejado) : pts.length >= 2 ? kmEstimado(pts, parametros.fator_rodoviario) : null;
    const consumo = Number(v?.consumo_km_l ?? parametros.consumo_km_l);
    const c = km != null ? custoPercurso(km, { consumoKmL: consumo, precoCombustivel: parametros.preco_combustivel, valorKm: parametros.valor_km, modo: parametros.reembolso_modo }) : null;
    return {
      veiculo: v ? { descricao: v.descricao, placa: v.placa, consumo_km_l: consumo } : null,
      previsao: km != null && c ? { km, litros: c.litros, combustivel: c.combustivel, consumo_km_l: consumo } : null,
    };
  };
  // o que falta de documento (até 30 clientes, os de prazo mais curto)
  const faltando = await Promise.all((pend ?? []).slice(0, 30).map(async (c) => {
    const { data } = await db.rpc("situacao_documental", { p_cliente: c.id });
    return [c.id, ((data as { faltando?: string[] } | null)?.faltando ?? [])] as const;
  }));
  const faltaMap = new Map(faltando);
  let leadsNovos = 0;
  if (can(session.profile, "leads.view")) {
    const { count } = await db.from("leads").select("id", { count: "exact", head: true }).eq("responsavel_id", me).eq("status", "novo");
    leadsNovos = count ?? 0;
  }
  let pontoHoje: unknown[] = [];
  if (can(session.profile, "ponto.registrar")) {
    const { data } = await db.from("ponto_marcacoes").select("id, tipo, registrado_em").eq("user_id", me).gte("registrado_em", `${hoje}T00:00:00-03:00`).order("registrado_em");
    pontoHoje = data ?? [];
  }
  const termoV = (termo?.valor ?? {}) as { versao?: string; texto?: string };

  return NextResponse.json(
    {
      gerado_em: new Date().toISOString(),
      usuario: { id: me, nome: session.profile.full_name },
      empresa: { id: session.empresa.id, nome: session.empresa.nome },
      pode: {
        cadastrar: can(session.profile, "clientes.write"),
        rotas: can(session.profile, "rotas.executar"),
        despesas: can(session.profile, "despesas.lancar"),
        ponto: can(session.profile, "ponto.registrar"),
        leads: can(session.profile, "leads.view"),
      },
      parametros,
      termo_lgpd: {
        versao: termoV.versao ?? "1.0",
        texto: termoV.texto ?? `Autorizo ${session.empresa.nome} a tratar meus dados pessoais (nome, contato, documentos e localização do atendimento) para cadastro, análise de crédito/proposta e contato comercial, conforme a Lei 13.709/2018 (LGPD). Posso pedir acesso, correção ou exclusão a qualquer momento.`,
      },
      rotas: (rotas ?? []).map((r) => ({
        ...r,
        ...extras(r, (paradas ?? []).filter((p) => p.rota_id === r.id)),
        paradas: (paradas ?? []).filter((p) => p.rota_id === r.id),
        checkins: (checkins ?? []).filter((c) => c.rota_id === r.id),
      })),
      pendencias: (pend ?? []).map((c) => ({ ...c, faltando: faltaMap.get(c.id) ?? null })),
      // no aparelho só os 4 últimos dígitos do documento (minimização: basta para identificar o cliente)
      carteira: (carteira ?? []).map((c) => ({ id: c.id, nome: c.nome, documento: c.documento ? `•••${onlyDigits(c.documento).slice(-4)}` : null, cidade: c.cidade, status_cadastro: c.status_cadastro })),
      documento_tipos: tipos ?? [],
      contadores: { despesas_pendentes: despesas ?? 0, leads_novos: leadsNovos },
      ponto_hoje: pontoHoje,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
