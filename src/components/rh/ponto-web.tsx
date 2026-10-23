"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2 } from "lucide-react";
import { registrarPontoWeb } from "@/lib/actions/rh";
import { useToast } from "@/components/ui/toast";
import { PONTO_TIPOS } from "@/lib/constants";

const proximo = (ultima?: string) => (!ultima ? "entrada" : ultima === "entrada" ? "intervalo_inicio" : ultima === "intervalo_inicio" ? "intervalo_fim" : ultima === "intervalo_fim" ? "saida" : "entrada");

/** Marcação pelo navegador: a localização é lida só no clique; o horário é o do servidor. */
export function PontoWeb({ ultima }: { ultima?: string }) {
  const [pending, start] = useTransition();
  const [lendo, setLendo] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const sugerido = proximo(ultima);

  const marcar = (tipo: string) => {
    setLendo(tipo);
    const enviar = (pos: GeolocationPosition | null) =>
      start(async () => {
        const fd = new FormData();
        fd.set("tipo", tipo);
        if (pos) {
          fd.set("lat", String(pos.coords.latitude));
          fd.set("lng", String(pos.coords.longitude));
          fd.set("precisao", String(Math.round(pos.coords.accuracy)));
        }
        const r = await registrarPontoWeb({}, fd);
        setLendo(null);
        if (r.ok) {
          toast(r.message ?? "Marcação registrada.");
          router.refresh();
        } else toast(r.error ?? "Não foi possível registrar.", "error");
      });
    if (!navigator.geolocation) return enviar(null);
    navigator.geolocation.getCurrentPosition((p) => enviar(p), () => enviar(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };

  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {PONTO_TIPOS.map((t) => (
        <button key={t.value} type="button" disabled={pending || !!lendo} onClick={() => marcar(t.value)}
          className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-4 text-sm font-semibold transition disabled:opacity-60 ${t.value === sugerido ? "border-brand-700 bg-brand-700 text-white" : "border-line hover:bg-surface-2"}`}>
          {lendo === t.value ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}{t.label}
        </button>
      ))}
    </div>
  );
}
