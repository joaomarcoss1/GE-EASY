/* eslint-disable @next/next/no-img-element -- fotos e assinaturas vêm por URL assinada e temporária do Storage */
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { getProfileMap } from "@/lib/data";
import { NIVEIS_TANQUE, ROTA_OBJETIVOS, ROTA_STATUS } from "@/lib/constants";
import { brl, date, dateTime, num } from "@/lib/format";
import type { Rota } from "@/lib/types";
import { optionLabel } from "@/components/ui/badge";
import { PrintButton } from "@/components/ui/print-button";
import { AssinarRotaWeb } from "@/components/rotas/assinar-rota-web";

export const metadata: Metadata = { title: "Relatório da rota" };

interface Checklist { id: string; momento: "saida" | "chegada"; km: number; nivel_tanque: string; foto_painel: string; avaria: boolean; avaria_descricao: string | null; assinatura_path: string | null; registrado_em: string; usuario_id: string | null }
interface Assinatura { id: string; nome: string; papel: string; assinatura_path: string; assinado_em: string; usuario_id: string | null }

const PAPEL: Record<string, string> = { responsavel: "Responsável", participante: "Participante", gestor: "Gestão" };

/** Relatório final da rota (imprimível/PDF): dados, objetivo, checklist do veículo, avaria, paradas, despesas e assinaturas. */
export default async function RelatorioRotaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { profile, userId, empresa } = await requireSession();
  if (!can(profile, "rotas.ver") && !can(profile, "rotas.executar") && !can(profile, "rotas.definir")) redirect("/inicio?erro=permissao");
  const supabase = await createClient();
  const { data: rota } = await supabase.from("rotas").select("*").eq("id", id).maybeSingle<Rota>();
  if (!rota) notFound();
  const [{ data: ck }, { data: ass }, { data: paradas }, { data: despesas }, { data: veiculo }, { data: corretores }, profiles] = await Promise.all([
    supabase.from("rota_checklists").select("id, momento, km, nivel_tanque, foto_painel, avaria, avaria_descricao, assinatura_path, registrado_em, usuario_id").eq("rota_id", id),
    supabase.from("rota_assinaturas").select("id, nome, papel, assinatura_path, assinado_em, usuario_id").eq("rota_id", id).order("assinado_em"),
    supabase.from("rota_paradas").select("id, ordem, titulo, cidade, status, motivo").eq("rota_id", id).order("ordem"),
    supabase.from("despesas_rota").select("tipo, valor, status").eq("rota_id", id),
    rota.veiculo_id ? supabase.from("veiculos").select("descricao, placa").eq("id", rota.veiculo_id).maybeSingle() : Promise.resolve({ data: null }),
    rota.corretores?.length ? supabase.from("assessores").select("id, nome").in("id", rota.corretores) : Promise.resolve({ data: [] }),
    getProfileMap(),
  ]);
  const checklists = (ck ?? []) as Checklist[];
  const assinaturas = (ass ?? []) as Assinatura[];
  const saida = checklists.find((c) => c.momento === "saida");
  const chegada = checklists.find((c) => c.momento === "chegada");
  const caminhos = [...checklists.flatMap((c) => [c.foto_painel, c.assinatura_path]), ...assinaturas.map((a) => a.assinatura_path)].filter((x): x is string => !!x);
  const { data: urls } = caminhos.length ? await supabase.storage.from("documentos").createSignedUrls(caminhos, 900) : { data: [] };
  const url = new Map((urls ?? []).filter((u) => u.signedUrl).map((u) => [u.path ?? "", u.signedUrl as string]));
  const nomeUser = (uid: string | null) => (uid ? (profiles.get(uid)?.full_name ?? "—") : "—");
  const responsavel = nomeUser(rota.consultor_id);
  const equipe = [{ id: rota.consultor_id, nome: responsavel, papel: "responsavel" as const }, ...(rota.participantes ?? []).map((p) => ({ id: p, nome: nomeUser(p), papel: "participante" as const }))];
  const assinou = (nome: string) => assinaturas.some((a) => a.nome === nome);
  const totalDesp = (despesas ?? []).filter((d) => d.status !== "recusada").reduce((a, d) => a + Number(d.valor), 0);
  const kmRodado = saida && chegada ? chegada.km - saida.km : null;
  const encerrada = rota.status === "concluida" || rota.status === "aprovada";
  const euNaEquipe = equipe.find((e) => e.id === userId);
  const souGestor = can(profile, "rotas.aprovar");
  const meuNome = profile.full_name || profile.email;
  const podeAssinar = encerrada && !assinou(euNaEquipe?.nome ?? meuNome) && (euNaEquipe || souGestor);
  const linha = "flex justify-between gap-3 border-b border-line py-1.5 text-sm";

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/rotas/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Voltar à rota</Link>
        <div className="flex gap-2">
          {podeAssinar && <AssinarRotaWeb rotaId={id} nome={euNaEquipe?.nome ?? meuNome} papel={euNaEquipe ? euNaEquipe.papel : "gestor"} />}
          <PrintButton label="Imprimir / salvar PDF" />
        </div>
      </div>

      <article className="card space-y-6 p-6 print:border-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b-4 border-accent-500 pb-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">{empresa?.nome}</p>
            <h1 className="text-2xl font-bold text-brand-800 dark:text-brand-100">Relatório da rota</h1>
            <p className="text-sm text-muted">{rota.nome} · {date(rota.data)} · {optionLabel(ROTA_STATUS, rota.status)}</p>
          </div>
          <Image src="/brand/logo-wordmark.png" alt="GE EASY" width={150} height={63} className="h-auto w-[150px]" />
        </header>

        <section>
          <h2 className="mb-2 font-semibold">Dados da rota</h2>
          <div className="grid gap-x-8 sm:grid-cols-2">
            <p className={linha}><span className="text-muted">Responsável</span><b>{responsavel}</b></p>
            <p className={linha}><span className="text-muted">Objetivo</span><b>{rota.objetivo_tipo ? optionLabel(ROTA_OBJETIVOS, rota.objetivo_tipo) : "—"}</b></p>
            <p className={linha}><span className="text-muted">Veículo</span><b>{veiculo ? `${veiculo.descricao}${veiculo.placa ? ` · ${veiculo.placa}` : ""}` : "Sem veículo"}</b></p>
            <p className={linha}><span className="text-muted">Cidades</span><b className="text-right">{rota.cidades?.length ? rota.cidades.join(", ") : "—"}</b></p>
            <p className={linha}><span className="text-muted">Início</span><b>{rota.iniciada_em ? dateTime(rota.iniciada_em) : "—"}</b></p>
            <p className={linha}><span className="text-muted">Fim</span><b>{rota.finalizada_em ? dateTime(rota.finalizada_em) : "—"}</b></p>
            {!!corretores?.length && <p className={linha}><span className="text-muted">Corretor(es) atendidos</span><b className="text-right">{corretores.map((c) => c.nome).join(", ")}</b></p>}
            <p className={linha}><span className="text-muted">Equipe</span><b className="text-right">{equipe.map((e) => e.nome).join(", ")}</b></p>
          </div>
          <p className="mt-3 text-sm"><span className="text-muted">Motivo:</span> {rota.objetivo ?? "—"}</p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Checklist do veículo</h2>
          {!rota.veiculo_id ? <p className="text-sm text-muted">Rota sem veículo.</p> : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {(["saida", "chegada"] as const).map((m) => {
                  const c = checklists.find((x) => x.momento === m);
                  return (
                    <div key={m} className="rounded-xl border border-line p-3">
                      <p className="mb-2 text-sm font-semibold">{m === "saida" ? "Saída" : "Chegada"}</p>
                      {!c ? <p className="text-sm text-red-600">Não registrado</p> : (
                        <div className="flex gap-3">
                          {url.get(c.foto_painel) && <a href={url.get(c.foto_painel)} target="_blank" rel="noopener noreferrer"><img src={url.get(c.foto_painel)} alt={`Painel na ${m}`} className="h-24 w-32 rounded-lg object-cover" /></a>}
                          <div className="text-sm">
                            <p>Km: <b>{num(c.km)}</b></p>
                            <p>Tanque: <b>{optionLabel(NIVEIS_TANQUE, c.nivel_tanque)}</b></p>
                            <p className="text-xs text-muted">{dateTime(c.registrado_em)} · {nomeUser(c.usuario_id)}</p>
                            {m === "chegada" && <p>Avaria: <b className={c.avaria ? "text-red-600" : ""}>{c.avaria ? "Sim" : "Não"}</b></p>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {kmRodado !== null && <p className="mt-2 text-sm">Quilometragem rodada: <b>{num(kmRodado)} km</b></p>}
              {chegada?.avaria && (
                <div className="mt-4 rounded-xl border-2 border-red-300 p-4">
                  <p className="font-semibold text-red-700 dark:text-red-300">Relatório de avaria</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{chegada.avaria_descricao}</p>
                  {chegada.assinatura_path && url.get(chegada.assinatura_path) && (
                    <div className="mt-3 w-64 text-center text-xs">
                      <img src={url.get(chegada.assinatura_path)} alt="Assinatura do responsável pela avaria" className="h-20 w-full object-contain" />
                      <p className="border-t border-fg/40 pt-1">{nomeUser(chegada.usuario_id)} · {dateTime(chegada.registrado_em)}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Paradas ({(paradas ?? []).length})</h2>
          <table className="table-base">
            <thead><tr><th>#</th><th>Parada</th><th>Cidade</th><th>Situação</th></tr></thead>
            <tbody>
              {(paradas ?? []).map((p) => (
                <tr key={p.id}><td>{p.ordem}</td><td>{p.titulo}</td><td>{p.cidade ?? "—"}</td><td>{p.status === "visitada" ? "Visitada" : p.status === "nao_realizada" ? `Não realizada${p.motivo ? `: ${p.motivo}` : ""}` : p.status === "reagendada" ? "Reagendada" : "Pendente"}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm">Despesas lançadas na rota: <b>{brl(totalDesp)}</b></p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Assinaturas</h2>
          {!encerrada && <p className="mb-2 text-sm text-muted">O relatório é assinado por todos que foram na rota depois que ela é finalizada.</p>}
          <div className="grid gap-4 sm:grid-cols-3">
            {assinaturas.map((a) => (
              <div key={a.id} className="text-center text-xs">
                {url.get(a.assinatura_path) ? <img src={url.get(a.assinatura_path)} alt={`Assinatura de ${a.nome}`} className="h-20 w-full object-contain" /> : <div className="h-20" />}
                <p className="border-t border-fg/40 pt-1 font-semibold">{a.nome}</p>
                <p className="text-muted">{PAPEL[a.papel] ?? a.papel} · {dateTime(a.assinado_em)}</p>
              </div>
            ))}
          </div>
          {encerrada && equipe.some((e) => !assinou(e.nome)) && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Faltam assinar: {equipe.filter((e) => !assinou(e.nome)).map((e) => e.nome).join(", ")}</p>}
        </section>
        <footer className="border-t border-line pt-3 text-xs text-muted">Gerado em {dateTime(new Date().toISOString())} por {meuNome} · GE EASY</footer>
      </article>
    </div>
  );
}
