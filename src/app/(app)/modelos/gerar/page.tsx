import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Wand2 } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, processoOptions } from "@/lib/data";
import { montarDocumentoModelo } from "@/lib/juridico/modelo-contexto";
import { registrarDocumentoGerado } from "@/lib/actions/modelos";
import { salvarModeloNoDrive } from "@/lib/actions/integracoes";
import { getDriveEscritorioStatus } from "@/components/documentos/google-status";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DocumentoToolbar } from "@/components/modelos/toolbar";

export const metadata: Metadata = { title: "Gerar documento" };

const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export default async function GerarDocumentoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("modelos.view");
  const sp = await searchParams;
  const supabase = await createClient();
  const modeloId = uuid(sp.modelo_id);
  let clienteId = uuid(sp.cliente_id);
  let processoId = uuid(sp.processo_id);
  const contratoId = uuid(sp.contrato_id);

  const [{ data: modelos }, clientes, processos] = await Promise.all([
    supabase.from("modelos_documentos").select("id, titulo, categoria").eq("ativo", true).order("titulo"),
    clienteOptions(),
    can(profile.role, "processos.view") ? processoOptions() : Promise.resolve([]),
  ]);

  const m = await montarDocumentoModelo(supabase, profile.id, { modeloId, clienteId, processoId, contratoId });
  const { modelo, cliente, processo, empresa, rendered, texto } = m;
  clienteId = m.clienteId;
  processoId = m.processoId;
  const drive = await getDriveEscritorioStatus();

  return (
    <>
      <Link href="/modelos" className="no-print mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Modelos</Link>
      <div className="no-print">
        <PageHeader eyebrow="Modelos de documentos" title="Gerar documento" description="Escolha o modelo e os dados; o documento é preenchido automaticamente." />
        <Card className="mb-6">
          <CardBody>
            <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
              <div>
                <label className="label" htmlFor="g-modelo">Modelo</label>
                <select id="g-modelo" name="modelo_id" defaultValue={modeloId ?? ""} className="input" required>
                  <option value="">Selecione…</option>
                  {(modelos ?? []).map((m) => <option key={m.id} value={m.id}>{m.titulo}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="g-cliente">Cliente</label>
                <select id="g-cliente" name="cliente_id" defaultValue={clienteId ?? ""} className="input">
                  <option value="">—</option>
                  {clientes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="g-processo">Processo</label>
                <select id="g-processo" name="processo_id" defaultValue={processoId ?? ""} className="input">
                  <option value="">—</option>
                  {processos.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              {contratoId && <input type="hidden" name="contrato_id" value={contratoId} />}
              <Button type="submit"><Wand2 className="h-4 w-4" /> Gerar</Button>
            </form>
          </CardBody>
        </Card>
      </div>

      {!modelo || !rendered ? (
        <Card className="no-print"><CardBody><p className="text-sm text-muted">Selecione um modelo para pré-visualizar o documento.</p></CardBody></Card>
      ) : (
        <>
          <div className="no-print mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <DocumentoToolbar
              titulo={`${modelo.titulo}${cliente ? ` - ${cliente.nome}` : ""}`}
              html={rendered.html}
              texto={texto}
              registrar={processo && can(profile.role, "processos.write") ? registrarDocumentoGerado.bind(null, processo.id, modelo.titulo) : undefined}
              salvarDrive={drive.ativo && (clienteId || processoId) ? salvarModeloNoDrive.bind(null, { modeloId: modelo.id, clienteId, processoId, contratoId }) : undefined}
            />
            {rendered.faltando.length > 0 && (
              <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Campos sem dados (destacados): {rendered.faltando.join(", ")}
              </p>
            )}
          </div>
          <article className="ge-doc mx-auto max-w-[210mm] rounded-sm bg-white px-[22mm] py-[25mm] text-[12pt] leading-[1.6] text-black shadow-pop print:max-w-none print:p-0 print:shadow-none">
            {empresa.nome && <header className="mb-8 border-b border-black/20 pb-3 text-center text-[10pt] uppercase tracking-widest text-black/70">{empresa.nome}</header>}
            <div className="whitespace-pre-wrap font-serif [&_mark.ge-missing]:bg-amber-200" dangerouslySetInnerHTML={{ __html: rendered.html }} />
          </article>
        </>
      )}
    </>
  );
}
