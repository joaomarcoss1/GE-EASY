"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { detectarTipoArquivo } from "@/lib/seguranca/arquivos";
import { isValidCPF } from "@/lib/validators";
import { onlyDigits } from "@/lib/format";
import { can } from "@/lib/rbac";
import { AUSENCIA_TIPOS, PONTO_TIPOS, TIPOS_CONTRATO } from "@/lib/constants";
import { criarUsuario } from "./usuarios";
import { dbError, formToObject, guard, isUuid, limitar, registrarAcesso, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

/**
 * RH, ponto e pré-folha (fase 7). Marcações, ajustes, espelho e folha passam pelas funções do banco
 * (inalterabilidade, aprovação por outra pessoa, cálculo). Dados sensíveis só com rh.dados_sensiveis;
 * dados bancários são criptografados aqui antes de gravar.
 */
const atualizar = (id?: string) => {
  revalidatePath("/rh");
  revalidatePath("/ponto");
  if (id) revalidatePath(`/rh/${id}`);
};
const erroDb = (e: { code?: string; message?: string }): ActionState =>
  (e.code === "P0001" || e.code === "23514" || (e.code === "42501" && e.message && !e.message.startsWith("new row"))) && e.message ? { error: e.message } : dbError(e);
const opcao = (opts: { value: string }[]) => (v: string) => opts.some((o) => o.value === v);

const funcSchema = z.object({
  id: zs.uuid(),
  nome: zs.required("Nome", 200),
  matricula: zs.text(30),
  cargo: zs.text(120),
  departamento_id: zs.uuid(),
  jornada_id: zs.uuid(),
  tipo_contrato: z.string().refine(opcao(TIPOS_CONTRATO), "Tipo de contrato inválido"),
  admissao: zs.date(),
  email: zs.text(200).refine((v) => !v || z.string().email().safeParse(v).success, "E-mail inválido"),
  telefone: zs.text(30),
  ponto_externo: zs.bool(),
  controla_ponto: zs.bool(),
  observacoes: zs.text(2000),
  criar_acesso: zs.bool(),
  role: zs.text(40),
  senha: z.string().max(128).optional().default(""),
  confirmar: z.string().max(128).optional().default(""),
  trocar_senha: zs.bool(),
});

/** Admissão/edição. Com "criar acesso", cria o usuário com a senha inicial (o banco cria o vínculo e o registro, que é completado aqui). */
export async function salvarFuncionario(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("rh.funcionarios.editar");
  if ("denied" in g) return g.denied;
  const parsed = funcSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, criar_acesso, role, senha, confirmar, trocar_senha, ...v } = parsed.data;
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from("funcionarios").update(v).eq("id", id).select("id").maybeSingle();
    if (error) return erroDb(error);
    if (!data) return { error: "Funcionário não encontrado." };
    atualizar(id);
    return { ok: true, message: "Cadastro atualizado.", id };
  }
  if (criar_acesso) {
    if (!can(g.session.profile, "usuarios.manage")) return { error: "Criar acesso ao sistema exige a permissão de gerir usuários." };
    if (!v.email) return { error: "Informe o e-mail para criar o acesso.", fieldErrors: { email: "Obrigatório para o acesso" } };
    const fd = new FormData();
    fd.set("email", v.email);
    fd.set("full_name", v.nome);
    fd.set("role", role || "administrativo");
    fd.set("senha", senha);
    fd.set("confirmar", confirmar);
    if (trocar_senha) fd.set("trocar_senha", "on");
    const r = await criarUsuario({}, fd);
    if (!r.ok || !r.id) return r;
    const { data } = await createAdminClient().from("funcionarios").update(v).eq("empresa_id", g.session.empresa!.id).eq("user_id", r.id).select("id").maybeSingle();
    atualizar();
    return { ok: true, id: data?.id, message: `Funcionário admitido. ${r.message}` };
  }
  const { data, error } = await supabase.from("funcionarios").insert(v).select("id").single();
  if (error) return error.code === "23505" ? { error: "Já existe funcionário com esta matrícula." } : erroDb(error);
  atualizar();
  return { ok: true, id: data.id, message: "Funcionário admitido." };
}

const sensSchema = z.object({
  funcionario_id: zs.requiredUuid("o funcionário"),
  cpf: zs.text(20).refine((v) => !v || isValidCPF(onlyDigits(v)), "CPF inválido"),
  rg: zs.text(30),
  nascimento: zs.date(),
  pis: zs.text(20).refine((v) => !v || onlyDigits(v).length === 11, "PIS inválido"),
  salario_base: zs.money(),
  adicionais_fixos: zs.money(),
  banco: zs.text(200),
  endereco: zs.text(400),
  contato_emergencia: zs.text(200),
});

export async function salvarSensiveis(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("rh.dados_sensiveis");
  if ("denied" in g) return g.denied;
  const parsed = sensSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { banco, cpf, pis, ...v } = parsed.data;
  const row: Record<string, unknown> = { ...v, cpf: cpf ? onlyDigits(cpf) : null, pis: pis ? onlyDigits(pis) : null, adicionais_fixos: v.adicionais_fixos ?? 0 };
  if (banco) row.dados_bancarios_enc = encrypt(banco);
  const supabase = await createClient();
  const { error } = await supabase.from("funcionario_sensiveis").upsert(row, { onConflict: "funcionario_id" });
  if (error) return error.code === "23505" ? { error: "CPF já cadastrado em outro funcionário." } : erroDb(error);
  atualizar(v.funcionario_id);
  return { ok: true, message: "Dados contratuais salvos." };
}

const depSchema = z.object({
  funcionario_id: zs.requiredUuid("o funcionário"),
  nome: zs.required("Nome", 200),
  parentesco: zs.required("Parentesco", 40),
  nascimento: zs.date(),
  cpf: zs.text(20).refine((v) => !v || isValidCPF(onlyDigits(v)), "CPF inválido"),
  ir: zs.bool(),
});
export async function salvarDependente(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("rh.dados_sensiveis");
  if ("denied" in g) return g.denied;
  const parsed = depSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("funcionario_dependentes").insert({ ...parsed.data, cpf: parsed.data.cpf ? onlyDigits(parsed.data.cpf) : null });
  if (error) return erroDb(error);
  atualizar(parsed.data.funcionario_id);
  return { ok: true, message: "Dependente incluído." };
}

/** Dados bancários: decifrados só para quem tem a permissão, com registro na auditoria. */
export async function verDadosBancarios(funcionarioId: string): Promise<ActionState & { dados?: string }> {
  const g = await guard("rh.dados_sensiveis");
  if ("denied" in g) return g.denied;
  if (!isUuid(funcionarioId)) return { error: "Funcionário inválido." };
  const supabase = await createClient();
  const { data } = await supabase.from("funcionario_sensiveis").select("dados_bancarios_enc").eq("funcionario_id", funcionarioId).maybeSingle();
  if (!data?.dados_bancarios_enc) return { error: "Sem dados bancários cadastrados." };
  await registrarAcesso("VISUALIZACAO_SIGILOSA", "funcionario_sensiveis", funcionarioId, { campo: "dados_bancarios" });
  const { decrypt } = await import("@/lib/crypto");
  return { ok: true, dados: decrypt(data.dados_bancarios_enc as string) };
}

// ------------------------------------------------------------------ arquivos (documentos do funcionário, atestados)
const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function guardarArquivo(empresaId: string, funcionarioId: string, file: File): Promise<{ path: string; mime: string; tamanho: number } | { error: string }> {
  if (!hasServiceRole()) return { error: "Armazenamento indisponível (service role não configurada)." };
  if (!file.size || file.size > 10 * 1024 * 1024) return { error: "Envie um arquivo de até 10 MB." };
  if (!MIMES.includes(file.type)) return { error: "Envie PDF ou imagem (JPG, PNG, WEBP)." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!detectarTipoArquivo(bytes, file.type)) return { error: "O conteúdo do arquivo não confere com o tipo. Envio bloqueado por segurança." };
  const path = `empresas/${empresaId}/funcionarios/${funcionarioId}/${crypto.randomUUID()}.${EXT[file.type]}`;
  const { error } = await createAdminClient().storage.from("documentos").upload(path, bytes, { contentType: file.type });
  if (error) return { error: "Não foi possível guardar o arquivo." };
  return { path, mime: file.type, tamanho: file.size };
}

export async function enviarDocumentoFuncionario(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("rh.funcionarios.editar");
  if ("denied" in g) return g.denied;
  const v = z.object({ funcionario_id: zs.requiredUuid("o funcionário"), tipo: zs.required("Tipo", 80), descricao: zs.text(300), validade: zs.date() }).safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  const file = formData.get("arquivo");
  if (!(file instanceof File)) return { error: "Escolha o arquivo." };
  const supabase = await createClient();
  const { data: f } = await supabase.from("funcionarios").select("id").eq("id", v.data.funcionario_id).maybeSingle();
  if (!f) return { error: "Funcionário não encontrado." };
  const arq = await guardarArquivo(g.session.empresa!.id, f.id, file);
  if ("error" in arq) return { error: arq.error };
  const { error } = await supabase.from("funcionario_documentos").insert({ ...v.data, storage_path: arq.path, mime: arq.mime, tamanho: arq.tamanho });
  if (error) {
    await createAdminClient().storage.from("documentos").remove([arq.path]);
    return erroDb(error);
  }
  atualizar(f.id);
  return { ok: true, message: "Documento guardado." };
}

// ------------------------------------------------------------------ jornadas, cercas, parâmetros
const jornadaSchema = z.object({
  id: zs.uuid(),
  nome: zs.required("Nome", 120),
  entrada: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida"),
  saida: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida"),
  intervalo_min: zs.number(0, 600),
  tolerancia_min: zs.number(0, 60),
  banco_horas: zs.bool(),
  ativo: zs.bool(),
});
export async function salvarJornada(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("ponto.gerir");
  if ("denied" in g) return g.denied;
  const parsed = jornadaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const dias = formData.getAll("dias[]").map(Number).filter((d) => d >= 1 && d <= 7);
  if (!dias.length) return { error: "Escolha os dias de trabalho.", fieldErrors: { dias: "Obrigatório" } };
  const { id, ...v } = parsed.data;
  if (v.saida <= v.entrada) return { error: "A saída deve ser depois da entrada.", fieldErrors: { saida: "Horário inválido" } };
  const row = { ...v, dias, intervalo_min: v.intervalo_min ?? 60, tolerancia_min: v.tolerancia_min ?? 10 };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("jornadas").update(row).eq("id", id) : await supabase.from("jornadas").insert(row);
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: "Jornada salva." };
}

const cercaSchema = z.object({ id: zs.uuid(), nome: zs.required("Nome", 120), lat: zs.number(-90, 90), lng: zs.number(-180, 180), raio_m: zs.number(20, 5000), ativo: zs.bool() });
export async function salvarCerca(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("ponto.gerir");
  if ("denied" in g) return g.denied;
  const parsed = cercaSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...v } = parsed.data;
  if (v.lat == null || v.lng == null) return { error: "Informe latitude e longitude." };
  const supabase = await createClient();
  const row = { ...v, raio_m: v.raio_m ?? 150 };
  const { error } = id ? await supabase.from("cercas").update(row).eq("id", id) : await supabase.from("cercas").insert(row);
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: "Cerca salva." };
}

const paramSchema = z.object({ fora_cerca: zs.enumOf(["registrar", "bloquear"]), precisao_max_m: zs.number(10, 5000), offline_max_h: zs.number(1, 168), exigir_gps: zs.bool() });
export async function salvarParametrosPonto(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("ponto.gerir");
  if ("denied" in g) return g.denied;
  const parsed = paramSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("configuracoes").upsert({ chave: "ponto", valor: parsed.data, updated_by: g.session.userId }, { onConflict: "empresa_id,chave" });
  if (error) return dbError(error);
  atualizar();
  return { ok: true, message: "Parâmetros do ponto salvos." };
}

// ------------------------------------------------------------------ marcação web, ajustes, ausências
const webSchema = z.object({ tipo: z.string().refine(opcao(PONTO_TIPOS), "Tipo inválido"), lat: zs.number(-90, 90), lng: zs.number(-180, 180), precisao: zs.number(0, 100000) });
export async function registrarPontoWeb(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("ponto.registrar");
  if ("denied" in g) return g.denied;
  const parsed = webSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const lim = await limitar("ponto", 20, 3600);
  if (lim) return lim;
  const supabase = await createClient();
  const v = parsed.data;
  const { data, error } = await supabase.rpc("registrar_ponto", {
    p_id: crypto.randomUUID(), p_tipo: v.tipo, p_lat: v.lat, p_lng: v.lng, p_precisao: v.precisao, p_dispositivo_em: null, p_dispositivo: null, p_offline: false,
  });
  if (error) return erroDb(error);
  atualizar();
  const r = data as { nsr: number; fora_cerca: boolean };
  return { ok: true, message: `Marcação registrada (NSR ${r.nsr})${r.fora_cerca ? " — fora da área da empresa, ficará sinalizada" : ""}.` };
}

const ajusteSchema = z.object({
  funcionario_id: zs.uuid(),
  acao: zs.enumOf(["incluir", "desconsiderar"]),
  marcacao_id: zs.uuid(),
  tipo: zs.text(20),
  data: zs.date(),
  hora: zs.text(5),
  justificativa: zs.required("Justificativa", 1000).refine((v) => v.length >= 5, "Explique o motivo"),
});
export async function solicitarAjuste(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("ponto.registrar");
  if ("denied" in g) return g.denied;
  const parsed = ajusteSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  let funcId = v.funcionario_id;
  if (!funcId) {
    const { data } = await supabase.rpc("meu_funcionario");
    funcId = (data as string | null) ?? null;
  }
  if (!funcId) return { error: "Seu cadastro de funcionário não foi encontrado." };
  if (v.acao === "incluir" && (!v.tipo || !PONTO_TIPOS.some((t) => t.value === v.tipo) || !v.data || !v.hora || !/^\d{2}:\d{2}$/.test(v.hora))) return { error: "Informe o tipo, a data e a hora da marcação." };
  if (v.acao === "desconsiderar" && !v.marcacao_id) return { error: "Escolha a marcação." };
  const row = v.acao === "incluir"
    ? { funcionario_id: funcId, acao: v.acao, tipo: v.tipo, horario: new Date(`${v.data}T${v.hora}:00-03:00`).toISOString(), justificativa: v.justificativa }
    : { funcionario_id: funcId, acao: v.acao, marcacao_id: v.marcacao_id, justificativa: v.justificativa };
  const { error } = await supabase.from("ponto_ajustes").insert(row);
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: "Ajuste enviado para aprovação. A marcação original é mantida." };
}

export async function decidirAjuste(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("ponto.gerir");
  if ("denied" in g) return g.denied;
  const v = z.object({ id: zs.requiredUuid("o ajuste"), aprovar: zs.enumOf(["sim", "nao"]), observacao: zs.text(500) }).safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("decidir_ajuste", { p_ajuste: v.data.id, p_aprovar: v.data.aprovar === "sim", p_obs: v.data.observacao });
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: v.data.aprovar === "sim" ? "Ajuste aprovado." : "Ajuste recusado." };
}

export async function solicitarAusencia(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("ponto.registrar");
  if ("denied" in g) return g.denied;
  const v = z.object({
    funcionario_id: zs.uuid(), tipo: z.string().refine(opcao(AUSENCIA_TIPOS), "Tipo inválido"),
    inicio: zs.date().refine((x) => !!x, "Informe o início"), fim: zs.date().refine((x) => !!x, "Informe o fim"), observacao: zs.text(1000),
  }).safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  if (v.data.fim! < v.data.inicio!) return { error: "O fim deve ser depois do início.", fieldErrors: { fim: "Data inválida" } };
  const supabase = await createClient();
  let funcId = v.data.funcionario_id;
  if (!funcId) funcId = ((await supabase.rpc("meu_funcionario")).data as string | null) ?? null;
  if (!funcId) return { error: "Seu cadastro de funcionário não foi encontrado." };
  let anexo: { anexo_path: string; anexo_mime: string } | Record<string, never> = {};
  const file = formData.get("arquivo");
  if (file instanceof File && file.size) {
    const arq = await guardarArquivo(g.session.empresa!.id, funcId, file);
    if ("error" in arq) return { error: arq.error };
    anexo = { anexo_path: arq.path, anexo_mime: arq.mime };
  }
  const { error } = await supabase.from("ausencias").insert({ ...v.data, funcionario_id: funcId, ...anexo });
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: "Solicitação enviada para aprovação." };
}

export async function decidirAusencia(id: string, aprovar: boolean): Promise<ActionState> {
  const g = await guard("ponto.gerir");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Solicitação inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decidir_ausencia", { p_ausencia: id, p_aprovar: aprovar });
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: aprovar ? "Solicitação aprovada." : "Solicitação recusada." };
}

// ------------------------------------------------------------------ espelho e folha
export async function fecharEspelho(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("ponto.gerir");
  if ("denied" in g) return g.denied;
  const v = z.object({ funcionario_id: zs.requiredUuid("o funcionário"), competencia: z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido") }).safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("fechar_espelho", { p_func: v.data.funcionario_id, p_competencia: `${v.data.competencia}-01` });
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: "Espelho fechado e enviado ao funcionário para ciência." };
}

export async function darCiencia(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  const v = z.object({ id: zs.requiredUuid("o espelho"), contestacao: zs.text(2000) }).safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("ciencia_espelho", { p_espelho: v.data.id, p_contestacao: v.data.contestacao });
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: v.data.contestacao ? "Contestação enviada ao RH." : "Ciência registrada." };
}

export async function gerarPreFolha(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("folha.gerir");
  if ("denied" in g) return g.denied;
  const v = z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido") }).safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gerar_pre_folha", { p_competencia: `${v.data.competencia}-01` });
  if (error) return erroDb(error);
  revalidatePath("/rh/folha");
  return { ok: true, id: data as string, message: "Pré-folha consolidada. Revise os valores antes de aprovar." };
}

export async function aprovarFolha(id: string): Promise<ActionState> {
  const g = await guard("folha.gerir");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Folha inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("aprovar_folha", { p_competencia_id: id });
  if (error) return erroDb(error);
  revalidatePath("/rh/folha");
  revalidatePath("/financeiro");
  return { ok: true, message: `Folha aprovada: ${data ?? 0} pagamento(s) lançado(s) em contas a pagar.` };
}

const itemSchema = z.object({ id: zs.requiredUuid("o item"), outros_proventos: zs.money(), outros_descontos: zs.money(), observacoes: zs.text(1000) });
export async function ajustarItemFolha(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("folha.gerir");
  if ("denied" in g) return g.denied;
  const parsed = itemSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...v } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("folha_itens").update({ outros_proventos: v.outros_proventos ?? 0, outros_descontos: v.outros_descontos ?? 0, observacoes: v.observacoes }).eq("id", id).select("id").maybeSingle();
  if (error) return erroDb(error);
  if (!data) return { error: "Item não encontrado ou folha já aprovada." };
  revalidatePath("/rh/folha");
  return { ok: true, message: "Item ajustado." };
}
