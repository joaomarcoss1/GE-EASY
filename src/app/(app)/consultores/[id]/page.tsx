import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Landmark, Mail, MapPin, Phone, ShieldCheck, Users, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CLIENTE_STATUS, COMISSAO_STATUS, ETAPAS, ROLE_LABEL } from "@/lib/constants";
import { brl, brlShort, date, dateTime, maskPhone, pct } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { updateConsultor } from "@/lib/actions/usuarios";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { consultorEditFields } from "@/components/configuracoes/usuario-fields";
import { emptyStats, mesAtual, statsPorConsultor } from "@/components/consultores/stats";
import { VISITA_RESULTADOS, duration, mapsLink } from "@/components/visitas/options";

export const metadata: Metadata = { title: "Consultor" };

export default async function ConsultorPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile: me } = await requirePermission("consultores.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from("membros").select("*").eq("id", id).maybeSingle<Profile>();
  if (!c) notFound();
  const { ini } = mesAtual();

  const [stats, { data: clientes }, { data: visitas }, { data: oportunidades }, { data: comissoes }] = await Promise.all([
    statsPorConsultor([id]),
    supabase.from("clientes").select("id, nome, cidade, uf, status, created_at").eq("consultor_id", id).order("created_at", { ascending: false }).limit(50),
    supabase
      .from("visitas")
      .select("id, checkin_em, checkout_em, checkin_lat, checkin_lng, resultado, observacoes, clientes(nome)")
      .eq("consultor_id", id)
      .order("checkin_em", { ascending: false })
      .limit(20),
    supabase.from("oportunidades").select("id, titulo, etapa, valor").eq("consultor_id", id).order("created_at", { ascending: false }).limit(10),
    supabase.from("comissoes").select("id, descricao, valor_consultor, status").eq("consultor_id", id).eq("competencia", ini).order("created_at", { ascending: false }),
  ]);
  const s = stats.get(id) ?? emptyStats();

  return (
    <>
      <Link href="/consultores" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Consultores
      </Link>
      <Card className="mb-6 overflow-hidden">
        <div className="brand-gradient h-20" />
        <div className="-mt-10 flex flex-col gap-5 px-6 pb-6 sm:flex-row sm:items-end">
          <Avatar name={c.full_name} src={c.avatar_url} size={84} className="ring-4 ring-surface" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{c.full_name || c.email}</h1>
              <Badge tone={c.role === "consultor_externo" ? "accent" : "sky"}>{ROLE_LABEL[c.role]}</Badge>
              {!c.active && <Badge tone="slate">Inativo</Badge>}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              {c.cargo && <span>{c.cargo}</span>}
              {c.territorio && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {c.territorio}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />
                {c.email}
              </span>
              {c.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" />
                  {maskPhone(c.phone)}
                </span>
              )}
              <span>
                Comissão: <b className="font-medium text-fg">{pct(c.comissao_percentual)}</b>
              </span>
            </div>
          </div>
          <FormDrawerButton
            action={updateConsultor}
            fields={consultorEditFields(me.role === "admin")}
            values={{ territorio: c.territorio, cargo: c.cargo, comissao_percentual: c.comissao_percentual }}
            hidden={{ id }}
            title="Editar consultor"
            label="Editar"
            icon="edit"
            variant="secondary"
            width="max-w-lg"
          />
        </div>
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Carteira de clientes" value={s.clientes} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Crédito vendido no mês" value={brlShort(s.credito)} icon={<Landmark className="h-5 w-5" />} tone="accent" />
        <StatCard label="Prêmios no mês" value={brlShort(s.premio)} icon={<ShieldCheck className="h-5 w-5" />} tone="green" />
        <StatCard label="Comissão do mês" value={brlShort(s.comissao)} hint={`${s.visitas} visita(s) no mês`} icon={<Wallet className="h-5 w-5" />} tone="amber" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Últimas visitas" icon={<MapPin className="h-4 w-4" />} />
          {!visitas?.length ? (
            <EmptyState title="Nenhuma visita registrada" />
          ) : (
            <ul className="divide-y divide-line">
              {visitas.map((v) => {
                const cli = v.clientes as unknown as { nome: string } | null;
                const res = VISITA_RESULTADOS.find((r) => r.value === v.resultado);
                const map = mapsLink(v.checkin_lat, v.checkin_lng);
                return (
                  <li key={v.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{cli?.nome ?? "Sem cliente vinculado"}</p>
                      <p className="text-xs text-muted">
                        {dateTime(v.checkin_em)} · {v.checkout_em ? duration(v.checkin_em, v.checkout_em) : "em andamento"}
                      </p>
                      {v.observacoes && <p className="mt-1 text-xs">{v.observacoes}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {res && <Badge tone={res.tone}>{res.label}</Badge>}
                      {map && (
                        <a href={map} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">
                          Mapa <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Carteira de clientes" icon={<Users className="h-4 w-4" />} />
          {!clientes?.length ? (
            <EmptyState title="Nenhum cliente na carteira" />
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Cidade</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((cl) => (
                    <tr key={cl.id}>
                      <td>
                        <Link href={`/clientes/${cl.id}`} className="font-medium hover:text-brand-600">
                          {cl.nome}
                        </Link>
                        <div className="text-xs text-muted">desde {date(cl.created_at)}</div>
                      </td>
                      <td className="text-sm">{cl.cidade ? `${cl.cidade}${cl.uf ? `/${cl.uf}` : ""}` : "—"}</td>
                      <td>
                        <StatusBadge options={CLIENTE_STATUS} value={cl.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Negócios recentes" />
          {!oportunidades?.length ? (
            <EmptyState title="Nenhuma oportunidade" />
          ) : (
            <ul className="divide-y divide-line">
              {oportunidades.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <Link href={`/oportunidades?abrir=${o.id}`} className="min-w-0 truncate text-sm font-medium hover:text-brand-600">
                    {o.titulo}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm tabular-nums">{brl(o.valor)}</span>
                    <StatusBadge options={ETAPAS} value={o.etapa} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Comissões do mês" icon={<Wallet className="h-4 w-4" />} />
          {!comissoes?.length ? (
            <EmptyState title="Nenhuma comissão neste mês" />
          ) : (
            <ul className="divide-y divide-line">
              {comissoes.map((cm) => (
                <li key={cm.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0 truncate text-sm">{cm.descricao ?? "Comissão"}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">{brl(cm.valor_consultor)}</span>
                    <StatusBadge options={COMISSAO_STATUS} value={cm.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
