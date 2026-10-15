import { Activity, HardDrive, Newspaper, RadioTower } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasServiceRole } from "@/lib/supabase/admin";
import { googleConfigured } from "@/lib/env";
import { dateTime } from "@/lib/format";
import { parseOab } from "@/lib/juridico/djen";
import { arquivarPendentesDrive, definirDriveEscritorio, removerDriveEscritorio, salvarOabsDjen } from "@/lib/actions/integracoes";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { SettingsForm } from "./settings-form";
import { AcaoIntegracao } from "./acao-integracao";

const TIPO_LABEL: Record<string, string> = { datajud: "DataJud", djen: "DJEN", drive: "Drive", agenda: "Agenda", cron: "Rotina" };

/** Painel do administrador: Drive do escritório, OABs monitoradas no DJEN, DataJud e registro das execuções. */
export async function IntegracoesEscritorio({ googleConectado }: { googleConectado: boolean }) {
  const supabase = await createClient();
  const [{ data: cfgs }, { data: perfis }, { data: logs }, { count: pendentes }, { count: comErro }, { count: monitorados }, { count: erroDatajud }] = await Promise.all([
    supabase.from("configuracoes").select("chave, valor").in("chave", ["drive_escritorio", "djen"]),
    supabase.from("profiles").select("full_name, oab, active").not("oab", "is", null),
    supabase.from("integracoes_log").select("id, tipo, status, mensagem, created_at").order("created_at", { ascending: false }).limit(15),
    supabase.from("documentos").select("id", { count: "exact", head: true }).eq("drive_status", "pendente").not("storage_path", "is", null),
    supabase.from("documentos").select("id", { count: "exact", head: true }).eq("drive_status", "erro"),
    supabase.from("processos").select("id", { count: "exact", head: true }).eq("datajud_monitorar", true).not("numero_cnj", "is", null).in("status", ["ativo", "suspenso"]),
    supabase.from("processos").select("id", { count: "exact", head: true }).eq("datajud_status", "erro"),
  ]);
  const drive = cfgs?.find((c) => c.chave === "drive_escritorio")?.valor as { user_id?: string; email?: string | null; definido_em?: string } | undefined;
  const oabsExtras = ((cfgs?.find((c) => c.chave === "djen")?.valor as { oabs?: string[] } | undefined)?.oabs ?? []).join("\n");
  const oabsPerfis = (perfis ?? []).filter((p) => p.active).map((p) => ({ nome: p.full_name, oab: parseOab(p.oab) })).filter((p) => p.oab);
  const servidorOk = hasServiceRole();

  return (
    <div className="space-y-6">
      {!servidorOk && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <b>Rotinas automáticas pausadas:</b> configure <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> e <code className="font-mono">CRON_SECRET</code> no servidor (Vercel) para a
          sincronização agendada (DataJud a cada hora, DJEN 3x ao dia, Drive e Agenda a cada hora). Os botões manuais de DataJud e DJEN já funcionam.
        </div>
      )}

      <Card>
        <CardHeader
          title="Drive do escritório"
          description="Uma conta Google guarda todo o acervo, com pastas criadas e organizadas automaticamente por cliente, processo e categoria."
          icon={<HardDrive className="h-4 w-4" />}
          action={drive?.user_id ? <Badge tone="green" dot>Ativo</Badge> : <Badge tone="slate">Não definido</Badge>}
        />
        <CardBody className="space-y-4 text-sm">
          <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-xs leading-relaxed text-muted">{`GE EASY — Arquivo do escritório/
├─ Clientes/
│  └─ <Nome do cliente (…1234)>/
│     ├─ Documentos do cliente/<Categoria>/
│     └─ Processos/<0000000-00.0000.0.00.0000 — Título>/<Categoria>/
├─ Processos sem cliente/
└─ Documentos internos/`}</pre>
          {drive?.user_id ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>
                Conta: <b>{drive.email ?? "conta Google"}</b>
                {drive.definido_em ? <span className="text-muted"> · desde {dateTime(drive.definido_em)}</span> : null}
                <br />
                <span className="text-xs text-muted">
                  {pendentes ?? 0} documento(s) aguardando arquivamento · {comErro ?? 0} com falha
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <AcaoIntegracao action={arquivarPendentesDrive} label="Arquivar pendentes agora" />
                <ConfirmAction action={removerDriveEscritorio} id="drive" title="Desativar o Drive do escritório?" message="Novos documentos deixarão de ser copiados para o Drive. Os arquivos já enviados permanecem na conta Google." confirmLabel="Desativar" label="Desativar" variant="secondary" size="md" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted">
                {googleConfigured()
                  ? googleConectado
                    ? "Use a sua conta Google conectada (recomendado: uma conta institucional do escritório) como Drive do escritório."
                    : "Conecte uma conta Google acima (de preferência a conta institucional do escritório) e depois defina-a como Drive do escritório."
                  : "Configure a integração Google no servidor para habilitar o arquivo no Drive."}
              </p>
              {googleConectado && <AcaoIntegracao action={definirDriveEscritorio} label="Usar minha conta como Drive do escritório" variant="accent" />}
            </div>
          )}
          <p className="text-xs text-muted">
            Segurança: o app usa o escopo <code>drive.file</code> (só enxerga o que ele mesmo criou). O acesso de cada pessoa continua controlado pelo GE EASY; compartilhe pastas no
            Drive somente com quem pode ver aqueles processos.
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Intimações (DJEN)" description="Captura automática das comunicações do Diário de Justiça Eletrônico Nacional pelas OABs." icon={<Newspaper className="h-4 w-4" />} />
          <CardBody className="space-y-4 text-sm">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">OABs dos perfis ({oabsPerfis.length})</p>
              {oabsPerfis.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {oabsPerfis.map((p) => (
                    <li key={`${p.oab!.uf}${p.oab!.numero}`}>
                      <Badge tone="brand">{p.oab!.numero}/{p.oab!.uf} · {p.nome.split(" ")[0]}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Nenhum perfil com OAB. Cada advogado(a) informa a OAB em Configurações › Meu perfil.</p>
              )}
            </div>
            <SettingsForm
              action={salvarOabsDjen}
              values={{ oabs: oabsExtras }}
              fields={[{ name: "oabs", label: "OABs adicionais (uma por linha)", type: "textarea", rows: 3, placeholder: "123456/SP\n98765/MG", help: "Ex.: sócios sem usuário no sistema ou OAB suplementar." }]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="DataJud (CNJ)" description="Movimentações processuais importadas da API pública do DataJud." icon={<RadioTower className="h-4 w-4" />} />
          <CardBody className="space-y-3 text-sm">
            <p>
              <b>{monitorados ?? 0}</b> processo(s) monitorado(s) automaticamente · {erroDatajud ?? 0} com falha na última consulta.
            </p>
            <p className="text-muted">
              A rotina consulta os processos ativos com número CNJ (os mais antigos primeiro), grava as movimentações novas na linha do tempo e avisa o responsável e a equipe.
              Processos em segredo de justiça podem não constar na base pública.
            </p>
            <p className="text-xs text-muted">A chave pública do CNJ pode mudar: se as consultas falharem com &quot;chave recusada&quot;, atualize a variável DATAJUD_API_KEY.</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Últimas execuções" description="Registro das sincronizações manuais e automáticas (mantido por 180 dias)." icon={<Activity className="h-4 w-4" />} />
        {(logs ?? []).length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted">Nenhuma execução registrada ainda.</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {(logs ?? []).map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <Badge tone={l.status === "ok" ? "green" : l.status === "parcial" ? "amber" : "red"}>{TIPO_LABEL[l.tipo] ?? l.tipo}</Badge>
                <span className="min-w-0 flex-1 truncate">{l.mensagem}</span>
                <span className="shrink-0 text-xs text-muted">{dateTime(l.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
