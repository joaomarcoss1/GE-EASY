import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DJEN_URL, conteudoPublicacao, dataPublicacaoDjen, djenParams, lerResposta, parseOab, type ComunicacaoDjen, type Oab } from "@/lib/juridico/djen";

export interface OabMonitorada extends Oab {
  responsavelId: string | null;
  rotulo: string;
}

/** OABs monitoradas: as cadastradas nos perfis ativos + as adicionais definidas pelo administrador. */
export async function oabsMonitoradas(db: SupabaseClient): Promise<OabMonitorada[]> {
  const [{ data: perfis }, { data: cfg }] = await Promise.all([
    db.from("profiles").select("id, oab, active").not("oab", "is", null),
    db.from("configuracoes").select("valor").eq("chave", "djen").maybeSingle(),
  ]);
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

/** Busca as comunicações de uma OAB no período (máx. 10 páginas de 100). */
export async function buscarComunicacoesDjen(oab: Oab, inicio: string, fim: string): Promise<{ itens: ComunicacaoDjen[]; erro?: string }> {
  const itens: ComunicacaoDjen[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
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
    const { itens: pag } = lerResposta(json);
    itens.push(...pag);
    if (pag.length < 100) break;
  }
  return { itens };
}

/** Grava as comunicações como publicações (sem duplicar: hash único). Retorna quantas são novas. */
export async function importarComunicacoes(db: SupabaseClient, itens: ComunicacaoDjen[], oab: OabMonitorada): Promise<{ novas: number; erro?: string }> {
  if (!itens.length) return { novas: 0 };
  const rows = itens.map((c) => ({
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
    const { data, error } = await db.from("publicacoes").upsert(rows.slice(i, i + 100), { onConflict: "hash", ignoreDuplicates: true }).select("id");
    if (error) return { novas, erro: error.code === "42501" ? "Sem permissão para registrar publicações." : "Falha ao gravar publicações." };
    novas += data?.length ?? 0;
  }
  return { novas };
}

export const isoDiasAtras = (dias: number) => {
  const d = new Date(Date.now() - 3 * 3600_000 - dias * 86400_000);
  return d.toISOString().slice(0, 10);
};
