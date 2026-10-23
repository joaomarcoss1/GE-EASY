import { Car, Route } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { parametrosRotas } from "@/lib/parametros";
import { salvarParametrosRotas, salvarVeiculo } from "@/lib/actions/rotas";
import { userOptions } from "@/lib/data";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import type { FieldDef } from "@/components/ui/form";
import { SettingsForm } from "./settings-form";

/** Rotas e check-in: raio, regra fora do raio, reembolso (R$/km ou consumo), hodômetro/selfie e veículos. */
export async function RotasTab() {
  const supabase = await createClient();
  const [p, { data: veiculos }, usuarios] = await Promise.all([parametrosRotas(), supabase.from("veiculos").select("*").order("descricao"), userOptions()]);
  const veiculoFields: FieldDef[] = [
    { name: "descricao", label: "Descrição", required: true, span: 4 },
    { name: "placa", label: "Placa", span: 2 },
    { name: "consumo_km_l", label: "Consumo (km/l)", type: "number", min: 1, max: 100, step: "0.1", span: 3 },
    { name: "responsavel_id", label: "Responsável", type: "select", options: usuarios, span: 3 },
    { name: "ativo", label: "Ativo", type: "checkbox", span: 6 },
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-[460px_1fr]">
      <Card className="self-start">
        <CardHeader title="Check-in e reembolso" description="Valem para todas as rotas da empresa (o raio pode ser ajustado em cada parada)." icon={<Route className="h-4 w-4" />} />
        <SettingsForm
          action={salvarParametrosRotas}
          values={p as unknown as Record<string, string | number | boolean>}
          fields={[
            { name: "raio_m", label: "Raio do check-in (m)", type: "number", min: 20, max: 5000, required: true, span: 3 },
            { name: "fora_do_raio", label: "Fora do raio", type: "select", options: [{ value: "justificar", label: "Permitir com justificativa (revisão)" }, { value: "bloquear", label: "Bloquear" }], emptyOption: false, span: 3 },
            { name: "reembolso_modo", label: "Reembolso de deslocamento", type: "select", options: [{ value: "km", label: "Valor por km" }, { value: "consumo", label: "Consumo × combustível" }], emptyOption: false, span: 6 },
            { name: "valor_km", label: "R$ por km", type: "money", span: 3 },
            { name: "preco_combustivel", label: "Preço do combustível (R$/l)", type: "money", span: 3 },
            { name: "consumo_km_l", label: "Consumo padrão (km/l)", type: "number", min: 1, max: 100, step: "0.1", span: 3 },
            { name: "fator_rodoviario", label: "Fator rodoviário", type: "number", min: 1, max: 3, step: "0.05", span: 3, help: "Converte a distância em linha reta em estimativa por estrada (padrão 1,3)" },
            { name: "exigir_hodometro", label: "Exigir hodômetro no início e no fim", type: "checkbox", span: 6 },
            { name: "exigir_selfie", label: "Exigir foto no check-in", type: "checkbox", span: 6 },
            { name: "rastreio", label: "Rastrear o trajeto durante a rota (somente com a rota ativa)", type: "checkbox", span: 6, help: "Desligado por padrão (LGPD). O app avisa o consultor enquanto rastreia." },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Veículos" description="O consumo do veículo substitui o padrão no cálculo por consumo." icon={<Car className="h-4 w-4" />}
          action={<FormDrawerButton action={salvarVeiculo} title="Novo veículo" label="Veículo" size="sm" variant="accent" width="max-w-md" fields={veiculoFields} values={{ ativo: true }} />} />
        {(veiculos ?? []).length === 0 ? <EmptyState title="Nenhum veículo" /> : (
          <ul className="divide-y divide-line">
            {(veiculos ?? []).map((v) => (
              <li key={v.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span><b>{v.descricao}</b>{v.placa ? ` · ${v.placa}` : ""}{v.consumo_km_l ? ` · ${v.consumo_km_l} km/l` : ""} {!v.ativo && <Badge tone="slate">inativo</Badge>}</span>
                <FormDrawerButton action={salvarVeiculo} hidden={{ id: v.id }} title="Editar veículo" icon="edit" size="icon" variant="ghost" width="max-w-md" fields={veiculoFields}
                  values={{ descricao: v.descricao, placa: v.placa, consumo_km_l: v.consumo_km_l, responsavel_id: v.responsavel_id, ativo: v.ativo }} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
