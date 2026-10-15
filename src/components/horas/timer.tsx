"use client";
import { useEffect, useState } from "react";
import { Pause, Play, Square, Timer as TimerIcon } from "lucide-react";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { ResourceForm, type FieldDef } from "@/components/ui/form";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/format";

const KEY = "ge-timer";
interface TimerState {
  inicio: number | null; // epoch ms quando rodando
  acumulado: number; // ms já contados
}

const load = (): TimerState => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as TimerState;
  } catch {}
  return { inicio: null, acumulado: 0 };
};
const save = (s: TimerState) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
};

/** Cronômetro persistente (sobrevive a recarregar a página). Ao parar, abre o formulário com a duração. */
export function HorasTimer({ action, fields }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; fields: FieldDef[] }) {
  const [st, setSt] = useState<TimerState>({ inicio: null, acumulado: 0 });
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [minutos, setMinutos] = useState(0);
  const router = useRouter();

  useEffect(() => setSt(load()), []);
  useEffect(() => {
    if (!st.inicio) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [st.inicio]);

  const ms = st.acumulado + (st.inicio ? now - st.inicio : 0);
  const total = Math.floor(ms / 1000);
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  const update = (s: TimerState) => {
    setSt(s);
    save(s);
  };

  return (
    <div className="card flex flex-wrap items-center gap-4 p-5">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg">
        <TimerIcon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">Cronômetro de atividade</p>
        <p className="font-mono text-3xl font-bold tabular-nums tracking-tight" aria-live="polite">
          {hh}:{mm}:{ss}
        </p>
      </div>
      <div className="flex gap-2">
        {st.inicio ? (
          <Button variant="secondary" onClick={() => update({ inicio: null, acumulado: ms })}>
            <Pause className="h-4 w-4" /> Pausar
          </Button>
        ) : (
          <Button variant="primary" onClick={() => update({ inicio: Date.now(), acumulado: st.acumulado })}>
            <Play className="h-4 w-4" /> {st.acumulado ? "Retomar" : "Iniciar"}
          </Button>
        )}
        <Button
          variant="accent"
          disabled={ms < 60000}
          onClick={() => {
            setMinutos(Math.max(1, Math.round(ms / 60000)));
            update({ inicio: null, acumulado: ms });
            setOpen(true);
          }}
        >
          <Square className="h-4 w-4" /> Parar e lançar
        </Button>
      </div>
      <Drawer open={open} onClose={() => setOpen(false)} title="Lançar horas do cronômetro" width="max-w-xl">
        {open && (
          <ResourceForm
            action={action}
            fields={fields}
            values={{ data: todayISO(), duracao: `${Math.floor(minutos / 60)}:${String(minutos % 60).padStart(2, "0")}`, faturavel: true }}
            submitLabel="Lançar horas"
            onSuccess={() => {
              update({ inicio: null, acumulado: 0 });
              setOpen(false);
              router.refresh();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
