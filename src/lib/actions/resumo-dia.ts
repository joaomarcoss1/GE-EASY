"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dbError, guard, limitar } from "./utils";
import type { ActionState } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (max: number) => z.number().int().min(0).max(max);
const texto = (max: number) => z.string().trim().max(max).transform((v) => (v ? v : null)).nullable().optional();

const ligacaoSchema = z.object({
  id: z.string().regex(UUID_RE),
  cliente_id: z.string().regex(UUID_RE).nullable().optional(),
  nome: z.string().trim().min(2, "Informe para quem ligou").max(160),
  telefone: z.string().trim().max(20).nullable().optional(),
  resultado: z.enum(["atendeu", "nao_atendeu", "agendou", "retornar", "fechou", "numero_errado"]),
  obs: z.string().trim().max(200).nullable().optional(),
});

const resumoSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  processos_novos: n(500),
  processos_trabalhados: n(1000),
  ligacoes: n(1000),
  visitas: n(200),
  documentos_coletados: n(500),
  pendencias_resolvidas: n(500),
  exigencias_cumpridas: n(500).default(0),
  ligacoes_detalhe: z.array(ligacaoSchema).max(200),
  avaliacao: z.enum(["otimo", "bom", "regular", "dificil"]).nullable().optional(),
  atividades: texto(1000),
  dificuldades: texto(1000),
  plano_amanha: texto(1000),
});
export type ResumoDiaInput = z.input<typeof resumoSchema>;

const RESULTADO: Record<string, string> = { atendeu: "atendeu", nao_atendeu: "não atendeu", agendou: "agendou", retornar: "pediu retorno", fechou: "fechou/cadastrou", numero_errado: "número errado" };

/**
 * Salva (ou corrige) o resumo do dia. As ligações feitas para clientes cadastrados entram no histórico do cliente
 * (uma única vez por ligação), e o total de ligações conta na meta do dia.
 */
export async function salvarResumoDia(input: ResumoDiaInput): Promise<ActionState> {
  const g = await guard("clientes.view");
  if ("denied" in g) return g.denied;
  const parsed = resumoSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Verifique os campos." };
  const limite = await limitar("resumo_dia", 30, 3600);
  if (limite) return limite;
  const v = parsed.data;
  const dados = { ...v, ligacoes: Math.max(v.ligacoes, v.ligacoes_detalhe.length), avaliacao: v.avaliacao ?? null };
  const supabase = await createClient();
  const { data: anterior } = await supabase.from("resumos_diarios").select("id, ligacoes_detalhe").eq("usuario_id", g.session.userId).eq("data", v.data).maybeSingle();
  const jaRegistradas = new Set(((anterior?.ligacoes_detalhe ?? []) as { id: string }[]).map((l) => l.id));
  const { error } = anterior
    ? await supabase.from("resumos_diarios").update(dados).eq("id", anterior.id)
    : await supabase.from("resumos_diarios").insert({ ...dados, usuario_id: g.session.userId });
  if (error) return error.code === "23514" && error.message ? { error: error.message } : dbError(error);

  // histórico do cliente: só as ligações novas e para clientes cadastrados (o RLS confere o acesso)
  const novas = v.ligacoes_detalhe.filter((l) => l.cliente_id && !jaRegistradas.has(l.id));
  if (novas.length) {
    const { error: e2 } = await supabase.from("interacoes").insert(
      novas.map((l) => ({ cliente_id: l.cliente_id!, tipo: "ligacao", autor_id: g.session.userId, descricao: `Ligação (resumo do dia): ${RESULTADO[l.resultado]}${l.obs ? ` — ${l.obs}` : ""}` })),
    );
    if (e2) console.error("[resumo-dia] histórico", e2.code, e2.message);
  }
  revalidatePath("/comercial/meu-resumo");
  revalidatePath("/comercial/resumo-diario");
  revalidatePath("/metas/processos");
  revalidatePath("/dashboard");
  return { ok: true, message: anterior ? "Resumo do dia atualizado." : "Resumo do dia enviado. Obrigado!" };
}
