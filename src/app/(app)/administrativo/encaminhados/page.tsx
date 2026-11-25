import type { Metadata } from "next";
import Link from "next/link";
import { Send } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { getProfileMap } from "@/lib/data";
import { CASO_STATUS } from "@/lib/constants";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusCasoSelect } from "@/components/clientes/status-caso-select";
import { SELECT_FICHA_LINHA, TabelaFichas, type FichaLinha } from "@/components/pendencias/fila-setor";

export const metadata: Metadata = { title: "Encaminhados para mim" };

/**
 * Processos que os setores de Pendências e Exigências encaminharam para mim: a análise (Tati) e a habilitação
 * (Aline). Aqui a pessoa vê a ficha e muda a situação do processo (ex.: habilitar com o protocolo do INSS).
 */
export default async function EncaminhadosPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const { profile, userId } = await requireSession();
  const { aba } = await searchParams;
  const todos = aba === "todos";
  const supabase = await createClient();
  const [{ data }, perfis] = await Promise.all([
    supabase.from("fichas_pendencia").select(SELECT_FICHA_LINHA).eq("status", "encerrada").eq("encaminhado_para", userId).order("encerrada_em", { ascending: false }).limit(500),
    getProfileMap(),
  ]);
  const linhas = (data ?? []) as unknown as FichaLinha[];
  // a ficha mais recente de cada processo; "a fazer" = o processo continua na situação para a qual foi enviado
  const porCaso = new Map<string, FichaLinha>();
  for (const x of linhas) if (!porCaso.has(x.caso_id)) porCaso.set(x.caso_id, x);
  const ultimas = [...porCaso.values()];
  const aFazer = ultimas.filter((x) => x.cliente_casos && x.cliente_casos.status === x.destino_status);
  const lista = todos ? ultimas : aFazer;
  const nome = (id: string | null) => (id ? (perfis.get(id)?.full_name ?? "—") : "—");
  const podeMudar = can(profile, "clientes.write");
  const restritos = can(profile, "processos.status_restritos");

  return (
    <>
      <PageHeader
        eyebrow="Administrativo"
        title="Encaminhados para mim"
        description="Processos que os setores de Pendências e Exigências enviaram para você — para análise ou habilitação. Abra a ficha para ver tudo o que foi feito e mude a situação quando concluir."
      />
      <Card>
        <CardHeader
          icon={<Send className="h-4 w-4" />}
          title={todos ? "Todos os encaminhados" : `A fazer (${aFazer.length})`}
          action={<Link href={todos ? "/administrativo/encaminhados" : "/administrativo/encaminhados?aba=todos"} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">{todos ? "Ver só os a fazer" : "Ver todos"}</Link>}
        />
        {!lista.length ? (
          <EmptyState icon={<Send className="h-6 w-6" />} title={todos ? "Nada foi encaminhado para você" : "Nada pendente"} description="Quando um processo for enviado para você, ele aparece aqui e você recebe um aviso." />
        ) : (
          <TabelaFichas
            linhas={lista}
            nome={nome}
            acao={(x) =>
              podeMudar && x.cliente_casos ? (
                <StatusCasoSelect casoId={x.caso_id} status={x.cliente_casos.status} podeRestritos={restritos} protocolo={x.cliente_casos.protocolo_inss} situacao={x.cliente_casos.situacao_atual} />
              ) : <StatusBadge options={CASO_STATUS} value={x.cliente_casos?.status ?? ""} />
            }
          />
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">Para habilitar, escolha “Habilitado” e informe o protocolo do INSS e o estado atual do processo.</p>
    </>
  );
}
