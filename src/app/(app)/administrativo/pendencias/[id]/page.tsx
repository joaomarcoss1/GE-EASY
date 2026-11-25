import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { getProfileMap } from "@/lib/data";
import { CASO_STATUS, FICHA_BENEFICIOS, FICHA_DESTINOS, FICHA_SEGURADOS, FICHA_TIPOS } from "@/lib/constants";
import { date, dateTime, maskDocumento } from "@/lib/format";
import { excluirItemFicha } from "@/lib/actions/fichas-pendencia";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, optionLabel } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { CabecalhoFicha, EncerrarFicha, NovaAnotacao, ResolvidaToggle } from "@/components/pendencias/ficha-componentes";
import { cn } from "@/lib/cn";
import { opcoesEncaminhamento, SELECT_FICHA, type FichaCompleta, type ItemFicha } from "@/lib/fichas-pendencia";
import { ExigenciaPrazo } from "@/components/processos/exigencia-prazo";

export const metadata: Metadata = { title: "Ficha de acompanhamento" };

/**
 * Folha de acompanhamento de um processo — pendências ou exigências (versão digital da folha em papel).
 * Quem trabalha no setor edita; quem recebeu o processo (analista, habilitação) lê a ficha encerrada (RLS).
 */
export default async function FichaPendenciaPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile, userId } = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: fichaData }, { data: itensData }, perfis] = await Promise.all([
    supabase.from("fichas_pendencia").select(SELECT_FICHA).eq("id", id).maybeSingle(),
    supabase.from("ficha_pendencia_itens").select("id, secao, data, texto, prazo, resolvida, criado_por, created_at").eq("ficha_id", id).order("data").order("created_at"),
    getProfileMap(),
  ]);
  if (!fichaData) notFound();
  const ficha = fichaData as unknown as FichaCompleta;
  const itens = (itensData ?? []) as ItemFicha[];
  const aberta = ficha.status === "aberta";
  const T = FICHA_TIPOS[ficha.tipo];
  const setor = can(profile, T.perm);
  const editavel = aberta && setor && can(profile, "clientes.write");
  const exig = ficha.tipo === "exigencia";
  const nome = (uid: string | null) => (uid ? (perfis.get(uid)?.full_name ?? "—") : "—");
  const pendencias = itens.filter((i) => i.secao === "pendencia");
  const retornos = itens.filter((i) => i.secao === "retorno");
  const caso = ficha.cliente_casos;
  const hoje = new Date().toISOString().slice(0, 10);

  const { analistas, habilitadores } = editavel ? await opcoesEncaminhamento(supabase, perfis) : { analistas: [], habilitadores: [] };
  let assinaturaUrl: string | null = null;
  if (ficha.assinatura_path) {
    const { data } = await supabase.storage.from("documentos").createSignedUrl(ficha.assinatura_path, 900);
    assinaturaUrl = data?.signedUrl ?? null;
  }

  const Celula = ({ rotulo, children, className }: { rotulo: string; children: React.ReactNode; className?: string }) => (
    <div className={cn("border-line p-3", className)}><p className="text-[11px] font-bold uppercase tracking-wide text-muted">{rotulo}</p><div className="mt-0.5 text-sm font-medium">{children}</div></div>
  );

  return (
    <>
      <PageHeader
        eyebrow={`${T.ficha} · nº ${ficha.numero}`}
        title={ficha.clientes?.nome ?? "Cliente"}
        description="Complemento da folha de análise. Toda anotação tem data e fica registrada com o nome de quem escreveu."
        actions={
          <div className="flex flex-wrap gap-2">
            <LinkButton href={setor ? T.rota : "/administrativo/encaminhados"} variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /> {setor ? T.titulo : "Encaminhados para mim"}</LinkButton>
            <LinkButton href={`/clientes/${ficha.cliente_id}`} variant="secondary" size="sm">Ficha do cliente</LinkButton>
            <LinkButton href={`/administrativo/pendencias/${ficha.id}/imprimir`} variant="secondary" size="sm" prefetch={false}><Printer className="h-4 w-4" /> Imprimir</LinkButton>
          </div>
        }
      />

      <Card className="mb-5">
        <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Celula rotulo="Cliente">{ficha.clientes?.nome ?? "—"}</Celula>
          <Celula rotulo="CPF">{ficha.clientes?.documento ? maskDocumento(ficha.clientes.documento) : "—"}</Celula>
          <Celula rotulo="Processo / protocolo">{caso?.protocolo_inss ?? "sem protocolo"}<span className="block text-xs text-muted">{caso?.tipo}{caso?.ano ? ` · planilha ${caso.ano}` : ""}</span></Celula>
        </div>
        <div className="grid divide-y divide-line border-t border-line sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Celula rotulo="Benefício">{ficha.beneficio ? optionLabel(FICHA_BENEFICIOS, ficha.beneficio) : "—"}</Celula>
          <Celula rotulo="Segurado">{ficha.segurado ? optionLabel(FICHA_SEGURADOS, ficha.segurado) : "—"}</Celula>
          <Celula rotulo={exig ? "Exigência recebida em" : "Análise recebida em"}>{date(ficha.recebida_em)}</Celula>
          <Celula rotulo={exig ? "Responsável pela exigência" : "Responsável pela pendência"}>{nome(ficha.responsavel_id)}</Celula>
        </div>
        {exig && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 text-sm">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Prazo do INSS</span>
            {caso?.status === "exigencia" ? (
              <ExigenciaPrazo casoId={ficha.caso_id} prazo={caso.exigencia_prazo} prorrogada={caso.exigencia_prorrogada} podeProrrogar={editavel} />
            ) : <span className="text-muted">o processo não está mais em exigência</span>}
            {caso?.exigencia_aberta_em && <span className="text-xs text-muted">aberta em {date(caso.exigencia_aberta_em)} · 7 dias, prorrogável uma vez por mais 7</span>}
            {caso?.exigencia_texto && <span className="w-full text-xs text-muted">Registro da planilha: {caso.exigencia_texto}</span>}
          </div>
        )}
        <CabecalhoFicha fichaId={ficha.id} beneficio={ficha.beneficio} segurado={ficha.segurado} recebidaEm={ficha.recebida_em} editavel={editavel} />
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 text-xs text-muted">
          Situação do processo: <Badge tone="slate">{optionLabel(CASO_STATUS, caso?.status ?? "")}</Badge>
          {aberta ? <Badge tone="amber">Ficha em andamento</Badge> : <Badge tone="green">Ficha encerrada em {ficha.encerrada_em ? dateTime(ficha.encerrada_em) : "—"}</Badge>}
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader title={exig ? "1. Exigências do INSS" : "1. Pendências"} description={exig ? "O que o INSS exigiu, a providência, a quem foi pedido e prazo" : "O que falta, o que foi pedido, a quem e prazo"} />
        <Anotacoes itens={pendencias} editavel={editavel} userId={userId} nome={nome} hoje={hoje} pendencia />
        {editavel && <NovaAnotacao fichaId={ficha.id} secao="pendencia" tipo={ficha.tipo} />}
      </Card>

      <Card className="mb-5">
        <CardHeader title={exig ? "2. Retorno do cliente e cumprimento" : "2. Retorno do cliente"} description={exig ? "Contatos, documentos entregues e o que foi enviado ao INSS" : "Contatos, respostas, documentos entregues"} />
        <Anotacoes itens={retornos} editavel={editavel} userId={userId} nome={nome} hoje={hoje} />
        {editavel && <NovaAnotacao fichaId={ficha.id} secao="retorno" />}
      </Card>

      <Card>
        <CardHeader title="3. Destino do processo" description={aberta ? "Escolha para onde o processo vai, assine e encaminhe" : undefined} />
        {aberta ? (
          editavel ? (
            <EncerrarFicha
              fichaId={ficha.id}
              tipo={ficha.tipo}
              analistas={analistas}
              habilitadores={habilitadores}
              nomeResponsavel={nome(userId)}
              pendenciasAbertas={pendencias.filter((p) => !p.resolvida).length}
            />
          ) : <p className="p-5 text-sm text-muted">Somente o setor responsável encerra a ficha.</p>
        ) : (
          <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5 text-sm">
              <p><span className="text-muted">Destino:</span> <Badge tone={FICHA_DESTINOS.find((d) => d.value === ficha.destino)?.tone ?? "slate"}>{optionLabel(FICHA_DESTINOS, ficha.destino ?? "")}</Badge>{ficha.destino === "outro" ? ` ${optionLabel(CASO_STATUS, ficha.destino_status ?? "")}${ficha.destino_outro ? ` — ${ficha.destino_outro}` : ""}` : ""}</p>
              <p><span className="text-muted">Data:</span> {ficha.destino_em ? date(ficha.destino_em) : "—"}</p>
              {exig && ficha.exigencia_cumprida !== null && <p><span className="text-muted">Exigência cumprida no INSS:</span> {ficha.exigencia_cumprida ? "sim" : "não"}</p>}
              {ficha.encaminhado_para && <p><span className="text-muted">Encaminhado para:</span> <b>{nome(ficha.encaminhado_para)}</b></p>}
              <p><span className="text-muted">Responsável:</span> {nome(ficha.responsavel_id)}</p>
            </div>
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária do Storage */}
              {assinaturaUrl ? <img src={assinaturaUrl} alt="Assinatura da responsável" className="h-24 w-64 rounded-lg border border-line bg-white object-contain" /> : <div className="h-24 w-64 rounded-lg border border-dashed border-line" />}
              <p className="mt-1 text-xs text-muted">Assinatura da responsável pela {exig ? "exigência" : "pendência"}</p>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function Anotacoes({ itens, editavel, userId, nome, hoje, pendencia }: { itens: ItemFicha[]; editavel: boolean; userId: string; nome: (id: string | null) => string; hoje: string; pendencia?: boolean }) {
  if (!itens.length) return <p className="px-5 pb-4 text-sm text-muted">Nenhuma anotação ainda.</p>;
  return (
    <ul className="divide-y divide-line border-t border-line">
      {itens.map((i) => {
        const vencido = pendencia && !i.resolvida && i.prazo && i.prazo < hoje;
        return (
          <li key={i.id} className="flex flex-wrap items-start gap-3 px-4 py-2.5 sm:flex-nowrap">
            <span className="w-24 shrink-0 text-sm font-semibold tabular-nums">{date(i.data)}</span>
            <div className="min-w-0 flex-1">
              <p className={cn("whitespace-pre-wrap text-sm", pendencia && i.resolvida && "text-muted line-through decoration-emerald-600/50")}>{i.texto}</p>
              <p className="text-[11px] text-muted">
                {nome(i.criado_por)}
                {i.prazo ? <> · prazo <span className={cn(vencido && "font-bold text-red-600")}>{date(i.prazo)}{vencido ? " (vencido)" : ""}</span></> : null}
              </p>
            </div>
            {pendencia && <ResolvidaToggle itemId={i.id} resolvida={i.resolvida} editavel={editavel} />}
            {editavel && i.criado_por === userId && (
              <ConfirmAction action={excluirItemFicha} id={i.id} title="Apagar anotação?" message="Use só para corrigir algo escrito por engano. A exclusão fica registrada na auditoria." confirmLabel="Apagar" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
