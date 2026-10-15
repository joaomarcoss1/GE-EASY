import { Gavel, History } from "lucide-react";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { juridicoOptions } from "@/lib/data";
import type { Audiencia } from "@/lib/types";
import { createAudiencia } from "@/lib/actions/audiencias";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { AudienciaList } from "./audiencia-list";
import { audienciaDefaults, audienciaFields } from "./fields";
import { toAudienciaItems } from "./load";

/** Aba "Audiências" do processo: próximas (agendadas/redesignadas) e histórico. */
export async function AudienciasPanel({ processoId }: { processoId: string }) {
  const session = await getSession();
  if (!session || !can(session.profile.role, "processos.view")) return null;
  const canWrite = can(session.profile.role, "processos.write");

  const supabase = await createClient();
  const [{ data }, juridico] = await Promise.all([
    supabase.from("audiencias").select("*").eq("processo_id", processoId).order("data_hora", { ascending: true }).limit(200),
    canWrite ? juridicoOptions() : Promise.resolve([]),
  ]);
  const items = await toAudienciaItems((data ?? []) as Audiencia[], session, canWrite);
  const nowMs = Date.now();
  // Próximas: ativas a partir de hoje (inclui a de agora, até o término)
  const proximas = items.filter((a) => (a.status === "agendada" || a.status === "redesignada") && Date.parse(a.data_hora) + a.duracao_min * 60_000 >= nowMs);
  const passadas = items.filter((a) => !proximas.includes(a)).sort((a, b) => b.data_hora.localeCompare(a.data_hora));
  const pendentesRegistro = passadas.filter((a) => a.status === "agendada" || a.status === "redesignada").length;
  const fields = audienciaFields({ juridico });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Próximas audiências"
          description={proximas.length ? `${proximas.length} agendada(s) — incluídas na agenda do responsável` : "Nenhuma audiência agendada"}
          icon={<Gavel className="h-4 w-4" />}
          action={
            canWrite ? (
              <FormDrawerButton
                action={createAudiencia}
                fields={fields}
                values={audienciaDefaults()}
                hidden={{ processo_id: processoId }}
                title="Nova audiência"
                label="Nova audiência"
                description="A audiência entra na agenda do responsável (e no Google Agenda, se conectado)."
                submitLabel="Agendar audiência"
                variant="accent"
                size="sm"
                width="max-w-xl"
              />
            ) : undefined
          }
        />
        {proximas.length === 0 ? (
          <EmptyState icon={<Gavel className="h-6 w-6" />} title="Sem audiências futuras" description={canWrite ? "Agende a próxima audiência: ela aparece na agenda da equipe." : undefined} />
        ) : (
          <AudienciaList items={proximas} fields={fields} showProcesso={false} showDate />
        )}
      </Card>

      {passadas.length > 0 && (
        <Card>
          <CardHeader
            title="Audiências anteriores"
            description={pendentesRegistro ? `${pendentesRegistro} sem resultado registrado — marque como realizada ou redesigne` : "Realizadas, redesignadas e canceladas"}
            icon={<History className="h-4 w-4" />}
          />
          <AudienciaList items={passadas} fields={fields} showProcesso={false} showDate />
        </Card>
      )}
    </div>
  );
}
