"use client";
import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, Check, ChevronDown, Link2, RotateCcw, Scale, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { PRAZO_CONTAGEM, PRIORIDADES, type Option } from "@/lib/constants";
import { PALAVRAS_CHAVE, sugerirDias } from "@/lib/juridico/publicacoes";
import { date } from "@/lib/format";
import type { ActionState } from "@/lib/actions/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { useToast } from "@/components/ui/toast";

export interface PublicacaoView {
  id: string;
  data_publicacao: string;
  fonte: string | null;
  numero_processo: string | null;
  conteudo: string;
  status: "nova" | "tratada" | "descartada";
  processo: { id: string; titulo: string; numero_cnj: string | null } | null;
  prazo_id: string | null;
  responsavel: string | null;
}

const KW = new RegExp(`(${PALAVRAS_CHAVE.map((p) => p.replace(/[-]/g, "\\-")).join("|")}|\\d{7}-?\\d{2}\\.?\\d{4}\\.?\\d\\.?\\d{2}\\.?\\d{4})`, "gi");

function Destacado({ texto }: { texto: string }) {
  const parts = texto.split(KW);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-accent-100 px-0.5 font-semibold text-accent-800 dark:bg-accent-900/40 dark:text-accent-200">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export function PublicacaoItem({
  pub,
  processos,
  responsaveis,
  selected,
  onSelect,
  actions,
  canDelete,
}: {
  pub: PublicacaoView;
  processos: Option[];
  responsaveis: Option[];
  selected: boolean;
  onSelect: (v: boolean) => void;
  actions: {
    vincular: (id: string, processoId: string) => Promise<ActionState>;
    status: (id: string, s: "nova" | "tratada" | "descartada") => Promise<ActionState>;
    gerarPrazo: (s: ActionState, f: FormData) => Promise<ActionState>;
    remove: (id: string) => Promise<ActionState>;
  };
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(pub.status === "nova");
  const [proc, setProc] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const dias = useMemo(() => sugerirDias(pub.conteudo), [pub.conteudo]);

  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(r.message ?? "Feito.");
        router.refresh();
      } else toast(r.error ?? "Não foi possível concluir.", "error");
    });

  return (
    <article className={cn("border-b border-line px-5 py-4 last:border-0", pub.status === "nova" && "bg-accent-50/30 dark:bg-accent-900/5")}>
      <div className="flex items-start gap-3">
        {pub.status === "nova" && (
          <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} className="mt-1 h-4 w-4 accent-brand-700" aria-label="Selecionar publicação" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <b className="text-sm font-semibold">{date(pub.data_publicacao)}</b>
            {pub.fonte && <Badge tone="slate">{pub.fonte}</Badge>}
            {pub.status === "nova" && <Badge tone="accent" dot>Nova</Badge>}
            {pub.status === "tratada" && <Badge tone="green" dot>Tratada</Badge>}
            {pub.status === "descartada" && <Badge tone="slate" dot>Descartada</Badge>}
            {pub.prazo_id && (
              <Badge tone="amber">
                <AlarmClock className="h-3 w-3" /> Prazo gerado
              </Badge>
            )}
            {dias && pub.status === "nova" && <Badge tone="brand">Prazo sugerido: {dias} dias</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            {pub.processo ? (
              <Link href={`/processos/${pub.processo.id}`} className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline dark:text-brand-300">
                <Scale className="h-4 w-4" /> {pub.processo.titulo}
                <span className="font-mono text-xs font-normal text-muted">{pub.processo.numero_cnj}</span>
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                <Link2 className="h-4 w-4" /> Sem processo vinculado {pub.numero_processo && <span className="font-mono text-xs">({pub.numero_processo})</span>}
              </span>
            )}
            {pub.responsavel && <span className="text-xs text-muted">· {pub.responsavel}</span>}
          </div>
          <button onClick={() => setOpen((o) => !o)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} /> {open ? "Ocultar teor" : "Ler teor"}
          </button>
          {open && (
            <p className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-surface-2 p-3 text-sm leading-relaxed">
              <Destacado texto={pub.conteudo} />
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!pub.processo && (
              <>
                <select value={proc} onChange={(e) => setProc(e.target.value)} className="input h-9 w-auto max-w-xs py-1 text-xs" aria-label="Processo">
                  <option value="">Vincular a um processo…</option>
                  {processos.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="secondary" disabled={!proc || pending} onClick={() => run(() => actions.vincular(pub.id, proc))}>
                  <Link2 className="h-4 w-4" /> Vincular
                </Button>
              </>
            )}
            {pub.processo && !pub.prazo_id && pub.status !== "descartada" && (
              <FormDrawerButton
                action={actions.gerarPrazo}
                hidden={{ publicacao_id: pub.id }}
                values={{ descricao: "Manifestação sobre publicação", dias: dias ?? 15, contagem: "uteis", fatal: true, prioridade: "alta" }}
                fields={[
                  { name: "descricao", label: "Descrição do prazo", required: true, span: 6 },
                  { name: "dias", label: "Dias", type: "number", min: 1, max: 365, required: true, span: 2, help: dias ? "Sugerido pelo texto" : undefined },
                  { name: "contagem", label: "Contagem", type: "select", options: PRAZO_CONTAGEM, emptyOption: false, span: 4 },
                  { name: "responsavel_id", label: "Responsável", type: "select", options: responsaveis, emptyOption: "Eu mesmo", span: 3 },
                  { name: "prioridade", label: "Prioridade", type: "select", options: PRIORIDADES, emptyOption: false, span: 3 },
                  { name: "fatal", label: "Prazo fatal", type: "checkbox", span: 6, help: "O vencimento é calculado a partir da data da publicação (CPC art. 224)." },
                ]}
                title="Gerar prazo da publicação"
                label="Gerar prazo"
                size="sm"
                width="max-w-lg"
                submitLabel="Criar prazo"
              />
            )}
            {pub.status === "nova" ? (
              <>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => actions.status(pub.id, "tratada"))}>
                  <Check className="h-4 w-4" /> Tratada
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => actions.status(pub.id, "descartada"))}>
                  <X className="h-4 w-4" /> Descartar
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => actions.status(pub.id, "nova"))}>
                <RotateCcw className="h-4 w-4" /> Reabrir
              </Button>
            )}
            {canDelete && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("Excluir esta publicação?") && run(() => actions.remove(pub.id))} aria-label="Excluir">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/** Lista com seleção para baixa em lote. */
export function PublicacoesLista({
  items,
  processos,
  responsaveis,
  actions,
  canDelete,
  lote,
}: {
  items: PublicacaoView[];
  processos: Option[];
  responsaveis: Option[];
  actions: Parameters<typeof PublicacaoItem>[0]["actions"];
  canDelete: boolean;
  lote: (ids: string[]) => Promise<ActionState>;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      {sel.size > 0 && (
        <div className="sticky top-16 z-10 flex items-center justify-between gap-3 border-b border-line bg-brand-50 px-5 py-2.5 text-sm dark:bg-brand-900/40">
          <span className="font-medium">{sel.size} selecionada(s)</span>
          <Button
            size="sm"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await lote([...sel]);
                if (r.ok) {
                  toast(r.message ?? "Feito.");
                  setSel(new Set());
                  router.refresh();
                } else toast(r.error ?? "Erro.", "error");
              })
            }
          >
            <Check className="h-4 w-4" /> Marcar como tratadas
          </Button>
        </div>
      )}
      {items.map((p) => (
        <PublicacaoItem
          key={p.id}
          pub={p}
          processos={processos}
          responsaveis={responsaveis}
          actions={actions}
          canDelete={canDelete}
          selected={sel.has(p.id)}
          onSelect={(v) =>
            setSel((s) => {
              const n = new Set(s);
              if (v) n.add(p.id);
              else n.delete(p.id);
              return n;
            })
          }
        />
      ))}
    </>
  );
}
