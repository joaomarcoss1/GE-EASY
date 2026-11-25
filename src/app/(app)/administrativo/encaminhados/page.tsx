import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Send } from "lucide-react";
import { date, maskDocumento } from "@/lib/format";
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
  const [{ data }, perfis, { data: habilitador }] = await Promise.all([
    supabase.from("fichas_pendencia").select(SELECT_FICHA_LINHA).eq("status", "encerrada").eq("encaminhado_para", userId).order("encerrada_em", { ascending: false }).limit(500),
    getProfileMap(),
    supabase.rpc("eh_habilitador"),
  ]);
  // Fila de habilitação: todos os processos "Para habilitação" (vindos de ficha ou da análise)
  const { data: filaHab } = habilitador
    ? await supabase.from("cliente_casos").select("id, cliente_id, tipo, status, protocolo_inss, situacao_atual, updated_at, clientes!inner(nome, documento, whatsapp, telefone)").eq("status", "habilitacao").order("updated_at", { ascending: true }).limit(500)
    : { data: [] };
  const hab = (filaHab ?? []) as unknown as { id: string; cliente_id: string; tipo: string; status: string; protocolo_inss: string | null; situacao_atual: string | null; updated_at: string; clientes: { nome: string; documento: string | null } }[];
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
      {habilitador && (
        <Card className="mb-6">
          <CardHeader icon={<BadgeCheck className="h-4 w-4" />} title={`Fila de habilitação (${hab.length})`} description="Todos os processos “Para habilitação”, os mais antigos primeiro. Habilite com o protocolo do INSS e o estado atual." />
          {!hab.length ? <EmptyState title="Nenhum processo esperando habilitação" /> : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Cliente</th><th>Tipo</th><th>Na fila desde</th><th>Situação</th></tr></thead>
                <tbody>
                  {hab.map((c) => (
                    <tr key={c.id}>
                      <td><Link href={`/clientes/${c.cliente_id}`} className="font-semibold hover:text-brand-600">{c.clientes.nome}</Link><div className="text-xs text-muted">{c.clientes.documento ? maskDocumento(c.clientes.documento) : "sem CPF"}</div></td>
                      <td className="text-sm">{c.tipo}</td>
                      <td className="whitespace-nowrap text-xs text-muted">{date(c.updated_at)}</td>
                      <td>{podeMudar ? <StatusCasoSelect casoId={c.id} status={c.status} podeRestritos={restritos} protocolo={c.protocolo_inss} situacao={c.situacao_atual} /> : <StatusBadge options={CASO_STATUS} value={c.status} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

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
