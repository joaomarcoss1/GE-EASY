"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { googleConfigured } from "@/lib/env";
import { can, isManagerRole } from "@/lib/rbac";
import { DriveError, driveFolderUrl, findOrCreateFolder, getAccessToken } from "@/lib/google";
import { parseOab } from "@/lib/juridico/djen";
import { sincronizarProcessoDatajud } from "@/lib/integracoes/datajud";
import { buscarComunicacoesDjen, importarComunicacoes, isoDiasAtras, oabsMonitoradas, type OabMonitorada } from "@/lib/integracoes/djen";
import { sincronizarPendentesAgenda } from "@/lib/integracoes/agenda";
import { RAIZ_NOME, arquivarDocumentoNoDrive, garantirPasta, getDriveEscritorio, salvarGoogleDoc } from "@/lib/integracoes/drive";
import { montarDocumentoModelo } from "@/lib/juridico/modelo-contexto";
import { dbError, formToObject, guard, isUuid, limitar, zodErrors } from "./utils";
import type { ActionState } from "./types";

type Resultado = ActionState & { url?: string };

async function log(tipo: "datajud" | "djen" | "drive" | "agenda", status: "ok" | "erro" | "parcial", mensagem: string, detalhes?: Record<string, unknown>) {
  const supabase = await createClient();
  await supabase.rpc("registrar_integracao", { p_tipo: tipo, p_status: status, p_mensagem: mensagem, p_detalhes: detalhes ?? null });
}

const SEM_SERVICE_ROLE = "Integração indisponível: o administrador precisa configurar SUPABASE_SERVICE_ROLE_KEY no servidor.";

// ------------------------------------------------------------------ DataJud

export async function sincronizarDatajud(processoId: string): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(processoId)) return { error: "Processo inválido." };
  const bloqueio = await limitar("datajud", 30, 600);
  if (bloqueio) return bloqueio;
  const supabase = await createClient();
  const r = await sincronizarProcessoDatajud(supabase, processoId);
  await log("datajud", r.status === "ok" ? "ok" : "erro", r.mensagem, { processo: processoId, novos: r.novos });
  revalidatePath(`/processos/${processoId}`);
  return r.status === "ok" ? { ok: true, message: r.mensagem } : { error: r.mensagem };
}

export async function alternarMonitoramentoDatajud(processoId: string, ativo: boolean): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(processoId)) return { error: "Processo inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("processos").update({ datajud_monitorar: !!ativo }).eq("id", processoId).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar este processo." };
  revalidatePath(`/processos/${processoId}`);
  return { ok: true, message: ativo ? "Monitoramento automático do DataJud ativado." : "Monitoramento automático desativado." };
}

// ------------------------------------------------------------------ DJEN (intimações)

const djenSchema = z.object({ dias: z.coerce.number().int().min(1).max(30) });

/** Busca intimações no DJEN: a gestão busca todas as OABs monitoradas; demais usuários, a própria. */
export async function buscarIntimacoesDjen(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("publicacoes.view");
  if ("denied" in g) return g.denied;
  const parsed = djenSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const bloqueio = await limitar("djen", 8, 3600);
  if (bloqueio) return bloqueio;

  const supabase = await createClient();
  let oabs: OabMonitorada[];
  const empresaId = g.session.empresa!.id;
  if (isManagerRole(g.session.profile.role)) {
    oabs = await oabsMonitoradas(supabase, empresaId);
  } else {
    const propria = parseOab(g.session.profile.oab);
    oabs = propria ? [{ ...propria, responsavelId: g.session.userId, rotulo: `${propria.numero}/${propria.uf}` }] : [];
  }
  if (!oabs.length) return { error: "Nenhuma OAB cadastrada. Informe sua OAB em Configurações › Meu perfil (ex.: SP 123456)." };

  const inicio = isoDiasAtras(parsed.data.dias);
  const fim = isoDiasAtras(0);
  let novas = 0;
  let encontradas = 0;
  const erros: string[] = [];
  for (const oab of oabs.slice(0, 30)) {
    const { itens, erro } = await buscarComunicacoesDjen(oab, inicio, fim);
    encontradas += itens.length;
    if (erro) erros.push(`${oab.rotulo}: ${erro}`);
    const imp = await importarComunicacoes(supabase, itens, oab, empresaId);
    novas += imp.novas;
    if (imp.erro) erros.push(`${oab.rotulo}: ${imp.erro}`);
  }
  await log("djen", erros.length ? (novas ? "parcial" : "erro") : "ok", `${novas} nova(s) de ${encontradas} comunicação(ões)`, { oabs: oabs.length, erros: erros.slice(0, 5) });
  revalidatePath("/publicacoes");
  revalidatePath("/dashboard");
  if (erros.length && !encontradas) return { error: erros[0] };
  const msg = novas ? `${novas} intimação(ões) nova(s) importada(s) do DJEN.` : `Nenhuma intimação nova no DJEN (${encontradas} já registrada(s)).`;
  return { ok: true, message: erros.length ? `${msg} Atenção: ${erros[0]}` : msg };
}

const oabsSchema = z.object({ oabs: z.string().max(3000).optional().default("") });

export async function salvarOabsDjen(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("integracoes.manage");
  if ("denied" in g) return g.denied;
  const parsed = oabsSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const linhas = parsed.data.oabs.split(/[\n;,]+/).map((l) => l.trim()).filter(Boolean);
  const invalidas = linhas.filter((l) => !parseOab(l));
  if (invalidas.length) return { error: `OAB inválida: ${invalidas.slice(0, 3).join(", ")}`, fieldErrors: { oabs: "Use o formato 123456/SP, uma por linha" } };
  const oabs = [...new Set(linhas.map((l) => { const o = parseOab(l)!; return `${o.numero}/${o.uf}`; }))].slice(0, 50);
  const supabase = await createClient();
  const { error } = await supabase.from("configuracoes").upsert({ chave: "djen", valor: { oabs } }, { onConflict: "empresa_id,chave" });
  if (error) return dbError(error);
  revalidatePath("/configuracoes");
  return { ok: true, message: `${oabs.length} OAB(s) adicional(is) salva(s).` };
}

// ------------------------------------------------------------------ Google Agenda

/** Envia ao Google Agenda os prazos pendentes e compromissos futuros do usuário ainda não sincronizados. */
export async function sincronizarMinhaAgenda(): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!googleConfigured()) return { error: "A integração com o Google ainda não foi configurada pelo administrador." };
  const bloqueio = await limitar("agenda-sync", 6, 600);
  if (bloqueio) return bloqueio;
  if (!(await getAccessToken(g.session.userId))) return { error: "Conecte sua conta Google em Configurações › Integrações." };
  const supabase = await createClient();
  const r = await sincronizarPendentesAgenda(supabase, [g.session.userId], 60);
  await log("agenda", r.falhas ? "parcial" : "ok", `${r.prazos} prazo(s) e ${r.eventos} compromisso(s) enviados`, r);
  revalidatePath("/agenda");
  revalidatePath("/prazos");
  if (!r.prazos && !r.eventos && !r.falhas) return { ok: true, message: "Sua agenda já está sincronizada com o Google." };
  return { ok: true, message: `Enviados ao Google Agenda: ${r.prazos} prazo(s) e ${r.eventos} compromisso(s)${r.falhas ? ` · ${r.falhas} falha(s)` : ""}.` };
}

// ------------------------------------------------------------------ Drive do escritório

/** Define a conta Google do administrador atual como o Drive do escritório e cria a pasta raiz. */
export async function definirDriveEscritorio(): Promise<ActionState> {
  const g = await guard("integracoes.manage");
  if ("denied" in g) return g.denied;
  if (!googleConfigured()) return { error: "Configure a integração Google no servidor antes (GOOGLE_CLIENT_ID/SECRET)." };
  const token = await getAccessToken(g.session.userId);
  if (!token) return { error: "Conecte primeiro a sua conta Google (botão acima)." };
  const supabase = await createClient();
  const { data: status } = await supabase.rpc("google_integracao_status");
  const email = (Array.isArray(status) ? (status[0] as { google_email?: string | null } | undefined)?.google_email : null) ?? null;
  try {
    const raiz = await findOrCreateFolder(token, RAIZ_NOME, null);
    const admin = createAdminClient();
    const empresaId = g.session.empresa!.id;
    // nova conta => nova árvore de pastas (só desta empresa: o service role ignora o isolamento)
    await admin.from("drive_pastas").delete().eq("empresa_id", empresaId);
    await admin.from("drive_pastas").upsert({ empresa_id: empresaId, chave: "raiz", folder_id: raiz }, { onConflict: "empresa_id,chave" });
    await admin.from("processos").update({ drive_folder_id: null }).eq("empresa_id", empresaId).not("drive_folder_id", "is", null);
    await admin.from("clientes").update({ drive_folder_id: null }).eq("empresa_id", empresaId).not("drive_folder_id", "is", null);
  } catch (e) {
    return { error: e instanceof DriveError ? e.message : "Não foi possível criar a pasta do escritório no Drive." };
  }
  const { error } = await supabase.from("configuracoes").upsert({ chave: "drive_escritorio", valor: { user_id: g.session.userId, email, definido_em: new Date().toISOString() } }, { onConflict: "empresa_id,chave" });
  if (error) return dbError(error);
  await log("drive", "ok", `Drive do escritório definido (${email ?? "conta Google"})`);
  revalidatePath("/configuracoes");
  return { ok: true, message: "Drive do escritório definido. Novos documentos serão arquivados automaticamente." };
}

export async function removerDriveEscritorio(): Promise<ActionState> {
  const g = await guard("integracoes.manage");
  if ("denied" in g) return g.denied;
  const supabase = await createClient();
  const { error } = await supabase.from("configuracoes").delete().eq("chave", "drive_escritorio");
  if (error) return dbError(error);
  revalidatePath("/configuracoes");
  return { ok: true, message: "Arquivamento automático no Drive desativado (os arquivos já enviados continuam no Drive)." };
}

/** Arquiva o documento no Drive do escritório. O acesso é conferido antes com a sessão do usuário (RLS). */
export async function arquivarDocumentoDrive(id: string): Promise<Resultado> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Documento inválido." };
  if (!hasServiceRole()) return { error: SEM_SERVICE_ROLE };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documentos").select("id, cliente_id, processo_id").eq("id", id).maybeSingle();
  if (!doc) return { error: "Documento não encontrado ou sem acesso." };
  const bloqueio = await limitar("drive", 60, 600);
  if (bloqueio) return bloqueio;
  const r = await arquivarDocumentoNoDrive(createAdminClient(), id, g.session.empresa!.id);
  revalidatePath("/documentos");
  if (doc.cliente_id) revalidatePath(`/clientes/${doc.cliente_id}`);
  if (doc.processo_id) revalidatePath(`/processos/${doc.processo_id}`);
  return r.ok ? { ok: true, message: r.mensagem, url: r.url } : { error: r.mensagem };
}

/** Reprocessa documentos pendentes/com erro (administrador). */
export async function arquivarPendentesDrive(): Promise<ActionState> {
  const g = await guard("integracoes.manage");
  if ("denied" in g) return g.denied;
  if (!hasServiceRole()) return { error: SEM_SERVICE_ROLE };
  const admin = createAdminClient();
  const empresaId = g.session.empresa!.id;
  if (!(await getDriveEscritorio(admin, empresaId))) return { error: "Defina primeiro o Drive da empresa." };
  const { data } = await admin.from("documentos").select("id").eq("empresa_id", empresaId).in("drive_status", ["pendente", "erro"]).not("storage_path", "is", null).order("created_at").limit(15);
  let ok = 0;
  let falhas = 0;
  const limite = Date.now() + 45_000;
  for (const d of data ?? []) {
    if (Date.now() > limite) break;
    const r = await arquivarDocumentoNoDrive(admin, d.id, empresaId);
    if (r.ok) ok++;
    else falhas++;
  }
  await log("drive", falhas ? "parcial" : "ok", `${ok} documento(s) arquivado(s), ${falhas} falha(s)`);
  revalidatePath("/documentos");
  revalidatePath("/configuracoes");
  return { ok: true, message: `${ok} documento(s) arquivado(s) no Drive${falhas ? ` · ${falhas} com falha` : ""}.` };
}

/** Abre (criando se preciso) a pasta do processo/cliente no Drive do escritório. */
export async function abrirPastaDrive(tipo: "processo" | "cliente", id: string): Promise<Resultado> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id) || !["processo", "cliente"].includes(tipo)) return { error: "Solicitação inválida." };
  if (!hasServiceRole()) return { error: SEM_SERVICE_ROLE };
  const supabase = await createClient();
  const { data: visivel } = await supabase.from(tipo === "processo" ? "processos" : "clientes").select("id").eq("id", id).maybeSingle();
  if (!visivel) return { error: "Registro não encontrado ou sem acesso." };
  try {
    const pasta = await garantirPasta(createAdminClient(), g.session.empresa!.id, tipo === "processo" ? { processo_id: id } : { cliente_id: id });
    return { ok: true, url: driveFolderUrl(pasta) };
  } catch (e) {
    return { error: e instanceof DriveError ? e.message : "Não foi possível abrir a pasta no Drive." };
  }
}

/** Gera o documento do modelo no servidor e salva como Google Docs na pasta do processo/cliente. */
export async function salvarModeloNoDrive(ids: { modeloId: string; clienteId?: string | null; processoId?: string | null; contratoId?: string | null }): Promise<Resultado> {
  const g = await guard("modelos.view");
  if ("denied" in g) return g.denied;
  const chk = (v: string | null | undefined) => (v && isUuid(v) ? v : null);
  if (!isUuid(ids.modeloId)) return { error: "Modelo inválido." };
  if (!hasServiceRole()) return { error: SEM_SERVICE_ROLE };
  const bloqueio = await limitar("drive", 60, 600);
  if (bloqueio) return bloqueio;
  const supabase = await createClient();
  const m = await montarDocumentoModelo(supabase, g.session.userId, { modeloId: ids.modeloId, clienteId: chk(ids.clienteId), processoId: chk(ids.processoId), contratoId: chk(ids.contratoId) });
  if (!m.modelo || !m.rendered) return { error: "Modelo não encontrado." };
  // Somente registros que o RLS devolveu ao usuário (ids informados e não visíveis são ignorados)
  const processoId = m.processo?.id ?? null;
  const clienteId = processoId ? null : (m.cliente?.id ?? null);
  if (!processoId && !clienteId) return { error: "Selecione o cliente ou o processo para arquivar o documento na pasta certa." };
  if (processoId && !can(g.session.profile, "processos.write")) return { error: "Você não tem permissão para arquivar documentos neste processo." };
  const titulo = `${m.modelo.titulo}${m.cliente ? ` - ${m.cliente.nome}` : ""} (${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })})`;

  // 1º o registro com a sessão do usuário: o RLS confirma que ele pode anexar documentos ao processo/cliente
  const { data: registro, error: regErro } = await supabase
    .from("documentos")
    .insert({ nome: titulo.slice(0, 255), categoria: "gerado", cliente_id: clienteId, processo_id: processoId, mime_type: "application/vnd.google-apps.document", enviado_por: g.session.userId })
    .select("id")
    .single();
  if (regErro) return regErro.code === "42501" ? { error: "Sem permissão para anexar documentos a este processo/cliente." } : dbError(regErro);

  const admin = createAdminClient();
  let arquivo: { id: string; webViewLink: string };
  try {
    arquivo = await salvarGoogleDoc(admin, g.session.empresa!.id, { cliente_id: clienteId, processo_id: processoId }, titulo, m.rendered.html);
  } catch (e) {
    await supabase.from("documentos").delete().eq("id", registro.id);
    return { error: e instanceof DriveError ? e.message : "Não foi possível salvar no Drive." };
  }
  await admin
    .from("documentos")
    .update({ drive_file_id: arquivo.id, drive_url: arquivo.webViewLink, drive_status: "sincronizado", drive_sincronizado_em: new Date().toISOString() })
    .eq("id", registro.id);
  if (processoId) {
    await supabase.from("processo_andamentos").insert({ processo_id: processoId, tipo: "peticao", descricao: `Documento gerado e arquivado no Drive: ${m.modelo.titulo}`.slice(0, 300), autor_id: g.session.userId });
    revalidatePath(`/processos/${processoId}`);
  }
  revalidatePath("/documentos");
  return { ok: true, message: "Documento salvo como Google Docs na pasta do Drive.", url: arquivo.webViewLink };
}
