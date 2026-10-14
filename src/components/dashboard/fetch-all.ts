import "server-only";

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Busca paginada (o PostgREST limita linhas por requisição). O `build` deve
 * aplicar uma ordenação estável e o `.range(from, to)` recebido.
 * Sempre usa o cliente do usuário (RLS aplicado) — quem chama decide.
 */
export async function fetchAll<T>(build: (from: number, to: number) => PageResult<T>, max = 10_000, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const to = Math.min(from + pageSize, max) - 1;
    const { data, error } = await build(from, to);
    if (error) {
      console.error("[fetchAll]", error.message);
      break;
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < to - from + 1) break;
  }
  return out;
}
