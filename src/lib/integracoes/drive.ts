import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOC_CATEGORIAS } from "@/lib/constants";
import { formatCNJ } from "@/lib/juridico/cnj";
import { DriveError, findOrCreateFolder, folderExists, getAccessToken, uploadDriveFile } from "@/lib/google";

/**
 * Arquivo de cada empresa no Google Drive.
 * Uma conta Google (definida pelo administrador da empresa) guarda os documentos da empresa, organizados assim:
 *
 *   GE EASY — Arquivo do escritório/
 *     Clientes/<Nome do cliente (…1234)>/
 *       Documentos do cliente/<Categoria>/arquivo
 *       Processos/<0000000-00.0000.0.00.0000 — Título>/<Categoria>/arquivo
 *     Processos sem cliente/<processo>/<Categoria>/
 *     Documentos internos/<Categoria>/
 *
 * Os ids das pastas ficam em cache (tabela drive_pastas, por empresa) e são recriados se apagados no Drive.
 * Todas as funções recebem o cliente service role e o id da empresa: só chame depois de autorizar o
 * usuário, sempre com a empresa da sessão (o service role ignora o isolamento do banco).
 */

export const RAIZ_NOME = "GE EASY — Arquivo do escritório";

export interface DriveEscritorio {
  user_id: string;
  email: string | null;
  definido_em?: string;
}

export async function getDriveEscritorio(db: SupabaseClient, empresaId: string): Promise<DriveEscritorio | null> {
  const { data } = await db.from("configuracoes").select("valor").eq("empresa_id", empresaId).eq("chave", "drive_escritorio").maybeSingle();
  const v = data?.valor as DriveEscritorio | null | undefined;
  return v?.user_id ? v : null;
}

export async function tokenDoEscritorio(admin: SupabaseClient, empresaId: string) {
  const cfg = await getDriveEscritorio(admin, empresaId);
  if (!cfg) throw new DriveError("O Drive da empresa ainda não foi definido (Configurações › Integrações).", 412);
  const token = await getAccessToken(cfg.user_id);
  if (!token) throw new DriveError("A conta Google do Drive da empresa está desconectada. Reconecte em Configurações › Integrações.", 401);
  return token;
}

const PENDENTE = "__pendente__";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const notFound = (e: unknown) => e instanceof DriveError && e.status === 404;

const categoriaLabel = (c: string | null | undefined) => DOC_CATEGORIAS.find((o) => o.value === c)?.label ?? "Outros";

class Pastas {
  private usadas: string[] = [];
  constructor(
    private admin: SupabaseClient,
    private token: string,
    readonly empresaId: string,
  ) {}

  private cache() {
    return this.admin.from("drive_pastas");
  }

  /**
   * Garante a subpasta `nome` em `pai`, usando o cache pela chave lógica. Envios simultâneos não criam
   * pastas duplicadas: quem cria reserva a chave (linha "pendente"); os demais aguardam o id.
   */
  async garantir(chave: string, nome: string, pai: string | null): Promise<string> {
    this.usadas.push(chave);
    for (let tentativa = 0; tentativa < 40; tentativa++) {
      const { data } = await this.cache().select("folder_id, created_at").eq("empresa_id", this.empresaId).eq("chave", chave).maybeSingle();
      if (data?.folder_id && data.folder_id !== PENDENTE) return data.folder_id;
      if (data && Date.now() - Date.parse(data.created_at) < 60_000) {
        await espera(500); // outra execução está criando esta pasta
        continue;
      }
      if (data) await this.cache().delete().eq("empresa_id", this.empresaId).eq("chave", chave).eq("folder_id", PENDENTE); // reserva abandonada
      const { error } = await this.cache().insert({ empresa_id: this.empresaId, chave, folder_id: PENDENTE });
      if (error) {
        await espera(300); // outra execução reservou primeiro
        continue;
      }
      try {
        const id = await findOrCreateFolder(this.token, nome, pai);
        await this.cache().update({ folder_id: id }).eq("empresa_id", this.empresaId).eq("chave", chave);
        return id;
      } catch (e) {
        await this.cache().delete().eq("empresa_id", this.empresaId).eq("chave", chave).eq("folder_id", PENDENTE);
        throw e;
      }
    }
    throw new DriveError("Tempo esgotado aguardando a criação da pasta no Drive.", 503);
  }

  /** Remove do cache as pastas usadas nesta operação (ex.: alguém apagou a pasta no Drive). */
  async invalidar() {
    if (this.usadas.length) await this.cache().delete().eq("empresa_id", this.empresaId).in("chave", this.usadas);
    this.usadas = [];
  }

  async raiz() {
    const id = await this.garantir("raiz", RAIZ_NOME, null);
    return id;
  }

  async cliente(c: { id: string; nome: string; documento: string | null }) {
    const raiz = await this.raiz();
    const clientes = await this.garantir("clientes", "Clientes", raiz);
    const sufixo = c.documento ? ` (…${c.documento.replace(/\D/g, "").slice(-4)})` : "";
    const id = await this.garantir(`cliente:${c.id}`, `${c.nome}${sufixo}`, clientes);
    await this.admin.from("clientes").update({ drive_folder_id: id }).eq("id", c.id).eq("empresa_id", this.empresaId);
    return id;
  }

  async processo(p: { id: string; titulo: string; numero_cnj: string | null; numero_interno: string | null; cliente: { id: string; nome: string; documento: string | null } | null }) {
    let pai: string;
    if (p.cliente) {
      const cli = await this.cliente(p.cliente);
      pai = await this.garantir(`cliente:${p.cliente.id}:processos`, "Processos", cli);
    } else {
      pai = await this.garantir("processos-sem-cliente", "Processos sem cliente", await this.raiz());
    }
    const numero = p.numero_cnj ? formatCNJ(p.numero_cnj) : p.numero_interno || "Sem número";
    const id = await this.garantir(`processo:${p.id}`, `${numero} — ${p.titulo}`, pai);
    await this.admin.from("processos").update({ drive_folder_id: id }).eq("id", p.id).eq("empresa_id", this.empresaId);
    return id;
  }
}

interface DocRow {
  id: string;
  empresa_id: string;
  nome: string;
  categoria: string | null;
  mime_type: string | null;
  storage_path: string | null;
  cliente_id: string | null;
  processo_id: string | null;
  drive_file_id: string | null;
  drive_tentativas: number;
}

type ClienteRel = { id: string; nome: string; documento: string | null };
const umCliente = (rel: ClienteRel | ClienteRel[] | null) => (Array.isArray(rel) ? (rel[0] ?? null) : rel);

async function pastaDestino(admin: SupabaseClient, pastas: Pastas, alvo: { cliente_id: string | null; processo_id: string | null; categoria: string | null }) {
  const cat = categoriaLabel(alvo.categoria);
  if (alvo.processo_id) {
    const { data: p } = await admin
      .from("processos")
      .select("id, titulo, numero_cnj, numero_interno, cliente_id, clientes(id, nome, documento)")
      .eq("id", alvo.processo_id)
      .eq("empresa_id", pastas.empresaId)
      .maybeSingle();
    if (p) {
      const cliente = umCliente((p as unknown as { clientes: ClienteRel | ClienteRel[] | null }).clientes);
      const proc = await pastas.processo({ ...(p as { id: string; titulo: string; numero_cnj: string | null; numero_interno: string | null }), cliente });
      return pastas.garantir(`processo:${p.id}:cat:${alvo.categoria ?? "outros"}`, cat, proc);
    }
  }
  if (alvo.cliente_id) {
    const { data: c } = await admin.from("clientes").select("id, nome, documento").eq("id", alvo.cliente_id).eq("empresa_id", pastas.empresaId).maybeSingle();
    if (c) {
      const cli = await pastas.cliente(c);
      const docs = await pastas.garantir(`cliente:${c.id}:docs`, "Documentos do cliente", cli);
      return pastas.garantir(`cliente:${c.id}:docs:${alvo.categoria ?? "outros"}`, cat, docs);
    }
  }
  const internos = await pastas.garantir("internos", "Documentos internos", await pastas.raiz());
  return pastas.garantir(`internos:${alvo.categoria ?? "outros"}`, cat, internos);
}

/** O caminho no Storage precisa pertencer ao cliente/processo (e à empresa) do próprio registro. */
export function caminhoCoerente(d: Pick<DocRow, "storage_path" | "cliente_id" | "processo_id" | "empresa_id">) {
  if (!d.storage_path || d.storage_path.includes("..")) return false;
  let rel = d.storage_path;
  if (rel.startsWith("empresas/")) {
    const prefixo = `empresas/${d.empresa_id}/`;
    if (!rel.startsWith(prefixo)) return false;
    rel = rel.slice(prefixo.length);
  }
  if (d.processo_id) return rel.startsWith(`processos/${d.processo_id}/`);
  return !!d.cliente_id && rel.startsWith(`clientes/${d.cliente_id}/`);
}

/** Envia ao Drive, recriando a árvore de pastas uma vez se alguma tiver sido apagada no Drive. */
async function enviarComRecriacao(admin: SupabaseClient, pastas: Pastas, alvo: { cliente_id: string | null; processo_id: string | null; categoria: string | null }, enviar: (pasta: string) => Promise<{ id: string; webViewLink: string }>) {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await enviar(await pastaDestino(admin, pastas, alvo));
    } catch (e) {
      if (notFound(e) && tentativa === 0) {
        await pastas.invalidar();
        continue;
      }
      throw e;
    }
  }
}

/** Arquiva um documento do Storage no Drive da empresa, na pasta certa. Nunca lança. */
export async function arquivarDocumentoNoDrive(admin: SupabaseClient, docId: string, empresaId: string): Promise<{ ok: boolean; mensagem: string; url?: string }> {
  const { data: doc } = await admin
    .from("documentos")
    .select("id, empresa_id, nome, categoria, mime_type, storage_path, cliente_id, processo_id, drive_file_id, drive_url, drive_tentativas")
    .eq("id", docId)
    .eq("empresa_id", empresaId)
    .maybeSingle<DocRow & { drive_url: string | null }>();
  if (!doc) return { ok: false, mensagem: "Documento não encontrado." };
  if (doc.drive_file_id) return { ok: true, mensagem: "Documento já arquivado no Drive.", url: doc.drive_url ?? undefined };
  if (!doc.storage_path || !caminhoCoerente(doc)) {
    await admin.from("documentos").update({ drive_status: "ignorado", drive_erro: doc.storage_path ? "Caminho incompatível com o registro." : null }).eq("id", doc.id);
    return { ok: false, mensagem: "Documento sem arquivo válido no armazenamento." };
  }
  // Reserva o documento (evita dois envios simultâneos do mesmo arquivo)
  const { data: reservado } = await admin
    .from("documentos")
    .update({ drive_bloqueado_ate: new Date(Date.now() + 3 * 60_000).toISOString() })
    .eq("id", doc.id)
    .is("drive_file_id", null)
    .or(`drive_bloqueado_ate.is.null,drive_bloqueado_ate.lt.${new Date().toISOString()}`)
    .select("id")
    .maybeSingle();
  if (!reservado) return { ok: false, mensagem: "O documento já está sendo arquivado. Tente novamente em instantes." };

  const falha = async (mensagem: string) => {
    await admin
      .from("documentos")
      .update({ drive_status: "erro", drive_erro: mensagem.slice(0, 300), drive_tentativas: (doc.drive_tentativas ?? 0) + 1, drive_bloqueado_ate: null })
      .eq("id", doc.id);
    return { ok: false, mensagem };
  };
  try {
    const token = await tokenDoEscritorio(admin, empresaId);
    const { data: blob, error } = await admin.storage.from("documentos").download(doc.storage_path);
    if (error || !blob) return falha("Não foi possível ler o arquivo no armazenamento.");
    const data = await blob.arrayBuffer();
    const pastas = new Pastas(admin, token, empresaId);
    const enviado = await enviarComRecriacao(admin, pastas, doc, (pasta) =>
      uploadDriveFile(token, pasta, { name: doc.nome, type: doc.mime_type ?? "application/octet-stream", data, description: "Arquivado pelo GE EASY" }),
    );
    await admin
      .from("documentos")
      .update({ drive_file_id: enviado.id, drive_url: enviado.webViewLink, drive_status: "sincronizado", drive_erro: null, drive_sincronizado_em: new Date().toISOString(), drive_bloqueado_ate: null })
      .eq("id", doc.id);
    return { ok: true, mensagem: "Documento arquivado no Drive da empresa.", url: enviado.webViewLink };
  } catch (e) {
    return falha(e instanceof DriveError ? e.message : "Falha inesperada ao enviar ao Drive.");
  }
}

/** Salva um HTML como Google Docs na pasta do processo/cliente (documentos gerados por modelo). */
export async function salvarGoogleDoc(
  admin: SupabaseClient,
  empresaId: string,
  alvo: { cliente_id: string | null; processo_id: string | null },
  titulo: string,
  html: string,
): Promise<{ id: string; webViewLink: string }> {
  const token = await tokenDoEscritorio(admin, empresaId);
  const pastas = new Pastas(admin, token, empresaId);
  const doc = `<html><head><meta charset="utf-8"></head><body style="font-family:'Times New Roman',serif;font-size:12pt;white-space:pre-wrap">${html}</body></html>`;
  const data = new TextEncoder().encode(doc);
  return enviarComRecriacao(admin, pastas, { ...alvo, categoria: "gerado" }, (pasta) =>
    uploadDriveFile(token, pasta, { name: titulo, type: "text/html", data, description: "Gerado pelo GE EASY a partir de modelo" }, { converterParaDocs: true }),
  );
}

/** Garante (e devolve) a pasta do processo ou do cliente — usada no botão "Abrir pasta no Drive". */
export async function garantirPasta(admin: SupabaseClient, empresaId: string, alvo: { cliente_id?: string | null; processo_id?: string | null }) {
  const token = await tokenDoEscritorio(admin, empresaId);
  const pastas = new Pastas(admin, token, empresaId);
  if (alvo.processo_id) {
    const { data: p } = await admin
      .from("processos")
      .select("id, titulo, numero_cnj, numero_interno, drive_folder_id, clientes(id, nome, documento)")
      .eq("id", alvo.processo_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!p) throw new DriveError("Processo não encontrado.", 404);
    if (p.drive_folder_id && (await folderExists(token, p.drive_folder_id))) return p.drive_folder_id as string;
    await admin.from("drive_pastas").delete().eq("empresa_id", empresaId).eq("chave", `processo:${p.id}`);
    const cliente = umCliente((p as unknown as { clientes: ClienteRel | ClienteRel[] | null }).clientes);
    return pastas.processo({ ...(p as { id: string; titulo: string; numero_cnj: string | null; numero_interno: string | null }), cliente });
  }
  if (alvo.cliente_id) {
    const { data: c } = await admin.from("clientes").select("id, nome, documento, drive_folder_id").eq("id", alvo.cliente_id).eq("empresa_id", empresaId).maybeSingle();
    if (!c) throw new DriveError("Cliente não encontrado.", 404);
    if (c.drive_folder_id && (await folderExists(token, c.drive_folder_id))) return c.drive_folder_id as string;
    await admin.from("drive_pastas").delete().eq("empresa_id", empresaId).eq("chave", `cliente:${c.id}`);
    await admin.from("clientes").update({ drive_folder_id: null }).eq("id", c.id);
    return pastas.cliente(c);
  }
  return pastas.raiz();
}
