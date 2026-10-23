"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Atualiza a página quando há mudança nas tabelas indicadas (Supabase Realtime). O Realtime respeita o RLS:
 * cada usuário só recebe eventos de linhas que pode ver (inclusive o isolamento entre empresas).
 */
export function RealtimeRefresh({ tabelas, intervaloSeg = 60 }: { tabelas: string[]; intervaloSeg?: number }) {
  const router = useRouter();
  const [ao, setAo] = useState(false);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chave = tabelas.join(",");
  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (espera.current) clearTimeout(espera.current);
      espera.current = setTimeout(() => router.refresh(), 800);
    };
    let canal = supabase.channel(`rt-${chave}`);
    for (const t of chave.split(",")) canal = canal.on("postgres_changes", { event: "*", schema: "public", table: t }, refresh);
    canal.subscribe((s) => setAo(s === "SUBSCRIBED"));
    const t = setInterval(() => router.refresh(), intervaloSeg * 1000); // reserva caso o tempo real caia
    return () => {
      clearInterval(t);
      if (espera.current) clearTimeout(espera.current);
      supabase.removeChannel(canal);
    };
  }, [router, chave, intervaloSeg]);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={ao ? "Atualização em tempo real ativa" : "Atualizando a cada minuto"}>
      <Radio className={ao ? "h-3.5 w-3.5 text-emerald-500" : "h-3.5 w-3.5"} /> {ao ? "ao vivo" : "atualização periódica"}
    </span>
  );
}
