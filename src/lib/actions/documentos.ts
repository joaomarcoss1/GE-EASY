"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { googleConfigured } from "@/lib/env";
import { DOC_CATEGORIAS } from "@/lib/constants";
import { detectarTipoArquivo } from "@/lib/seguranca/arquivos";
import { arquivarDocumentoNoDrive, getDriveEscritorio } from "@/lib/integracoes/drive";
import { MAX_DOC_BYTES, isAllowedMime } from "@/components/documentos/mime";
import { arquivarDocumentoDrive } from "./integracoes";
import { dbError, guard, isUuid, limitar, registrarAcesso, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const BUCKET = "documentos";
const CATEGORIAS = DOC_CATEGORIAS.map((c) => c.value);
/** <uuid>-<nome-sanitizado> (gerado no navegador) */
const FILE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$/;

const registerSchema = z.object({
  cliente_id: zs.uuid(),
  processo_id: zs.uuid(),
  storage_path: z.string().trim().min(1).max(400),
  nome: z.string().trim().min(1, "Nome do arquivo inválido").max(255),
  categoria: z.string().refine((v) => CATEGORIAS.includes(v), "Categoria inválida"),
});

function revalidateDocs(clienteId: string | null, processoId?: string | null) {
  revalidatePath("/documentos");
  if (clienteId) revalidatePath(`/clientes/${clienteId}`);
  if (processoId) revalidatePath(`/processos/${processoId}`);
}

/**
 * Registra um documento DEPOIS que o navegador enviou o arquivo ao Storage.
 * O caminho, o acesso ao cliente/processo, o tipo, o tamanho e o CONTEÚDO real (assinatura do
 * arquivo) são revalidados aqui — não confia no que o navegador informou. Em seguida, o arquivo é
 * arquivado automaticamente no Drive do escritório (em segundo plano), na pasta do cliente/processo.
 */
export async function registerDocumento(input: { cliente_id?: string | null; processo_id?: string | null; storage_path: string; nome: string; categoria: string }): Promise<ActionState> {
  const g = await guard("clientes.view");
  if ("denied" in g) return g.denied;
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return zodErrors(parsed.error);
  const processoId = parsed.data.processo_id?.toLowerCase() ?? null;
  let clienteId = parsed.data.cliente_id?.toLowerCase() ?? null;
  if (!processoId && !clienteId) return { error: "Informe o cliente ou o processo do documento." };
  const path = parsed.data.storage_path;
  const pasta = processoId ? `processos/${processoId}` : `clientes/${clienteId}`;
  const prefix = `${pasta}/`;
  const fileKey = path.slice(prefix.length);
  if (!path.startsWith(prefix) || path.includes("..") || !FILE_KEY.test(fileKey)) return { error: "Caminho do arquivo inválido." };

  const supabase = await createClient();
  const storage = supabase.storage.from(BUCKET);
  const discard = async () => {
    const { error } = await storage.remove([path]);
    if (error) console.error("[documentos] falha ao descartar upload", error.message);
  };

  // Cliente/processo precisa estar visível para o usuário (RLS)
  if (processoId) {
    const { data: proc } = await supabase.from("processos").select("id").eq("id", processoId).maybeSingle();
    if (!proc) {
      await discard();
      return { error: "Processo não encontrado ou sem acesso." };
    }
    // Documento do processo: o acesso segue o processo (não a carteira do cliente)
    clienteId = null;
  } else {
    const { data: cliente } = await supabase.from("clientes").select("id").eq("id", clienteId!).maybeSingle();
    if (!cliente) {
      await discard();
      return { error: "Cliente não encontrado ou sem acesso." };
    }
  }

  // Metadados reais do objeto enviado
  const { data: objects, error: listError } = await storage.list(pasta, { search: fileKey, limit: 5 });
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
  // Conteúdo real: a assinatura precisa conferir com o tipo declarado
  const { data: blob } = await storage.download(path);
  const cabecalho = blob ? new Uint8Array(await blob.slice(0, 8192).arrayBuffer()) : null;
  if (!cabecalho || !detectarTipoArquivo(cabecalho, mime!)) {
    await discard();
    return { error: "O conteúdo do arquivo não corresponde ao tipo informado. Envio bloqueado por segurança." };
  }

  const { data: row, error } = await supabase
    .from("documentos")
    .insert({ cliente_id: clienteId, processo_id: processoId, nome: parsed.data.nome, categoria: parsed.data.categoria, storage_path: path, mime_type: mime, tamanho: size, enviado_por: g.session.userId })
    .select("id")
    .single();
  if (error) {
    await discard();
    return dbError(error);
  }

  // Arquivamento automático no Drive do escritório (não atrasa a resposta)
  if (googleConfigured() && hasServiceRole()) {
    const docId = row.id as string;
    after(async () => {
      try {
        const admin = createAdminClient();
        if (await getDriveEscritorio(admin)) await arquivarDocumentoNoDrive(admin, docId);
      } catch (e) {
        console.error("[documentos] drive automático", e instanceof Error ? e.message : e);
      }
    });
  }
  revalidateDocs(clienteId, processoId);
  return { ok: true, message: "Documento enviado.", id: row.id };
}

/** URL assinada (60 s) para download. A linha é lida antes com RLS para checar o acesso. */
export async function getDownloadUrl(id: string): Promise<ActionState & { url?: string }> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Documento inválido." };
  const bloqueio = await limitar("download", 120, 600);
  if (bloqueio) return bloqueio;
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documentos").select("nome, storage_path, drive_url").eq("id", id).maybeSingle();
  if (!doc) return { error: "Documento não encontrado ou sem acesso." };
  if (!doc.storage_path) {
    // Documentos gerados diretamente no Drive (Google Docs)
    if (doc.drive_url && /^https:\/\/(drive|docs)\.google\.com\//.test(doc.drive_url)) return { ok: true, url: doc.drive_url };
    return { error: "Documento sem arquivo disponível." };
  }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60, { download: doc.nome });
  if (error || !data?.signedUrl) return { error: "Não foi possível gerar o link de download." };
  await registrarAcesso("DOWNLOAD", "documentos", id, { nome: doc.nome });
  return { ok: true, url: data.signedUrl };
}

/** Exclui o registro (RLS: gestão ou quem enviou) e depois o objeto no Storage. */
export async function deleteDocumento(id: string): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Documento inválido." };
  const supabase = await createClient();
  const { data: doc, error } = await supabase.from("documentos").delete().eq("id", id).select("cliente_id, processo_id, storage_path").maybeSingle();
  if (error) return dbError(error);
  if (!doc) return { error: "Sem permissão para excluir este documento." };
  if (doc.storage_path) {
    const { error: rmError } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    if (rmError) console.error("[documentos] objeto não removido", doc.storage_path, rmError.message);
  }
  revalidateDocs(doc.cliente_id, doc.processo_id);
  return { ok: true, message: "Documento excluído." };
}

/** Arquiva o documento no Drive do escritório (pasta do cliente/processo). */
export async function sendToDrive(id: string): Promise<ActionState & { url?: string }> {
  return arquivarDocumentoDrive(id);
}
