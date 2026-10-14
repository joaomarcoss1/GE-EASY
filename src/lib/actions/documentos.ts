"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { googleConfigured } from "@/lib/env";
import { uploadToDrive } from "@/lib/google";
import { DOC_CATEGORIAS } from "@/lib/constants";
import { MAX_DOC_BYTES, isAllowedMime } from "@/components/documentos/mime";
import { dbError, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const BUCKET = "documentos";
const CATEGORIAS = DOC_CATEGORIAS.map((c) => c.value);
/** <uuid>-<nome-sanitizado> (gerado no navegador) */
const FILE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$/;

const registerSchema = z.object({
  cliente_id: zs.requiredUuid("o cliente"),
  storage_path: z.string().trim().min(1).max(400),
  nome: z.string().trim().min(1, "Nome do arquivo inválido").max(255),
  categoria: z.string().refine((v) => CATEGORIAS.includes(v), "Categoria inválida"),
});

function revalidateDocs(clienteId: string | null) {
  revalidatePath("/documentos");
  if (clienteId) revalidatePath(`/clientes/${clienteId}`);
}

/**
 * Registra um documento DEPOIS que o navegador enviou o arquivo ao Storage.
 * O caminho, o acesso ao cliente, o tipo e o tamanho são revalidados aqui,
 * usando os metadados do próprio Storage (não confia no que o navegador informou).
 */
export async function registerDocumento(input: { cliente_id: string; storage_path: string; nome: string; categoria: string }): Promise<ActionState> {
  const g = await guard("clientes.view");
  if ("denied" in g) return g.denied;
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return zodErrors(parsed.error);
  const clienteId = parsed.data.cliente_id.toLowerCase();
  const path = parsed.data.storage_path;
  const prefix = `clientes/${clienteId}/`;
  const fileKey = path.slice(prefix.length);
  if (!path.startsWith(prefix) || path.includes("..") || !FILE_KEY.test(fileKey)) return { error: "Caminho do arquivo inválido." };

  const supabase = await createClient();
  const storage = supabase.storage.from(BUCKET);
  const discard = async () => {
    const { error } = await storage.remove([path]);
    if (error) console.error("[documentos] falha ao descartar upload", error.message);
  };

  // Cliente precisa estar visível para o usuário (RLS)
  const { data: cliente } = await supabase.from("clientes").select("id").eq("id", clienteId).maybeSingle();
  if (!cliente) {
    await discard();
    return { error: "Cliente não encontrado ou sem acesso." };
  }

  // Metadados reais do objeto enviado
  const { data: objects, error: listError } = await storage.list(`clientes/${clienteId}`, { search: fileKey, limit: 5 });
  const obj = objects?.find((o) => o.name === fileKey);
  if (listError || !obj) return { error: "Arquivo não encontrado no armazenamento. Envie novamente." };
  const size = Number(obj.metadata?.size ?? 0);
  const mime = (obj.metadata?.mimetype as string | undefined) ?? null;
  if (!size || size > MAX_DOC_BYTES) {
    await discard();
    return { error: "O arquivo deve ter no máximo 25 MB." };
  }
  if (!isAllowedMime(mime)) {
    await discard();
    return { error: "Tipo de arquivo não permitido. Envie PDF, imagem, Word, Excel, TXT ou CSV." };
  }

  const { data: row, error } = await supabase
    .from("documentos")
    .insert({ cliente_id: clienteId, nome: parsed.data.nome, categoria: parsed.data.categoria, storage_path: path, mime_type: mime, tamanho: size, enviado_por: g.session.userId })
    .select("id")
    .single();
  if (error) {
    await discard();
    return dbError(error);
  }
  revalidateDocs(clienteId);
  return { ok: true, message: "Documento enviado.", id: row.id };
}

/** URL assinada (60 s) para download. A linha é lida antes com RLS para checar o acesso. */
export async function getDownloadUrl(id: string): Promise<ActionState & { url?: string }> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Documento inválido." };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documentos").select("nome, storage_path").eq("id", id).maybeSingle();
  if (!doc?.storage_path) return { error: "Documento não encontrado ou sem acesso." };
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60, { download: doc.nome });
  if (error || !data?.signedUrl) return { error: "Não foi possível gerar o link de download." };
  return { ok: true, url: data.signedUrl };
}

/** Exclui o registro (RLS: gestão ou quem enviou) e depois o objeto no Storage. */
export async function deleteDocumento(id: string): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Documento inválido." };
  const supabase = await createClient();
  const { data: doc, error } = await supabase.from("documentos").delete().eq("id", id).select("cliente_id, storage_path").maybeSingle();
  if (error) return dbError(error);
  if (!doc) return { error: "Sem permissão para excluir este documento." };
  if (doc.storage_path) {
    const { error: rmError } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    if (rmError) console.error("[documentos] objeto não removido", doc.storage_path, rmError.message);
  }
  revalidateDocs(doc.cliente_id);
  return { ok: true, message: "Documento excluído." };
}

const DRIVE_HINT = "Conecte sua conta Google em Configurações › Integrações para enviar arquivos ao Drive.";

/** Copia o arquivo do Storage para o Google Drive do usuário (pasta "GE EASY/<cliente>"). */
export async function sendToDrive(id: string): Promise<ActionState & { url?: string }> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Documento inválido." };
  if (!googleConfigured()) return { error: "A integração com o Google ainda não foi configurada pelo administrador (Configurações › Integrações)." };

  const supabase = await createClient();
  const { data: status } = await supabase.rpc("google_integracao_status");
  const conectado = Array.isArray(status) && status.length > 0 && Boolean((status[0] as { conectado?: boolean }).conectado);
  if (!conectado) return { error: DRIVE_HINT };

  const { data: doc } = await supabase.from("documentos").select("id, nome, mime_type, storage_path, cliente_id, drive_url, clientes(nome)").eq("id", id).maybeSingle();
  if (!doc?.storage_path) return { error: "Documento não encontrado ou sem acesso." };
  if (doc.drive_url) return { ok: true, message: "Este documento já está no Drive.", url: doc.drive_url };

  const { data: blob, error: dlError } = await supabase.storage.from(BUCKET).download(doc.storage_path);
  if (dlError || !blob) return { error: "Não foi possível ler o arquivo no armazenamento." };

  const rel = doc.clientes as unknown as { nome: string } | { nome: string }[] | null;
  const clienteNome = (Array.isArray(rel) ? rel[0]?.nome : rel?.nome) ?? "Documentos gerais";
  let uploaded: { id: string; webViewLink: string } | null = null;
  try {
    uploaded = await uploadToDrive(g.session.userId, clienteNome, { name: doc.nome, type: doc.mime_type ?? "application/octet-stream", data: await blob.arrayBuffer() });
  } catch (e) {
    console.error("[documentos] drive", e);
  }
  if (!uploaded) return { error: `Falha ao enviar ao Google Drive. ${DRIVE_HINT.replace("Conecte", "Se necessário, reconecte")}` };

  const { data: updated, error } = await supabase.from("documentos").update({ drive_file_id: uploaded.id, drive_url: uploaded.webViewLink }).eq("id", id).select("id").maybeSingle();
  if (error || !updated) {
    // Arquivo foi enviado, mas o usuário não pode alterar o registro (RLS): devolve o link mesmo assim.
    return { ok: true, message: "Arquivo enviado ao Drive (o vínculo não pôde ser salvo no registro).", url: uploaded.webViewLink };
  }
  revalidateDocs(doc.cliente_id);
  return { ok: true, message: "Arquivo enviado ao Google Drive.", url: uploaded.webViewLink };
}
