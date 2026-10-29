import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Navigation } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfileMap } from "@/lib/data";
import { CHECKIN_FLAGS, ROTA_STATUS } from "@/lib/constants";
import { relative, time, todayISO } from "@/lib/format";
import { linkTrajeto } from "@/lib/integracoes/maps";
import type { CheckinRota, Rota } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { RealtimeRefresh } from "@/components/ui/realtime-refresh";
import { Mapa, type Marcador, type TomMapa } from "@/components/mapa/mapa";

export const metadata: Metadata = { title: "Mapa do campo" };

/** Acompanhamento do dia em tempo quase real: onde cada consultor fez o último check-in e o andamento das rotas. */
export default async function MapaCampoPage() {
  await requirePermission("rotas.ver");
  const supabase = await createClient();
  const hoje = todayISO();
  const [{ data: rRows }, profiles] = await Promise.all([
    supabase.from("rotas").select("*").eq("data", hoje).neq("status", "cancelada").order("nome"),
    getProfileMap(),
  ]);
  const rotas = (rRows ?? []) as Rota[];
  const ids = rotas.map((r) => r.id);
  const [{ data: cRows }, { data: pRows }] = ids.length
    ? await Promise.all([
        supabase.from("checkins").select("*").in("rota_id", ids).order("registrado_em"),
        supabase.from("rota_paradas").select("id, rota_id, titulo, status, lat, lng").in("rota_id", ids).order("ordem"),
      ])
    : [{ data: [] }, { data: [] }];
  const checkins = (cRows ?? []) as CheckinRota[];
  const paradas = (pRows ?? []) as { id: string; rota_id: string; titulo: string; status: string; lat: number | null; lng: number | null }[];
  const TOM: Record<string, TomMapa> = { pendente: "brand", visitada: "green", nao_realizada: "red", reagendada: "slate" };
  const nomeDe = (r: Rota) => profiles.get(r.consultor_id)?.full_name ?? "Consultor";
  const marcadores: Marcador[] = [
    ...paradas.filter((p) => p.lat != null && p.lng != null).map((p) => {
      const r = rotas.find((x) => x.id === p.rota_id);
      return { lat: Number(p.lat), lng: Number(p.lng), pequeno: true, tom: TOM[p.status] ?? "brand", titulo: `${p.titulo}${r ? ` · ${nomeDe(r)}` : ""}` };
    }),
    // último check-in de cada rota: onde o consultor está agora
    ...rotas.flatMap((r) => {
      const ult = checkins.filter((c) => c.rota_id === r.id).at(-1);
      const nome = nomeDe(r);
      return ult ? [{ lat: ult.lat, lng: ult.lng, rotulo: nome.trim().charAt(0).toUpperCase(), tom: "accent" as TomMapa, titulo: `${nome} · ${ult.tipo === "chegada" ? "chegou" : "saiu"} às ${time(ult.registrado_em)}` }] : [];
    }),
  ];

  return (
    <>
      <PageHeader eyebrow="Campo" title="Mapa do campo" description="Rotas de hoje, último check-in de cada consultor e inconsistências — atualizado em tempo quase real." actions={<RealtimeRefresh tabelas={["checkins", "rotas"]} />} />
      {rotas.length === 0 ? <Card><EmptyState icon={<MapPin className="h-6 w-6" />} title="Nenhuma rota hoje" /></Card> : (
        <>
        <Card className="mb-6">
          <CardHeader title="Campo agora" description="Laranja: último check-in de cada consultor (inicial do nome). Pontos: paradas — azul pendente, verde visitada, vermelho não realizada." icon={<MapPin className="h-4 w-4" />} />
          <div className="px-5 pb-5"><Mapa marcadores={marcadores} className="h-96 lg:h-[28rem]" /></div>
        </Card>
        <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {rotas.map((r) => {
            const cs = checkins.filter((c) => c.rota_id === r.id);
            const ult = cs[cs.length - 1];
            const ps = paradas.filter((p) => p.rota_id === r.id);
            const feitas = ps.filter((p) => p.status === "visitada").length;
            const trajeto = linkTrajeto(cs.filter((c) => c.tipo === "chegada").map((c) => ({ lat: c.lat, lng: c.lng })));
            const alertas = cs.filter((c) => c.dentro_do_raio === false || c.flags.length > 0).length;
            return (
              <Card key={r.id}>
                <CardHeader
                  title={<Link href={`/rotas/${r.id}`} className="hover:text-brand-600">{profiles.get(r.consultor_id)?.full_name ?? "Consultor"}</Link>}
                  description={r.nome}
                  action={<StatusBadge options={ROTA_STATUS} value={r.status} />}
                />
                <div className="space-y-3 px-5 pb-5">
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-emerald-500" style={{ width: `${ps.length ? (feitas / ps.length) * 100 : 0}%` }} /></div>
                  <p className="text-sm">{feitas} de {ps.length} parada(s) visitada(s){alertas ? <Badge tone="amber" className="ml-2">{alertas} alerta(s)</Badge> : null}</p>
                  {ult ? (
                    <p className="text-sm">
                      Último check-in: <b>{ult.tipo === "chegada" ? "chegada" : "saída"}</b> às {time(ult.registrado_em)} ({relative(ult.registrado_em)}) ·{" "}
                      <a href={`https://www.google.com/maps/search/?api=1&query=${ult.lat},${ult.lng}`} target="_blank" rel="noopener noreferrer" className="text-brand-600">ver no mapa</a>
                      {ult.flags.map((f) => <Badge key={f} tone="amber" className="ml-1">{CHECKIN_FLAGS[f] ?? f}</Badge>)}
                    </p>
                  ) : <p className="text-sm text-muted">{r.status === "planejada" ? "Rota ainda não iniciada." : "Sem check-ins ainda."}</p>}
                  {trajeto && <a href={trajeto} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600"><Navigation className="h-4 w-4" />Percurso realizado</a>}
                </div>
              </Card>
            );
          })}
        </div>
        </>
      )}
    </>
  );
}
