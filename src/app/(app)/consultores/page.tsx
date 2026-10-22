import type { Metadata } from "next";
import Link from "next/link";
import { BriefcaseBusiness, Landmark, MapPin, Users, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getProfiles } from "@/lib/data";
import { ROLE_LABEL } from "@/lib/constants";
import { brlShort, pct, relative } from "@/lib/format";
import { inviteUsuario } from "@/lib/actions/usuarios";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { SegmentTabs } from "@/components/ui/filters";
import { inviteFields } from "@/components/configuracoes/usuario-fields";
import { emptyStats, statsPorConsultor } from "@/components/consultores/stats";

export const metadata: Metadata = { title: "Consultores" };

export default async function ConsultoresPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const { profile } = await requirePermission("consultores.manage");
  const { tipo } = await searchParams;
  const all = (await getProfiles()).filter((p) => p.role === "consultor" || p.role === "consultor_externo");
  const lista = all.filter((p) => (tipo === "internos" ? p.role === "consultor" : tipo === "externos" ? p.role === "consultor_externo" : true));
  const stats = await statsPorConsultor(lista.map((p) => p.id));

  const rows = lista
    .map((p) => ({ p, s: stats.get(p.id) ?? emptyStats() }))
    .sort((a, b) => Number(b.p.active) - Number(a.p.active) || b.s.credito + b.s.premio - (a.s.credito + a.s.premio));
  const tot = rows.reduce(
    (a, r) => ({ credito: a.credito + r.s.credito, premio: a.premio + r.s.premio, visitas: a.visitas + r.s.visitas, ativos: a.ativos + (r.p.active ? 1 : 0) }),
    { credito: 0, premio: 0, visitas: 0, ativos: 0 },
  );
  const externosAtivos = all.filter((p) => p.role === "consultor_externo" && p.active).length;

  return (
    <>
      <PageHeader
        eyebrow="Gestão"
        title="Consultores"
        description="Equipe interna e consultores externos: carteira, produção do mês, comissões e visitas de campo."
        actions={
          can(profile, "usuarios.manage") && (
            <FormDrawerButton action={inviteUsuario} fields={inviteFields} values={{ role: "consultor_externo" }} title="Convidar consultor" label="Convidar consultor" variant="accent" submitLabel="Enviar convite" />
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Consultores ativos" value={tot.ativos} hint={`${externosAtivos} externo(s)`} icon={<BriefcaseBusiness className="h-5 w-5" />} />
        <StatCard label="Crédito vendido no mês" value={brlShort(tot.credito)} icon={<Landmark className="h-5 w-5" />} tone="accent" />
        <StatCard label="Prêmios emitidos no mês" value={brlShort(tot.premio)} icon={<Wallet className="h-5 w-5" />} tone="green" />
        <StatCard label="Visitas no mês" value={tot.visitas} icon={<MapPin className="h-5 w-5" />} tone="amber" />
      </div>
      <Card>
        <div className="border-b border-line p-4">
          <SegmentTabs
            param="tipo"
            options={[
              { value: "todos", label: "Todos" },
              { value: "internos", label: "Internos" },
              { value: "externos", label: "Externos" },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="Nenhum consultor cadastrado" description="Convide consultores pelo botão acima ou em Configurações › Usuários." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Consultor</th>
                  <th>Território</th>
                  <th className="text-right">Carteira</th>
                  <th className="text-right">Crédito (mês)</th>
                  <th className="text-right">Prêmio (mês)</th>
                  <th className="text-right">Comissão (mês)</th>
                  <th className="text-right">Visitas</th>
                  <th>Último check-in</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, s }) => (
                  <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                    <td>
                      <Link href={`/consultores/${p.id}`} className="flex items-center gap-3">
                        <Avatar name={p.full_name} src={p.avatar_url} size={36} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold hover:text-brand-600">{p.full_name || p.email}</span>
                          <span className="flex items-center gap-1.5 text-xs text-muted">
                            {ROLE_LABEL[p.role]}
                            {p.comissao_percentual > 0 && <span>· {pct(p.comissao_percentual)}</span>}
                            {!p.active && <Badge tone="slate">Inativo</Badge>}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="text-sm">{p.territorio ?? <span className="text-muted">—</span>}</td>
                    <td className="text-right tabular-nums">{s.clientes}</td>
                    <td className="text-right tabular-nums">{brlShort(s.credito)}</td>
                    <td className="text-right tabular-nums">{brlShort(s.premio)}</td>
                    <td className="text-right font-semibold tabular-nums">{brlShort(s.comissao)}</td>
                    <td className="text-right tabular-nums">{s.visitas}</td>
                    <td className="text-xs text-muted">{s.ultimaVisita ? relative(s.ultimaVisita) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
