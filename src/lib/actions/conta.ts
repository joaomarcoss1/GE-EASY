"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { detectarTipoArquivo } from "@/lib/seguranca/arquivos";
import { corValida } from "@/lib/marca";
import { parseCsv } from "@/lib/csv";
import { isValidCNPJ, isValidCPF } from "@/lib/validators";
import { onlyDigits } from "@/lib/format";
import { asaasConfigurado, criarAssinaturaAsaas, criarClienteAsaas, linkPagamentoPendente, trocarPlanoAsaas } from "@/lib/integracoes/asaas";
import { adicionarDominio, removerDominio, vercelConfigurado, verificarDominio } from "@/lib/integracoes/vercel";
import { can } from "@/lib/rbac";
import { dbError, formToObject, guard, isUuid, limitar, registrarAcesso, zodErrors } from "./utils";
import type { ActionState } from "./types";

/**
 * Conta da empresa (fase 10), do administrador master da empresa ativa: assinatura, marca, domínio próprio,
 * exclusão agendada (LGPD), autorização do suporte; e a importação de clientes. O banco repete as travas.
 */
const erroDb = (e: { code?: string; message?: string }): ActionState =>
  (e.code === "P0001" || e.code === "23505" || (e.code === "42501" && e.message && !e.message.startsWith("new row"))) && e.message ? { error: e.message } : dbError(e);

async function master() {
  const g = await guard();
  if ("denied" in g) return g;
  if (!g.session.profile.admin_master) return { denied: { error: "Somente o administrador master da empresa." } as ActionState };
  return g;
}
const atualizar = () => revalidatePath("/configuracoes");

// ------------------------------------------------------------------ assinatura
export async function assinarPlano(plano: string): Promise<ActionState & { url?: string }> {
  const g = await master();
  if ("denied" in g) return g.denied;
  if (!asaasConfigurado() || !hasServiceRole()) return { error: "A cobrança online ainda não está configurada. Fale com o suporte para contratar." };
  const empresa = g.session.empresa!;
  const admin = createAdminClient();
  const [{ data: pl }, { data: emp }, { data: ass }] = await Promise.all([
    admin.from("planos").select("codigo, nome, preco_mensal").eq("codigo", plano).eq("ativo", true).eq("publico", true).maybeSingle(),
    admin.from("empresas").select("nome, cnpj").eq("id", empresa.id).single(),
    admin.from("assinaturas").select("asaas_customer_id, asaas_subscription_id, status").eq("empresa_id", empresa.id).maybeSingle(),
  ]);
  if (!pl) return { error: "Plano indisponível." };
  const doc = onlyDigits(emp?.cnpj as string | null);
  if (!doc || !(isValidCNPJ(doc) || isValidCPF(doc))) return { error: "Cadastre o CNPJ da empresa (Configurações › Empresa) antes de assinar." };
  try {
    const descricao = `GE EASY — plano ${pl.nome}`;
    if (ass?.asaas_subscription_id) {
      await trocarPlanoAsaas(ass.asaas_subscription_id as string, Number(pl.preco_mensal), descricao);
      await admin.rpc("registrar_assinatura_asaas", { p_empresa: empresa.id, p_plano: pl.codigo, p_customer: ass.asaas_customer_id, p_subscription: ass.asaas_subscription_id, p_valor: pl.preco_mensal, p_vencimento: null });
      await registrarAcesso("INTEGRACAO", "assinaturas", empresa.id, { acao: "troca_plano", plano: pl.codigo });
      atualizar();
      return { ok: true, message: `Plano alterado para ${pl.nome}. O valor vale a partir da próxima cobrança.` };
    }
    const customer = (ass?.asaas_customer_id as string | null) ?? (await criarClienteAsaas(emp!.nome as string, doc, g.session.profile.email ?? null, empresa.id));
    const venc = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    const s = await criarAssinaturaAsaas(customer, Number(pl.preco_mensal), venc, descricao, empresa.id);
    await admin.rpc("registrar_assinatura_asaas", { p_empresa: empresa.id, p_plano: pl.codigo, p_customer: customer, p_subscription: s.id, p_valor: pl.preco_mensal, p_vencimento: venc });
    await registrarAcesso("INTEGRACAO", "assinaturas", empresa.id, { acao: "assinatura", plano: pl.codigo });
    atualizar();
    return { ok: true, url: s.linkPagamento ?? undefined, message: "Assinatura criada. Pague a primeira cobrança para ativar." };
  } catch (e) {
    console.error("[asaas]", e instanceof Error ? e.message : e);
    return { error: "Não foi possível criar a cobrança agora. Tente novamente em instantes." };
  }
}

export async function linkPagamento(): Promise<ActionState & { url?: string }> {
  const g = await master();
  if ("denied" in g) return g.denied;
  if (!asaasConfigurado() || !hasServiceRole()) return { error: "Cobrança online não configurada." };
  const { data: ass } = await createAdminClient().from("assinaturas").select("asaas_subscription_id").eq("empresa_id", g.session.empresa!.id).maybeSingle();
  if (!ass?.asaas_subscription_id) return { error: "Nenhuma assinatura." };
  const url = await linkPagamentoPendente(ass.asaas_subscription_id as string).catch(() => null);
  return url ? { ok: true, url } : { error: "Nenhuma cobrança em aberto." };
}

// ------------------------------------------------------------------ marca
const LOGO_MIMES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function salvarMarca(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  const cor = String(formData.get("cor") ?? "").trim();
  if (cor && !corValida(cor)) return { error: "Cor inválida (use #RRGGBB).", fieldErrors: { cor: "Formato #RRGGBB" } };
  const empresaId = g.session.empresa!.id;
  const supabase = await createClient();
  const { data: atual } = await supabase.from("empresas").select("marca").eq("id", empresaId).single();
  const marca: Record<string, unknown> = { ...((atual?.marca as Record<string, unknown> | null) ?? {}), cor: cor || null };
  if (formData.get("remover_logo") === "on") marca.logo_url = null;
  const file = formData.get("logo");
  if (file instanceof File && file.size) {
    if (!hasServiceRole()) return { error: "Armazenamento indisponível." };
    if (file.size > 512 * 1024 || !LOGO_MIMES[file.type]) return { error: "Logo em PNG, JPG ou WEBP de até 512 KB (SVG não é aceito por segurança)." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!detectarTipoArquivo(bytes, file.type)) return { error: "O conteúdo do arquivo não é uma imagem válida." };
    const path = `${empresaId}/logo-${crypto.randomUUID()}.${LOGO_MIMES[file.type]}`;
    const admin = createAdminClient();
    const { error } = await admin.storage.from("marcas").upload(path, bytes, { contentType: file.type, cacheControl: "31536000" });
    if (error) return { error: "Não foi possível guardar o logo." };
    marca.logo_url = admin.storage.from("marcas").getPublicUrl(path).data.publicUrl;
  }
  const { error } = await supabase.from("empresas").update({ marca }).eq("id", empresaId);
  if (error) return erroDb(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Marca atualizada." };
}

// ------------------------------------------------------------------ domínio próprio
export async function salvarDominio(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  const dominio = String(formData.get("dominio") ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const supabase = await createClient();
  const empresaId = g.session.empresa!.id;
  const { data: antes } = await supabase.from("empresas").select("dominio").eq("id", empresaId).single();
  const { error } = await supabase.rpc("definir_dominio", { p_dominio: dominio });
  if (error) return erroDb(error);
  if (vercelConfigurado() && hasServiceRole()) {
    const admin = createAdminClient();
    try {
      if (antes?.dominio && antes.dominio !== dominio) await removerDominio(antes.dominio as string);
      if (dominio) {
        const d = await adicionarDominio(dominio);
        await admin.from("empresas").update({ dominio_info: d, dominio_status: d.verified ? "verificado" : "pendente" }).eq("id", empresaId);
      }
    } catch (e) {
      await admin.from("empresas").update({ dominio_status: "erro", dominio_info: { erro: e instanceof Error ? e.message : String(e) } }).eq("id", empresaId);
      atualizar();
      return { error: "Domínio salvo, mas o registro na hospedagem falhou. Tente verificar de novo em alguns minutos." };
    }
  }
  atualizar();
  return { ok: true, message: dominio ? "Domínio registrado. Configure o DNS conforme as instruções e clique em Verificar." : "Domínio removido." };
}

export async function verificarDominioEmpresa(): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  if (!vercelConfigurado() || !hasServiceRole()) return { error: "Verificação automática não configurada (VERCEL_API_TOKEN)." };
  const admin = createAdminClient();
  const { data: e } = await admin.from("empresas").select("dominio").eq("id", g.session.empresa!.id).single();
  if (!e?.dominio) return { error: "Nenhum domínio cadastrado." };
  try {
    const d = await verificarDominio(e.dominio as string);
    const ok = d.verified && d.configurado;
    await admin.from("empresas").update({ dominio_info: d, dominio_status: ok ? "verificado" : "pendente" }).eq("id", g.session.empresa!.id);
    atualizar();
    return ok ? { ok: true, message: "Domínio verificado e ativo." } : { error: "O DNS ainda não aponta para o sistema. A propagação pode levar algumas horas." };
  } catch {
    return { error: "Não foi possível consultar o domínio agora." };
  }
}

// ------------------------------------------------------------------ LGPD
export async function agendarExclusao(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("agendar_exclusao_empresa", { p_confirmacao: String(formData.get("confirmacao") ?? "") });
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: `Exclusão agendada para ${new Date(data as string).toLocaleDateString("pt-BR")}. Pode ser cancelada até lá.` };
}

export async function cancelarExclusao(): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancelar_exclusao_empresa");
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: "Exclusão cancelada." };
}

// ------------------------------------------------------------------ suporte
export async function decidirSuporte(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await master();
  if ("denied" in g) return g.denied;
  const v = z.object({ id: z.string().uuid(), decisao: z.enum(["autorizar", "recusar"]), horas: z.coerce.number().int().min(1).max(72).default(24) }).safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("decidir_suporte", { p_id: v.data.id, p_autorizar: v.data.decisao === "autorizar", p_horas: v.data.horas });
  if (error) return erroDb(error);
  atualizar();
  return { ok: true, message: v.data.decisao === "autorizar" ? `Suporte autorizado por ${v.data.horas} h. Tudo o que for feito fica na auditoria.` : "Pedido recusado." };
}

export async function encerrarSuporte(id: string): Promise<ActionState> {
  const g = await guard();
  if ("denied" in g) return g.denied;
  if (!isUuid(id)) return { error: "Pedido inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("encerrar_suporte", { p_id: id });
  if (error) return erroDb(error);
  atualizar();
  revalidatePath("/plataforma");
  return { ok: true, message: "Acesso do suporte encerrado." };
}

/** Plataforma: pede acesso temporário a uma empresa (o admin master autoriza). */
export async function solicitarSuporte(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session?.plataformaAdmin) return { error: "Somente a equipe da plataforma." };
  const v = z.object({ empresa_id: z.string().uuid(), motivo: z.string().trim().min(5, "Explique o motivo").max(1000) }).safeParse(formToObject(formData));
  if (!v.success) return zodErrors(v.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("solicitar_suporte", { p_empresa: v.data.empresa_id, p_motivo: v.data.motivo });
  if (error) return erroDb(error);
  revalidatePath("/plataforma");
  return { ok: true, message: "Pedido enviado ao administrador master da empresa." };
}

// ------------------------------------------------------------------ importação de clientes (CSV)
const COLUNAS: Record<string, string> = {
  nome: "nome", "nome completo": "nome", cliente: "nome",
  cpf: "documento", cnpj: "documento", documento: "documento", "cpf/cnpj": "documento",
  telefone: "telefone", celular: "whatsapp", whatsapp: "whatsapp",
  email: "email", "e-mail": "email", cidade: "cidade", uf: "uf", estado: "uf", origem: "origem", observacoes: "observacoes", "observações": "observacoes",
};

export async function importarClientes(_: ActionState, formData: FormData): Promise<ActionState> {
  const g = await guard("clientes.write");
  if ("denied" in g) return g.denied;
  if (!can(g.session.profile, "clientes.ver_todos")) return { error: "Importação exige acesso à base de clientes." };
  const lim = await limitar("importar_clientes", 5, 3600);
  if (lim) return lim;
  const file = formData.get("arquivo");
  if (!(file instanceof File) || !file.size) return { error: "Escolha o arquivo CSV.", fieldErrors: { arquivo: "Obrigatório" } };
  if (file.size > 5 * 1024 * 1024) return { error: "O arquivo deve ter até 5 MB." };
  const linhas = parseCsv(new TextDecoder("utf-8").decode(await file.arrayBuffer()));
  if (linhas.length < 2) return { error: "O arquivo não tem linhas de dados." };
  const cab = linhas[0].map((h) => COLUNAS[h.trim().toLowerCase()] ?? null);
  if (!cab.includes("nome")) return { error: "A primeira linha precisa ter a coluna \"nome\" (e, se houver, cpf, telefone, whatsapp, email, cidade, uf, origem)." };
  const erros: string[] = [];
  const rows: Record<string, string | null>[] = [];
  const docs = new Set<string>();
  for (const [i, l] of linhas.slice(1, 5001).entries()) {
    if (l.every((c) => !c.trim())) continue;
    const r: Record<string, string | null> = {};
    cab.forEach((k, j) => {
      if (k) r[k] = (l[j] ?? "").trim().slice(0, 300) || null;
    });
    const n = i + 2;
    if (!r.nome || r.nome.length < 2) {
      erros.push(`linha ${n}: nome vazio`);
      continue;
    }
    if (r.documento) {
      const d = onlyDigits(r.documento);
      if (!(d.length === 11 ? isValidCPF(d) : d.length === 14 && isValidCNPJ(d))) {
        erros.push(`linha ${n}: CPF/CNPJ inválido`);
        continue;
      }
      if (docs.has(d)) {
        erros.push(`linha ${n}: documento repetido no arquivo`);
        continue;
      }
      docs.add(d);
      r.documento = d;
    }
    if (r.email && !z.string().email().safeParse(r.email).success) r.email = null;
    if (r.uf) r.uf = r.uf.slice(0, 2).toUpperCase();
    r.origem = r.origem ?? "importacao";
    rows.push(r);
  }
  const supabase = await createClient();
  const existentes = new Set<string>();
  const lista = [...docs];
  for (let i = 0; i < lista.length; i += 500) {
    const { data } = await supabase.from("clientes").select("documento").in("documento", lista.slice(i, i + 500));
    for (const c of data ?? []) existentes.add(c.documento as string);
  }
  const novos = rows.filter((r) => !r.documento || !existentes.has(r.documento));
  let inseridos = 0;
  for (let i = 0; i < novos.length; i += 200) {
    const { data, error } = await supabase.from("clientes").insert(novos.slice(i, i + 200)).select("id");
    if (error) {
      erros.push(`lote ${i / 200 + 1}: ${erroDb(error).error}`);
      continue;
    }
    inseridos += data?.length ?? 0;
  }
  await registrarAcesso("IMPORTACAO", "clientes", null, { arquivo: file.name.slice(0, 120), linhas: linhas.length - 1, inseridos, ja_existiam: rows.length - novos.length, erros: erros.length });
  revalidatePath("/clientes");
  revalidatePath("/administrativo/base");
  const resumo = `${inseridos} cliente(s) importado(s); ${rows.length - novos.length} já existiam (mesmo CPF/CNPJ); ${erros.length} linha(s) com erro.`;
  if (!inseridos && erros.length) return { error: `${resumo} ${erros.slice(0, 5).join("; ")}` };
  return { ok: true, message: erros.length ? `${resumo} Primeiros erros: ${erros.slice(0, 3).join("; ")}` : resumo };
}
