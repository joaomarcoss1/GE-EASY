import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DJEN_URL, conteudoPublicacao, dataPublicacaoDjen, djenParams, lerResposta, parseOab, type ComunicacaoDjen, type Oab } from "@/lib/juridico/djen";

export interface OabMonitorada extends Oab {
  responsavelId: string | null;
  rotulo: string;
}

/**
 * OABs monitoradas da empresa: as dos membros ativos + as adicionais definidas pelo administrador.
 * Filtra explicitamente pela empresa (funciona com a sessão do usuário e com o service role da rotina).
 */
export async function oabsMonitoradas(db: SupabaseClient, empresaId: string): Promise<OabMonitorada[]> {
  const [{ data: membros }, { data: cfg }] = await Promise.all([
    db.from("empresa_membros").select("user_id").eq("empresa_id", empresaId).eq("ativo", true),
    db.from("configuracoes").select("valor").eq("empresa_id", empresaId).eq("chave", "djen").maybeSingle(),
  ]);
  const ids = (membros ?? []).map((m) => m.user_id as string);
  const { data: perfis } = ids.length ? await db.from("profiles").select("id, oab, active").in("id", ids).not("oab", "is", null) : { data: [] };
  const mapa = new Map<string, OabMonitorada>();
  for (const p of perfis ?? []) {
    if (!p.active) continue;
    const o = parseOab(p.oab);
    if (o) mapa.set(`${o.uf}${o.numero}`, { ...o, responsavelId: p.id, rotulo: `${o.numero}/${o.uf}` });
  }
  const extras = ((cfg?.valor as { oabs?: unknown } | null)?.oabs ?? []) as unknown[];
  for (const e of Array.isArray(extras) ? extras : []) {
    const o = parseOab(typeof e === "string" ? e : null);
    if (o && !mapa.has(`${o.uf}${o.numero}`)) mapa.set(`${o.uf}${o.numero}`, { ...o, responsavelId: null, rotulo: `${o.numero}/${o.uf}` });
  }
  return [...mapa.values()];
}

/** Busca as comunicações de uma OAB no período (máx. 10 páginas de 100), respeitando o prazo final da execução. */
export async function buscarComunicacoesDjen(oab: Oab, inicio: string, fim: string, prazoFinal = Date.now() + 240_000): Promise<{ itens: ComunicacaoDjen[]; erro?: string }> {
  const itens: ComunicacaoDjen[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    if (prazoFinal - Date.now() < 22_000) return { itens, erro: pagina > 1 ? "Busca interrompida pelo limite de tempo; o restante será buscado na próxima rodada." : undefined };
    let res: Response;
    try {
      res = await fetch(`${DJEN_URL}?${djenParams(oab, inicio, fim, pagina)}`, {
        headers: { Accept: "application/json", "User-Agent": "GE-EASY/1.0 (gestao juridica)" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return { itens, erro: "O DJEN não respondeu (tempo esgotado)." };
    }
    if (res.status === 429) return { itens, erro: "Limite de consultas do DJEN atingido; o restante será buscado na próxima rodada." };
    if (res.status === 404 && pagina === 1) return { itens };
    if (!res.ok) return { itens, erro: `O DJEN retornou erro ${res.status}.` };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { itens, erro: "Resposta inválida do DJEN." };
    }
    const { itens: pag, brutos, total } = lerResposta(json);
    itens.push(...pag);
    if (brutos < 100 || (total !== null && pagina * 100 >= total)) break;
  }
  return { itens };
}

/** Grava as comunicações como publicações da empresa (sem duplicar: hash único por empresa). Retorna quantas são novas. */
export async function importarComunicacoes(db: SupabaseClient, itens: ComunicacaoDjen[], oab: OabMonitorada, empresaId: string): Promise<{ novas: number; erro?: string }> {
  if (!itens.length) return { novas: 0 };
  const rows = itens.map((c) => ({
    empresa_id: empresaId,
    hash: `djen:${c.hash}`.slice(0, 200),
    origem: "djen",
    fonte: `DJEN${c.tribunal ? ` · ${c.tribunal}` : ""}`,
    tribunal: c.tribunal,
    orgao: c.orgao?.slice(0, 300) ?? null,
    tipo_comunicacao: c.tipo?.slice(0, 120) ?? null,
    link: c.link,
    oab: oab.rotulo,
    data_disponibilizacao: c.disponibilizacao,
    data_publicacao: dataPublicacaoDjen(c.disponibilizacao),
    numero_processo: c.numeroProcesso,
    conteudo: conteudoPublicacao(c),
    responsavel_id: oab.responsavelId,
  }));
  let novas = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const { data, error } = await db.from("publicacoes").upsert(rows.slice(i, i + 100), { onConflict: "empresa_id,hash", ignoreDuplicates: true }).select("id");
    if (error) return { novas, erro: error.code === "42501" ? "Sem permissão para registrar publicações." : "Falha ao gravar publicações." };
    novas += data?.length ?? 0;
  }
  return { novas };
}

export const isoDiasAtras = (dias: number) => {
  const d = new Date(Date.now() - 3 * 3600_000 - dias * 86400_000);
  return d.toISOString().slice(0, 10);
};
