"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { calcularPrazo } from "@/lib/juridico/prazos";
import { isValidYmd, parseFeriados } from "@/components/prazos/utils";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const STATUS = ["pendente", "cumprido", "perdido", "cancelado"] as const;
const PRIORIDADES = ["baixa", "media", "alta", "urgente"] as const;
const CONTAGEM = ["uteis", "corridos"] as const;

const prazoSchema = z
  .object({
    processo_id: zs.uuid(),
    descricao: zs.required("Descrição", 300).refine((v) => v.length >= 2, "Informe ao menos 2 caracteres"),
    data_publicacao: zs.date(),
    dias: zs.number(0, 365).refine((v) => v === null || v === undefined || Number.isInteger(v), "Informe um número inteiro de dias"),
    contagem: zs.enumOf([...CONTAGEM], "Selecione a contagem"),
    data_fim: zs.date(),
    manual: zs.bool(),
    feriados_extras: zs.text(1000),
    fatal: zs.bool(),
    prioridade: zs.enumOf([...PRIORIDADES], "Selecione a prioridade"),
    responsavel_id: zs.uuid(),
    departamento_id: zs.uuid(),
    observacoes: zs.text(5000),
  })
  .superRefine((v, ctx) => {
    if (v.data_publicacao && !isValidYmd(v.data_publicacao)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_publicacao"], message: "Data inválida" });
    if (v.data_fim && !isValidYmd(v.data_fim)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_fim"], message: "Data inválida" });
    const { invalidos } = parseFeriados(v.feriados_extras);
    if (invalidos.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["feriados_extras"], message: `Datas inválidas: ${invalidos.slice(0, 3).join(", ")} (use dd/mm/aaaa)` });
    const temCalculo = !!v.data_publicacao && v.dias !== null && v.dias !== undefined;
    if (v.manual && !v.data_fim) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_fim"], message: "Informe o vencimento" });
    if (!temCalculo && !v.data_fim) {
      if (v.data_publicacao) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dias"], message: "Informe a quantidade de dias" });
      else ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_fim"], message: "Informe o vencimento ou a publicação + dias" });
    }
  });

type PrazoInput = z.output<typeof prazoSchema>;

interface PrazoRow {
  id: string;
  processo_id: string | null;
  data_publicacao: string | null;
  dias: number | null;
  contagem: "uteis" | "corridos";
  data_fim: string;
  status: (typeof STATUS)[number];
}
const ROW_COLS = "id, processo_id, data_publicacao, dias, contagem, data_fim, status";

/**
 * Define o vencimento: com publicação + dias (e sem "definir manualmente"),
 * calcula pelo CPC no servidor. Na edição, se os dados da contagem não mudaram e
 * não foram informados feriados locais, mantém o vencimento já gravado (que pode
 * ter considerado feriados locais ou um ajuste manual anterior).
 */
function resolveDataFim(v: PrazoInput, before?: PrazoRow | null): string {
  const extras = parseFeriados(v.feriados_extras).datas;
  if (!v.manual && v.data_publicacao && v.dias !== null && v.dias !== undefined) {
    const unchanged =
      before && before.data_publicacao === v.data_publicacao && before.dias === v.dias && before.contagem === v.contagem && extras.length === 0;
    if (unchanged) return before.data_fim;
    return calcularPrazo(v.data_publicacao, v.dias, v.contagem, extras).dataFim;
  }
  return v.data_fim!;
}

function toRecord(v: PrazoInput, dataFim: string) {
  return {
    descricao: v.descricao,
    data_publicacao: v.data_publicacao ?? null,
    dias: v.dias ?? null,
    contagem: v.contagem,
    data_fim: dataFim,
    fatal: v.fatal,
    prioridade: v.prioridade,
    departamento_id: v.departamento_id ?? null,
    observacoes: v.observacoes ?? null,
  };
}

function revalidate(processoIds: (string | null | undefined)[]) {
  revalidatePath("/prazos");
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
  for (const p of new Set(processoIds.filter(Boolean))) revalidatePath(`/processos/${p}`);
}

const dueMsg = (d: string) => `vencimento em ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export async function createPrazo(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const parsed = prazoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const dataFim = resolveDataFim(v);

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("prazos")
    .insert({ ...toRecord(v, dataFim), processo_id: v.processo_id ?? null, responsavel_id: v.responsavel_id ?? g.session.userId })
    .select(ROW_COLS)
    .single<PrazoRow>();
  if (error) {
    if (error.code === "42501") return { error: "Você não tem permissão para cadastrar prazos neste processo/departamento." };
    return dbError(error);
  }
  revalidate([row.processo_id]);
  return { ok: true, message: `Prazo cadastrado — ${dueMsg(row.data_fim)}.`, id: row.id };
}

export async function updatePrazo(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Prazo inválido." };
  const parsed = prazoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: before } = await supabase.from("prazos").select(ROW_COLS).eq("id", id).maybeSingle<PrazoRow>();
  if (!before) return { error: "Prazo não encontrado ou sem acesso." };

  const dataFim = resolveDataFim(v, before);
  // Sem o campo "processo_id" no formulário (ex.: aba do processo), mantém o vínculo atual.
  const processoId = formData.has("processo_id") ? (v.processo_id ?? null) : before.processo_id;
  const update: Record<string, unknown> = { ...toRecord(v, dataFim), processo_id: processoId };
  if (v.responsavel_id) update.responsavel_id = v.responsavel_id;

  const { data: row, error } = await supabase.from("prazos").update(update).eq("id", id).select(ROW_COLS).maybeSingle<PrazoRow>();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para editar este prazo." };
  revalidate([before.processo_id, row.processo_id]);
  return { ok: true, message: `Prazo atualizado — ${dueMsg(row.data_fim)}.`, id: row.id };
}

export async function setPrazoStatus(id: string, status: string): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Prazo inválido." };
  const parsed = z.enum(STATUS).safeParse(status);
  if (!parsed.success) return { error: "Status inválido." };

  const supabase = await createClient();
  // cumprido_em é preenchido/limpo pelo trigger prazo_cumprimento
  const { data: row, error } = await supabase.from("prazos").update({ status: parsed.data }).eq("id", id).select(ROW_COLS).maybeSingle<PrazoRow>();
  if (error) return dbError(error);
  if (!row) return { error: "Você não tem permissão para alterar este prazo." };
  revalidate([row.processo_id]);
  const message = {
    pendente: "Prazo reaberto.",
    cumprido: "Prazo marcado como cumprido.",
    perdido: "Prazo marcado como perdido.",
    cancelado: "Prazo cancelado.",
  }[row.status];
  return { ok: true, message, id: row.id };
}

export async function deletePrazo(id: string): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Prazo inválido." };
  const supabase = await createClient();
  const { data: row } = await supabase.from("prazos").select(ROW_COLS).eq("id", id).maybeSingle<PrazoRow>();
  if (!row) return { error: "Prazo não encontrado ou sem acesso." };
  const { error, count } = await supabase.from("prazos").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Somente quem cadastrou o prazo ou a gestão pode excluí-lo." };
  revalidate([row.processo_id]);
  return { ok: true, message: "Prazo excluído." };
}
