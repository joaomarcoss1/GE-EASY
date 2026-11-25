"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { detectarTipoArquivo } from "@/lib/seguranca/arquivos";
import { can } from "@/lib/rbac";
import { beneficioDoTipo, CASO_STATUS } from "@/lib/constants";
import { dbError, formToObject, guard, isUuid, zodErrors, zs } from "./utils";
import type { ActionState } from "./types";

/**
 * Folha de Acompanhamento de Pendências. Quem cuida das pendências abre a ficha do processo, anota com data o que
 * falta e o retorno do cliente e, ao encerrar, define o destino (análise, habilitado, exigência ou outro), assina
 * e encaminha. O status do processo muda com a sessão de quem encerrou (o histórico e as metas contam para ela).
 */
const PERM = "processos.status_restritos" as const;
const BENEFICIOS = ["aux_doenca", "bpc", "aposentadoria", "sal_maternidade", "pensao", "outro"] as const;
const SEGURADOS = ["rural", "pescador", "urbano"] as const;
const OUTROS_STATUS = CASO_STATUS.map((s) => s.value).filter((s) => !["pendencia", "em_analise", "habilitado", "exigencia"].includes(s)) as [string, ...string[]];

function atualizar(fichaId?: string, clienteId?: string | null) {
  revalidatePath("/administrativo/pendencias");
  if (fichaId) revalidatePath(`/administrativo/pendencias/${fichaId}`);
  revalidatePath("/administrativo/processos");
  revalidatePath("/dashboard");
  if (clienteId) revalidatePath(`/clientes/${clienteId}`);
}

/** Abre (ou retoma) a ficha do processo e leva para ela. Usada como ação de formulário. */
export async function abrirFicha(formData: FormData): Promise<void> {
  const g = await guard(PERM);
  if ("denied" in g) redirect("/administrativo/pendencias?erro=permissao");
  const casoId = formData.get("caso_id");
  if (!isUuid(casoId)) redirect("/administrativo/pendencias");
  const supabase = await createClient();
  const { data: aberta } = await supabase.from("fichas_pendencia").select("id").eq("caso_id", casoId).eq("status", "aberta").maybeSingle();
  if (aberta) redirect(`/administrativo/pendencias/${aberta.id}`);
  const { data: caso } = await supabase.from("cliente_casos").select("id, tipo, cliente_id").eq("id", casoId).maybeSingle();
  if (!caso) redirect("/administrativo/pendencias?erro=processo");
  const { data, error } = await supabase
    .from("fichas_pendencia")
    .insert({ caso_id: caso.id, beneficio: beneficioDoTipo(caso.tipo), responsavel_id: g.session.userId })
    .select("id")
    .single();
  if (error || !data) {
    // corrida: outra aba abriu a ficha ao mesmo tempo
    const { data: outra } = await supabase.from("fichas_pendencia").select("id").eq("caso_id", casoId).eq("status", "aberta").maybeSingle();
    if (outra) redirect(`/administrativo/pendencias/${outra.id}`);
    redirect("/administrativo/pendencias?erro=abrir");
  }
  atualizar(data.id, caso.cliente_id);
  redirect(`/administrativo/pendencias/${data.id}`);
}

const cabecalhoSchema = z.object({
  id: zs.requiredUuid("a ficha"),
  beneficio: z.enum(BENEFICIOS).nullable().optional().or(z.literal("").transform(() => null)),
  segurado: z.enum(SEGURADOS).nullable().optional().or(z.literal("").transform(() => null)),
  recebida_em: zs.date(),
});

/** Cabeçalho da ficha: benefício, tipo de segurado e data em que a análise foi recebida. */
export async function salvarCabecalhoFicha(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard(PERM);
  if ("denied" in g) return g.denied;
  const v = cabecalhoSchema.safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  const supabase = await createClient();
  const { id, ...row } = v.data;
  const { data, error } = await supabase
    .from("fichas_pendencia")
    .update({ beneficio: row.beneficio ?? null, segurado: row.segurado ?? null, ...(row.recebida_em ? { recebida_em: row.recebida_em } : {}) })
    .eq("id", id)
    .eq("status", "aberta")
    .select("id, cliente_id");
  if (error) return dbError(error);
  if (!data?.length) return { error: "Ficha não encontrada ou já encerrada." };
  atualizar(id, data[0].cliente_id);
  return { ok: true, message: "Ficha atualizada." };
}

const itemSchema = z.object({
  ficha_id: zs.requiredUuid("a ficha"),
  secao: z.enum(["pendencia", "retorno"]),
  data: zs.date(),
  texto: z.string().trim().min(2, "Descreva a anotação").max(2000),
  prazo: zs.date(),
});

/** Nova anotação (linha da seção 1 ou 2). Toda anotação tem data. */
export async function adicionarItemFicha(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard(PERM);
  if ("denied" in g) return g.denied;
  const v = itemSchema.safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  const hoje = new Date().toISOString().slice(0, 10);
  if (v.data.data && v.data.data > hoje) return { error: "A data da anotação não pode ser futura.", fieldErrors: { data: "Data futura" } };
  const supabase = await createClient();
  const { error } = await supabase.from("ficha_pendencia_itens").insert({
    ficha_id: v.data.ficha_id,
    secao: v.data.secao,
    data: v.data.data ?? hoje,
    texto: v.data.texto,
    prazo: v.data.secao === "pendencia" ? v.data.prazo : null,
    criado_por: g.session.userId,
  });
  if (error) return error.message?.includes("encerrada") ? { error: error.message } : dbError(error);
  atualizar(v.data.ficha_id);
  return { ok: true, message: "Anotação registrada." };
}

/** Marca/desmarca uma pendência como resolvida (o texto da anotação não muda). */
export async function marcarPendenciaResolvida(itemId: string, resolvida: boolean): Promise<ActionState> {
  const g = await guard(PERM);
  if ("denied" in g) return g.denied;
  if (!isUuid(itemId)) return { error: "Anotação inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("ficha_pendencia_itens").update({ resolvida: !!resolvida }).eq("id", itemId).select("ficha_id");
  if (error) return error.message?.includes("encerrada") ? { error: error.message } : dbError(error);
  if (!data?.length) return { error: "Anotação não encontrada." };
  atualizar(data[0].ficha_id);
  return { ok: true };
}

/** Remove uma anotação escrita por engano (só quem escreveu, só com a ficha aberta). */
export async function excluirItemFicha(id: string): Promise<ActionState> {
  const g = await guard(PERM);
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Anotação inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("ficha_pendencia_itens").delete().eq("id", id).select("ficha_id");
  if (error) return error.message?.includes("encerrada") ? { error: error.message } : dbError(error);
  if (!data?.length) return { error: "Só quem escreveu a anotação pode apagá-la." };
  atualizar(data[0].ficha_id);
  return { ok: true, message: "Anotação removida." };
}

const encerrarSchema = z.object({
  id: zs.requiredUuid("a ficha"),
  destino: z.enum(["analise", "habilitado", "exigencia", "outro"], { error: "Escolha o destino do processo" }),
  encaminhado_para: zs.uuid(),
  protocolo_inss: zs.text(40),
  situacao_atual: zs.text(300),
  outro_status: z.enum(OUTROS_STATUS).optional().or(z.literal("").transform(() => undefined)),
  destino_outro: zs.text(120),
});

/**
 * Seção 3: destino do processo + assinatura. Muda o status do processo, encerra a ficha (que fica imutável) e
 * avisa quem recebe (a analista escolhida ou o setor de destino).
 */
export async function encerrarFicha(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard(PERM);
  if ("denied" in g) return g.denied;
  if (!can(g.session.profile, "clientes.write")) return { error: "Você não tem permissão para alterar processos." };
  const v = encerrarSchema.safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  const d = v.data;
  if (d.destino === "analise" && !d.encaminhado_para) return { error: "Escolha a analista que vai receber o processo.", fieldErrors: { encaminhado_para: "Obrigatório" } };
  if (d.destino === "habilitado" && (!d.protocolo_inss || !d.situacao_atual)) {
    return { error: "Para habilitar, informe o protocolo do INSS e o estado atual.", fieldErrors: { ...(d.protocolo_inss ? {} : { protocolo_inss: "Obrigatório" }), ...(d.situacao_atual ? {} : { situacao_atual: "Obrigatório" }) } };
  }
  if (d.destino === "outro" && !d.outro_status) return { error: "Escolha a nova situação do processo.", fieldErrors: { outro_status: "Obrigatório" } };

  const arq = formData.get("assinatura");
  if (!(arq instanceof File) || !arq.size || arq.size > 2 * 1024 * 1024 || arq.type !== "image/png") return { error: "Assine no quadro antes de encerrar." };
  const bytes = new Uint8Array(await arq.arrayBuffer());
  if (!detectarTipoArquivo(bytes, "image/png")) return { error: "Assinatura inválida." };

  const supabase = await createClient();
  const { data: ficha } = await supabase.from("fichas_pendencia").select("id, caso_id, cliente_id, status").eq("id", d.id).maybeSingle();
  if (!ficha) return { error: "Ficha não encontrada." };
  if (ficha.status !== "aberta") return { error: "Esta ficha já foi encerrada." };
  const { count } = await supabase.from("ficha_pendencia_itens").select("id", { count: "exact", head: true }).eq("ficha_id", ficha.id).eq("secao", "pendencia");
  if (!count) return { error: "Registre ao menos uma pendência (seção 1) antes de encerrar." };

  const novoStatus = d.destino === "analise" ? "em_analise" : d.destino === "outro" ? d.outro_status! : d.destino;
  const caminho = `empresas/${g.session.empresa!.id}/clientes/${ficha.cliente_id}/fichas-pendencia/${ficha.id}-assinatura.png`;
  const { error: upErr } = await supabase.storage.from("documentos").upload(caminho, bytes, { contentType: "image/png", upsert: true });
  if (upErr) return { error: "Não foi possível guardar a assinatura." };

  // 1) processo muda de situação (com a sessão de quem encerra: histórico e metas)
  const patch: Record<string, unknown> = { status: novoStatus };
  if (d.destino === "habilitado") {
    patch.protocolo_inss = d.protocolo_inss;
    patch.situacao_atual = d.situacao_atual;
  }
  const { error: casoErr } = await supabase.from("cliente_casos").update(patch).eq("id", ficha.caso_id);
  if (casoErr) {
    await supabase.storage.from("documentos").remove([caminho]);
    return casoErr.code === "23514" && casoErr.message ? { error: casoErr.message } : dbError(casoErr);
  }

  // 2) ficha encerrada (imutável a partir daqui)
  const { error } = await supabase
    .from("fichas_pendencia")
    .update({
      status: "encerrada",
      destino: d.destino,
      destino_status: novoStatus,
      destino_outro: d.destino === "outro" ? d.destino_outro : null,
      encaminhado_para: d.destino === "analise" ? d.encaminhado_para : null,
      assinatura_path: caminho,
    })
    .eq("id", ficha.id)
    .eq("status", "aberta");
  if (error) return dbError(error);

  // 3) aviso para quem recebe
  await supabase.rpc("notificar_ficha_encaminhada", { p_ficha: ficha.id });
  atualizar(ficha.id, ficha.cliente_id);
  const rotulo = d.destino === "analise" ? "enviado para análise" : d.destino === "habilitado" ? "habilitado" : d.destino === "exigencia" ? "enviado para exigência" : "atualizado";
  return { ok: true, message: `Ficha encerrada. Processo ${rotulo}.` };
}
