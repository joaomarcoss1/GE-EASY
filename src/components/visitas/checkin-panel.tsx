"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LocateFixed, LogOut, MapPin, Navigation, Timer } from "lucide-react";
import type { Option } from "@/lib/constants";
import { checkIn, checkOut } from "@/lib/actions/visitas";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { VISITA_RESULTADOS, mapsLink } from "./options";

export interface OpenVisit {
  id: string;
  checkin_em: string;
  cliente_nome: string | null;
  evento_titulo: string | null;
  lat: number | null;
  lng: number | null;
  precisao: number | null;
}

export interface TodayEvent {
  id: string;
  titulo: string;
  hora: string;
  cliente_id: string | null;
  local: string | null;
}

function geoErrorMessage(err: GeolocationPositionError | null) {
  if (!err) return "Seu navegador não oferece geolocalização. Use um celular com GPS ou outro navegador.";
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Permissão de localização negada. Toque no cadeado da barra de endereço, permita a localização para este site e tente novamente.";
    case err.POSITION_UNAVAILABLE:
      return "Não foi possível obter sua posição. Ative o GPS/localização do aparelho e tente em um local aberto.";
    case err.TIMEOUT:
      return "A localização demorou demais para responder. Verifique o GPS e tente novamente.";
    default:
      return "Falha ao obter a localização.";
  }
}

function useElapsed(since: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function OpenVisitCard({ visit }: { visit: OpenVisit }) {
  const elapsed = useElapsed(visit.checkin_em);
  const [resultado, setResultado] = useState("");
  const [obs, setObs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const map = mapsLink(visit.lat, visit.lng);

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      <div className="brand-gradient px-5 py-6 text-white">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/70">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          Visita em andamento
        </div>
        <p className="mt-2 text-xl font-bold">{visit.cliente_nome ?? visit.evento_titulo ?? "Visita sem cliente vinculado"}</p>
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="flex items-center gap-2">
            <Timer className="h-6 w-6 text-accent-300" />
            <span className="font-mono text-4xl font-bold tabular-nums tracking-tight" aria-live="off" suppressHydrationWarning>
              {elapsed}
            </span>
          </div>
          {map && (
            <a href={map} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/20">
              <MapPin className="h-4 w-4" /> Local do check-in
            </a>
          )}
        </div>
        {visit.precisao != null && <p className="mt-2 text-xs text-white/60">Precisão do GPS: ±{Math.round(visit.precisao)} m</p>}
      </div>
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!resultado) {
            setError("Selecione o resultado da visita.");
            return;
          }
          setError(null);
          start(async () => {
            const r = await checkOut({ id: visit.id, resultado, observacoes: obs });
            if (r.ok) {
              toast(r.message ?? "Check-out registrado.");
              router.refresh();
            } else setError(r.fieldErrors ? Object.values(r.fieldErrors)[0] : (r.error ?? "Falha no check-out."));
          });
        }}
      >
        <div>
          <label htmlFor="resultado" className="label">
            Resultado da visita <span className="text-accent-500">*</span>
          </label>
          <select id="resultado" value={resultado} onChange={(e) => setResultado(e.target.value)} className="input h-12 text-base" required>
            <option value="">Selecione…</option>
            {VISITA_RESULTADOS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="obs-out" className="label">
            Observações
          </label>
          <textarea id="obs-out" value={obs} onChange={(e) => setObs(e.target.value)} rows={3} maxLength={2000} className="input resize-y text-base" placeholder="Próximos passos, objeções, produto de interesse…" />
        </div>
        {error && (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={pending} className="h-14 w-full text-base">
          <LogOut className="h-5 w-5" /> Fazer check-out
        </Button>
      </form>
    </div>
  );
}

function CheckInCard({ clientes, eventos }: { clientes: Option[]; eventos: TodayEvent[] }) {
  const [clienteId, setClienteId] = useState("");
  const [eventoId, setEventoId] = useState("");
  const [obs, setObs] = useState("");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function onEvento(id: string) {
    setEventoId(id);
    const ev = eventos.find((e) => e.id === id);
    if (ev?.cliente_id && clientes.some((c) => c.value === ev.cliente_id)) setClienteId(ev.cliente_id);
  }

  function doCheckIn() {
    setError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator) || !window.isSecureContext) {
      setError(geoErrorMessage(null));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        start(async () => {
          const r = await checkIn({
            cliente_id: clienteId || null,
            evento_id: eventoId || null,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            precisao: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
            observacoes: obs,
          });
          if (r.ok) {
            toast(r.message ?? "Check-in realizado.");
            setObs("");
            router.refresh();
          } else setError(r.fieldErrors ? Object.values(r.fieldErrors)[0] : (r.error ?? "Falha no check-in."));
        });
      },
      (err) => {
        setLocating(false);
        setError(geoErrorMessage(err));
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  const busy = locating || pending;
  return (
    <div className="space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-card">
      {eventos.length > 0 && (
        <div>
          <label htmlFor="evento" className="label">
            Compromisso de hoje (opcional)
          </label>
          <select id="evento" value={eventoId} onChange={(e) => onEvento(e.target.value)} className="input h-12 text-base">
            <option value="">Visita avulsa</option>
            {eventos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.hora} · {e.titulo}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="cliente" className="label">
          Cliente
        </label>
        <select id="cliente" value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="input h-12 text-base">
          <option value="">Sem cliente (prospecção)</option>
          {clientes.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="obs-in" className="label">
          Observações
        </label>
        <textarea id="obs-in" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} maxLength={2000} className="input resize-y text-base" placeholder="Objetivo da visita (opcional)" />
      </div>
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <Button type="button" variant="accent" size="lg" onClick={doCheckIn} loading={busy} className="h-16 w-full rounded-2xl text-lg">
        {!busy && <LocateFixed className="h-6 w-6" />}
        {locating ? "Obtendo localização…" : pending ? "Registrando…" : "Fazer check-in"}
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
        <Navigation className="h-3.5 w-3.5" /> Sua localização é registrada apenas no momento do check-in.
      </p>
    </div>
  );
}

/** Aplicativo de campo: check-in com GPS ou check-out da visita em andamento. */
export function CheckinPanel({ openVisit, clientes, eventos }: { openVisit: OpenVisit | null; clientes: Option[]; eventos: TodayEvent[] }) {
  return openVisit ? <OpenVisitCard visit={openVisit} /> : <CheckInCard clientes={clientes} eventos={eventos} />;
}
