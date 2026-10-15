"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CloudDownload, Loader2, RadioTower, TriangleAlert } from "lucide-react";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

const STATUS: Record<string, { label: string; cls: string }> = {
  ok: { label: "Sincronizado", cls: "text-emerald-700 dark:text-emerald-300" },
  nao_encontrado: { label: "Não localizado no DataJud", cls: "text-amber-700 dark:text-amber-300" },
  indisponivel: { label: "Tribunal fora da API pública", cls: "text-muted" },
  erro: { label: "Falha na última consulta", cls: "text-red-600 dark:text-red-400" },
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "nunca";

/** Faixa do DataJud no processo: situação, última consulta, sincronização manual e monitoramento automático. */
export function DatajudPanel({
  processoId,
  temCnj,
  consultavel,
  status,
  erro,
  sincronizadoEm,
  atualizadoEm,
  monitorar,
  podeEditar,
  importados,
  actions,
}: {
  processoId: string;
  temCnj: boolean;
  consultavel: boolean;
  status: string | null;
  erro: string | null;
  sincronizadoEm: string | null;
  atualizadoEm: string | null;
  monitorar: boolean;
  podeEditar: boolean;
  importados: number;
  actions: { sincronizar: (id: string) => Promise<ActionState>; monitorar: (id: string, ativo: boolean) => Promise<ActionState> };
}) {
  const [pending, start] = useTransition();
  const [togglePending, startToggle] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const st = status ? STATUS[status] : null;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
          <RadioTower className="h-5 w-5" />
        </span>
        <div className="text-sm">
          <p className="font-semibold">
            DataJud (CNJ){" "}
            {st && (
              <span className={cn("ml-1 inline-flex items-center gap-1 text-xs font-semibold", st.cls)}>
                {status === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : status === "erro" ? <TriangleAlert className="h-3.5 w-3.5" /> : null}
                {st.label}
              </span>
            )}
          </p>
          <p className="text-xs text-muted">
            {!temCnj
              ? "Cadastre o número CNJ para importar as movimentações automaticamente."
              : !consultavel
                ? "Este tribunal não está disponível na API pública do DataJud."
                : `Última consulta: ${fmt(sincronizadoEm)}${atualizadoEm ? ` · atualizado no tribunal em ${fmt(atualizadoEm)}` : ""} · ${importados} movimentação(ões) importada(s)`}
          </p>
          {erro && status !== "ok" && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{erro}</p>}
        </div>
      </div>
      {podeEditar && temCnj && consultavel && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line accent-brand-600"
              checked={monitorar}
              disabled={togglePending}
              onChange={(e) => {
                const ativo = e.target.checked;
                startToggle(async () => {
                  const r = await actions.monitorar(processoId, ativo);
                  toast(r.ok ? (r.message ?? "Atualizado.") : (r.error ?? "Erro."), r.ok ? "success" : "error");
                  router.refresh();
                });
              }}
            />
            Monitorar automaticamente
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await actions.sincronizar(processoId);
                toast(r.ok ? (r.message ?? "Sincronizado.") : (r.error ?? "Falha ao consultar o DataJud."), r.ok ? "success" : "error");
                router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />} Sincronizar agora
          </Button>
        </div>
      )}
    </div>
  );
}
