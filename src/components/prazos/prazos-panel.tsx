import { AlarmClock } from "lucide-react";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { departamentoOptions, juridicoOptions } from "@/lib/data";
import { todayISO } from "@/lib/format";
import type { Prazo } from "@/lib/types";
import { createPrazo } from "@/lib/actions/prazos";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { prazoDefaults, prazoFields } from "./fields";
import { toPrazoItems } from "./load";
import { NovoPrazoButton } from "./prazo-drawer";
import { PrazoList } from "./prazo-list";
import { diffDays } from "./utils";

/** Aba "Prazos" do processo: pendentes primeiro (vencidos em destaque), depois o histórico. */
export async function PrazosPanel({ processoId }: { processoId: string }) {
  const session = await getSession();
  if (!session || !can(session.profile.role, "processos.view")) return null;
  const canWrite = can(session.profile.role, "processos.write");
  const today = todayISO();

  const supabase = await createClient();
  const [{ data }, juridico, departamentos] = await Promise.all([
    supabase.from("prazos").select("*").eq("processo_id", processoId).order("data_fim", { ascending: true }).limit(300),
    canWrite ? juridicoOptions() : Promise.resolve([]),
    canWrite ? departamentoOptions() : Promise.resolve([]),
  ]);
  const items = await toPrazoItems((data ?? []) as Prazo[], session, canWrite);
  const pendentes = items.filter((p) => p.status === "pendente");
  const historico = items.filter((p) => p.status !== "pendente").sort((a, b) => b.data_fim.localeCompare(a.data_fim));
  const vencidos = pendentes.filter((p) => diffDays(p.data_fim, today) < 0).length;
  const fields = prazoFields({ juridico, departamentos });

  const description = pendentes.length
    ? `${pendentes.length} pendente(s)${vencidos ? ` · ${vencidos} vencido(s) sem baixa` : ""}`
    : "Nenhum prazo pendente";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Prazos do processo"
          description={description}
          icon={<AlarmClock className="h-4 w-4" />}
          action={canWrite ? <NovoPrazoButton action={createPrazo} fields={fields} values={prazoDefaults()} hidden={{ processo_id: processoId }} size="sm" /> : undefined}
        />
        {pendentes.length === 0 ? (
          <EmptyState
            icon={<AlarmClock className="h-6 w-6" />}
            title="Sem prazos pendentes"
            description={canWrite ? "Cadastre os prazos a partir da publicação: o vencimento é calculado em dias úteis (CPC)." : "Nenhum prazo em aberto neste processo."}
          />
        ) : (
          <PrazoList items={pendentes} today={today} fields={fields} showProcesso={false} />
        )}
      </Card>

      {historico.length > 0 && (
        <Card>
          <CardHeader title="Histórico de prazos" description="Cumpridos, perdidos e cancelados" />
          <PrazoList items={historico} today={today} fields={fields} showProcesso={false} />
        </Card>
      )}
    </div>
  );
}
