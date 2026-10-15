import "server-only";
import { createClient } from "@/lib/supabase/server";
import { departamentoMap, getProfileMap } from "@/lib/data";
import { isManagerRole } from "@/lib/rbac";
import type { Session } from "@/lib/auth";
import type { Tone } from "@/lib/constants";
import type { Prazo } from "@/lib/types";
import type { PrazoItem } from "./utils";

const TONES: Tone[] = ["brand", "accent", "green", "amber", "red", "slate", "sky", "violet"];

/** Converte linhas de `prazos` (lidas via RLS) em itens serializáveis para a interface. */
export async function toPrazoItems(rows: Prazo[], session: Session, canWrite: boolean): Promise<PrazoItem[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const processoIds = [...new Set(rows.map((r) => r.processo_id).filter((v): v is string => !!v))];
  const [profiles, deps, procs] = await Promise.all([
    getProfileMap(),
    departamentoMap(),
    processoIds.length
      ? supabase.from("processos").select("id, titulo, numero_cnj").in("id", processoIds)
      : Promise.resolve({ data: [] as { id: string; titulo: string; numero_cnj: string | null }[] }),
  ]);
  const procMap = new Map(((procs.data ?? []) as { id: string; titulo: string; numero_cnj: string | null }[]).map((p) => [p.id, p]));
  const manager = isManagerRole(session.profile.role);

  return rows.map((r) => {
    const resp = r.responsavel_id ? profiles.get(r.responsavel_id) : null;
    const dep = r.departamento_id ? deps.get(r.departamento_id) : null;
    const proc = r.processo_id ? procMap.get(r.processo_id) : null;
    return {
      id: r.id,
      processo_id: r.processo_id,
      processo_titulo: proc?.titulo ?? null,
      processo_cnj: proc?.numero_cnj ?? null,
      descricao: r.descricao,
      data_publicacao: r.data_publicacao,
      dias: r.dias,
      contagem: r.contagem,
      data_fim: r.data_fim,
      fatal: r.fatal,
      prioridade: r.prioridade,
      status: r.status,
      responsavel_id: r.responsavel_id,
      responsavel_nome: resp?.full_name || resp?.email || null,
      responsavel_avatar: resp?.avatar_url ?? null,
      departamento_id: r.departamento_id,
      departamento_nome: dep ? (dep.sigla ?? dep.nome) : null,
      departamento_cor: dep && (TONES as string[]).includes(dep.cor) ? (dep.cor as Tone) : dep ? "slate" : null,
      cumprido_em: r.cumprido_em,
      observacoes: r.observacoes,
      // A permissão real é do RLS; aqui apenas escondemos ações indisponíveis.
      canEdit: canWrite,
      canDelete: canWrite && (manager || r.created_by === session.userId),
    };
  });
}
