"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dbError, formToObject, guard, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

/** Relatório mensal geral (fase 9): geração sob demanda e parâmetros do ranking/alertas/destinatários. */
const erroDb = (e: { code?: string; message?: string }): ActionState =>
  (e.code === "P0001" || (e.code === "42501" && e.message && !e.message.startsWith("new row"))) && e.message ? { error: e.message } : dbError(e);

export async function gerarRelatorioMensal(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("relatorios.view");
  if ("denied" in g) return g.denied;
  const v = z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/, "Use AAAA-MM") }).safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gerar_relatorio_mensal", { p_empresa: g.session.empresa!.id, p_competencia: `${v.data.competencia}-01`, p_automatico: false });
  if (error) return erroDb(error);
  revalidatePath("/relatorios/mensal");
  return { ok: true, id: data as string, message: "Relatório gerado." };
}

const peso = () => zs.number(-100, 100);
const paramSchema = z.object({
  clientes_novos: peso(), vendas_aprovadas: peso(), paradas_visitadas: peso(), leads_convertidos: peso(), checkins_fora_raio: peso(), transferidos_45: peso(),
  limite_fora_raio_pct: zs.number(1, 100),
  fator_custo_cliente: zs.number(1, 10),
  destinatarios: zs.text(2000),
});

export async function salvarParametrosRelatorios(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("relatorios.view");
  if ("denied" in g) return g.denied;
  const parsed = paramSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { limite_fora_raio_pct, fator_custo_cliente, destinatarios, ...pesos } = parsed.data;
  const emails = (destinatarios ?? "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const invalido = emails.find((e) => !z.string().email().safeParse(e).success);
  if (invalido) return { error: `E-mail inválido: ${invalido}`, fieldErrors: { destinatarios: "Revise os e-mails" } };
  const valor = {
    pesos: Object.fromEntries(Object.entries(pesos).map(([k, v]) => [k, v ?? 0])),
    limite_fora_raio_pct: limite_fora_raio_pct ?? 20,
    fator_custo_cliente: fator_custo_cliente ?? 2,
    destinatarios: emails.slice(0, 20),
  };
  const supabase = await createClient();
  const { error } = await supabase.from("configuracoes").upsert({ chave: "relatorios", valor, updated_by: g.session.userId }, { onConflict: "empresa_id,chave" });
  if (error) return error.code === "42501" ? { error: "Somente a gestão altera os parâmetros do relatório." } : dbError(error);
  revalidatePath("/relatorios/mensal");
  return { ok: true, message: "Parâmetros salvos; valem a partir do próximo relatório gerado." };
}
