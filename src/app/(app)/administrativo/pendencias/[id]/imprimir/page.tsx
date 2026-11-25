import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfileMap } from "@/lib/data";
import { CASO_STATUS, FICHA_BENEFICIOS, FICHA_SEGURADOS } from "@/lib/constants";
import { optionLabel } from "@/components/ui/badge";
import { date, maskDocumento } from "@/lib/format";
import { PrintButton } from "@/components/ui/print-button";
import { LinkButton } from "@/components/ui/button";
import { SELECT_FICHA, type FichaCompleta, type ItemFicha } from "@/lib/fichas-pendencia";

export const metadata: Metadata = { title: "Imprimir ficha de pendências" };

const LINHAS = 11;
const caixa = (marcado: boolean) => (marcado ? "☒" : "☐");

/** Folha de Acompanhamento de Pendências no formato da folha em papel (A4), já preenchida. */
export default async function ImprimirFichaPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("processos.status_restritos");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: fichaData }, { data: itensData }, perfis] = await Promise.all([
    supabase.from("fichas_pendencia").select(SELECT_FICHA).eq("id", id).maybeSingle(),
    supabase.from("ficha_pendencia_itens").select("id, secao, data, texto, prazo, resolvida, criado_por, created_at").eq("ficha_id", id).order("data").order("created_at"),
    getProfileMap(),
  ]);
  if (!fichaData) notFound();
  const f = fichaData as unknown as FichaCompleta;
  const itens = (itensData ?? []) as ItemFicha[];
  const { count: total } = await supabase.from("fichas_pendencia").select("id", { count: "exact", head: true }).eq("caso_id", f.caso_id);
  let assinatura: string | null = null;
  if (f.assinatura_path) assinatura = (await supabase.storage.from("documentos").createSignedUrl(f.assinatura_path, 900)).data?.signedUrl ?? null;
  const nome = (uid: string | null) => (uid ? (perfis.get(uid)?.full_name ?? "") : "");
  const pend = itens.filter((i) => i.secao === "pendencia");
  const ret = itens.filter((i) => i.secao === "retorno");
  const destinoData = (d: string) => (f.destino === d && f.destino_em ? date(f.destino_em) : "");
  const rubrica = (d: string) => (f.destino === d ? nome(f.responsavel_id).split(" ")[0] : "");
  const th = "border border-slate-400 bg-slate-100 px-2 py-1 text-left text-[11px] font-bold";
  const td = "border border-slate-400 px-2 align-top text-[11.5px]";

  const Tabela = ({ titulo, sub, rotulo, linhas }: { titulo: string; sub: string; rotulo: string; linhas: ItemFicha[] }) => (
    <section className="mt-4">
      <h2 className="text-[13px] font-bold text-[#2D2D83]">{titulo} <span className="text-[10.5px] font-normal text-slate-500">({sub})</span></h2>
      <table className="mt-1 w-full border-collapse">
        <thead><tr><th className={`${th} w-24 text-center`}>Data</th><th className={th}>{rotulo}</th></tr></thead>
        <tbody>
          {Array.from({ length: Math.max(LINHAS, linhas.length) }).map((_, k) => {
            const i = linhas[k];
            return (
              <tr key={k} className="h-7">
                <td className={`${td} text-center`}>{i ? date(i.data) : ""}</td>
                <td className={td}>
                  {i ? <>{i.texto}{i.prazo ? ` — prazo ${date(i.prazo)}` : ""}{i.secao === "pendencia" && i.resolvida ? " ✔ resolvida" : ""}</> : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );

  return (
    <div className="mx-auto max-w-[800px]">
      <div className="no-print mb-4 flex flex-wrap gap-2">
        <PrintButton />
        <LinkButton href={`/administrativo/pendencias/${f.id}`} variant="ghost">Voltar para a ficha</LinkButton>
      </div>
      <article className="rounded-lg bg-white p-6 text-slate-900 shadow-sm print:p-0 print:shadow-none">
        <header className="flex items-end justify-between border-b-[3px] border-[#2D2D83] pb-1.5">
          <div>
            <h1 className="text-[19px] font-extrabold tracking-tight text-[#2D2D83]">FOLHA DE ACOMPANHAMENTO DE PENDÊNCIAS</h1>
            <p className="text-[10.5px] text-slate-500">Complemento da Folha de Análise · toda anotação com data · gerada pelo GE EASY</p>
          </div>
          <p className="text-[12px] font-bold text-[#2D2D83]">Folha nº {f.numero} de {total ?? f.numero}</p>
        </header>

        <table className="mt-3 w-full border-collapse text-[11.5px]">
          <tbody>
            <tr>
              <td className={td + " py-1.5"} colSpan={2}><b>Cliente:</b> {f.clientes?.nome}</td>
              <td className={td + " py-1.5"}><b>CPF:</b> {f.clientes?.documento ? maskDocumento(f.clientes.documento) : ""}</td>
              <td className={td + " py-1.5"}><b>Processo / protocolo:</b> {f.cliente_casos?.protocolo_inss ?? ""}</td>
            </tr>
            <tr>
              <td className={td + " py-1.5"} colSpan={3}>
                <b>Benefício:</b>{" "}
                {FICHA_BENEFICIOS.filter((b) => b.value !== "outro" || f.beneficio === "outro").map((b) => <span key={b.value} className="mr-2">{caixa(f.beneficio === b.value)} {b.label}</span>)}
              </td>
              <td className={td + " py-1.5"}>
                <b>Segurado:</b> {FICHA_SEGURADOS.map((s) => <span key={s.value} className="mr-2">{caixa(f.segurado === s.value)} {s.label}</span>)}
              </td>
            </tr>
            <tr>
              <td className={td + " py-1.5"} colSpan={2}><b>Análise recebida em:</b> {date(f.recebida_em)}</td>
              <td className={td + " py-1.5"} colSpan={2}><b>Responsável pela pendência:</b> {nome(f.responsavel_id)}</td>
            </tr>
          </tbody>
        </table>

        <Tabela titulo="1. Pendências" sub="o que falta, o que foi pedido, a quem e prazo" rotulo="Pendência / providência" linhas={pend} />
        <Tabela titulo="2. Retorno do cliente" sub="contatos, respostas, documentos entregues" rotulo="Retorno / resultado do contato" linhas={ret} />

        <section className="mt-4 break-inside-avoid">
          <h2 className="text-[13px] font-bold text-[#2D2D83]">3. Destino do processo</h2>
          <table className="mt-1 w-full border-collapse text-[11.5px]">
            <tbody>
              {[["habilitado", "Habilitado", "exigencia", "Exigência"], ["analise", "Análise", "outro", "Outro"]].map(([a, la, b, lb]) => (
                <tr key={a} className="h-8">
                  <td className={td + " w-32 py-1.5 font-bold"}>{caixa(f.destino === a)} {la}</td>
                  <td className={td + " py-1.5"}><span className="text-[10px] text-slate-500">Data:</span> {destinoData(a)}</td>
                  <td className={td + " py-1.5"}><span className="text-[10px] text-slate-500">Rubrica:</span> {rubrica(a)}</td>
                  <td className={td + " w-36 py-1.5 font-bold"}>
                    {caixa(f.destino === b)} {lb}
                    {b === "outro" && f.destino === "outro" ? <span className="font-normal">: {optionLabel(CASO_STATUS, f.destino_status ?? "")}{f.destino_outro ? ` — ${f.destino_outro}` : ""}</span> : null}
                  </td>
                  <td className={td + " py-1.5"}><span className="text-[10px] text-slate-500">Data:</span> {destinoData(b)}</td>
                  <td className={td + " py-1.5"}><span className="text-[10px] text-slate-500">Rubrica:</span> {rubrica(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {f.encaminhado_para && <p className="mt-1 text-[11px]">Encaminhado para: <b>{nome(f.encaminhado_para)}</b></p>}
        </section>

        <footer className="mt-10 flex flex-col items-center break-inside-avoid">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária do Storage */}
          {assinatura ? <img src={assinatura} alt="Assinatura" className="h-16 object-contain" /> : <div className="h-16" />}
          <div className="w-80 border-t border-slate-700" />
          <p className="mt-1 text-[11px] text-slate-600">Assinatura da responsável pela pendência{f.responsavel_id ? ` — ${nome(f.responsavel_id)}` : ""}</p>
        </footer>
      </article>
    </div>
  );
}
