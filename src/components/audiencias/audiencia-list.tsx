"use client";
import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CalendarClock, CheckCircle2, ExternalLink, MapPin, MoreHorizontal, Pencil, RefreshCw, RotateCcw, Scale, UserRound, Video } from "lucide-react";
import { cn } from "@/lib/cn";
import { AUDIENCIA_MODALIDADES, AUDIENCIA_STATUS, AUDIENCIA_TIPOS } from "@/lib/constants";
import { deleteAudiencia, redesignarAudiencia, setAudienciaStatus, updateAudiencia } from "@/lib/actions/audiencias";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Drawer, Modal } from "@/components/ui/drawer";
import { ResourceForm, type FieldDef } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { audienciaValues, redesignarFields, type AudienciaItem } from "./fields";

const fmtDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

/** Lista de audiências com ações rápidas: realizada, redesignar, cancelar, editar e excluir. */
export function AudienciaList({ items, fields, showProcesso = true, showDate = false }: { items: AudienciaItem[]; fields: FieldDef[]; showProcesso?: boolean; showDate?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => (
        <AudienciaRow key={a.id} a={a} fields={fields} showProcesso={showProcesso} showDate={showDate} />
      ))}
    </ul>
  );
}

type Panel = null | "editar" | "redesignar" | "realizada";

function AudienciaRow({ a, fields, showProcesso, showDate }: { a: AudienciaItem; fields: FieldDef[]; showProcesso: boolean; showDate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState(false);
  const [resultado, setResultado] = useState(a.resultado ?? "");
  const [pending, start] = useTransition();
  const ativa = a.status === "agendada" || a.status === "redesignada";
  const virtual = a.modalidade !== "presencial";

  const close = useCallback(() => setPanel(null), []);
  const done = useCallback(() => {
    setPanel(null);
    router.refresh();
  }, [router]);

  const change = (status: AudienciaItem["status"], res?: string) => {
    setMenu(false);
    start(async () => {
      const r = await setAudienciaStatus(a.id, status, res ?? null);
      if (r.ok) {
        toast(r.message ?? "Audiência atualizada.");
        setPanel(null);
        router.refresh();
      } else toast(r.error ?? "Não foi possível atualizar a audiência.", "error");
    });
  };

  return (
    <li className={cn("flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-4 sm:px-5", a.status === "cancelada" && "opacity-60")}>
      <div className="flex shrink-0 items-baseline gap-2 sm:w-24 sm:flex-col sm:items-start sm:gap-0">
        {showDate && <span className="text-xs font-medium capitalize text-muted">{fmtDate(a.date)}</span>}
        <span className={cn("text-lg font-bold tabular-nums leading-tight", a.status === "cancelada" && "line-through")}>{a.time}</span>
        <span className="text-xs tabular-nums text-muted">até {a.endTime}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">Audiência de {optionLabel(AUDIENCIA_TIPOS, a.tipo).replace(/\s*\(.*\)$/, "").toLowerCase()}</p>
          <StatusBadge options={AUDIENCIA_STATUS} value={a.status} />
          <Badge tone={virtual ? "violet" : "slate"} className="gap-1">
            {virtual ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
            {optionLabel(AUDIENCIA_MODALIDADES, a.modalidade).replace(/\s*\(.*\)$/, "")}
          </Badge>
          {a.sincronizada && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted" title="Sincronizada com o Google Agenda do responsável">
              <RefreshCw className="h-3 w-3" /> Google Agenda
            </span>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {showProcesso && (
            <Link href={`/processos/${a.processo_id}?tab=audiencias`} className="inline-flex min-w-0 max-w-full items-center gap-1 font-medium text-fg hover:text-brand-600 hover:underline">
              <Scale className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="truncate">{a.processo_titulo ?? "Processo"}</span>
              {a.processo_cnj && <span className="shrink-0 font-normal tabular-nums text-muted">· {a.processo_cnj}</span>}
            </Link>
          )}
          {a.departamento_nome && (
            <Badge tone={a.departamento_cor ?? "slate"} className="px-2 py-0 text-[11px]">
              {a.departamento_nome}
            </Badge>
          )}
          {a.responsavel_nome && (
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={a.responsavel_nome} src={a.responsavel_avatar} size={18} />
              {a.responsavel_nome}
            </span>
          )}
          {a.preposto && (
            <span className="inline-flex items-center gap-1">
              <UserRound className="h-3 w-3" /> Preposto: {a.preposto}
            </span>
          )}
          {a.local && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.local)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-brand-600 hover:underline"
            >
              <MapPin className="h-3 w-3" /> {a.local}
            </a>
          )}
        </div>

        {a.resultado && (
          <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-xs">
            <b className="font-semibold">Resultado: </b>
            {a.resultado}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
        {a.link && ativa && (
          <a
            href={a.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-violet-700"
          >
            <Video className="h-3.5 w-3.5" /> Entrar na sala <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {a.canEdit && ativa && (
          <>
            <Button type="button" size="sm" variant="secondary" onClick={() => setPanel("realizada")}>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Realizada
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setPanel("redesignar")}>
              <CalendarClock className="h-3.5 w-3.5" /> Redesignar
            </Button>
          </>
        )}
        {a.canEdit && (
          <div className="relative flex items-center">
            <Button type="button" variant="ghost" size="icon" onClick={() => setMenu((v) => !v)} aria-label="Mais ações" aria-expanded={menu} title="Mais ações">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {menu && (
              <>
                <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Fechar menu" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-10 z-20 w-52 rounded-xl border border-line bg-surface p-1 text-sm shadow-pop">
                  <MenuItem
                    onClick={() => {
                      setMenu(false);
                      setPanel("editar");
                    }}
                    icon={<Pencil className="h-4 w-4" />}
                  >
                    Editar audiência
                  </MenuItem>
                  {ativa ? (
                    <MenuItem onClick={() => change("cancelada")} icon={<Ban className="h-4 w-4 text-red-500" />}>
                      Cancelar audiência
                    </MenuItem>
                  ) : (
                    <MenuItem onClick={() => change("agendada")} icon={<RotateCcw className="h-4 w-4" />}>
                      Reabrir como agendada
                    </MenuItem>
                  )}
                </div>
              </>
            )}
            {a.canDelete && (
              <ConfirmAction
                action={deleteAudiencia}
                id={a.id}
                title="Excluir audiência?"
                message="A audiência e o compromisso da agenda (inclusive no Google Agenda) serão removidos. Para manter o histórico, prefira cancelar."
                label="Excluir audiência"
              />
            )}
          </div>
        )}
      </div>

      {a.canEdit && (
        <>
          <Drawer open={panel === "editar"} onClose={close} title="Editar audiência" description={a.processo_titulo ?? undefined} width="max-w-xl">
            {panel === "editar" && <ResourceForm action={updateAudiencia} fields={fields} values={audienciaValues(a)} hidden={{ id: a.id, processo_id: a.processo_id }} submitLabel="Salvar alterações" onSuccess={done} />}
          </Drawer>
          <Drawer open={panel === "redesignar"} onClose={close} title="Redesignar audiência" description={`Data atual: ${fmtDate(a.date)} às ${a.time}`} width="max-w-xl">
            {panel === "redesignar" && (
              <ResourceForm
                action={redesignarAudiencia}
                fields={redesignarFields}
                values={{ data_hora: "", duracao_min: String(a.duracao_min), modalidade: a.modalidade, local: a.local, link: a.link }}
                hidden={{ id: a.id }}
                submitLabel="Redesignar"
                onSuccess={done}
              />
            )}
          </Drawer>
          <Modal open={panel === "realizada"} onClose={close} title="Registrar audiência realizada" className="max-w-lg">
            <label htmlFor={`res-${a.id}`} className="label">
              Resultado / ata resumida
            </label>
            <textarea
              id={`res-${a.id}`}
              value={resultado}
              onChange={(e) => setResultado(e.target.value)}
              rows={5}
              maxLength={5000}
              className="input resize-y"
              placeholder="Ex.: Acordo não realizado; designada instrução para 10/03. Testemunhas intimadas."
            />
            <p className="mt-1 text-xs text-muted">O resultado é registrado no andamento do processo.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button variant="primary" loading={pending} onClick={() => change("realizada", resultado.trim())}>
                <CheckCircle2 className="h-4 w-4" /> Marcar como realizada
              </Button>
            </div>
          </Modal>
        </>
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
