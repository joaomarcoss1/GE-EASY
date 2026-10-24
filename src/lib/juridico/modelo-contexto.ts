import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderModelo, renderTexto, type MergeContext } from "@/lib/juridico/merge";
import type { Cliente, ContratoHonorarios, ModeloDocumento, Processo, Profile } from "@/lib/types";
import { descricaoHonorarios } from "@/components/financeiro/fields";

interface IdsModelo {
  modeloId: string | null;
  clienteId: string | null;
  processoId: string | null;
  contratoId: string | null;
}

/**
 * Carrega (com a sessão do usuário — RLS) os dados do modelo e monta o documento.
 * Usado na pré-visualização e ao salvar no Drive: o HTML é sempre gerado no servidor.
 */
export async function montarDocumentoModelo(supabase: SupabaseClient, usuarioId: string, ids: IdsModelo) {
  let { clienteId, processoId } = ids;
  const { data: contrato } = ids.contratoId
    ? await supabase.from("contratos_honorarios").select("*").eq("id", ids.contratoId).maybeSingle<ContratoHonorarios>()
    : { data: null };
  if (contrato) {
    clienteId = clienteId ?? contrato.cliente_id;
    processoId = processoId ?? contrato.processo_id;
  }
  const { data: processo } = processoId ? await supabase.from("processos").select("*").eq("id", processoId).maybeSingle<Processo>() : { data: null };
  if (processo && !clienteId) clienteId = processo.cliente_id;

  const [{ data: modelo }, { data: cliente }, { data: resp }, { data: empresaCfg }] = await Promise.all([
    ids.modeloId ? supabase.from("modelos_documentos").select("*").eq("id", ids.modeloId).maybeSingle<ModeloDocumento>() : Promise.resolve({ data: null }),
    clienteId ? supabase.from("clientes").select("*").eq("id", clienteId).maybeSingle<Cliente>() : Promise.resolve({ data: null }),
    supabase
      .from("profiles")
      .select("full_name, oab, email")
      .eq("id", processo?.responsavel_id ?? contrato?.responsavel_id ?? usuarioId)
      .maybeSingle<Pick<Profile, "full_name" | "oab" | "email">>(),
    supabase.from("configuracoes").select("valor").eq("chave", "empresa").maybeSingle(),
  ]);
  const empresa = (empresaCfg?.valor ?? {}) as Record<string, string | null>;
  const ctx: MergeContext = {
    cliente,
    processo,
    responsavel: resp ? { nome: resp.full_name, oab: resp.oab, email: resp.email } : null,
    escritorio: { nome: empresa.nome, cnpj: empresa.cnpj, endereco: empresa.endereco, telefone: empresa.telefone, email: empresa.email },
    contrato: contrato ? { descricao_honorarios: descricaoHonorarios(contrato), numero: contrato.numero, titulo: contrato.titulo } : null,
  };
  const rendered = modelo ? renderModelo(modelo.conteudo, ctx) : null;
  const texto = modelo ? renderTexto(modelo.conteudo, ctx) : "";
  return { modelo, cliente, processo, contrato, empresa, rendered, texto, clienteId, processoId };
}
