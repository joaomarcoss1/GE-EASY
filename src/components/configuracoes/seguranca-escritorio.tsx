import { Fingerprint, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { dateTime } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/constants";
import { salvarPoliticaSeguranca } from "@/lib/actions/seguranca";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";

const ACESSOS: Record<string, string> = {
  LOGIN: "Entrada",
  LOGOUT: "Saída",
  LOGOUT_GLOBAL: "Saiu de todos os dispositivos",
  DOWNLOAD: "Download de documento",
  EXPORTACAO: "Exportação de dados",
  VISUALIZACAO_SIGILOSA: "Acesso a processo sigiloso",
  LGPD_EXPORTACAO: "Relatório LGPD do titular",
  LGPD_ANONIMIZACAO: "Anonimização LGPD",
};

/** Painel do administrador: política de sessão/2FA, situação do 2FA da equipe e acessos sensíveis recentes. */
export async function SegurancaEscritorio() {
  const supabase = await createClient();
  const [{ data: cfg }, { data: acessos }, { data: perfis }] = await Promise.all([
    supabase.from("configuracoes").select("valor").eq("chave", "seguranca").maybeSingle(),
    supabase.from("audit_logs").select("id, actor_email, acao, tabela, registro_id, dados_novos, created_at").in("acao", Object.keys(ACESSOS)).order("created_at", { ascending: false }).limit(25),
    supabase.from("membros").select("id, full_name, email, role, active"),
  ]);
  const politica = (cfg?.valor ?? {}) as { inatividade_min?: number; exigir_2fa?: string };

  // Situação do 2FA: leitura pelo service role (fatores ficam no schema auth)
  let mfa: Map<string, { doisFatores: boolean; ultimoAcesso: string | null }> | null = null;
  if (hasServiceRole()) {
    try {
      const { data } = await createAdminClient().auth.admin.listUsers({ perPage: 500 });
      mfa = new Map(
        (data?.users ?? []).map((u) => [u.id, { doisFatores: (u.factors ?? []).some((f) => f.status === "verified"), ultimoAcesso: u.last_sign_in_at ?? null }]),
      );
    } catch {
      mfa = null;
    }
  }
  const ativos = (perfis ?? []).filter((p) => p.active);
  const sem2fa = mfa ? ativos.filter((p) => !mfa!.get(p.id)?.doisFatores).length : null;

  return (
    <div className="grid gap-6 xl:col-span-2 xl:grid-cols-2">
      <Card>
        <CardHeader title="Política de segurança do escritório" description="Vale para todos os usuários." icon={<ShieldCheck className="h-4 w-4" />} />
        <SettingsForm
          action={salvarPoliticaSeguranca}
          values={{ inatividade_min: politica.inatividade_min ?? 30, exigir_2fa: politica.exigir_2fa ?? "nenhum" }}
          fields={[
            { name: "inatividade_min", label: "Encerrar a sessão após (minutos sem uso)", type: "number", min: 5, max: 240, required: true, span: 3 },
            {
              name: "exigir_2fa",
              label: "Autenticação em dois fatores obrigatória",
              type: "select",
              emptyOption: false,
              options: [
                { value: "nenhum", label: "Opcional" },
                { value: "gestao", label: "Obrigatória para gestão e financeiro" },
                { value: "todos", label: "Obrigatória para todos" },
              ],
              span: 3,
            },
          ]}
        />
        <CardBody className="pt-0 text-xs text-muted">
          Com 2FA obrigatória, quem ainda não cadastrou o autenticador só consegue acessar a tela de segurança até concluir o cadastro.
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="2FA da equipe"
          description={sem2fa === null ? "Configure SUPABASE_SERVICE_ROLE_KEY para ver a situação de cada usuário." : `${ativos.length - sem2fa} de ${ativos.length} usuário(s) ativo(s) com 2FA`}
          icon={<Users className="h-4 w-4" />}
          action={sem2fa ? <Badge tone="amber" dot>{sem2fa} sem 2FA</Badge> : sem2fa === 0 ? <Badge tone="green" dot>Todos protegidos</Badge> : undefined}
        />
        {mfa && (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto">
            {ativos.map((p) => {
              const m = mfa!.get(p.id);
              return (
                <li key={p.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  {m?.doisFatores ? <Fingerprint className="h-4 w-4 shrink-0 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />}
                  <span className="min-w-0 flex-1 truncate">
                    <b className="font-semibold">{p.full_name || p.email}</b> <span className="text-xs text-muted">· {ROLE_LABEL[p.role as keyof typeof ROLE_LABEL] ?? p.role}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">último acesso {dateTime(m?.ultimoAcesso)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader title="Acessos sensíveis recentes" description="Entradas, downloads, exportações, processos sigilosos e operações LGPD (trilha imutável para a equipe)." icon={<ShieldAlert className="h-4 w-4" />} />
        {(acessos ?? []).length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted">Nenhum acesso registrado ainda.</p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Usuário</th>
                  <th>Ação</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {(acessos ?? []).map((a) => {
                  const d = (a.dados_novos ?? {}) as Record<string, unknown>;
                  const detalhe = [d.nome, d.ip ? `IP ${d.ip}` : null, d.motivo, d.entidade].filter(Boolean).join(" · ");
                  return (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap text-xs text-muted">{dateTime(a.created_at)}</td>
                      <td className="text-sm">{a.actor_email ?? "—"}</td>
                      <td>
                        <Badge tone={a.acao.startsWith("LGPD") || a.acao === "VISUALIZACAO_SIGILOSA" ? "violet" : a.acao === "DOWNLOAD" || a.acao === "EXPORTACAO" ? "sky" : "slate"}>{ACESSOS[a.acao] ?? a.acao}</Badge>
                      </td>
                      <td className="max-w-[360px] truncate text-xs text-muted">{detalhe || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
