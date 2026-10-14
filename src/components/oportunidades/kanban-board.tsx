"use client";
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, CalendarPlus, GripVertical, ListPlus, MoreHorizontal, Pencil, PartyPopper, Trophy, UserRound, Users, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { ETAPAS, LINHAS, type Tone } from "@/lib/constants";
import { brl, brlShort, date } from "@/lib/format";
import type { ActionState } from "@/lib/actions/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Drawer, Modal } from "@/components/ui/drawer";
import { ResourceForm, type FieldDef } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { TONE_CLS } from "@/components/agenda/tones";

export interface OpItem {
  id: string;
  titulo: string;
  cliente_id: string;
  cliente_nome: string | null;
  linha: "consorcio" | "seguro";
  produto_id: string | null;
  valor: number;
  etapa: string;
  probabilidade: number;
  previsao_fechamento: string | null;
  motivo_perda: string | null;
  consultor_id: string | null;
  consultor_nome: string | null;
  observacoes: string | null;
  fechado_em: string | null;
  created_at: string;
}

interface Actions {
  move: (id: string, etapa: string, motivo?: string | null) => Promise<ActionState>;
  update: (state: ActionState, formData: FormData) => Promise<ActionState>;
  remove: (id: string) => Promise<ActionState>;
}

const CLOSED = new Set(["ganho", "perdido"]);
const MOTIVOS = ["Preço / condições", "Optou pela concorrência", "Sem retorno do cliente", "Crédito não aprovado", "Adiou a decisão", "Desistiu da compra"];
const toneOfEtapa = (etapa: string): Tone => ETAPAS.find((e) => e.value === etapa)?.tone ?? "slate";
const etapaLabel = (etapa: string) => ETAPAS.find((e) => e.value === etapa)?.label ?? etapa;

export function KanbanBoard({
  items,
  today,
  canWrite,
  canDelete,
  showConsultor,
  editFields,
  actions,
  initialOpenId,
}: {
  items: OpItem[];
  today: string;
  canWrite: boolean;
  canDelete: boolean;
  showConsultor: boolean;
  editFields: FieldDef[];
  actions: Actions;
  initialOpenId?: string | null;
}) {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const [moved, setMoved] = useOptimistic<Record<string, string>, { id: string; etapa: string }>({}, (s, a) => ({ ...s, [a.id]: a.etapa }));
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [lost, setLost] = useState<{ item: OpItem; motivo: string } | null>(null);
  const [won, setWon] = useState<OpItem | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialOpenId && items.some((i) => i.id === initialOpenId) ? initialOpenId : null);

  const eff = useCallback((i: OpItem) => moved[i.id] ?? i.etapa, [moved]);
  const columns = useMemo(
    () =>
      ETAPAS.map((e) => {
        const list = items.filter((i) => eff(i) === e.value);
        const total = list.reduce((a, i) => a + i.valor, 0);
        const weighted = list.reduce((a, i) => a + (i.valor * (CLOSED.has(e.value) ? (e.value === "ganho" ? 100 : 0) : i.probabilidade)) / 100, 0);
        return { ...e, list, total, weighted };
      }),
    [items, eff],
  );
  const selected = openId ? (items.find((i) => i.id === openId) ?? null) : null;

  const commit = (item: OpItem, etapa: string, motivo?: string) => {
    start(async () => {
      setMoved({ id: item.id, etapa });
      const r = await actions.move(item.id, etapa, motivo ?? null);
      if (!r.ok) {
        toast(r.error ?? "Não foi possível mover a oportunidade.", "error");
        return;
      }
      toast(r.message ?? `Movida para ${etapaLabel(etapa)}.`);
      if (etapa === "ganho") setWon(item);
    });
  };

  const requestMove = (item: OpItem, etapa: string) => {
    if (!canWrite || eff(item) === etapa) return;
    if (etapa === "perdido") setLost({ item, motivo: item.motivo_perda ?? "" });
    else commit(item, etapa);
  };

  const closeDrawer = useCallback(() => {
    setOpenId(null);
    if (params.get("abrir") || params.get("novo")) {
      const p = new URLSearchParams(params.toString());
      p.delete("abrir");
      router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
    }
  }, [params, pathname, router]);

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex snap-x snap-mandatory gap-3 sm:snap-none" role="list" aria-label="Funil de vendas">
          {columns.map((col) => {
            const tone = TONE_CLS[col.tone ?? "slate"];
            const isOver = over === col.value && dragId !== null;
            const closed = CLOSED.has(col.value);
            return (
              <section
                key={col.value}
                role="listitem"
                aria-label={`${col.label}: ${col.list.length} oportunidade(s)`}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (over !== col.value) setOver(col.value);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === col.value ? null : o));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  const item = items.find((i) => i.id === id);
                  setOver(null);
                  setDragId(null);
                  if (item) requestMove(item, col.value);
                }}
                className={cn(
                  "flex w-[85vw] max-w-[300px] shrink-0 snap-start flex-col rounded-2xl border bg-surface-2/70 transition sm:w-[288px]",
                  isOver ? "border-brand-400 bg-brand-50/70 ring-4 ring-brand-500/10 dark:bg-brand-900/30" : "border-line",
                )}
              >
                <div className={cn("h-1 rounded-t-2xl", tone.bar)} />
                <header className="px-3.5 pb-2 pt-3">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
                    <h2 className="text-sm font-semibold">{col.label}</h2>
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted ring-1 ring-inset ring-line">{col.list.length}</span>
                    <span className="ml-auto text-sm font-bold tabular-nums" title={brl(col.total)}>
                      {brlShort(col.total)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">
                    {closed ? (col.value === "ganho" ? "Fechados nos últimos 90 dias" : "Perdidos nos últimos 90 dias") : <>Ponderado: <b className="font-semibold text-fg/80">{brlShort(col.weighted)}</b></>}
                  </p>
                </header>
                <div className="flex min-h-[140px] flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0.5 lg:max-h-[calc(100vh-360px)]">
                  {col.list.map((item) => (
                    <OpCard
                      key={item.id}
                      item={item}
                      etapa={eff(item)}
                      today={today}
                      canWrite={canWrite}
                      showConsultor={showConsultor}
                      dragging={dragId === item.id}
                      onOpen={() => setOpenId(item.id)}
                      onMove={(etapa) => requestMove(item, etapa)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", item.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(item.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOver(null);
                      }}
                    />
                  ))}
                  {col.list.length === 0 && (
                    <div className={cn("grid flex-1 place-items-center rounded-xl border-2 border-dashed px-3 py-6 text-center text-xs text-muted", isOver ? "border-brand-300" : "border-line")}>
                      {canWrite ? "Arraste oportunidades para cá" : "Nenhuma oportunidade"}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* Motivo da perda */}
      <Modal open={!!lost} onClose={() => setLost(null)} title="Motivo da perda">
        {lost && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const { item, motivo } = lost;
              setLost(null);
              commit(item, "perdido", motivo);
            }}
          >
            <p className="mb-3 text-sm text-muted">
              Por que <b className="text-fg">{lost.item.titulo}</b> foi perdida? Isso ajuda a entender o funil e melhorar a abordagem.
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {MOTIVOS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setLost({ ...lost, motivo: m })}
                  className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition", lost.motivo === m ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300" : "border-line hover:bg-surface-2")}
                >
                  {m}
                </button>
              ))}
            </div>
            <label htmlFor="motivo-perda" className="label">
              Detalhes
            </label>
            <textarea id="motivo-perda" className="input resize-y" rows={3} maxLength={500} value={lost.motivo} onChange={(e) => setLost({ ...lost, motivo: e.target.value })} placeholder="Ex.: cliente fechou com outra administradora por taxa menor" autoFocus />
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setLost(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="danger">
                <XCircle className="h-4 w-4" /> Marcar como perdida
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Próximo passo após ganho */}
      {won && <WonNotice item={won} onClose={() => setWon(null)} />}

      {/* Detalhes / edição */}
      <Drawer open={!!selected} onClose={closeDrawer} title={selected?.titulo ?? ""} description={selected ? `${selected.linha === "consorcio" ? "Consórcio" : "Seguro"} · ${selected.cliente_nome ?? "Cliente"}` : undefined} width="max-w-2xl">
        {selected && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Etapa">
                <StatusBadge options={ETAPAS} value={eff(selected)} />
              </Metric>
              <Metric label="Valor">{brl(selected.valor)}</Metric>
              <Metric label="Probabilidade">{selected.probabilidade}%</Metric>
              <Metric label="Ponderado">{brl((selected.valor * selected.probabilidade) / 100)}</Metric>
            </div>
            {selected.etapa === "perdido" && selected.motivo_perda && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                <b className="font-semibold">Motivo da perda:</b> {selected.motivo_perda}
              </div>
            )}
            {selected.etapa === "ganho" && <NextStep item={selected} />}
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/clientes/${selected.cliente_id}`} variant="secondary" size="sm">
                <Users className="h-4 w-4" /> Ver cliente
              </LinkButton>
              <LinkButton href={`/agenda?novo=1&cliente_id=${selected.cliente_id}&oportunidade_id=${selected.id}`} variant="secondary" size="sm">
                <CalendarPlus className="h-4 w-4" /> Agendar
              </LinkButton>
              <LinkButton href={`/tarefas?novo=1&cliente_id=${selected.cliente_id}`} variant="secondary" size="sm">
                <ListPlus className="h-4 w-4" /> Nova tarefa
              </LinkButton>
            </div>
            <p className="text-xs text-muted">
              Criada em {date(selected.created_at)}
              {selected.fechado_em ? ` · fechada em ${date(selected.fechado_em)}` : ""}
              {selected.consultor_nome ? ` · consultor: ${selected.consultor_nome}` : ""}
            </p>
            {canWrite ? (
              <ResourceForm
                key={`${selected.id}:${selected.etapa}:${selected.probabilidade}`}
                action={actions.update}
                fields={editFields}
                values={{ ...selected }}
                hidden={{ id: selected.id }}
                submitLabel="Salvar alterações"
                onSuccess={closeDrawer}
                footer={
                  canDelete ? (
                    <div className="mr-auto">
                      <ConfirmAction
                        action={async (id) => {
                          const r = await actions.remove(id);
                          if (r.ok) closeDrawer();
                          return r;
                        }}
                        id={selected.id}
                        title="Excluir oportunidade?"
                        message="A oportunidade será removida do funil. Esta ação não pode ser desfeita."
                        label="Excluir"
                        size="sm"
                        variant="ghost"
                      />
                    </div>
                  ) : undefined
                }
              />
            ) : (
              selected.observacoes && (
                <div className="rounded-xl bg-surface-2 p-4 text-sm">
                  <p className="mb-1 text-xs font-semibold text-muted">Observações</p>
                  <p className="whitespace-pre-wrap">{selected.observacoes}</p>
                </div>
              )
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</p>
      <div className="mt-1 text-sm font-semibold">{children}</div>
    </div>
  );
}

function nextStepHref(item: OpItem) {
  return item.linha === "consorcio" ? `/consorcios?novo=1&cliente_id=${item.cliente_id}` : `/seguros?novo=1&cliente_id=${item.cliente_id}`;
}

function NextStep({ item }: { item: OpItem }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100 sm:flex-row sm:items-center">
      <Trophy className="h-5 w-5 shrink-0 text-emerald-600" />
      <p className="flex-1">Negócio ganho. Registre {item.linha === "consorcio" ? "a cota de consórcio" : "a apólice de seguro"} para acompanhar parcelas, vigência e comissões.</p>
      <LinkButton href={nextStepHref(item)} size="sm" variant="primary">
        {item.linha === "consorcio" ? "Registrar cota" : "Registrar apólice"}
      </LinkButton>
    </div>
  );
}

function WonNotice({ item, onClose }: { item: OpItem; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 15_000);
    return () => clearTimeout(t);
  }, [onClose]);
  const other = item.linha === "consorcio" ? { href: `/seguros?novo=1&cliente_id=${item.cliente_id}`, label: "Oferecer seguro" } : { href: `/consorcios?novo=1&cliente_id=${item.cliente_id}`, label: "Oferecer consórcio" };
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 animate-pop-in" role="status" aria-live="polite">
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-surface p-4 shadow-pop dark:border-emerald-800">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-600/30">
          <PartyPopper className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Negócio ganho: {item.titulo}</p>
          <p className="mt-0.5 text-xs text-muted">
            Próximo passo: registre {item.linha === "consorcio" ? "a cota de consórcio" : "a apólice"} de {item.cliente_nome ?? "seu cliente"}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkButton href={nextStepHref(item)} size="sm" variant="primary">
              {item.linha === "consorcio" ? "Registrar cota" : "Registrar apólice"}
            </LinkButton>
            <LinkButton href={other.href} size="sm" variant="secondary">
              {other.label}
            </LinkButton>
          </div>
        </div>
        <button onClick={onClose} className="text-muted hover:text-fg" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function OpCard({
  item,
  etapa,
  today,
  canWrite,
  showConsultor,
  dragging,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  item: OpItem;
  etapa: string;
  today: string;
  canWrite: boolean;
  showConsultor: boolean;
  dragging: boolean;
  onOpen: () => void;
  onMove: (etapa: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const linha = LINHAS.find((l) => l.value === item.linha);
  const open = !CLOSED.has(etapa);
  const overdue = open && item.previsao_fechamento && item.previsao_fechamento < today;
  const pending = etapa !== item.etapa;

  return (
    <article
      role="button"
      tabIndex={0}
      draggable={canWrite}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${item.titulo}, ${item.cliente_nome ?? ""}, ${brl(item.valor)}`}
      className={cn(
        "group relative rounded-xl border border-line bg-surface p-3 text-left shadow-sm transition hover:-translate-y-px hover:border-brand-200 hover:shadow-card dark:hover:border-brand-700",
        canWrite && "cursor-grab active:cursor-grabbing",
        dragging && "rotate-1 opacity-50",
        pending && "animate-pulse",
      )}
    >
      <div className="flex items-start gap-2">
        {linha && (
          <Badge tone={linha.tone ?? "slate"} className="!px-2 !py-0 text-[10.5px]">
            {linha.label}
          </Badge>
        )}
        {canWrite && <GripVertical className="ml-auto h-4 w-4 shrink-0 text-muted/50 opacity-0 transition group-hover:opacity-100" aria-hidden />}
        <div ref={menuRef} className={cn("relative", !canWrite && "ml-auto")} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => setMenu((v) => !v)} className="-m-1 grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Ações da oportunidade" aria-expanded={menu} aria-haspopup="menu">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 top-8 z-20 w-56 animate-pop-in rounded-xl border border-line bg-surface p-2 shadow-pop">
              {canWrite && (
                <div className="px-1 pb-2">
                  <label htmlFor={`mover-${item.id}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Mover para
                  </label>
                  <select
                    id={`mover-${item.id}`}
                    className="input h-9 py-1.5"
                    value={etapa}
                    onChange={(e) => {
                      setMenu(false);
                      onMove(e.target.value);
                    }}
                  >
                    {ETAPAS.map((e) => (
                      <option key={e.value} value={e.value}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onOpen();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2"
              >
                <Pencil className="h-4 w-4 text-muted" /> {canWrite ? "Editar detalhes" : "Ver detalhes"}
              </button>
              <Link role="menuitem" href={`/clientes/${item.cliente_id}`} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <Users className="h-4 w-4 text-muted" /> Ver cliente
              </Link>
            </div>
          )}
        </div>
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-snug">{item.titulo}</h3>
      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
        <UserRound className="h-3 w-3 shrink-0" />
        <span className="truncate">{item.cliente_nome ?? "Cliente"}</span>
      </p>
      <div className="mt-2.5 flex items-end justify-between gap-2">
        <div>
          <p className="text-[15px] font-bold tabular-nums tracking-tight">{brl(item.valor)}</p>
          {open && (
            <div className="mt-1 flex items-center gap-1.5">
              <div className="h-1 w-14 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line">
                <div className={cn("h-full rounded-full", TONE_CLS[toneOfEtapa(etapa)].bar)} style={{ width: `${item.probabilidade}%` }} />
              </div>
              <span className="text-[11px] font-medium tabular-nums text-muted">{item.probabilidade}%</span>
            </div>
          )}
        </div>
        {showConsultor && (
          <span title={item.consultor_nome ?? "Sem consultor"}>
            <Avatar name={item.consultor_nome ?? "?"} size={26} />
          </span>
        )}
      </div>
      {(item.previsao_fechamento || (etapa === "perdido" && item.motivo_perda)) && (
        <div className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2 text-[11px]">
          {etapa === "perdido" && item.motivo_perda ? (
            <span className="truncate text-red-600 dark:text-red-400" title={item.motivo_perda}>
              {item.motivo_perda}
            </span>
          ) : (
            <span className={cn("inline-flex items-center gap-1", overdue ? "font-semibold text-red-600 dark:text-red-400" : "text-muted")}>
              <CalendarClock className="h-3.5 w-3.5" />
              {open ? "Previsão" : "Previsto"} {date(item.previsao_fechamento)}
              {overdue && " · atrasada"}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
