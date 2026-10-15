"use client";
import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Check, Flame, MoreHorizontal, Pencil, RotateCcw, Scale, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { PRAZO_STATUS, PRIORIDADES } from "@/lib/constants";
import { deletePrazo, setPrazoStatus, updatePrazo } from "@/lib/actions/prazos";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import type { FieldDef } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { prazoValues } from "./fields";
import { PrazoFormDrawer } from "./prazo-drawer";
import { brDate, brDateWeekday, diffDays, restanteLabel, type PrazoItem } from "./utils";

const TONE_TEXT = {
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  green: "text-emerald-600 dark:text-emerald-400",
  slate: "text-muted",
} as const;

/** Lista de prazos com baixa rápida ("Cumprido"), edição e exclusão. */
export function PrazoList({
  items,
  today,
  fields,
  showProcesso = true,
  showResponsavel = true,
}: {
  items: PrazoItem[];
  today: string;
  fields: FieldDef[];
  showProcesso?: boolean;
  showResponsavel?: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {items.map((p) => (
        <PrazoRow key={p.id} p={p} today={today} fields={fields} showProcesso={showProcesso} showResponsavel={showResponsavel} />
      ))}
    </ul>
  );
}

function PrazoRow({ p, today, fields, showProcesso, showResponsavel }: { p: PrazoItem; today: string; fields: FieldDef[]; showProcesso: boolean; showResponsavel: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(p.status);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);

  const item = { ...p, status };
  const pendente = status === "pendente";
  const d = diffDays(p.data_fim, today);
  const overdue = pendente && d < 0;
  const dueToday = pendente && d === 0;
  const rest = restanteLabel({ ...item, cumprido_em: status === "cumprido" ? (p.cumprido_em ?? new Date().toISOString()) : null }, today);
  const textTone = TONE_TEXT[rest.tone as keyof typeof TONE_TEXT] ?? "text-muted";

  const change = (s: PrazoItem["status"]) => {
    setMenu(false);
    const prev = status;
    setStatus(s);
    start(async () => {
      const r = await setPrazoStatus(p.id, s);
      if (r.ok) {
        toast(r.message ?? "Prazo atualizado.");
        router.refresh();
      } else {
        setStatus(prev);
        toast(r.error ?? "Não foi possível atualizar o prazo.", "error");
      }
    });
  };

  const closeEdit = useCallback(() => setEditing(false), []);
  const afterEdit = useCallback(() => {
    setEditing(false);
    router.refresh();
  }, [router]);

  return (
    <li
      className={cn(
        "relative flex items-start gap-3 px-4 py-3.5 transition sm:gap-4 sm:px-5",
        overdue && "bg-red-50/70 dark:bg-red-950/25",
        dueToday && "bg-amber-50/70 dark:bg-amber-950/20",
        !pendente && "opacity-80",
      )}
    >
      {(overdue || dueToday) && <span className={cn("absolute inset-y-0 left-0 w-1", overdue ? "bg-red-500" : "bg-amber-500")} aria-hidden />}

      {/* Baixa rápida */}
      <button
        type="button"
        disabled={!p.canEdit || pending || status === "cancelado" || status === "perdido"}
        onClick={() => change(status === "cumprido" ? "pendente" : "cumprido")}
        className={cn(
          "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition disabled:cursor-not-allowed",
          status === "cumprido"
            ? "border-emerald-500 bg-emerald-500 text-white"
            : overdue
              ? "border-red-500 text-transparent hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-950/50"
              : "border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500 dark:border-white/25",
          (status === "cancelado" || status === "perdido") && "border-dashed",
        )}
        aria-label={status === "cumprido" ? "Reabrir prazo" : "Marcar como cumprido"}
        title={status === "cumprido" ? "Reabrir prazo" : "Cumprido"}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={cn("font-semibold", status === "cumprido" && "text-muted line-through", status === "cancelado" && "text-muted line-through")}>{p.descricao}</p>
          {p.fatal && (
            <Badge tone="red" className="gap-1">
              <Flame className="h-3 w-3" /> Fatal
            </Badge>
          )}
          {(p.prioridade === "urgente" || p.prioridade === "alta") && <StatusBadge options={PRIORIDADES} value={p.prioridade} />}
          {status !== "pendente" && <StatusBadge options={PRAZO_STATUS} value={status} />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {showProcesso &&
            (p.processo_id ? (
              <Link href={`/processos/${p.processo_id}?tab=prazos`} className="inline-flex min-w-0 max-w-full items-center gap-1 font-medium text-fg hover:text-brand-600 hover:underline">
                <Scale className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate">{p.processo_titulo ?? "Processo"}</span>
                {p.processo_cnj && <span className="shrink-0 font-normal tabular-nums text-muted">· {p.processo_cnj}</span>}
              </Link>
            ) : (
              <span className="italic">Prazo administrativo</span>
            ))}
          {p.departamento_nome && (
            <Badge tone={p.departamento_cor ?? "slate"} className="px-2 py-0 text-[11px]">
              {p.departamento_nome}
            </Badge>
          )}
          {showResponsavel && p.responsavel_nome && (
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={p.responsavel_nome} src={p.responsavel_avatar} size={18} />
              {p.responsavel_nome}
            </span>
          )}
          {p.data_publicacao && p.dias !== null && (
            <span>
              Publicação {brDate(p.data_publicacao)} · {p.dias} {p.contagem === "uteis" ? "dias úteis" : "dias corridos"}
            </span>
          )}
          {p.prioridade !== "urgente" && p.prioridade !== "alta" && <span>Prioridade {PRIORIDADES.find((o) => o.value === p.prioridade)?.label.toLowerCase()}</span>}
        </div>
        {p.observacoes && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted">{p.observacoes}</p>}
      </div>

      <div className="flex shrink-0 items-start gap-1 sm:gap-2">
        <div className="text-right">
          <p className={cn("whitespace-nowrap text-sm font-semibold tabular-nums", overdue && "text-red-600 dark:text-red-400")}>{brDateWeekday(p.data_fim)}</p>
          <p className={cn("mt-0.5 inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium", textTone)}>
            {overdue && <TriangleAlert className="h-3 w-3" />}
            {rest.text}
          </p>
        </div>
        {p.canEdit && (
          <div className="relative flex items-center">
            <Button type="button" variant="ghost" size="icon" onClick={() => setEditing(true)} aria-label="Editar prazo" title="Editar prazo">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => setMenu((v) => !v)} aria-label="Mais ações" aria-expanded={menu} title="Mais ações">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {menu && (
              <>
                <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Fechar menu" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-10 z-20 w-52 rounded-xl border border-line bg-surface p-1 text-sm shadow-pop">
                  {status !== "pendente" && (
                    <MenuItem onClick={() => change("pendente")} icon={<RotateCcw className="h-4 w-4" />}>
                      Reabrir prazo
                    </MenuItem>
                  )}
                  {status === "pendente" && (
                    <MenuItem onClick={() => change("perdido")} icon={<TriangleAlert className="h-4 w-4 text-red-500" />}>
                      Marcar como perdido
                    </MenuItem>
                  )}
                  {status === "pendente" && (
                    <MenuItem onClick={() => change("cancelado")} icon={<Ban className="h-4 w-4" />}>
                      Cancelar prazo
                    </MenuItem>
                  )}
                </div>
              </>
            )}
            {p.canDelete && (
              <ConfirmAction
                action={deletePrazo}
                id={p.id}
                title="Excluir prazo?"
                message="O prazo será removido definitivamente. Para manter o histórico, prefira marcá-lo como cancelado."
                label="Excluir prazo"
              />
            )}
          </div>
        )}
      </div>

      {p.canEdit && (
        <PrazoFormDrawer
          open={editing}
          onClose={closeEdit}
          action={updatePrazo}
          fields={fields}
          values={prazoValues(item)}
          hidden={{ id: p.id }}
          title="Editar prazo"
          description={p.processo_titulo ?? undefined}
          submitLabel="Salvar alterações"
          onSuccess={afterEdit}
        />
      )}
    </li>
  );
}

function MenuItem({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-surface-2">
      {icon}
      {children}
    </button>
  );
}
