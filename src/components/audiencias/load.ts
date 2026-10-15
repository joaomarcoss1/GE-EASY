import "server-only";
import { createClient } from "@/lib/supabase/server";
import { departamentoMap, getProfileMap } from "@/lib/data";
import { isManagerRole } from "@/lib/rbac";
import type { Session } from "@/lib/auth";
import type { Tone } from "@/lib/constants";
import type { Audiencia } from "@/lib/types";
import { spIsoFromMs, toLocal } from "@/components/agenda/date-utils";
import type { AudienciaItem } from "./fields";

const TONES: Tone[] = ["brand", "accent", "green", "amber", "red", "slate", "sky", "violet"];

export interface ProcessoResumo {
  id: string;
  titulo: string;
  numero_cnj: string | null;
  departamento_id: string | null;
}

/** Converte linhas de `audiencias` (lidas via RLS) em itens serializáveis. */
export async function toAudienciaItems(rows: Audiencia[], session: Session, canWrite: boolean, known?: Map<string, ProcessoResumo>): Promise<AudienciaItem[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const missing = [...new Set(rows.map((r) => r.processo_id))].filter((id) => !known?.has(id));
  const eventoIds = rows.map((r) => r.agenda_evento_id).filter((v): v is string => !!v);
  const [profiles, deps, procs, eventos] = await Promise.all([
    getProfileMap(),
    departamentoMap(),
    missing.length ? supabase.from("processos").select("id, titulo, numero_cnj, departamento_id").in("id", missing) : Promise.resolve({ data: [] }),
    eventoIds.length ? supabase.from("agenda_eventos").select("id, google_event_id").in("id", eventoIds) : Promise.resolve({ data: [] }),
  ]);
  const procMap = new Map<string, ProcessoResumo>(known ?? []);
  for (const p of (procs.data ?? []) as ProcessoResumo[]) procMap.set(p.id, p);
  const synced = new Set(((eventos.data ?? []) as { id: string; google_event_id: string | null }[]).filter((e) => e.google_event_id).map((e) => e.id));
  const manager = isManagerRole(session.profile.role);

  return rows.map((a) => {
    const proc = procMap.get(a.processo_id);
    const dep = proc?.departamento_id ? deps.get(proc.departamento_id) : null;
    const resp = a.responsavel_id ? profiles.get(a.responsavel_id) : null;
    const start = toLocal(a.data_hora);
    const end = toLocal(spIsoFromMs(Date.parse(a.data_hora) + a.duracao_min * 60_000));
    return {
      id: a.id,
      processo_id: a.processo_id,
      processo_titulo: proc?.titulo ?? null,
      processo_cnj: proc?.numero_cnj ?? null,
      tipo: a.tipo,
      data_hora: a.data_hora,
      date: start.date,
      time: start.time,
      endTime: end.time,
      duracao_min: a.duracao_min,
      modalidade: a.modalidade,
      local: a.local,
      link: a.link && /^https:\/\//i.test(a.link) ? a.link : null,
      responsavel_id: a.responsavel_id,
      responsavel_nome: resp?.full_name || resp?.email || null,
      responsavel_avatar: resp?.avatar_url ?? null,
      preposto: a.preposto,
      status: a.status,
      resultado: a.resultado,
      departamento_nome: dep ? (dep.sigla ?? dep.nome) : null,
      departamento_cor: dep && (TONES as string[]).includes(dep.cor) ? (dep.cor as Tone) : dep ? "slate" : null,
      sincronizada: !!a.agenda_evento_id && synced.has(a.agenda_evento_id),
      // A permissão real é do RLS; aqui apenas escondemos ações indisponíveis.
      canEdit: canWrite,
      canDelete: canWrite && (manager || a.created_by === session.userId),
    };
  });
}
