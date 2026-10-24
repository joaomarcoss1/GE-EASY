"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { coordValida, ordemVizinhoMaisProximo, percursoM, type Ponto } from "@/lib/geo";
import { geocodificar, planejarComGoogle } from "@/lib/integracoes/maps";
import { normalizarRotas, parametrosRotas } from "@/lib/parametros";
import { DESPESA_TIPOS, PARADA_TIPOS } from "@/lib/constants";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

/**
 * Rotas (fase 5): o planejamento (rotas.definir) cria rotas e paradas; o consultor executa pelas funções do
 * banco (iniciar, check-in, finalizar), que calculam raio, sinais de fraude, km, tempos e custos; a gestão
 * aprova rotas, check-ins e despesas. O banco repete todas as travas.
 */
const atualizar = (id?: string | null) => {
  revalidatePath("/rotas");
  if (id) revalidatePath(`/rotas/${id}`);
  revalidatePath("/campo");
};
const erroDb = (e: { code?: string; message?: string }): ActionState =>
  (e.code === "P0001" || e.code === "23514" || (e.code === "42501" && e.message && !e.message.startsWith("new row"))) && e.message ? { error: e.message } : dbError(e);

const rotaSchema = z.object({
  id: zs.uuid(),
  nome: zs.required("Nome", 160),
  data: zs.date().refine((v) => !!v, "Informe a data"),
  consultor_id: zs.requiredUuid("o consultor"),
  veiculo_id: zs.uuid(),
  objetivo: zs.text(2000),
});

export async function salvarRota(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("rotas.definir");
  if ("denied" in g) return g.denied;
  const parsed = rotaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...v } = parsed.data;
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("rotas").update(v).eq("id", id).select("id").maybeSingle()
    : await supabase.from("rotas").insert({ ...v, status: "planejada" }).select("id").single();
  if (error) return erroDb(error);
  if (!data) return { error: "Rota não encontrada ou já encerrada." };
  atualizar(data.id);
  return { ok: true, message: id ? "Rota atualizada." : "Rota criada. Agora inclua as paradas.", id: data.id };
}

export async function cancelarRota(id: string): Promise<ActionState> {
  const g = await guard("rotas.definir");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Rota inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("rotas").update({ status: "cancelada" }).eq("id", id).eq("status", "planejada").select("id").maybeSingle();
  if (error) return erroDb(error);
  if (!data) return { error: "Só rotas ainda não iniciadas podem ser canceladas." };
  atualizar(id);
  return { ok: true, message: "Rota cancelada." };
}

const paradaSchema = z.object({
  rota_id: zs.requiredUuid("a rota"),
  tipo: z.string().refine((t) => PARADA_TIPOS.some((o) => o.value === t), "Tipo inválido"),
  cliente_id: zs.uuid(),
  titulo: zs.text(200),
  endereco: zs.text(300),
  cidade: zs.text(120),
  uf: zs.text(2),
  lat: zs.number(-90, 90),
  lng: zs.number(-180, 180),
  raio_m: zs.number(20, 5000),
  janela_inicio: zs.text(5),
  janela_fim: zs.text(5),
  objetivo: zs.text(1000),
  obrigatoria: zs.bool(),
});

async function proximaOrdem(supabase: Awaited<ReturnType<typeof createClient>>, rotaId: string) {
  const { data } = await supabase.from("rota_paradas").select("ordem").eq("rota_id", rotaId).order("ordem", { ascending: false }).limit(1).maybeSingle();
  return Math.min(500, (data?.ordem ?? 0) + 1);
}

/** Parada: cliente (endereço e coordenadas do cadastro), cidade, endereço ou ponto de interesse. Sem coordenadas, geocodifica. */
export async function adicionarParada(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("rotas.definir");
  if ("denied" in g) return g.denied;
  const parsed = paradaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  let { titulo, endereco, cidade, uf, lat, lng } = v;
  if (v.cliente_id) {
    const { data: c } = await supabase.from("clientes").select("nome, endereco, numero, bairro, cidade, uf, latitude, longitude").eq("id", v.cliente_id).maybeSingle();
    if (!c) return { error: "Cliente não encontrado ou sem acesso.", fieldErrors: { cliente_id: "Sem acesso" } };
    titulo = titulo ?? c.nome;
    endereco = endereco ?? ([c.endereco, c.numero, c.bairro].filter(Boolean).join(", ") || null);
    cidade = cidade ?? c.cidade;
    uf = uf ?? c.uf;
    if (lat == null && c.latitude != null) { lat = Number(c.latitude); lng = Number(c.longitude); }
  }
  if (!titulo) titulo = cidade ? `${cidade}${uf ? `/${uf}` : ""}` : endereco;
  if (!titulo || titulo.length < 2) return { error: "Informe o título, o cliente ou o endereço da parada.", fieldErrors: { titulo: "Obrigatório" } };
  let aviso = "";
  if ((lat == null || lng == null) && (endereco || cidade)) {
    const geo = await geocodificar([endereco, cidade, uf, "Brasil"].filter(Boolean).join(", "));
    if (geo) { lat = geo.lat; lng = geo.lng; aviso = ` Localização encontrada (${geo.fonte}).`; }
    else aviso = " Sem coordenadas: o check-in desta parada não terá verificação de raio.";
  }
  const { error } = await supabase.from("rota_paradas").insert({
    rota_id: v.rota_id, ordem: await proximaOrdem(supabase, v.rota_id), tipo: v.tipo, cliente_id: v.cliente_id, titulo: titulo.slice(0, 200),
    endereco, cidade, uf: uf?.toUpperCase() ?? null, lat, lng, raio_m: v.raio_m, janela_inicio: v.janela_inicio, janela_fim: v.janela_fim,
    objetivo: v.objetivo, obrigatoria: v.obrigatoria,
  });
  if (error) return erroDb(error);
  atualizar(v.rota_id);
  return { ok: true, message: `Parada incluída.${aviso}` };
}

const filtroSchema = z.object({
  rota_id: zs.requiredUuid("a rota"),
  cidade: zs.text(120),
  status_cadastro: zs.text(40),
  carteira: zs.text(20),
  consultor_id: zs.uuid(),
  limite: zs.number(1, 100),
});

/** Inclui de uma vez os clientes de um filtro (ex.: "documentação pendente na cidade X"). */
export async function adicionarClientesFiltro(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("rotas.definir");
  if ("denied" in g) return g.denied;
  const parsed = filtroSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  if (!v.cidade && !v.status_cadastro && !v.consultor_id) return { error: "Escolha ao menos um filtro (cidade, situação ou consultor)." };
  const supabase = await createClient();
  let q = supabase.from("clientes").select("id, nome, endereco, numero, bairro, cidade, uf, latitude, longitude").limit(v.limite ?? 30);
  if (v.cidade) q = q.ilike("cidade", v.cidade);
  if (v.status_cadastro) q = q.eq("status_cadastro", v.status_cadastro);
  if (v.carteira) q = q.eq("carteira", v.carteira);
  if (v.consultor_id) q = q.eq("consultor_id", v.consultor_id);
  const [{ data: clientes, error: e1 }, { data: ja }] = await Promise.all([q, supabase.from("rota_paradas").select("cliente_id").eq("rota_id", v.rota_id)]);
  if (e1) return dbError(e1);
  const existentes = new Set((ja ?? []).map((p) => p.cliente_id));
  const novos = (clientes ?? []).filter((c) => !existentes.has(c.id));
  if (!novos.length) return { error: "Nenhum cliente novo encontrado com esses filtros." };
  let ordem = (await proximaOrdem(supabase, v.rota_id)) - 1;
  const { error } = await supabase.from("rota_paradas").insert(
    novos.map((c) => ({
      rota_id: v.rota_id, ordem: Math.min(500, ++ordem), tipo: "cliente", cliente_id: c.id, titulo: c.nome,
      endereco: [c.endereco, c.numero, c.bairro].filter(Boolean).join(", ") || null, cidade: c.cidade, uf: c.uf,
      lat: c.latitude, lng: c.longitude, objetivo: v.status_cadastro === "pendente_documentacao" ? "Coletar documentação pendente" : null,
    })),
  );
  if (error) return erroDb(error);
  atualizar(v.rota_id);
  const semCoord = novos.filter((c) => c.latitude == null).length;
  return { ok: true, message: `${novos.length} parada(s) incluída(s).${semCoord ? ` ${semCoord} sem coordenadas (sem verificação de raio).` : ""}` };
}

export async function removerParada(id: string): Promise<ActionState> {
  const g = await guard("rotas.definir");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Parada inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("rota_paradas").delete().eq("id", id).select("rota_id").maybeSingle();
  if (error) return erroDb(error);
  if (!data) return { error: "Só paradas pendentes de rotas planejadas podem ser removidas." };
  atualizar(data.rota_id);
  return { ok: true, message: "Parada removida." };
}

/** Ordena as paradas e calcula km/tempo planejados (Google com chave; senão vizinho mais próximo em linha reta × fator). */
export async function otimizarRota(id: string): Promise<ActionState> {
  const g = await guard("rotas.definir");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Rota inválida." };
  const supabase = await createClient();
  const [{ data: rota }, { data: paradas }, p] = await Promise.all([
    supabase.from("rotas").select("id, status, inicio_lat, inicio_lng").eq("id", id).maybeSingle(),
    supabase.from("rota_paradas").select("id, lat, lng, status").eq("rota_id", id).order("ordem"),
    parametrosRotas(),
  ]);
  if (!rota) return { error: "Rota não encontrada." };
  if (rota.status !== "planejada") return { error: "Só rotas planejadas podem ser reordenadas." };
  const lista = (paradas ?? []).filter((x) => x.status === "pendente");
  if (lista.length < 2) return { error: "Inclua ao menos duas paradas para otimizar." };
  const pontos = lista.map((x) => (x.lat != null && x.lng != null ? { lat: Number(x.lat), lng: Number(x.lng) } : null));
  const comCoord = pontos.filter((x): x is Ponto => coordValida(x));
  const origem: Ponto | null = rota.inicio_lat != null ? { lat: Number(rota.inicio_lat), lng: Number(rota.inicio_lng) } : (comCoord[0] ?? null);
  let ordem = ordemVizinhoMaisProximo(origem, pontos);
  let km: number | null = null;
  let minutos: number | null = null;
  let metodo = "linha_reta";
  const idxCoord = pontos.map((x, i) => (coordValida(x) ? i : -1)).filter((i) => i >= 0);
  const google = origem && idxCoord.length >= 1 ? await planejarComGoogle(origem, idxCoord.map((i) => pontos[i]!)) : null;
  if (google) {
    ordem = [...google.ordem.map((k) => idxCoord[k]), ...pontos.map((_, i) => i).filter((i) => !idxCoord.includes(i))];
    km = Math.round(google.distanciaM / 10) / 100;
    minutos = Math.round(google.duracaoS / 60);
    metodo = "google";
  } else {
    const seq = [origem, ...ordem.map((i) => pontos[i])].filter((x): x is Ponto => coordValida(x));
    km = Math.round((percursoM(seq) / 1000) * p.fator_rodoviario * 100) / 100;
    minutos = Math.round((km / 35) * 60); // shortcut: velocidade média urbana de 35 km/h quando não há mapa rodoviário
  }
  minutos = (minutos ?? 0) + lista.length * 20; // + 20 min por visita
  for (let k = 0; k < ordem.length; k++) {
    const { error } = await supabase.from("rota_paradas").update({ ordem: k + 1 }).eq("id", lista[ordem[k]].id);
    if (error) return erroDb(error);
  }
  const { error } = await supabase.from("rotas").update({ km_planejado: km, tempo_planejado_min: minutos, metodo_km: metodo }).eq("id", id);
  if (error) return erroDb(error);
  atualizar(id);
  return { ok: true, message: `Rota otimizada (${metodo === "google" ? "Google Maps" : "linha reta × fator rodoviário"}): ${km} km, ~${Math.round(minutos / 60 * 10) / 10} h com as visitas.` };
}

const reagendarSchema = z.object({ paradas: z.array(zs.requiredUuid("as paradas")).min(1, "Selecione as paradas").max(200), rota_destino: zs.requiredUuid("a rota de destino") });

export async function reagendarParadas(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("rotas.definir");
  if ("denied" in g) return g.denied;
  const parsed = reagendarSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reagendar_paradas", { p_paradas: parsed.data.paradas, p_rota_destino: parsed.data.rota_destino });
  if (error) return erroDb(error);
  atualizar(parsed.data.rota_destino);
  return { ok: true, message: `${data ?? 0} parada(s) reagendada(s).` };
}

// ------------------------------------------------------------------ supervisão
export async function aprovarRota(id: string): Promise<ActionState> {
  const g = await guard("rotas.aprovar");
  if ("denied" in g) return g.denied;
  const supabase = await createClient();
  const { error } = await supabase.rpc("aprovar_rota", { p_rota: id });
  if (error) return erroDb(error);
  atualizar(id);
  return { ok: true, message: "Rota aprovada." };
}

export async function revisarCheckin(id: string, aprovar: boolean): Promise<ActionState> {
  const g = await guard("rotas.aprovar");
  if ("denied" in g) return g.denied;
  const supabase = await createClient();
  const { error } = await supabase.rpc("revisar_checkin", { p_checkin: id, p_aprovar: aprovar });
  if (error) return erroDb(error);
  revalidatePath("/rotas");
  return { ok: true, message: aprovar ? "Check-in aceito." : "Check-in rejeitado." };
}

const decisaoSchema = z.object({ id: zs.requiredUuid("a despesa"), decisao: zs.enumOf(["aprovar", "recusar"]), motivo: zs.text(500) });

export async function decidirDespesa(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("despesas.aprovar");
  if ("denied" in g) return g.denied;
  const parsed = decisaoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("aprovar_despesa", { p_despesa: parsed.data.id, p_aprovar: parsed.data.decisao === "aprovar", p_motivo: parsed.data.motivo });
  if (error) return erroDb(error);
  revalidatePath("/rotas/despesas");
  return { ok: true, message: parsed.data.decisao === "aprovar" ? "Despesa aprovada." : "Despesa recusada." };
}

export async function aprovarDespesaRapida(id: string): Promise<ActionState> {
  const g = await guard("despesas.aprovar");
  if ("denied" in g) return g.denied;
  const supabase = await createClient();
  const { error } = await supabase.rpc("aprovar_despesa", { p_despesa: id, p_aprovar: true });
  if (error) return erroDb(error);
  revalidatePath("/rotas/despesas");
  return { ok: true, message: "Despesa aprovada." };
}

const despesaSchema = z.object({
  id: zs.uuid(),
  rota_id: zs.uuid(),
  tipo: z.string().refine((t) => DESPESA_TIPOS.some((o) => o.value === t), "Tipo inválido"),
  valor: zs.money().refine((v) => v != null && v > 0, "Informe o valor"),
  data: zs.date(),
  descricao: zs.text(500),
  hodometro: zs.number(0, 9_999_999),
  comprovante_path: zs.text(500),
});

export async function lancarDespesa(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("despesas.lancar");
  if ("denied" in g) return g.denied;
  const parsed = despesaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...v } = parsed.data;
  const supabase = await createClient();
  const row = { ...v, data: v.data ?? undefined, consultor_id: g.session.userId };
  const { error } = id ? await supabase.from("despesas_rota").update(row).eq("id", id) : await supabase.from("despesas_rota").insert(row);
  if (error) return erroDb(error);
  revalidatePath("/rotas/despesas");
  revalidatePath("/campo");
  return { ok: true, message: "Despesa lançada para aprovação." };
}

// ------------------------------------------------------------------ veículos e parâmetros
const veiculoSchema = z.object({ id: zs.uuid(), descricao: zs.required("Descrição", 120), placa: zs.text(10), consumo_km_l: zs.number(1, 100), responsavel_id: zs.uuid(), ativo: zs.bool() });

export async function salvarVeiculo(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("rotas.definir");
  if ("denied" in g) return g.denied;
  const parsed = veiculoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...v } = parsed.data;
  const supabase = await createClient();
  const row = { ...v, placa: v.placa?.toUpperCase().replace(/\s/g, "") ?? null };
  const { error } = id ? await supabase.from("veiculos").update(row).eq("id", id) : await supabase.from("veiculos").insert(row);
  if (error) return erroDb(error);
  revalidatePath("/configuracoes");
  return { ok: true, message: "Veículo salvo." };
}

const paramSchema = z.object({
  raio_m: zs.number(20, 5000), fora_do_raio: zs.enumOf(["justificar", "bloquear"]), reembolso_modo: zs.enumOf(["km", "consumo"]),
  valor_km: zs.money(), consumo_km_l: zs.number(1, 100), preco_combustivel: zs.money(), fator_rodoviario: zs.number(1, 3),
  exigir_hodometro: zs.bool(), exigir_selfie: zs.bool(), rastreio: zs.bool(),
});

export async function salvarParametrosRotas(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("rotas.definir");
  if ("denied" in g) return g.denied;
  const parsed = paramSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const valor = normalizarRotas(parsed.data as Parameters<typeof normalizarRotas>[0]);
  const { error } = await supabase.from("configuracoes").upsert({ chave: "rotas", valor, updated_by: g.session.userId }, { onConflict: "empresa_id,chave" });
  if (error) return dbError(error);
  revalidatePath("/configuracoes");
  return { ok: true, message: "Parâmetros de rotas salvos." };
}
