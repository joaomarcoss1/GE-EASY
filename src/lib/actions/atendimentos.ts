"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { onlyDigits, todayISO } from "@/lib/format";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

const STATUS = ["novo", "em_analise", "proposta_enviada", "contratado", "recusado", "arquivado"] as const;
const AREAS = ["civel", "consumidor", "trabalhista", "tributario", "previdenciario", "familia", "criminal", "administrativo", "empresarial", "bancario", "outro"] as const;

const atendSchema = z.object({
  nome_contato: zs.required("Nome", 200),
  telefone: zs.text(20),
  email: zs.text(160).refine((v) => !v || z.string().email().safeParse(v).success, "E-mail inválido"),
  canal: zs.enumOf(["presencial", "telefone", "whatsapp", "email", "videochamada", "indicacao", "site"]),
  data: z.string().trim().optional().transform((v) => (v ? new Date(`${v}:00-03:00`).toISOString() : new Date().toISOString())),
  area: zs.enumOf([...AREAS]),
  assunto: zs.required("Assunto", 250),
  relato: zs.text(10000),
  urgencia: zs.enumOf(["baixa", "media", "alta", "urgente"]),
  status: zs.enumOf([...STATUS]),
  valor_estimado: zs.money(),
  responsavel_id: zs.uuid(),
  departamento_id: zs.uuid(),
  cliente_id: zs.uuid(),
});

function revalidar() {
  revalidatePath("/atendimentos");
  revalidatePath("/dashboard");
}

export async function saveAtendimento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("atendimentos.view");
  if ("denied" in g) return g.denied;
  const parsed = atendSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = { ...parsed.data, telefone: parsed.data.telefone ? onlyDigits(parsed.data.telefone) : null, responsavel_id: parsed.data.responsavel_id ?? g.session.userId };
  const id = formData.get("id");
  const supabase = await createClient();
  const q = isUuid(id) ? supabase.from("atendimentos").update(v).eq("id", id) : supabase.from("atendimentos").insert(v);
  const { data, error } = await q.select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar este atendimento." };
  revalidar();
  return { ok: true, message: isUuid(id) ? "Atendimento atualizado." : "Atendimento registrado.", id: data.id };
}

export async function moverAtendimento(id: string, status: string, motivo?: string | null): Promise<ActionState> {
  const g = await guard("atendimentos.view");
  if ("denied" in g) return g.denied;
  if (!isUuid(id) || !(STATUS as readonly string[]).includes(status)) return { error: "Operação inválida." };
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "recusado") patch.motivo_recusa = (motivo ?? "").slice(0, 500) || null;
  const { data, error } = await supabase.from("atendimentos").update(patch).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para mover este atendimento." };
  revalidar();
  return { ok: true, message: "Atendimento atualizado." };
}

export async function deleteAtendimento(id: string): Promise<ActionState> {
  const g = await guard("processos.delete");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Atendimento inválido." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("atendimentos").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Somente a gestão pode excluir atendimentos." };
  revalidar();
  return { ok: true, message: "Atendimento excluído." };
}

const converterSchema = z.object({
  id: zs.requiredUuid("o atendimento"),
  documento: zs.text(20),
  criar_processo: zs.bool(),
  titulo_processo: zs.text(250),
  departamento_id: zs.uuid(),
  responsavel_id: zs.uuid(),
  criar_contrato: zs.bool(),
  tipo_contrato: z.union([z.enum(["fixo", "mensal", "exito", "por_ato", "hora", "misto"]), z.literal("")]).optional(),
  valor_contrato: zs.money(),
  percentual_exito: zs.number(0, 100),
});

/**
 * Converte o atendimento: cria (ou reaproveita) o cliente, opcionalmente o processo e o
 * contrato de honorários, e marca o atendimento como "contratado". Retorna o id para onde ir.
 */
export async function converterAtendimento(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("atendimentos.view");
  if ("denied" in g) return g.denied;
  const parsed = converterSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const role = g.session.profile.role;
  if (v.criar_processo && !can(role, "processos.write")) return { error: "Você não tem permissão para criar processos." };
  if (v.criar_contrato && !can(role, "contratos.write")) return { error: "Você não tem permissão para criar contratos." };

  const supabase = await createClient();
  const { data: a } = await supabase.from("atendimentos").select("*").eq("id", v.id).maybeSingle();
  if (!a) return { error: "Atendimento não encontrado." };

  let clienteId: string | null = a.cliente_id;
  if (!clienteId) {
    const doc = v.documento ? onlyDigits(v.documento) : null;
    if (doc) {
      const { data: existente } = await supabase.from("clientes").select("id").eq("documento", doc).maybeSingle();
      clienteId = existente?.id ?? null;
    }
    if (!clienteId) {
      const { data: novo, error } = await supabase
        .from("clientes")
        .insert({ nome: a.nome_contato, telefone: a.telefone, whatsapp: a.telefone, email: a.email, documento: doc, status: "ativo", origem: "Atendimento", tipo_pessoa: doc && doc.length === 14 ? "PJ" : "PF" })
        .select("id")
        .single();
      if (error) return error.code === "23505" ? { error: "Já existe um cliente com este CPF/CNPJ.", fieldErrors: { documento: "CPF/CNPJ já cadastrado" } } : dbError(error);
      clienteId = novo.id;
    }
  }

  let processoId: string | null = a.processo_id;
  if (v.criar_processo && !processoId) {
    const { data: proc, error } = await supabase
      .from("processos")
      .insert({
        titulo: v.titulo_processo || a.assunto,
        cliente_id: clienteId,
        area: a.area,
        fase: "pre_processual",
        status: "ativo",
        departamento_id: v.departamento_id ?? a.departamento_id,
        responsavel_id: v.responsavel_id ?? a.responsavel_id ?? g.session.userId,
        valor_causa: a.valor_estimado,
        observacoes: a.relato,
      })
      .select("id")
      .single();
    if (error) return error.code === "42501" ? { error: "Você só pode abrir processos nos departamentos de que participa." } : dbError(error);
    processoId = proc.id;
  }

  let contratoId: string | null = a.contrato_id;
  if (v.criar_contrato && !contratoId && v.tipo_contrato) {
    const { data: ct, error } = await supabase
      .from("contratos_honorarios")
      .insert({
        titulo: v.titulo_processo || a.assunto,
        cliente_id: clienteId,
        processo_id: processoId,
        tipo: v.tipo_contrato,
        valor_fixo: ["fixo", "misto"].includes(v.tipo_contrato) ? v.valor_contrato : null,
        valor_mensal: v.tipo_contrato === "mensal" ? v.valor_contrato : null,
        valor_hora: v.tipo_contrato === "hora" ? v.valor_contrato : null,
        percentual_exito: ["exito", "misto"].includes(v.tipo_contrato) ? v.percentual_exito : null,
        data_inicio: todayISO(),
        status: "ativo",
        responsavel_id: v.responsavel_id ?? g.session.userId,
        departamento_id: v.departamento_id ?? a.departamento_id,
      })
      .select("id")
      .single();
    if (error) return dbError(error);
    contratoId = ct.id;
  }

  const { error: errAt } = await supabase.from("atendimentos").update({ status: "contratado", cliente_id: clienteId, processo_id: processoId, contrato_id: contratoId }).eq("id", v.id);
  if (errAt) return dbError(errAt);
  revalidar();
  revalidatePath("/clientes");
  revalidatePath("/processos");
  const destino = processoId ? `/processos/${processoId}` : `/clientes/${clienteId}`;
  return { ok: true, message: "Atendimento convertido.", id: destino };
}
