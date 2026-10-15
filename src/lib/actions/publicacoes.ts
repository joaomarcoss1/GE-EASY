"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { calcularPrazo } from "@/lib/juridico/prazos";
import { dividirPublicacoes } from "@/lib/juridico/publicacoes";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

function revalidar(processoId?: string | null) {
  revalidatePath("/publicacoes");
  revalidatePath("/dashboard");
  if (processoId) revalidatePath(`/processos/${processoId}`);
}

const importSchema = z.object({
  texto: z.string().trim().min(5, "Cole o texto das publicações").max(500_000, "Texto muito grande (máx. 500 mil caracteres)"),
  fonte: zs.text(120),
  data_publicacao: zs.date().refine((v) => !!v, "Informe a data da publicação"),
  data_disponibilizacao: zs.date(),
});

/** Importa o texto colado do Diário: divide por processo, vincula pelo nº CNJ e ignora duplicadas. */
export async function importarPublicacoes(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const parsed = importSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { texto, fonte, data_publicacao, data_disponibilizacao } = parsed.data;
  const blocos = dividirPublicacoes(texto);
  if (!blocos.length) return { error: "Nenhuma publicação encontrada no texto.", fieldErrors: { texto: "Nenhuma publicação encontrada" } };

  const rows = blocos.map((b) => ({
    numero_processo: b.numero,
    conteudo: b.conteudo.slice(0, 50000),
    fonte,
    data_publicacao: data_publicacao!,
    data_disponibilizacao,
    hash: createHash("sha256").update(`${data_publicacao}|${b.conteudo.replace(/\s+/g, " ").toLowerCase()}`).digest("hex"),
  }));
  const supabase = await createClient();
  const { data, error } = await supabase.from("publicacoes").upsert(rows, { onConflict: "hash", ignoreDuplicates: true }).select("id, processo_id");
  if (error) return dbError(error);
  const inseridas = data?.length ?? 0;
  const vinculadas = (data ?? []).filter((d) => d.processo_id).length;
  revalidar();
  const dup = rows.length - inseridas;
  return {
    ok: true,
    message: `${inseridas} publicação(ões) importada(s), ${vinculadas} vinculada(s) automaticamente${dup ? ` · ${dup} já existente(s) ignorada(s)` : ""}.`,
  };
}

export async function vincularPublicacao(id: string, processoId: string): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id) || !isUuid(processoId)) return { error: "Seleção inválida." };
  const supabase = await createClient();
  const { data: proc } = await supabase.from("processos").select("id, responsavel_id, numero_cnj").eq("id", processoId).maybeSingle();
  if (!proc) return { error: "Processo não encontrado ou sem acesso." };
  const { data, error } = await supabase
    .from("publicacoes")
    .update({ processo_id: processoId, responsavel_id: proc.responsavel_id })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar esta publicação." };
  revalidar(processoId);
  return { ok: true, message: "Publicação vinculada e registrada nos andamentos do processo." };
}

export async function setPublicacaoStatus(id: string, status: "nova" | "tratada" | "descartada"): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  if (!isUuid(id) || !["nova", "tratada", "descartada"].includes(status)) return { error: "Operação inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("publicacoes").update({ status }).eq("id", id).select("processo_id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return { error: "Sem permissão para alterar esta publicação." };
  revalidar(data.processo_id);
  return { ok: true, message: status === "tratada" ? "Marcada como tratada." : status === "descartada" ? "Publicação descartada." : "Publicação reaberta." };
}

export async function marcarTratadasEmLote(ids: string[]): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const valid = ids.filter(isUuid).slice(0, 500);
  if (!valid.length) return { error: "Nenhuma publicação selecionada." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("publicacoes").update({ status: "tratada" }).in("id", valid).select("id");
  if (error) return dbError(error);
  revalidar();
  return { ok: true, message: `${data?.length ?? 0} publicação(ões) marcada(s) como tratada(s).` };
}

const prazoSchema = z.object({
  publicacao_id: zs.requiredUuid("a publicação"),
  descricao: zs.required("Descrição", 300),
  dias: zs.number(1, 365).refine((v) => v !== null, "Informe os dias"),
  contagem: zs.enumOf(["uteis", "corridos"]),
  responsavel_id: zs.uuid(),
  fatal: zs.bool(),
  prioridade: zs.enumOf(["baixa", "media", "alta", "urgente"]),
});

/** Gera o prazo processual a partir da publicação (CPC: exclui o dia do começo, conta dias úteis). */
export async function gerarPrazoDaPublicacao(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("processos.write");
  if ("denied" in g) return g.denied;
  const parsed = prazoSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  const { data: pub } = await supabase.from("publicacoes").select("id, processo_id, data_publicacao").eq("id", v.publicacao_id).maybeSingle();
  if (!pub) return { error: "Publicação não encontrada." };
  if (!pub.processo_id) return { error: "Vincule a publicação a um processo antes de gerar o prazo." };

  const { dataFim } = calcularPrazo(pub.data_publicacao, v.dias!, v.contagem as "uteis" | "corridos");
  const { data: prazo, error } = await supabase
    .from("prazos")
    .insert({
      processo_id: pub.processo_id,
      descricao: v.descricao,
      data_publicacao: pub.data_publicacao,
      dias: v.dias,
      contagem: v.contagem,
      data_fim: dataFim,
      fatal: v.fatal,
      prioridade: v.prioridade,
      responsavel_id: v.responsavel_id ?? g.session.userId,
    })
    .select("id")
    .single();
  if (error) return error.code === "42501" ? { error: "Sem permissão para criar prazos neste processo." } : dbError(error);
  await supabase.from("publicacoes").update({ prazo_id: prazo.id, status: "tratada" }).eq("id", pub.id);
  revalidatePath("/prazos");
  revalidar(pub.processo_id);
  const [y, m, d] = dataFim.split("-");
  return { ok: true, message: `Prazo criado: vence em ${d}/${m}/${y}.` };
}

export async function deletePublicacao(id: string): Promise<ActionState> {
  const g = await guard("processos.delete");
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Publicação inválida." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("publicacoes").delete({ count: "exact" }).eq("id", id);
  if (error) return dbError(error);
  if (!count) return { error: "Sem permissão para excluir." };
  revalidar();
  return { ok: true, message: "Publicação excluída." };
}
