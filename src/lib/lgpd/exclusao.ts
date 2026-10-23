import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Remove todos os arquivos de um prefixo do Storage (percorre as pastas). */
async function removerPrefixo(admin: SupabaseClient, bucket: string, prefixo: string, ate: number): Promise<number> {
  let n = 0;
  const pastas = [prefixo];
  while (pastas.length && Date.now() < ate) {
    const p = pastas.pop()!;
    for (let de = 0; ; de += 100) {
      const { data } = await admin.storage.from(bucket).list(p, { limit: 100, offset: de });
      if (!data?.length) break;
      const arquivos = data.filter((o) => o.id).map((o) => `${p}/${o.name}`);
      for (const o of data.filter((o) => !o.id)) pastas.push(`${p}/${o.name}`);
      if (arquivos.length) {
        await admin.storage.from(bucket).remove(arquivos);
        n += arquivos.length;
        de -= arquivos.length; // a listagem encolheu
      }
      if (data.length < 100) break;
    }
  }
  return n;
}

/** Exclusões vencidas: apaga os arquivos da empresa e anonimiza os dados pessoais (função do banco). */
export async function executarExclusoes(admin: SupabaseClient, ate: number) {
  const r = { empresas: 0, arquivos: 0, erros: 0 };
  const { data } = await admin.from("empresas").select("id").lt("exclusao_agendada_para", new Date().toISOString()).is("anonimizada_em", null).limit(5);
  for (const e of data ?? []) {
    if (Date.now() > ate) break;
    try {
      r.arquivos += await removerPrefixo(admin, "documentos", `empresas/${e.id}`, ate);
      r.arquivos += await removerPrefixo(admin, "marcas", e.id as string, ate);
      if (Date.now() > ate) break; // termina na próxima execução
      const { error } = await admin.rpc("anonimizar_empresa", { p_empresa: e.id });
      if (error) throw new Error(error.message);
      r.empresas++;
    } catch (err) {
      console.error("[exclusao]", e.id, err instanceof Error ? err.message : err);
      r.erros++;
    }
  }
  return r;
}
