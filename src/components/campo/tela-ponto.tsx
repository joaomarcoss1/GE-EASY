"use client";
import { useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { useCampo } from "./contexto";
import { posicaoAtual } from "./tipos";

const TIPOS = [
  { v: "entrada", l: "Entrada" },
  { v: "intervalo_inicio", l: "Início do intervalo" },
  { v: "intervalo_fim", l: "Fim do intervalo" },
  { v: "saida", l: "Saída" },
] as const;

/**
 * Ponto pelo app: o horário oficial é o do servidor; sem internet, a marcação guarda o horário do aparelho e
 * vai marcada como "registrada offline" para conferência. A localização é lida só no ato da marcação.
 */
export function TelaPonto() {
  const { snap, registrar, aviso } = useCampo();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const ultima = snap.ponto_hoje[snap.ponto_hoje.length - 1]?.tipo;
  const sugerido = !ultima ? "entrada" : ultima === "entrada" ? "intervalo_inicio" : ultima === "intervalo_inicio" ? "intervalo_fim" : ultima === "intervalo_fim" ? "saida" : null;

  const marcar = async (tipo: (typeof TIPOS)[number]["v"]) => {
    setOcupado(tipo);
    try {
      const pos = await posicaoAtual(15000).catch(() => null);
      await registrar("ponto", { id: crypto.randomUUID(), tipo, lat: pos?.lat ?? null, lng: pos?.lng ?? null, precisao: pos?.precisao ?? null, dispositivo_em: new Date().toISOString() }, `Ponto: ${TIPOS.find((t) => t.v === tipo)?.l}`);
      aviso("Marcação registrada.");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Ponto</h1>
      <div className="grid grid-cols-2 gap-3">
        {TIPOS.map((t) => (
          <button key={t.v} type="button" disabled={!!ocupado} onClick={() => marcar(t.v)} className={`card flex flex-col items-center gap-2 py-5 font-semibold ${sugerido === t.v ? "border-brand-600 ring-2 ring-brand-600/30" : ""}`}>
            {ocupado === t.v ? <Loader2 className="h-6 w-6 animate-spin" /> : <Clock className="h-6 w-6" />}{t.l}
          </button>
        ))}
      </div>
      <section className="card">
        <p className="border-b border-line px-4 py-3 text-sm font-semibold">Hoje</p>
        {snap.ponto_hoje.length === 0 ? <p className="px-4 py-3 text-sm text-muted">Nenhuma marcação.</p> : (
          <ul className="divide-y divide-line">{snap.ponto_hoje.map((m) => <li key={m.id} className="flex justify-between px-4 py-2.5 text-sm"><span>{TIPOS.find((t) => t.v === m.tipo)?.l ?? m.tipo}</span><span className="font-mono">{new Date(m.registrado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></li>)}</ul>
        )}
      </section>
      <p className="text-[11px] text-muted">Controle interno de jornada. A localização é registrada somente no momento da marcação.</p>
    </div>
  );
}
