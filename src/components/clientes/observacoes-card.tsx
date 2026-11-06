import { AlertTriangle, NotebookText } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

type Bloco = { titulo: string | null; itens: { k: string | null; v: string }[] };

/** Separa o texto em blocos (linha em branco) e, em cada bloco, pares "Campo: valor". */
function blocos(texto: string): Bloco[] {
  return texto
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").filter((l) => l.trim()))
    .filter((ls) => ls.length)
    .map((ls) => {
      const titulo = ls.length > 1 && !/^\s/.test(ls[0]) && !/^- /.test(ls[0]) && !/:\s/.test(ls[0]) ? ls[0].trim() : /^(CASO|IMPORTADO|ATENÇÃO)/.test(ls[0]) ? ls[0].trim() : null;
      const resto = titulo ? ls.slice(1) : ls;
      return {
        titulo,
        itens: resto.map((l) => {
          const t = l.trim().replace(/^- /, "");
          const m = /^([^:]{2,40}):\s(.+)$/.exec(t);
          return m ? { k: m[1], v: m[2] } : { k: null, v: t };
        }),
      };
    });
}

/** Observações do cliente em cartão de largura total, com casos e avisos organizados. */
export function ObservacoesCard({ texto }: { texto: string }) {
  const bs = blocos(texto);
  const cabecalho = bs[0]?.titulo?.startsWith("IMPORTADO") && !bs[0].itens.length ? bs.shift() : null;
  return (
    <Card className="mt-6">
      <CardHeader icon={<NotebookText className="h-4 w-4" />} title="Observações e histórico" description={cabecalho?.titulo ?? "Anotações do cadastro"} />
      <CardBody>
        <div className="grid gap-4 lg:grid-cols-2">
          {bs.map((b, i) => {
            const alerta = b.titulo?.startsWith("ATENÇÃO");
            return (
              <section key={i} className={`min-w-0 rounded-xl border p-4 ${alerta ? "border-amber-300 bg-amber-50/60 lg:col-span-2 dark:border-amber-800 dark:bg-amber-950/20" : "border-line bg-surface-2/50"}`}>
                {b.titulo && (
                  <h4 className={`mb-2.5 flex items-start gap-2 text-sm font-semibold ${alerta ? "text-amber-800 dark:text-amber-200" : "text-fg"}`}>
                    {alerta && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                    <span className="min-w-0 break-words">{b.titulo}</span>
                  </h4>
                )}
                <dl className="space-y-1.5 text-sm">
                  {b.itens.map((it, j) =>
                    it.k ? (
                      <div key={j} className="grid grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)] gap-3">
                        <dt className="text-muted">{it.k}</dt>
                        <dd className="min-w-0 break-words font-medium">{it.v}</dd>
                      </div>
                    ) : (
                      <p key={j} className="break-words">{it.v}</p>
                    ),
                  )}
                </dl>
              </section>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
