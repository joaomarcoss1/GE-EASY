import { AlertTriangle, CalendarDays, CheckCircle2, HardDrive, Plug, Rss, Unplug } from "lucide-react";
import { env } from "@/lib/env";
import { dateTime } from "@/lib/format";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getGoogleStatus } from "@/components/documentos/google-status";

const FEEDBACK: Record<string, { ok: boolean; text: string }> = {
  "ok:google": { ok: true, text: "Conta Google conectada com sucesso. Agenda e Drive já estão disponíveis." },
  "ok:desconectado": { ok: true, text: "Conta Google desconectada e acesso revogado." },
  "erro:google": { ok: false, text: "Não foi possível conectar ao Google. Tente novamente e autorize o acesso à Agenda e ao Drive." },
  "erro:config": { ok: false, text: "A integração com o Google ainda não está configurada no servidor." },
  "erro:desconectar": { ok: false, text: "Falha ao desconectar a conta Google. Tente novamente." },
};

export async function IntegracoesTab({ ok, erro }: { ok?: string; erro?: string }) {
  const google = await getGoogleStatus();
  const fb = (ok && FEEDBACK[`ok:${ok}`]) || (erro && FEEDBACK[`erro:${erro}`]) || null;
  const redirectUri = `${env.siteUrl}/api/integracoes/google/callback`;

  return (
    <div className="space-y-6">
      {fb && (
        <div
          role="status"
          className={
            fb.ok
              ? "flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          }
        >
          {fb.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />} {fb.text}
        </div>
      )}

      <Card>
        <CardHeader
          title="Google Workspace"
          description="Sincronize compromissos com o Google Agenda e envie documentos ao Google Drive."
          icon={<Plug className="h-4 w-4" />}
          action={google.connected ? <Badge tone="green" dot>Conectado</Badge> : <Badge tone="slate">Não conectado</Badge>}
        />
        <CardBody className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-2xl border border-line p-4">
              <CalendarDays className="mt-0.5 h-5 w-5 text-brand-600" />
              <div>
                <p className="text-sm font-semibold">Google Agenda</p>
                <p className="text-xs text-muted">Eventos criados no GE EASY são enviados para a sua agenda, com lembretes.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-line p-4">
              <HardDrive className="mt-0.5 h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold">Google Drive</p>
                <p className="text-xs text-muted">Copie documentos de clientes para a pasta “GE EASY/&lt;cliente&gt;”. O app só acessa arquivos que ele mesmo criou.</p>
              </div>
            </div>
          </div>

          {!google.configured ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> Integração ainda não configurada no servidor
              </p>
              <p className="mt-2">O administrador precisa definir estas variáveis de ambiente (nunca expostas ao navegador) e reiniciar a aplicação:</p>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                <li>GOOGLE_CLIENT_ID</li>
                <li>GOOGLE_CLIENT_SECRET</li>
                <li>SUPABASE_SERVICE_ROLE_KEY</li>
                <li>APP_ENCRYPTION_KEY <span className="font-sans text-amber-800/80 dark:text-amber-200/80">(32 bytes em base64 — ex.: openssl rand -base64 32)</span></li>
              </ul>
              <p className="mt-3">No Google Cloud Console (APIs Google Calendar e Google Drive ativadas), cadastre como URI de redirecionamento autorizado:</p>
              <code className="mt-1 block break-all rounded-lg bg-white/70 px-3 py-2 font-mono text-xs dark:bg-black/30">{redirectUri}</code>
            </div>
          ) : google.connected ? (
            <div className="flex flex-col gap-4 rounded-2xl bg-surface-2/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm">
                  Conectado como <b className="font-semibold">{google.email ?? "conta Google"}</b>
                </p>
                <p className="text-xs text-muted">Atualizado em {dateTime(google.updatedAt)}</p>
              </div>
              <div className="flex gap-2">
                <a href="/api/integracoes/google/conectar" className={buttonClass("secondary", "md")}>
                  Reconectar
                </a>
                <form method="post" action="/api/integracoes/google/desconectar">
                  <button type="submit" className={buttonClass("ghost", "md", "hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-950/40")}>
                    <Unplug className="h-4 w-4" /> Desconectar
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted">Você será levado ao Google para autorizar o acesso. Os tokens ficam criptografados no servidor.</p>
              <a href="/api/integracoes/google/conectar" className={buttonClass("accent", "md")}>
                <Plug className="h-4 w-4" /> Conectar conta Google
              </a>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Assinar agenda (.ics)" description="Alternativa sem conectar o Google: leve seus compromissos para o Outlook, Apple Calendário ou Google Agenda." icon={<Rss className="h-4 w-4" />} />
        <CardBody className="space-y-3 text-sm">
          <p className="text-muted">Baixe o arquivo de calendário (iCalendar) com seus compromissos:</p>
          <a href="/api/agenda/ics" className={buttonClass("secondary", "md")} download>
            <CalendarDays className="h-4 w-4" /> Baixar agenda (.ics)
          </a>
          <p className="text-xs text-muted">O download usa a sua sessão atual. Importe o arquivo no aplicativo de calendário de sua preferência.</p>
        </CardBody>
      </Card>
    </div>
  );
}
