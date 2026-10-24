import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DATAJUD_CHAVE_PUBLICA, datajudBody, datajudUrl, normalizarDatajud, type DjResposta, type ProcessoDatajud } from "@/lib/juridico/datajud";
import { isValidCNJ } from "@/lib/juridico/cnj";

type StatusDatajud = "ok" | "nao_encontrado" | "erro" | "indisponivel";
interface ResultadoDatajud {
  status: StatusDatajud;
  novos: number;
  mensagem: string;
}

type Consulta = { ok: true; dados: ProcessoDatajud | null } | { ok: false; status: StatusDatajud; mensagem: string };

/** Consulta a API pública do DataJud (sem dados do usuário: só o número do processo). */
async function consultarDatajud(cnj: string): Promise<Consulta> {
  if (!isValidCNJ(cnj)) return { ok: false, status: "erro", mensagem: "Número CNJ inválido." };
  const url = datajudUrl(cnj);
  if (!url) return { ok: false, status: "indisponivel", mensagem: "Este tribunal não está disponível na API pública do DataJud." };
  const chave = process.env.DATAJUD_API_KEY || DATAJUD_CHAVE_PUBLICA;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `APIKey ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify(datajudBody(cnj)),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, status: "erro", mensagem: "O DataJud não respondeu (tempo esgotado). Tente mais tarde." };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, status: "erro", mensagem: "O DataJud recusou a chave de acesso. Atualize DATAJUD_API_KEY com a chave pública vigente do CNJ." };
  if (res.status === 429) return { ok: false, status: "erro", mensagem: "Limite de consultas do DataJud atingido. Tente novamente em alguns minutos." };
  if (!res.ok) return { ok: false, status: "erro", mensagem: `O DataJud retornou erro ${res.status}.` };
  try {
    return { ok: true, dados: normalizarDatajud((await res.json()) as DjResposta) };
  } catch {
    return { ok: false, status: "erro", mensagem: "Resposta inválida do DataJud." };
  }
}

interface ProcRow {
  id: string;
  titulo: string;
  numero_cnj: string | null;
  classe: string | null;
  assunto: string | null;
  orgao: string | null;
  tribunal: string | null;
  data_distribuicao: string | null;
  datajud_sincronizado_em: string | null;
  datajud_atualizado_em: string | null;
  responsavel_id: string | null;
  equipe: string[] | null;
  empresa_id: string;
}

/**
 * Sincroniza um processo: completa dados cadastrais vazios e grava movimentos novos como andamentos.
 * `db` pode ser o cliente do usuário (RLS: só processos que ele edita) ou o service role (rotina agendada).
 * Com `notificarDireto`, grava as notificações pelo próprio `db` (service role); caso contrário usa a RPC.
 */
export async function sincronizarProcessoDatajud(db: SupabaseClient, processoId: string, opts: { notificarDireto?: boolean } = {}): Promise<ResultadoDatajud> {
  const { data: p } = await db
    .from("processos")
    .select("id, titulo, numero_cnj, classe, assunto, orgao, tribunal, data_distribuicao, datajud_sincronizado_em, datajud_atualizado_em, responsavel_id, equipe, empresa_id")
    .eq("id", processoId)
    .maybeSingle<ProcRow>();
  if (!p) return { status: "erro", novos: 0, mensagem: "Processo não encontrado ou sem acesso." };
  if (!p.numero_cnj) return { status: "erro", novos: 0, mensagem: "Cadastre o número CNJ do processo para consultar o DataJud." };

  const agora = new Date().toISOString();
  const consulta = await consultarDatajud(p.numero_cnj);
  if (!consulta.ok || !consulta.dados) {
    const status: StatusDatajud = consulta.ok ? "nao_encontrado" : consulta.status;
    const mensagem = consulta.ok
      ? "Processo não localizado no DataJud (pode estar em segredo de justiça ou ainda não indexado)."
      : consulta.mensagem;
    await db.from("processos").update({ datajud_sincronizado_em: agora, datajud_status: status, datajud_erro: mensagem.slice(0, 500) }).eq("id", p.id);
    return { status, novos: 0, mensagem };
  }

  const d = consulta.dados;
  const patch: Record<string, unknown> = {
    datajud_sincronizado_em: agora,
    datajud_atualizado_em: d.atualizadoEm,
    datajud_status: "ok",
    datajud_erro: null,
  };
  if (!p.classe && d.classe) patch.classe = d.classe.slice(0, 200);
  if (!p.assunto && d.assuntos.length) patch.assunto = d.assuntos.join(", ").slice(0, 250);
  if (!p.orgao && d.orgao) patch.orgao = d.orgao.slice(0, 200);
  if (!p.tribunal && d.tribunal) patch.tribunal = d.tribunal.slice(0, 40);
  if (!p.data_distribuicao && d.dataAjuizamento) patch.data_distribuicao = d.dataAjuizamento;

  // movimentos já gravados
  const existentes = new Set<string>();
  for (let from = 0; from < 20_000; from += 1000) {
    const { data } = await db.from("processo_andamentos").select("externo_id").eq("processo_id", p.id).eq("origem", "datajud").range(from, from + 999);
    for (const r of data ?? []) if (r.externo_id) existentes.add(r.externo_id);
    if (!data || data.length < 1000) break;
  }
  const novos = d.movimentos.filter((m) => !existentes.has(m.externoId));
  let gravados = 0;
  for (let i = 0; i < novos.length; i += 200) {
    const lote = novos.slice(i, i + 200).map((m) => ({
      processo_id: p.id,
      data: m.data,
      data_hora: m.dataHora,
      tipo: m.tipo,
      descricao: m.descricao,
      origem: "datajud",
      externo_id: m.externoId,
      autor_id: null,
    }));
    const { error } = await db.from("processo_andamentos").insert(lote);
    if (error && error.code !== "23505") {
      await db.from("processos").update({ ...patch, datajud_status: "erro", datajud_erro: "Falha ao gravar movimentos." }).eq("id", p.id);
      return { status: "erro", novos: gravados, mensagem: error.code === "42501" ? "Sem permissão para editar este processo." : "Falha ao gravar movimentos." };
    }
    if (!error) gravados += lote.length;
  }
  await db.from("processos").update(patch).eq("id", p.id);

  // Notifica só depois da 1ª importação bem-sucedida (ela traz o histórico inteiro)
  if (p.datajud_atualizado_em && gravados > 0) {
    if (opts.notificarDireto) {
      const destinos = [...new Set([p.responsavel_id, ...(p.equipe ?? [])].filter((u): u is string => !!u))];
      if (destinos.length)
        await db.from("notificacoes").insert(
          destinos.map((user_id) => ({
            empresa_id: p.empresa_id,
            user_id,
            titulo: "Novas movimentações no processo",
            mensagem: `${gravados} movimentação(ões) do DataJud em ${p.titulo}`.slice(0, 300),
            link: `/processos/${p.id}`,
          })),
        );
    } else {
      await db.rpc("notificar_movimentacoes", { p_processo: p.id, p_qtd: gravados });
    }
  }
  return {
    status: "ok",
    novos: gravados,
    mensagem: gravados ? `${gravados} movimentação(ões) importada(s) do DataJud.` : "Processo em dia: nenhuma movimentação nova no DataJud.",
  };
}
