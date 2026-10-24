"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { onlyDigits } from "@/lib/format";
import { can } from "@/lib/rbac";
import { DOC_CATEGORIAS, WA_MODELO_CATEGORIAS, WA_RESULTADOS } from "@/lib/constants";
import { enviarPendentes, testarNumero } from "@/lib/integracoes/whatsapp";
import { dbError, formToObject, guard, isUuid, limitar, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

/**
 * Atendimento por WhatsApp (fase 6). As regras (janela de 24 h, modelo aprovado, opt-in para marketing,
 * visibilidade por fila/carteira) ficam nas funções do banco; aqui só validamos a entrada e disparamos o
 * envio imediato pela API da Meta (o cron reenvia o que falhar).
 */
const atualizar = (c?: string) => {
  revalidatePath("/whatsapp");
  if (c) revalidatePath(`/whatsapp?c=${c}`);
};
const erroDb = (e: { code?: string; message?: string }): ActionState =>
  (e.code === "P0001" || e.code === "23514" || (e.code === "42501" && e.message && !e.message.startsWith("new row"))) && e.message ? { error: e.message } : dbError(e);
const enviarAgora = (conversa: string) => {
  if (!hasServiceRole()) return;
  after(() => enviarPendentes(createAdminClient(), Date.now() + 20_000, conversa).catch((e) => console.error("[wa envio]", e instanceof Error ? e.message : e)));
};

const msgSchema = z.object({
  conversa_id: zs.requiredUuid("a conversa"),
  texto: zs.text(4096),
  modelo_id: zs.uuid(),
  variaveis: zs.text(2000),
});

export async function enviarMensagem(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("whatsapp.atender");
  if ("denied" in g) return g.denied;
  const parsed = msgSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  if (!v.texto && !v.modelo_id) return { error: "Escreva a mensagem ou escolha um modelo." };
  const lim = await limitar("wa_enviar", 120, 600);
  if (lim) return lim;
  const supabase = await createClient();
  const { error } = await supabase.rpc("wa_enviar", {
    p_conversa: v.conversa_id, p_texto: v.modelo_id ? null : v.texto, p_modelo: v.modelo_id ?? null,
    p_variaveis: v.variaveis ? v.variaveis.split("|").map((s) => s.trim()) : null,
  });
  if (error) return erroDb(error);
  enviarAgora(v.conversa_id);
  atualizar(v.conversa_id);
  return { ok: true };
}

const notaSchema = z.object({ conversa_id: zs.requiredUuid("a conversa"), texto: zs.required("Nota", 4000) });
export async function registrarNota(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("whatsapp.atender");
  if ("denied" in g) return g.denied;
  const parsed = notaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("wa_nota", { p_conversa: parsed.data.conversa_id, p_texto: parsed.data.texto });
  if (error) return erroDb(error);
  atualizar(parsed.data.conversa_id);
  return { ok: true, message: "Nota interna registrada (o cliente não vê)." };
}

export async function assumirConversa(id: string): Promise<ActionState> {
  const g = await guard("whatsapp.atender");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Conversa inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wa_assumir", { p_conversa: id });
  if (error) return erroDb(error);
  atualizar(id);
  return { ok: true, message: "Conversa assumida." };
}

const transfSchema = z.object({ conversa_id: zs.requiredUuid("a conversa"), atendente_id: zs.uuid(), departamento_id: zs.uuid(), nota: zs.text(1000) });
export async function transferirConversa(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("whatsapp.atender");
  if ("denied" in g) return g.denied;
  const parsed = transfSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  if (!v.atendente_id && !v.departamento_id) return { error: "Escolha o atendente ou o departamento." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wa_transferir", { p_conversa: v.conversa_id, p_atendente: v.atendente_id ?? null, p_departamento: v.departamento_id ?? null, p_nota: v.nota });
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: "Conversa transferida com o histórico." };
}

const encSchema = z.object({
  conversa_id: zs.requiredUuid("a conversa"),
  resultado: z.string().refine((v) => WA_RESULTADOS.some((o) => o.value === v), "Escolha o resultado"),
  motivo: zs.text(300),
});
export async function encerrarConversa(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("whatsapp.atender");
  if ("denied" in g) return g.denied;
  const parsed = encSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("wa_encerrar", { p_conversa: parsed.data.conversa_id, p_resultado: parsed.data.resultado, p_motivo: parsed.data.motivo });
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: "Atendimento encerrado." };
}

export async function registrarOptin(contatoId: string, optin: boolean): Promise<ActionState> {
  const g = await guard("whatsapp.atender");
  if ("denied" in g) return g.denied;
  if (!isUuid(contatoId)) return { error: "Contato inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wa_consentimento", { p_contato: contatoId, p_optin: optin, p_origem: "atendimento" });
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: optin ? "Autorização para mensagens registrada." : "Descadastro registrado." };
}

const etiquetaSchema = z.object({ conversa_id: zs.requiredUuid("a conversa"), etiquetas: zs.text(300), prioridade: zs.number(0, 3) });
export async function salvarEtiquetas(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("whatsapp.atender");
  if ("denied" in g) return g.denied;
  const parsed = etiquetaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const etiquetas = (parsed.data.etiquetas ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 10);
  const supabase = await createClient();
  const { data: cv } = await supabase.from("wa_conversas").select("contato_id").eq("id", parsed.data.conversa_id).maybeSingle();
  if (!cv) return { error: "Conversa não encontrada." };
  const { error } = await supabase.from("wa_contatos").update({ etiquetas }).eq("id", cv.contato_id);
  if (error) return erroDb(error);
  atualizar(parsed.data.conversa_id);
  return { ok: true, message: "Etiquetas salvas." };
}

// ------------------------------------------------------------------ configuração (whatsapp.configurar)
const numeroSchema = z.object({
  id: zs.uuid(),
  nome: zs.required("Nome", 120),
  numero: zs.required("Número", 20).transform((v) => onlyDigits(v)).refine((v) => v.length >= 12 && v.length <= 15, "Use o formato internacional: 55 + DDD + número"),
  phone_number_id: z.string().trim().regex(/^\d{5,30}$/, "Phone number ID inválido"),
  waba_id: zs.text(30).refine((v) => !v || /^\d{5,30}$/.test(v), "WABA ID inválido"),
  departamento_id: zs.uuid(),
  token: zs.text(1000),
  msg_boas_vindas: zs.text(1000),
  msg_fora_horario: zs.text(1000),
  inicio: zs.text(5).refine((v) => !v || /^\d{2}:\d{2}$/.test(v), "Hora inválida"),
  fim: zs.text(5).refine((v) => !v || /^\d{2}:\d{2}$/.test(v), "Hora inválida"),
  sabado: zs.bool(),
  domingo: zs.bool(),
  sla_resposta_min: zs.number(1, 1440),
  ativo: zs.bool(),
});

export async function salvarNumero(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("whatsapp.configurar");
  if ("denied" in g) return g.denied;
  const parsed = numeroSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, token, inicio, fim, sabado, domingo, ...v } = parsed.data;
  if (!id && !token) return { error: "Informe o token de acesso (System User) da Meta.", fieldErrors: { token: "Obrigatório ao conectar" } };
  if (token) {
    try {
      await testarNumero(token, v.phone_number_id);
    } catch (e) {
      return { error: `A Meta recusou o token ou o Phone number ID: ${e instanceof Error ? e.message : ""}`.slice(0, 300) };
    }
  }
  const menu = formData.getAll("menu[]").map(String).filter(isUuid).map((dep, i) => ({ opcao: String(i + 1), departamento_id: dep }));
  const supabase = await createClient();
  const nomesDep = menu.length ? new Map(((await supabase.from("departamentos").select("id, nome").in("id", menu.map((m) => m.departamento_id))).data ?? []).map((d) => [d.id, d.nome as string])) : new Map();
  const row = {
    ...v, sla_resposta_min: v.sla_resposta_min ?? 30,
    horario: { dias: [1, 2, 3, 4, 5, ...(sabado ? [6] : []), ...(domingo ? [7] : [])], inicio: inicio ?? "08:00", fim: fim ?? "18:00" },
    menu: menu.map((m) => ({ ...m, rotulo: nomesDep.get(m.departamento_id) ?? "Atendimento" })),
  };
  const { data, error } = id
    ? await supabase.from("wa_numeros").update(row).eq("id", id).select("id, empresa_id").maybeSingle()
    : await supabase.from("wa_numeros").insert(row).select("id, empresa_id").single();
  if (error) return error.code === "23505" ? { error: "Este número já está conectado a uma empresa." } : erroDb(error);
  if (!data) return { error: "Número não encontrado." };
  if (token) {
    const { error: e2 } = await createAdminClient().from("wa_credenciais").upsert({ numero_id: data.id, empresa_id: data.empresa_id, token_enc: encrypt(token), atualizado_em: new Date().toISOString() });
    if (e2) return dbError(e2);
  }
  revalidatePath("/whatsapp/configuracao");
  return { ok: true, message: token ? "Número conectado e token verificado na Meta." : "Número atualizado." };
}

const modeloSchema = z.object({
  id: zs.uuid(),
  numero_id: zs.uuid(),
  nome: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Use o nome exato aprovado na Meta (minúsculas, números e _)"),
  idioma: zs.required("Idioma", 10),
  categoria: z.string().refine((v) => WA_MODELO_CATEGORIAS.some((o) => o.value === v), "Categoria inválida"),
  corpo: zs.required("Texto", 1024),
  status: zs.enumOf(["aprovado", "pendente", "rejeitado", "pausado"]),
});

export async function salvarModelo(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!can(g.session.profile, "whatsapp.configurar") && !can(g.session.profile, "whatsapp.campanhas")) return { error: "Você não tem permissão para esta ação." };
  const parsed = modeloSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...v } = parsed.data;
  const variaveis = new Set([...v.corpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;
  const supabase = await createClient();
  const { error } = id ? await supabase.from("wa_modelos").update({ ...v, variaveis }).eq("id", id) : await supabase.from("wa_modelos").insert({ ...v, variaveis });
  if (error) return error.code === "23505" ? { error: "Já existe um modelo com este nome e idioma." } : erroDb(error);
  revalidatePath("/whatsapp/configuracao");
  revalidatePath("/whatsapp/campanhas");
  return { ok: true, message: "Modelo salvo." };
}

// ------------------------------------------------------------------ campanhas (whatsapp.campanhas)
const campSchema = z.object({
  id: zs.uuid(),
  nome: zs.required("Nome", 160),
  numero_id: zs.requiredUuid("o número"),
  modelo_id: zs.requiredUuid("o modelo"),
  variaveis: zs.text(2000),
  agendada_para: zs.text(30),
  limite_hora: zs.number(1, 10000),
  cidade: zs.text(120),
  etiqueta: zs.text(60),
  carteira: zs.text(20),
  pendencia: zs.bool(),
});

export async function salvarCampanha(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("whatsapp.campanhas");
  if ("denied" in g) return g.denied;
  const parsed = campSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, cidade, etiqueta, carteira, pendencia, variaveis, agendada_para, ...v } = parsed.data;
  const quando = agendada_para ? new Date(`${agendada_para}:00-03:00`) : null;
  if (quando && Number.isNaN(quando.getTime())) return { error: "Data de agendamento inválida.", fieldErrors: { agendada_para: "Data inválida" } };
  const filtro = Object.fromEntries(Object.entries({ cidade, etiqueta: etiqueta?.toLowerCase(), carteira, pendencia: pendencia || undefined }).filter(([, x]) => x));
  const row = { ...v, limite_hora: v.limite_hora ?? 200, filtro, variaveis: (variaveis ?? "").split("|").map((s) => s.trim()).filter((s) => s !== ""), agendada_para: quando?.toISOString() ?? null };
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("wa_campanhas").update(row).eq("id", id).in("status", ["rascunho", "agendada"]).select("id").maybeSingle()
    : await supabase.from("wa_campanhas").insert(row).select("id").single();
  if (error) return erroDb(error);
  if (!data) return { error: "Campanha não encontrada ou já em envio." };
  revalidatePath("/whatsapp/campanhas");
  return { ok: true, id: data.id, message: "Campanha salva como rascunho. Prepare os destinatários para agendar." };
}

export async function prepararCampanha(id: string): Promise<ActionState> {
  const g = await guard("whatsapp.campanhas");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Campanha inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wa_preparar_campanha", { p_campanha: id });
  if (error) return erroDb(error);
  revalidatePath("/whatsapp/campanhas");
  return { ok: true, message: `${data ?? 0} destinatário(s) com autorização incluído(s). A campanha está agendada.` };
}

export async function cancelarCampanha(id: string): Promise<ActionState> {
  const g = await guard("whatsapp.campanhas");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Campanha inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("wa_campanhas").update({ status: "cancelada" }).eq("id", id).in("status", ["rascunho", "agendada", "enviando"]).select("id").maybeSingle();
  if (error) return erroDb(error);
  if (!data) return { error: "Campanha já concluída." };
  revalidatePath("/whatsapp/campanhas");
  return { ok: true, message: "Campanha cancelada; os envios pendentes não serão feitos." };
}

const anexoSchema = z.object({
  mensagem_id: zs.requiredUuid("a mensagem"),
  categoria: z.string().refine((v) => DOC_CATEGORIAS.some((c) => c.value === v), "Categoria inválida"),
  nome: zs.required("Nome", 200),
});

/**
 * Anexa a mídia recebida pelo WhatsApp ao cadastro do cliente (um clique): o arquivo já passou pela verificação
 * de assinatura ao chegar; é copiado para a pasta do cliente e entra na fila de análise documental.
 */
export async function anexarMidiaCliente(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("whatsapp.atender");
  if ("denied" in g) return g.denied;
  const parsed = anexoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { data: m } = await supabase.from("wa_mensagens").select("id, conversa_id, midia_path, midia_mime").eq("id", parsed.data.mensagem_id).not("midia_path", "is", null).maybeSingle();
  if (!m?.midia_path) return { error: "Mensagem sem arquivo ou sem acesso." };
  const { data: cv } = await supabase.from("wa_conversas").select("wa_contatos(cliente_id)").eq("id", m.conversa_id).maybeSingle();
  const clienteId = (cv?.wa_contatos as unknown as { cliente_id: string | null } | null)?.cliente_id;
  if (!clienteId) return { error: "A conversa não está ligada a um cliente. Converta o lead primeiro." };
  const { data: cli } = await supabase.from("clientes").select("id").eq("id", clienteId).maybeSingle();
  if (!cli) return { error: "Sem acesso ao cliente." };
  const ext = String(m.midia_path).split(".").pop();
  const destino = `empresas/${g.session.empresa!.id}/clientes/${clienteId}/${crypto.randomUUID()}-whatsapp.${ext}`;
  const admin = createAdminClient();
  const { error: e1 } = await admin.storage.from("documentos").copy(m.midia_path as string, destino);
  if (e1) return { error: "Não foi possível copiar o arquivo." };
  const { data: info } = await admin.storage.from("documentos").list(destino.slice(0, destino.lastIndexOf("/")), { search: destino.slice(destino.lastIndexOf("/") + 1), limit: 1 });
  const { error } = await supabase.from("documentos").insert({
    cliente_id: clienteId, nome: parsed.data.nome, categoria: parsed.data.categoria, storage_path: destino, mime_type: m.midia_mime,
    tamanho: Number(info?.[0]?.metadata?.size ?? 1), enviado_por: g.session.userId,
  });
  if (error) {
    await admin.storage.from("documentos").remove([destino]);
    return erroDb(error);
  }
  revalidatePath(`/clientes/${clienteId}`);
  revalidatePath("/administrativo/documentacao");
  return { ok: true, message: "Arquivo anexado ao cliente e enviado para análise." };
}
