"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { TERMO_LGPD_VERSAO } from "@/app/(app)/clientes/fields";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { detectarTipoArquivo } from "@/lib/seguranca/arquivos";
import { sanitizeFileName } from "@/components/documentos/mime";
import { isValidCPF } from "@/lib/validators";
import { onlyDigits } from "@/lib/format";
import { can } from "@/lib/rbac";
import { CASO_STATUS, TIPOS_ACAO, UFS } from "@/lib/constants";
import { dbError, formToObject, guard, isUuid, limitar, registrarAcesso, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const BUCKET = "documentos";
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
const MAX_ARQUIVOS = 10;
const EXT_MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg" };

interface Arquivo {
  nome: string;
  mime: string;
  bytes: Uint8Array;
}

/** Lê os arquivos do formulário e aceita só PDF e JPEG de verdade (confere o conteúdo, não só a extensão). */
async function lerArquivos(formData: FormData, campo: string, rotulo: string): Promise<Arquivo[] | { error: string; campo: string }> {
  const files = formData.getAll(campo).filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_ARQUIVOS) return { error: `Envie no máximo ${MAX_ARQUIVOS} arquivos em ${rotulo}.`, campo };
  const out: Arquivo[] = [];
  for (const f of files) {
    const ext = (f.name.split(".").pop() ?? "").toLowerCase();
    const mime = f.type === "image/jpg" ? "image/jpeg" : f.type || EXT_MIME[ext] || "";
    if (!["application/pdf", "image/jpeg"].includes(mime)) return { error: `${f.name}: envie só PDF ou JPEG.`, campo };
    if (f.size > MAX_BYTES) return { error: `${f.name}: o arquivo deve ter até 3 MB neste cadastro. Arquivos maiores podem ser enviados na ficha do cliente.`, campo };
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!detectarTipoArquivo(bytes, mime)) return { error: `${f.name}: o conteúdo não confere com o tipo. Envio bloqueado por segurança.`, campo };
    out.push({ nome: f.name.slice(0, 255), mime, bytes });
  }
  return out;
}

// ------------------------------------------------------------------ cadastro do cliente pelo comercial
const TIPOS = TIPOS_ACAO.map((t) => t.value) as [string, ...string[]];
const UF_LIST = UFS.map((u) => u.value) as [string, ...string[]];

const clienteComercialSchema = z
  .object({
    nome: zs.required("Nome completo", 200),
    documento: zs.required("CPF", 14),
    telefone: zs.required("Telefone", 20),
    telefone_recado: zs.text(20),
    email: zs.text(160).refine((v) => !v || z.string().email().safeParse(v).success, "E-mail inválido"),
    senha_gov: zs.text(100),
    tipo_acao: zs.enumOf(TIPOS, "Selecione o tipo de ação"),
    cidade: zs.required("Cidade", 100),
    uf: zs.enumOf(UF_LIST, "Selecione a UF"),
    assessor_id: zs.uuid(),
    lgpd_consentimento: zs.bool(),
  })
  .superRefine((v, ctx) => {
    if (!isValidCPF(v.documento)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["documento"], message: "CPF inválido" });
    if (onlyDigits(v.telefone).length < 10) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["telefone"], message: "Telefone com DDD" });
    if (v.telefone_recado && onlyDigits(v.telefone_recado).length < 10) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["telefone_recado"], message: "Telefone com DDD" });
  });

/**
 * Cadastro enxuto do comercial: dados do cliente, senha gov (guardada cifrada), tipo de ação, documentos
 * (PDF/JPEG) e contrato assinado. Abre também o processo do cliente, em análise.
 */
export async function cadastrarClienteComercial(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("clientes.write");
  if ("denied" in g) return g.denied;
  const parsed = clienteComercialSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  if (!v.lgpd_consentimento) return { error: "Registre o consentimento do titular para o tratamento dos dados.", fieldErrors: { lgpd_consentimento: "Obrigatório" } };

  const documentos = await lerArquivos(formData, "documentos", "Documentos");
  if ("error" in documentos) return { error: documentos.error, fieldErrors: { [documentos.campo]: documentos.error } };
  const contrato = await lerArquivos(formData, "contrato", "Contrato assinado");
  if ("error" in contrato) return { error: contrato.error, fieldErrors: { [contrato.campo]: contrato.error } };
  if ([...documentos, ...contrato].reduce((total, arquivo) => total + arquivo.bytes.byteLength, 0) > MAX_TOTAL_BYTES) {
    return { error: "Os anexos deste cadastro devem somar no máximo 3 MB. Cadastre o cliente e envie os arquivos maiores pela ficha.", fieldErrors: { documentos: "Total acima de 3 MB" } };
  }
  const temArquivos = documentos.length + contrato.length > 0;
  if (temArquivos && !hasServiceRole()) return { error: "Armazenamento de arquivos indisponível no momento. Cadastre sem anexos e envie depois." };

  const supabase = await createClient();
  let assessorNome: string | null = null;
  if (v.assessor_id) {
    const { data: a } = await supabase.from("assessores").select("nome").eq("id", v.assessor_id).eq("ativo", true).maybeSingle();
    if (!a) return { error: "Assessor não encontrado.", fieldErrors: { assessor_id: "Assessor inválido" } };
    assessorNome = a.nome as string;
  }

  const { encrypt } = await import("@/lib/crypto");
  const h = await headers();
  const documento = onlyDigits(v.documento);
  const { data: row, error } = await supabase
    .from("clientes")
    .insert({
      tipo_pessoa: "PF",
      nome: v.nome,
      documento,
      telefone: onlyDigits(v.telefone),
      whatsapp: onlyDigits(v.telefone),
      telefone_recado: v.telefone_recado ? onlyDigits(v.telefone_recado) : null,
      email: v.email,
      senha_gov_enc: v.senha_gov ? encrypt(v.senha_gov) : null,
      tipo_acao: v.tipo_acao,
      cidade: v.cidade,
      uf: v.uf,
      assessor_id: v.assessor_id,
      status: "ativo",
      consultor_id: g.session.userId,
      status_cadastro: temArquivos ? "pre_cadastro" : "pendente_documentacao",
      lgpd_consentimento_em: new Date().toISOString(),
      lgpd_termo_versao: TERMO_LGPD_VERSAO,
      lgpd_consentimento_origem: { usuario: g.session.userId, ip: (h.get("x-forwarded-for")?.split(",")[0] ?? "").trim().slice(0, 64) || null, canal: "cadastro_comercial" },
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "Este CPF já está cadastrado. Procure o cliente na lista ou peça a transferência à gestão.", fieldErrors: { documento: "CPF já cadastrado" } };
    return dbError(error);
  }
  const clienteId = row.id as string;

  // Processo do cliente (tipo de ação), começa em análise
  const hoje = new Date().toISOString().slice(0, 10);
  const { error: casoErr } = await supabase.from("cliente_casos").insert({
    cliente_id: clienteId,
    origem: "cadastro_comercial",
    tipo: v.tipo_acao,
    cidade: v.cidade,
    uf: v.uf,
    corretor: assessorNome ? assessorNome.toUpperCase().slice(0, 120) : null,
    contrato_assinado: contrato.length > 0,
    recebido_em: hoje,
    ano: Number(hoje.slice(0, 4)),
    status: "em_analise",
  });
  if (casoErr) console.error("[comercial] processo do cliente", casoErr.code, casoErr.message);

  // Anexos: guardados na pasta do cliente e registrados na central de documentos
  const falhas: string[] = [];
  if (temArquivos) {
    const admin = createAdminClient();
    const pasta = `empresas/${g.session.empresa!.id}/clientes/${clienteId}`;
    for (const [categoria, lista] of [["documentos_pessoais", documentos], ["contrato_assinado", contrato]] as const) {
      for (const arq of lista) {
        const path = `${pasta}/${crypto.randomUUID()}-${sanitizeFileName(arq.nome)}`;
        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, arq.bytes, { contentType: arq.mime, upsert: false });
        if (upErr) {
          falhas.push(arq.nome);
          continue;
        }
        const { error: docErr } = await supabase.from("documentos").insert({
          cliente_id: clienteId, nome: arq.nome, categoria, storage_path: path, mime_type: arq.mime, tamanho: arq.bytes.byteLength, enviado_por: g.session.userId,
        });
        if (docErr) {
          await admin.storage.from(BUCKET).remove([path]);
          falhas.push(arq.nome);
        }
      }
    }
  }

  revalidatePath("/clientes");
  revalidatePath("/consultor");
  revalidatePath("/administrativo/processos");
  const anexos = documentos.length + contrato.length - falhas.length;
  return {
    ok: true,
    id: clienteId,
    message: falhas.length
      ? `Cliente cadastrado, mas ${falhas.length} arquivo(s) não foram enviados: ${falhas.join(", ")}. Envie de novo na ficha do cliente.`
      : `Cliente cadastrado${anexos ? ` com ${anexos} anexo(s)` : ""}.`,
  };
}

/** Mostra a senha gov do cliente sob demanda (cada visualização fica registrada na auditoria). */
export async function verSenhaGov(clienteId: string): Promise<ActionState & { senha?: string }> {
  const g = await guard("clientes.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(clienteId)) return { error: "Cliente inválido." };
  const limite = await limitar("ver_senha_gov", 30, 3600);
  if (limite) return limite;
  const supabase = await createClient();
  const { data } = await supabase.from("clientes").select("senha_gov_enc").eq("id", clienteId).maybeSingle();
  if (!data?.senha_gov_enc) return { error: "Senha gov não cadastrada." };
  await registrarAcesso("VISUALIZACAO_SIGILOSA", "clientes", clienteId, { campo: "senha_gov" });
  const { decrypt } = await import("@/lib/crypto");
  return { ok: true, senha: decrypt(data.senha_gov_enc as string) };
}

// ------------------------------------------------------------------ status do processo
const STATUS = CASO_STATUS.map((s) => s.value) as [string, ...string[]];

export async function alterarStatusCaso(casoId: string, status: string, extra?: { protocolo_inss?: string | null; situacao_atual?: string | null }): Promise<ActionState> {
  const g = await guard("clientes.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(casoId)) return { error: "Processo inválido." };
  const v = z.enum(STATUS).safeParse(status);
  if (!v.success) return { error: "Status inválido." };
  const ex = z.object({ protocolo_inss: zs.text(40), situacao_atual: zs.text(300) }).safeParse(extra ?? {});
  if (!ex.success) return { error: "Protocolo ou estado atual inválido." };
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status: v.data };
  if (v.data === "habilitado") {
    const { data: atual } = await supabase.from("cliente_casos").select("protocolo_inss, situacao_atual").eq("id", casoId).maybeSingle();
    const protocolo = ex.data.protocolo_inss ?? atual?.protocolo_inss ?? null;
    const situacao = ex.data.situacao_atual ?? atual?.situacao_atual ?? null;
    if (!protocolo || !situacao) return { error: "Para habilitar, informe o número do protocolo do INSS e o estado atual do processo." };
    patch.protocolo_inss = protocolo;
    patch.situacao_atual = situacao;
  }
  const { data, error } = await supabase.from("cliente_casos").update(patch).eq("id", casoId).select("id, cliente_id");
  if (error) return error.code === "23514" && error.message ? { error: error.message } : dbError(error);
  // Ao mover para um status restrito sem permissão, a linha deixa de ser visível: confere se a alteração ocorreu
  if (!data?.length) {
    const restrito = ["pendencia", "exigencia", "em_analise"].includes(v.data) && !can(g.session.profile, "processos.status_restritos");
    if (!restrito) return { error: "Processo não encontrado ou sem permissão." };
  }
  revalidatePath("/administrativo/processos");
  revalidatePath("/dashboard");
  if (data?.[0]?.cliente_id) revalidatePath(`/clientes/${data[0].cliente_id}`);
  return { ok: true, message: "Status do processo atualizado." };
}

const casoSchema = z.object({
  id: zs.requiredUuid("o processo"),
  protocolo_inss: zs.text(40),
  situacao_atual: zs.text(300),
  observacoes: zs.text(4000),
});

/** Edita protocolo do INSS, estado atual e observações do processo. */
export async function editarCaso(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("clientes.write");
  if ("denied" in g) return g.denied;
  const parsed = casoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...dados } = parsed.data;
  const supabase = await createClient();
  const { data: atual } = await supabase.from("cliente_casos").select("status").eq("id", id).maybeSingle();
  if (!atual) return { error: "Processo não encontrado ou sem permissão." };
  if (atual.status === "habilitado" && (!dados.protocolo_inss || !dados.situacao_atual)) {
    return { error: "Processo habilitado precisa do protocolo do INSS e do estado atual.", fieldErrors: { ...(dados.protocolo_inss ? {} : { protocolo_inss: "Obrigatório" }), ...(dados.situacao_atual ? {} : { situacao_atual: "Obrigatório" }) } };
  }
  const { data, error } = await supabase.from("cliente_casos").update(dados).eq("id", id).select("cliente_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Processo não encontrado ou sem permissão." };
  revalidatePath("/administrativo/processos");
  revalidatePath(`/clientes/${data.cliente_id}`);
  return { ok: true, message: "Processo atualizado." };
}

// ------------------------------------------------------------------ assessores
const assessorSchema = z
  .object({
    id: zs.uuid(),
    nome: zs.required("Nome completo", 200),
    cpf: zs.text(14),
    telefone: zs.text(20),
    categoria: zs.enumOf(["consultor", "corretor", "diretoria"], "Escolha a categoria"),
    apelidos: zs.text(300),
    email: zs.text(160).refine((v) => !v || z.string().email().safeParse(v).success, "E-mail inválido"),
    acordo_comercial: zs.enumOf(["sim", "nao"], "Informe se tem acordo comercial"),
    ativo: zs.bool(),
    observacoes: zs.text(2000),
    user_id: zs.uuid(),
  })
  .superRefine((v, ctx) => {
    // no cadastro novo CPF e telefone são obrigatórios; na edição de registros antigos podem ser completados depois
    if (!v.id && !v.cpf) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cpf"], message: "CPF é obrigatório" });
    if (!v.id && !v.telefone) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["telefone"], message: "Telefone é obrigatório" });
    if (v.cpf && !isValidCPF(v.cpf)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cpf"], message: "CPF inválido" });
    if (v.telefone && onlyDigits(v.telefone).length < 10) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["telefone"], message: "Telefone com DDD" });
  });

export async function salvarAssessor(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("consultores.manage");
  if ("denied" in g) return g.denied;
  const form = formToObject(formData);
  const parsed = assessorSchema.safeParse({ ...form, ativo: form.id ? form.ativo : "on" });
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const comprovante = await lerArquivos(formData, "comprovante", "Comprovante de residência");
  if ("error" in comprovante) return { error: comprovante.error, fieldErrors: { comprovante: comprovante.error } };
  if (comprovante.length > 1) return { error: "Envie um único comprovante.", fieldErrors: { comprovante: "Um arquivo" } };
  if (comprovante.length && !hasServiceRole()) return { error: "Armazenamento de arquivos indisponível no momento." };

  const supabase = await createClient();
  const dados = {
    nome: v.nome,
    cpf: v.cpf ? onlyDigits(v.cpf) : null,
    telefone: v.telefone ? onlyDigits(v.telefone) : null,
    categoria: v.categoria,
    apelidos: (v.apelidos ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10),
    email: v.email,
    acordo_comercial: v.acordo_comercial === "sim",
    ativo: v.ativo,
    observacoes: v.observacoes,
    user_id: v.user_id ?? null,
  };
  const res = v.id
    ? await supabase.from("assessores").update(dados).eq("id", v.id).select("id, comprovante_path").maybeSingle()
    : await supabase.from("assessores").insert(dados).select("id, comprovante_path").single();
  if (res.error) return res.error.code === "23505" ? { error: "Já existe um assessor com este CPF.", fieldErrors: { cpf: "CPF já cadastrado" } } : dbError(res.error);
  if (!res.data) return { error: "Assessor não encontrado." };
  const id = res.data.id as string;

  let aviso = "";
  if (comprovante.length) {
    const arq = comprovante[0];
    const admin = createAdminClient();
    const path = `empresas/${g.session.empresa!.id}/assessores/${id}/${crypto.randomUUID()}.${arq.mime === "application/pdf" ? "pdf" : "jpg"}`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, arq.bytes, { contentType: arq.mime, upsert: false });
    if (upErr) aviso = " O comprovante não foi enviado; tente de novo.";
    else {
      const { error: e2 } = await supabase.from("assessores").update({ comprovante_path: path, comprovante_mime: arq.mime }).eq("id", id);
      if (e2) {
        await admin.storage.from(BUCKET).remove([path]);
        aviso = " O comprovante não foi salvo; tente de novo.";
      } else if (res.data.comprovante_path) await admin.storage.from(BUCKET).remove([res.data.comprovante_path as string]);
    }
  }
  revalidatePath("/assessores");
  return { ok: true, message: `${v.id ? "Assessor atualizado." : "Assessor cadastrado."}${aviso}`, id };
}

/** Link temporário (60 s) do comprovante de residência do assessor. */
export async function urlComprovanteAssessor(id: string): Promise<ActionState & { url?: string }> {
  const g = await guard("consultores.manage");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Assessor inválido." };
  const supabase = await createClient();
  const { data } = await supabase.from("assessores").select("comprovante_path").eq("id", id).maybeSingle();
  if (!data?.comprovante_path) return { error: "Sem comprovante cadastrado." };
  const { data: s, error } = await supabase.storage.from(BUCKET).createSignedUrl(data.comprovante_path as string, 60);
  if (error || !s) return { error: "Não foi possível abrir o arquivo." };
  await registrarAcesso("DOWNLOAD", "assessores", id, { campo: "comprovante_residencia" });
  return { ok: true, url: s.signedUrl };
}

export async function excluirAssessor(id: string): Promise<ActionState> {
  const g = await guard("consultores.manage");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Assessor inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("assessores").delete().eq("id", id).select("comprovante_path");
  if (error) return dbError(error);
  if (!data?.length) return { error: "Assessor não encontrado ou sem permissão." };
  if (data[0].comprovante_path && hasServiceRole()) await createAdminClient().storage.from(BUCKET).remove([data[0].comprovante_path as string]);
  revalidatePath("/assessores");
  return { ok: true, message: "Assessor excluído. Os clientes dele ficam sem assessor." };
}

// ------------------------------------------------------------------ prazo da exigência
/** Prorroga uma única vez o prazo da exigência (+7 dias; o banco calcula e impede a segunda prorrogação). */
export async function prorrogarExigencia(casoId: string): Promise<ActionState> {
  const g = await guard("clientes.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(casoId)) return { error: "Processo inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cliente_casos")
    .update({ exigencia_prorrogada: true })
    .eq("id", casoId)
    .eq("status", "exigencia")
    .eq("exigencia_prorrogada", false)
    .select("cliente_id, exigencia_prazo");
  if (error) return dbError(error);
  if (!data?.length) return { error: "Esta exigência já foi prorrogada ou não está mais em aberto." };
  revalidatePath("/dashboard");
  revalidatePath("/administrativo/processos");
  revalidatePath(`/clientes/${data[0].cliente_id}`);
  const [a, m, d] = String(data[0].exigencia_prazo).split("-");
  return { ok: true, message: `Prazo prorrogado para ${d}/${m}/${a}.` };
}
