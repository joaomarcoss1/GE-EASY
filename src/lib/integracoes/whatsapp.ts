import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import { detectarTipoArquivo } from "@/lib/seguranca/arquivos";

/**
 * WhatsApp Business (Cloud API oficial da Meta) e Lead Ads.
 * - O webhook só grava os eventos na fila (webhook_eventos, idempotente pelo id da Meta) e responde 200.
 * - O processador (cron a cada minuto + after() do próprio webhook) aplica as mensagens/status no banco,
 *   baixa mídias (validadas pela assinatura do arquivo) e envia as mensagens pendentes pela API.
 * - Tokens ficam criptografados (AES-256-GCM) em tabelas sem acesso para usuários.
 */
const graph = () => `https://graph.facebook.com/${serverEnv().metaGraphVersion}`;
export const whatsappConfigurado = () => Boolean(serverEnv().whatsappAppSecret && serverEnv().whatsappVerifyToken && serverEnv().encryptionKey);

/** Assinatura X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o App Secret), comparação em tempo constante. */
export function assinaturaValida(corpo: string, cabecalho: string | null) {
  const segredo = serverEnv().whatsappAppSecret;
  if (!segredo || !cabecalho?.startsWith("sha256=")) return false;
  const esperado = Buffer.from(createHmac("sha256", segredo).update(corpo, "utf8").digest("hex"));
  const recebido = Buffer.from(cabecalho.slice(7));
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

type Evento = { origem: "whatsapp" | "meta_leads"; externo_id: string; payload: Record<string, unknown> };

/** Desmonta o payload do webhook em eventos atômicos (uma mensagem, um status, um lead). */
export function eventosDoWebhook(body: unknown): Evento[] {
  const out: Evento[] = [];
  const b = body as { object?: string; entry?: { id?: string; changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  for (const entry of b.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      if (ch.field === "messages") {
        const phoneNumberId = String((v.metadata as { phone_number_id?: string } | undefined)?.phone_number_id ?? "");
        const contatos = (v.contacts as { wa_id?: string; profile?: { name?: string } }[] | undefined) ?? [];
        for (const m of (v.messages as Record<string, unknown>[] | undefined) ?? []) {
          const nome = contatos.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
          out.push({ origem: "whatsapp", externo_id: `msg:${m.id}`, payload: { tipo: "mensagem", phone_number_id: phoneNumberId, nome, mensagem: m } });
        }
        for (const s of (v.statuses as { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[] | undefined) ?? []) {
          out.push({ origem: "whatsapp", externo_id: `st:${s.id}:${s.status}`, payload: { tipo: "status", phone_number_id: phoneNumberId, status: s } });
        }
      } else if (ch.field === "leadgen" && v.leadgen_id) {
        out.push({ origem: "meta_leads", externo_id: `lead:${v.leadgen_id}`, payload: { page_id: String(v.page_id ?? entry.id ?? ""), ...v } });
      }
    }
  }
  return out;
}

export async function enfileirarEventos(admin: SupabaseClient, eventos: Evento[]) {
  if (!eventos.length) return;
  const { error } = await admin.from("webhook_eventos").upsert(eventos, { onConflict: "origem,externo_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------------ tokens
const cacheToken = new Map<string, { token: string; ate: number }>();
async function tokenDoNumero(admin: SupabaseClient, numeroId: string) {
  const c = cacheToken.get(numeroId);
  if (c && c.ate > Date.now()) return c.token;
  const { data } = await admin.from("wa_credenciais").select("token_enc").eq("numero_id", numeroId).maybeSingle();
  if (!data?.token_enc) return null;
  const token = decrypt(data.token_enc as string);
  cacheToken.set(numeroId, { token, ate: Date.now() + 5 * 60_000 });
  return token;
}

async function graphFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path.startsWith("http") ? path : `${graph()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
    throw new Error(`Meta ${r.status}: ${j.error?.message ?? r.statusText}`.slice(0, 400));
  }
  return (await r.json()) as T;
}

// ------------------------------------------------------------------ mídia recebida
const MIDIA_MAX = 16 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "video/mp4": "mp4",
};
function midiaValida(b: Uint8Array, mime: string) {
  const base = mime.split(";")[0].trim();
  if (["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(base)) return detectarTipoArquivo(b, base);
  if (base === "audio/ogg") return b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53; // OggS
  if (base === "audio/mpeg") return (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
  if (["audio/mp4", "video/mp4"].includes(base)) return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70; // ftyp
  if (base === "audio/aac") return b[0] === 0xff && (b[1] & 0xf0) === 0xf0;
  return false;
}

async function baixarMidia(admin: SupabaseClient, token: string, empresaId: string, numeroId: string, mediaId: string) {
  const info = await graphFetch<{ url: string; mime_type: string; file_size?: number }>(`/${encodeURIComponent(mediaId)}`, token);
  const mime = info.mime_type.split(";")[0].trim();
  if (!EXT[mime] || (info.file_size ?? 0) > MIDIA_MAX) return { recusada: true as const, mime };
  const r = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`download da mídia: ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > MIDIA_MAX || !midiaValida(bytes, mime)) return { recusada: true as const, mime };
  const path = `empresas/${empresaId}/whatsapp/${numeroId}/${mediaId.replace(/[^\w-]/g, "")}.${EXT[mime]}`;
  const { error } = await admin.storage.from("documentos").upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(error.message);
  return { recusada: false as const, mime, path };
}

type MsgMeta = {
  id: string; from: string; timestamp?: string; type: string;
  text?: { body?: string }; image?: { id: string; caption?: string }; document?: { id: string; filename?: string; caption?: string };
  audio?: { id: string }; video?: { id: string; caption?: string }; sticker?: { id: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  reaction?: { emoji?: string }; contacts?: unknown[]; referral?: Record<string, unknown>;
};
const TIPOS: Record<string, string> = { text: "texto", image: "imagem", audio: "audio", video: "video", document: "documento", location: "localizacao", button: "interativo", interactive: "interativo", reaction: "reacao", sticker: "sticker", contacts: "contato" };

async function aplicarMensagem(admin: SupabaseClient, payload: { phone_number_id: string; nome: string | null; mensagem: MsgMeta }) {
  const { data: numero } = await admin.from("wa_numeros").select("id, empresa_id").eq("phone_number_id", payload.phone_number_id).eq("ativo", true).maybeSingle();
  if (!numero) return "ignorado";
  const m = payload.mensagem;
  const tipo = TIPOS[m.type] ?? "texto";
  let conteudo: string | null =
    m.text?.body ?? m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.reaction?.emoji ?? null;
  if (m.location) conteudo = `${m.location.name ?? "Localização"}${m.location.address ? ` — ${m.location.address}` : ""} (${m.location.latitude}, ${m.location.longitude})`;
  let midia: { path: string | null; mime: string | null; nome: string | null } = { path: null, mime: null, nome: m.document?.filename ?? null };
  const mediaId = m.image?.id ?? m.document?.id ?? m.audio?.id ?? m.video?.id ?? m.sticker?.id;
  if (mediaId) {
    const token = await tokenDoNumero(admin, numero.id);
    if (token) {
      const r = await baixarMidia(admin, token, numero.empresa_id, numero.id, mediaId);
      if (r.recusada) conteudo = `${conteudo ? `${conteudo}\n` : ""}[arquivo ${r.mime} recusado pela verificação de segurança]`;
      else midia = { ...midia, path: r.path, mime: r.mime };
    }
  }
  const { error } = await admin.rpc("wa_receber_mensagem", {
    p_numero_id: numero.id, p_telefone: m.from, p_nome: payload.nome, p_meta_id: m.id, p_tipo: tipo, p_conteudo: conteudo,
    p_midia_path: midia.path, p_midia_mime: midia.mime, p_midia_nome: midia.nome,
    p_em: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null, p_referral: m.referral ?? null,
  });
  if (error) throw new Error(error.message);
  return "ok";
}

const STATUS: Record<string, string> = { sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" };

async function aplicarLeadAds(admin: SupabaseClient, v: { page_id: string; leadgen_id: string; form_id?: string; ad_id?: string }) {
  const { data: pagina } = await admin.from("meta_paginas").select("id, empresa_id, campanha_padrao").eq("page_id", v.page_id).eq("ativo", true).maybeSingle();
  if (!pagina) return "ignorado";
  const { data: tk } = await admin.from("meta_pagina_tokens").select("token_enc").eq("pagina_id", pagina.id).maybeSingle();
  if (!tk) throw new Error("Página sem token de acesso.");
  const lead = await graphFetch<{ field_data?: { name: string; values: string[] }[]; campaign_name?: string; ad_name?: string; form_id?: string }>(
    `/${encodeURIComponent(v.leadgen_id)}?fields=field_data,campaign_name,ad_name,form_id`, decrypt(tk.token_enc as string),
  );
  const campo = (...nomes: string[]) => lead.field_data?.find((f) => nomes.includes(f.name.toLowerCase()))?.values?.[0] ?? null;
  const { error } = await admin.rpc("capturar_lead", {
    p_empresa: pagina.empresa_id,
    p_origem: "lead_ads",
    p_dados: {
      nome: campo("full_name", "nome", "nome_completo"), telefone: campo("phone_number", "telefone", "whatsapp"), email: campo("email", "e-mail"),
      cidade: campo("city", "cidade"), interesse: campo("interesse", "produto"), campanha: lead.campaign_name ?? pagina.campanha_padrao ?? null,
      utm: { leadgen_id: v.leadgen_id, form_id: lead.form_id ?? v.form_id ?? null, ad: lead.ad_name ?? v.ad_id ?? null },
    },
  });
  if (error) throw new Error(error.message);
  return "ok";
}

/** Processa a fila de eventos recebidos (mensagens, status e leads), com novas tentativas em caso de falha. */
export async function processarFila(admin: SupabaseClient, ate: number) {
  const r = { mensagens: 0, status: 0, leads: 0, ignorados: 0, erros: 0 };
  for (const origem of ["whatsapp", "meta_leads"] as const) {
    const { data: eventos } = await admin.rpc("reservar_eventos", { p_origem: origem, p_limite: 50 });
    for (const ev of (eventos ?? []) as { id: number; payload: Record<string, unknown> }[]) {
      if (Date.now() > ate) {
        await admin.from("webhook_eventos").update({ status: "pendente" }).eq("id", ev.id);
        continue;
      }
      try {
        let res = "ok";
        if (origem === "meta_leads") {
          res = await aplicarLeadAds(admin, ev.payload as never);
          if (res === "ok") r.leads++;
        } else if (ev.payload.tipo === "mensagem") {
          res = await aplicarMensagem(admin, ev.payload as never);
          if (res === "ok") r.mensagens++;
        } else {
          const s = ev.payload.status as { id: string; status: string; errors?: { title?: string; message?: string }[] };
          if (STATUS[s.status]) await admin.rpc("wa_atualizar_status", { p_meta_id: s.id, p_status: STATUS[s.status], p_erro: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? null });
          r.status++;
        }
        if (res === "ignorado") {
          r.ignorados++;
          await admin.from("webhook_eventos").update({ status: "ignorado", processado_em: new Date().toISOString() }).eq("id", ev.id);
        } else await admin.rpc("concluir_evento", { p_id: ev.id, p_ok: true });
      } catch (e) {
        r.erros++;
        await admin.rpc("concluir_evento", { p_id: ev.id, p_ok: false, p_erro: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return r;
}

// ------------------------------------------------------------------ envio
async function enviarApi(token: string, phoneNumberId: string, para: string, corpo: Record<string, unknown>) {
  const j = await graphFetch<{ messages?: { id: string }[] }>(`/${encodeURIComponent(phoneNumberId)}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: para, ...corpo }),
  });
  const id = j.messages?.[0]?.id;
  if (!id) throw new Error("A Meta não devolveu o id da mensagem.");
  return id;
}

const corpoModelo = (nome: string, idioma: string, params: unknown[] | null) => ({
  type: "template",
  template: {
    name: nome,
    language: { code: idioma },
    ...(params?.length ? { components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p ?? "").slice(0, 1000) || "-" })) }] } : {}),
  },
});

type Pendente = { id: string; conversa_id: string; tipo: string; conteudo: string | null; modelo_id: string | null; parametros: unknown[] | null };

/** Envia as mensagens pendentes (respostas dos atendentes e automáticas). `somente` limita a uma conversa. */
export async function enviarPendentes(admin: SupabaseClient, ate: number, somente?: string) {
  const r = { enviadas: 0, falhas: 0 };
  let q = admin.from("wa_mensagens").select("id, conversa_id, tipo, conteudo, modelo_id, parametros").eq("direcao", "saida").eq("status", "pendente")
    .gt("created_at", new Date(Date.now() - 2 * 86400_000).toISOString()).order("created_at").limit(100);
  if (somente) q = q.eq("conversa_id", somente);
  const { data: msgs } = await q;
  if (!msgs?.length) return r;
  const conversas = [...new Set(msgs.map((m) => m.conversa_id as string))];
  const { data: cvs } = await admin.from("wa_conversas").select("id, numero_id, wa_contatos(telefone), wa_numeros(phone_number_id)").in("id", conversas);
  const porConversa = new Map((cvs ?? []).map((c) => [c.id as string, c as unknown as { numero_id: string; wa_contatos: { telefone: string }; wa_numeros: { phone_number_id: string } }]));
  const modelosIds = [...new Set(msgs.map((m) => m.modelo_id).filter(Boolean) as string[])];
  const { data: modelos } = modelosIds.length ? await admin.from("wa_modelos").select("id, nome, idioma").in("id", modelosIds) : { data: [] };
  const porModelo = new Map((modelos ?? []).map((m) => [m.id as string, m]));
  for (const m of msgs as Pendente[]) {
    if (Date.now() > ate) break;
    const cv = porConversa.get(m.conversa_id);
    try {
      if (!cv) throw new Error("Conversa não encontrada.");
      const token = await tokenDoNumero(admin, cv.numero_id);
      if (!token) throw new Error("Número sem token da Meta configurado.");
      const md = m.modelo_id ? porModelo.get(m.modelo_id) : null;
      const corpo = md ? corpoModelo(md.nome as string, md.idioma as string, m.parametros) : { type: "text", text: { body: (m.conteudo ?? "").slice(0, 4096), preview_url: false } };
      const metaId = await enviarApi(token, cv.wa_numeros.phone_number_id, cv.wa_contatos.telefone, corpo);
      await admin.rpc("wa_marcar_envio", { p_mensagem: m.id, p_meta_id: metaId });
      r.enviadas++;
    } catch (e) {
      await admin.rpc("wa_marcar_envio", { p_mensagem: m.id, p_meta_id: null, p_erro: e instanceof Error ? e.message : String(e) });
      r.falhas++;
    }
  }
  return r;
}

/** Campanhas agendadas: envia respeitando o limite por hora; só contatos com opt-in (montados no banco). */
export async function processarCampanhas(admin: SupabaseClient, ate: number) {
  const r = { enviadas: 0, falhas: 0, ignoradas: 0 };
  const { data: camps } = await admin.from("wa_campanhas").select("id, empresa_id, numero_id, modelo_id, variaveis, limite_hora, status, wa_modelos(nome, idioma, variaveis)")
    .in("status", ["agendada", "enviando"]).lte("agendada_para", new Date().toISOString()).limit(10);
  for (const c of (camps ?? []) as unknown as { id: string; numero_id: string; variaveis: string[]; limite_hora: number; status: string; wa_modelos: { nome: string; idioma: string; variaveis: number } }[]) {
    if (Date.now() > ate) break;
    if (c.status === "agendada") await admin.from("wa_campanhas").update({ status: "enviando" }).eq("id", c.id);
    const umaHora = new Date(Date.now() - 3600_000).toISOString();
    const { count: naHora } = await admin.from("wa_campanha_envios").select("id", { count: "exact", head: true }).eq("campanha_id", c.id).gte("enviado_em", umaHora);
    const lote = Math.min(Math.max(0, c.limite_hora - (naHora ?? 0)), Math.ceil(c.limite_hora / 60) * 2, 100);
    const token = await tokenDoNumero(admin, c.numero_id);
    const { data: numero } = await admin.from("wa_numeros").select("phone_number_id").eq("id", c.numero_id).maybeSingle();
    if (!token || !numero) continue;
    const { data: envios } = lote > 0
      ? await admin.from("wa_campanha_envios").select("id, wa_contatos(telefone, nome, optout_em)").eq("campanha_id", c.id).eq("status", "pendente").limit(lote)
      : { data: [] };
    for (const e of (envios ?? []) as unknown as { id: string; wa_contatos: { telefone: string; nome: string | null; optout_em: string | null } }[]) {
      if (Date.now() > ate) break;
      if (e.wa_contatos.optout_em) {
        await admin.from("wa_campanha_envios").update({ status: "ignorado_optout" }).eq("id", e.id);
        r.ignoradas++;
        continue;
      }
      const nome = (e.wa_contatos.nome ?? "").split(" ")[0] || "cliente";
      const params = (c.variaveis ?? []).slice(0, c.wa_modelos.variaveis).map((v) => String(v).replaceAll("{{nome}}", nome));
      try {
        const metaId = await enviarApi(token, numero.phone_number_id as string, e.wa_contatos.telefone, corpoModelo(c.wa_modelos.nome, c.wa_modelos.idioma, params));
        await admin.from("wa_campanha_envios").update({ status: "enviado", meta_id: metaId, enviado_em: new Date().toISOString() }).eq("id", e.id);
        r.enviadas++;
      } catch (err) {
        await admin.from("wa_campanha_envios").update({ status: "falhou", erro: (err instanceof Error ? err.message : String(err)).slice(0, 500), enviado_em: new Date().toISOString() }).eq("id", e.id);
        r.falhas++;
      }
    }
    const { count: restantes } = await admin.from("wa_campanha_envios").select("id", { count: "exact", head: true }).eq("campanha_id", c.id).eq("status", "pendente");
    if (!restantes) {
      const { data: tot } = await admin.from("wa_campanha_envios").select("status").eq("campanha_id", c.id);
      const totais = (tot ?? []).reduce<Record<string, number>>((a, x) => ({ ...a, [x.status as string]: (a[x.status as string] ?? 0) + 1 }), {});
      await admin.from("wa_campanhas").update({ status: "concluida", totais: { destinatarios: tot?.length ?? 0, ...totais } }).eq("id", c.id);
    }
  }
  return r;
}

/** Verifica o token informado ao conectar um número (consulta o próprio número na API). */
export async function testarNumero(token: string, phoneNumberId: string) {
  return graphFetch<{ display_phone_number?: string; verified_name?: string }>(`/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, token);
}
