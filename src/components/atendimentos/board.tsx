"use client";
import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Mail, MessageCircle, Phone, UserCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { ATENDIMENTO_CANAIS, ATENDIMENTO_STATUS, PRIORIDADES, PROCESSO_AREAS, type Tone } from "@/lib/constants";
import { brl, dateTime, maskPhone, whatsappLink } from "@/lib/format";
import type { ActionState } from "@/lib/actions/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, Modal } from "@/components/ui/drawer";
import { ResourceForm, type FieldDef } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

export interface AtendCard {
  id: string;
  nome_contato: string;
  telefone: string | null;
  email: string | null;
  canal: string;
  data: string;
  area: string;
  assunto: string;
  relato: string | null;
  urgencia: string;
  status: string;
  valor_estimado: number | null;
  responsavel: string | null;
  motivo_recusa: string | null;
  processo_id: string | null;
  cliente_id: string | null;
  values: Record<string, string | number | null>;
}

const TONE_BG: Record<Tone, string> = {
  brand: "border-t-brand-500", accent: "border-t-accent-500", green: "border-t-emerald-500", amber: "border-t-amber-500",
  red: "border-t-red-500", slate: "border-t-slate-400", sky: "border-t-sky-500", violet: "border-t-violet-500",
};

export function AtendimentosBoard({
  items,
  editFields,
  converterFields,
  actions,
}: {
  items: AtendCard[];
  editFields: FieldDef[];
  converterFields: FieldDef[];
  actions: {
    save: (s: ActionState, f: FormData) => Promise<ActionState>;
    mover: (id: string, status: string, motivo?: string | null) => Promise<ActionState>;
    converter: (s: ActionState, f: FormData) => Promise<ActionState>;
  };
}) {
  const [moved, setMoved] = useOptimistic<Record<string, string>, { id: string; s: string }>({}, (st, a) => ({ ...st, [a.id]: a.s }));
  const [, start] = useTransition();
  const [drag, setDrag] = useState<string | null>(null);
  const [aberto, setAberto] = useState<AtendCard | null>(null);
  const [converter, setConverter] = useState<AtendCard | null>(null);
  const [recusa, setRecusa] = useState<{ item: AtendCard; motivo: string } | null>(null);
  const router = useRouter();
  const toast = useToast();
  const statusOf = (i: AtendCard) => moved[i.id] ?? i.status;

  const mover = (item: AtendCard, s: string, motivo?: string) => {
    if (statusOf(item) === s) return;
    if (s === "recusado" && motivo === undefined) return setRecusa({ item, motivo: "" });
    if (s === "contratado") return setConverter(item);
    start(async () => {
      setMoved({ id: item.id, s });
      const r = await actions.mover(item.id, s, motivo ?? null);
      if (!r.ok) toast(r.error ?? "Não foi possível mover.", "error");
      else router.refresh();
    });
  };

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex gap-3">
          {ATENDIMENTO_STATUS.map((col) => {
            const list = items.filter((i) => statusOf(i) === col.value);
            return (
              <section
                key={col.value}
                onDragOver={(e) => drag && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const it = items.find((i) => i.id === drag);
                  setDrag(null);
                  if (it) mover(it, col.value);
                }}
                className={cn("flex w-72 shrink-0 flex-col rounded-2xl border border-t-4 border-line bg-surface-2/60", TONE_BG[col.tone ?? "slate"])}
                aria-label={`${col.label}: ${list.length}`}
              >
                <header className="flex items-center justify-between px-3 py-2.5">
                  <h3 className="text-sm font-semibold">{col.label}</h3>
                  <span className="rounded-full bg-surface px-2 text-xs font-semibold text-muted">{list.length}</span>
                </header>
                <div className="flex min-h-24 flex-col gap-2 px-2 pb-3">
                  {list.map((i) => (
                    <article
                      key={i.id}
                      draggable
                      onDragStart={() => setDrag(i.id)}
                      onDragEnd={() => setDrag(null)}
                      onClick={() => setAberto(i)}
                      className="cursor-pointer rounded-xl border border-line bg-surface p-3 shadow-sm transition hover:shadow-card"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug">{i.nome_contato}</p>
                        <StatusBadge options={PRIORIDADES} value={i.urgencia} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{i.assunto}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <Badge tone="brand">{optionLabel(PROCESSO_AREAS, i.area)}</Badge>
                        <span className="text-muted">{optionLabel(ATENDIMENTO_CANAIS, i.canal)}</span>
                        {i.valor_estimado ? <span className="font-semibold">{brl(i.valor_estimado)}</span> : null}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                        <span>{dateTime(i.data)}</span>
                        {i.responsavel && <Avatar name={i.responsavel} size={22} />}
                      </div>
                      <label className="sr-only" htmlFor={`mv-${i.id}`}>Mover</label>
                      <select
                        id={`mv-${i.id}`}
                        value={statusOf(i)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => mover(i, e.target.value)}
                        className="input mt-2 h-8 py-0 text-xs"
                      >
                        {ATENDIMENTO_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <Drawer open={!!aberto} onClose={() => setAberto(null)} title={aberto?.nome_contato ?? ""} description={aberto?.assunto} width="max-w-2xl">
        {aberto && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {aberto.telefone && <a href={`tel:${aberto.telefone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm"><Phone className="h-4 w-4" /> {maskPhone(aberto.telefone)}</a>}
              {whatsappLink(aberto.telefone) && <a href={whatsappLink(aberto.telefone)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white"><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
              {aberto.email && <a href={`mailto:${aberto.email}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm"><Mail className="h-4 w-4" /> {aberto.email}</a>}
              {aberto.status !== "contratado" && (
                <Button size="sm" variant="accent" onClick={() => { setConverter(aberto); setAberto(null); }}>
                  <UserCheck className="h-4 w-4" /> Converter em cliente / processo
                </Button>
              )}
            </div>
            {aberto.relato && <p className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-sm">{aberto.relato}</p>}
            {aberto.motivo_recusa && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">Motivo da recusa: {aberto.motivo_recusa}</p>}
            <ResourceForm action={actions.save} fields={editFields} values={aberto.values} hidden={{ id: aberto.id }} submitLabel="Salvar alterações" onSuccess={() => { setAberto(null); router.refresh(); }} />
          </div>
        )}
      </Drawer>

      <Drawer open={!!converter} onClose={() => setConverter(null)} title="Converter atendimento" description={converter ? `${converter.nome_contato} — ${converter.assunto}` : undefined} width="max-w-xl">
        {converter && (
          <ResourceForm
            action={actions.converter}
            fields={converterFields}
            values={{ criar_processo: true, titulo_processo: converter.assunto, criar_contrato: false, tipo_contrato: "fixo" }}
            hidden={{ id: converter.id }}
            submitLabel="Converter"
            onSuccess={(s) => {
              setConverter(null);
              if (s.id) router.push(s.id);
              else router.refresh();
            }}
          />
        )}
      </Drawer>

      <Modal open={!!recusa} onClose={() => setRecusa(null)} title="Recusar atendimento">
        {recusa && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const r = recusa;
              setRecusa(null);
              mover(r.item, "recusado", r.motivo);
            }}
            className="space-y-4"
          >
            <label className="label" htmlFor="motivo">Motivo</label>
            <textarea id="motivo" value={recusa.motivo} onChange={(e) => setRecusa({ ...recusa, motivo: e.target.value })} rows={3} className="input" placeholder="Ex.: sem viabilidade jurídica, fora da área de atuação…" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRecusa(null)}>Cancelar</Button>
              <Button type="submit" variant="danger"><ArrowRightLeft className="h-4 w-4" /> Recusar</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
