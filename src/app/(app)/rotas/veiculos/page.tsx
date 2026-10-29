import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Car, Fuel, Gauge, Route, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfileMap, userOptions } from "@/lib/data";
import { parametrosRotas } from "@/lib/parametros";
import { custoPercurso } from "@/lib/geo";
import { brl, num, todayISO } from "@/lib/format";
import { salvarVeiculo } from "@/lib/actions/rotas";
import type { RotaResumo } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ParametrosRotasForm, veiculoFields } from "@/components/configuracoes/rotas-tab";

export const metadata: Metadata = { title: "Veículos e combustível" };

/** Frota/carros dos consultores, consumo e uso do mês (km, litros e gasto estimado das rotas executadas). */
export default async function VeiculosPage() {
  await requirePermission("rotas.definir");
  const supabase = await createClient();
  const inicioMes = `${todayISO().slice(0, 7)}-01`;
  const [{ data: veiculos }, { data: rotas }, usuarios, profiles, par] = await Promise.all([
    supabase.from("veiculos").select("*").order("ativo", { ascending: false }).order("descricao"),
    supabase.from("rotas").select("veiculo_id, resumo").gte("data", inicioMes).in("status", ["concluida", "aprovada"]),
    userOptions(),
    getProfileMap(),
    parametrosRotas(),
  ]);
  const campos = veiculoFields(usuarios);
  const regra = (consumo: number) => ({ consumoKmL: consumo, precoCombustivel: par.preco_combustivel, valorKm: par.valor_km, modo: par.reembolso_modo });

  // uso do mês por veículo (rotas sem veículo entram como "consumo padrão")
  const uso = new Map<string, { rotas: number; km: number; litros: number; combustivel: number }>();
  for (const r of rotas ?? []) {
    const km = Number((r.resumo as RotaResumo | null)?.km ?? 0);
    const chave = r.veiculo_id ?? "padrao";
    const v = (veiculos ?? []).find((x) => x.id === r.veiculo_id);
    const c = custoPercurso(km, regra(Number(v?.consumo_km_l ?? par.consumo_km_l)));
    const u = uso.get(chave) ?? { rotas: 0, km: 0, litros: 0, combustivel: 0 };
    uso.set(chave, { rotas: u.rotas + 1, km: u.km + km, litros: u.litros + c.litros, combustivel: u.combustivel + c.combustivel });
  }
  const total = [...uso.values()].reduce((a, u) => ({ km: a.km + u.km, litros: a.litros + u.litros, combustivel: a.combustivel + u.combustivel }), { km: 0, litros: 0, combustivel: 0 });
  const semVeiculo = uso.get("padrao");

  return (
    <>
      <Link href="/rotas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Rotas</Link>
      <PageHeader
        eyebrow="Campo"
        title="Veículos e combustível"
        description="Cadastre os carros (da empresa ou dos consultores) com o consumo. O km planejado e o realizado das rotas viram litros e gasto de combustível."
        actions={<FormDrawerButton action={salvarVeiculo} title="Novo veículo" label="Novo veículo" variant="accent" width="max-w-md" fields={campos} values={{ ativo: true }} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Veículos ativos" value={String((veiculos ?? []).filter((v) => v.ativo).length)} icon={<Car className="h-5 w-5" />} />
        <StatCard label="Km rodados no mês" value={num(total.km)} hint="Rotas concluídas e aprovadas" icon={<Gauge className="h-5 w-5" />} tone="accent" />
        <StatCard label="Combustível no mês" value={`${num(total.litros)} l`} hint={`${brl(par.preco_combustivel)}/l`} icon={<Fuel className="h-5 w-5" />} />
        <StatCard label="Gasto estimado" value={brl(total.combustivel)} hint={par.reembolso_modo === "km" ? `Reembolso pago por km: ${brl(par.valor_km)}/km` : "Reembolso por consumo"} icon={<Wallet className="h-5 w-5" />} tone="green" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_460px]">
        <Card className="self-start">
          <CardHeader title="Veículos" description="O consumo do veículo substitui o padrão da empresa nos cálculos." icon={<Car className="h-4 w-4" />} />
          {(veiculos ?? []).length === 0 ? (
            <EmptyState icon={<Car className="h-6 w-6" />} title="Nenhum veículo" description="Cadastre o carro de cada consultor ou da frota para calcular o combustível pelo consumo real." />
          ) : (
            <div className="overflow-x-auto"><table className="table-base">
              <thead><tr><th>Veículo</th><th>Responsável</th><th className="text-right">Consumo</th><th className="text-right">Rotas no mês</th><th className="text-right">Km</th><th className="text-right">Litros</th><th className="text-right">Combustível</th><th /></tr></thead>
              <tbody>
                {(veiculos ?? []).map((v) => {
                  const u = uso.get(v.id);
                  return (
                    <tr key={v.id}>
                      <td><b className="font-medium">{v.descricao}</b>{v.placa && <span className="ml-2 font-mono text-xs text-muted">{v.placa}</span>}{!v.ativo && <Badge tone="slate" className="ml-2">inativo</Badge>}</td>
                      <td className="text-sm">{v.responsavel_id ? (profiles.get(v.responsavel_id)?.full_name ?? "—") : "Frota"}</td>
                      <td className="text-right text-sm">{v.consumo_km_l ? `${num(v.consumo_km_l)} km/l` : <span className="text-muted">padrão ({num(par.consumo_km_l)})</span>}</td>
                      <td className="text-right text-sm">{u?.rotas ?? 0}</td>
                      <td className="text-right text-sm">{u ? num(u.km) : "—"}</td>
                      <td className="text-right text-sm">{u ? num(u.litros) : "—"}</td>
                      <td className="text-right text-sm">{u ? brl(u.combustivel) : "—"}</td>
                      <td className="text-right">
                        <FormDrawerButton action={salvarVeiculo} hidden={{ id: v.id }} title="Editar veículo" icon="edit" size="icon" variant="ghost" width="max-w-md" fields={campos}
                          values={{ descricao: v.descricao, placa: v.placa, consumo_km_l: v.consumo_km_l, responsavel_id: v.responsavel_id, ativo: v.ativo }} />
                      </td>
                    </tr>
                  );
                })}
                {semVeiculo && (
                  <tr>
                    <td className="text-sm text-muted" colSpan={3}><Route className="mr-1 inline h-3.5 w-3.5" />Rotas sem veículo (consumo padrão {num(par.consumo_km_l)} km/l)</td>
                    <td className="text-right text-sm">{semVeiculo.rotas}</td>
                    <td className="text-right text-sm">{num(semVeiculo.km)}</td>
                    <td className="text-right text-sm">{num(semVeiculo.litros)}</td>
                    <td className="text-right text-sm">{brl(semVeiculo.combustivel)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table></div>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader title="Combustível, reembolso e check-in" description="Valem para todas as rotas da empresa." icon={<Fuel className="h-4 w-4" />} />
          <ParametrosRotasForm />
        </Card>
      </div>
    </>
  );
}
