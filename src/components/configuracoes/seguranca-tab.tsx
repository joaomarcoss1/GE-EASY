import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { dateTime } from "@/lib/format";
import { updatePassword } from "@/lib/actions/auth";
import { encerrarTodasSessoes } from "@/lib/actions/perfil";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { MfaManager } from "./mfa-manager";
import { PasswordForm } from "./settings-form";

export async function SegurancaTab() {
  const supabase = await createClient();
  const [{ data: userData }, { data: aal }] = await Promise.all([supabase.auth.getUser(), supabase.auth.mfa.getAuthenticatorAssuranceLevel()]);
  const user = userData.user;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Senha" description="Altere a senha de acesso ao GE EASY." icon={<KeyRound className="h-4 w-4" />} />
        <CardBody>
          <PasswordForm action={updatePassword} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Autenticação em dois fatores" description="Código temporário (TOTP) do aplicativo autenticador." icon={<ShieldCheck className="h-4 w-4" />} />
        <CardBody>
          <MfaManager />
        </CardBody>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader title="Sessão atual" description="Informações do acesso em uso neste dispositivo." icon={<MonitorSmartphone className="h-4 w-4" />} />
        <CardBody className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <dl className="grid flex-1 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">E-mail</dt>
              <dd className="mt-0.5 truncate font-medium">{user?.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Último acesso</dt>
              <dd className="mt-0.5 font-medium">{dateTime(user?.last_sign_in_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Nível de autenticação</dt>
              <dd className="mt-0.5">
                {aal?.currentLevel === "aal2" ? (
                  <Badge tone="green" dot>
                    Senha + 2FA
                  </Badge>
                ) : (
                  <Badge tone="amber" dot>
                    Somente senha
                  </Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Conta criada em</dt>
              <dd className="mt-0.5 font-medium">{dateTime(user?.created_at)}</dd>
            </div>
          </dl>
          <div className="flex flex-col items-start gap-1.5 lg:items-end">
            <ConfirmAction
              action={encerrarTodasSessoes}
              id="global"
              title="Sair de todos os dispositivos?"
              message="Todas as sessões abertas (computadores e celulares, inclusive esta) serão encerradas. Será necessário entrar novamente."
              confirmLabel="Sair de todos"
              label="Sair de todos os dispositivos"
              variant="secondary"
              size="md"
              icon={<LogOut className="h-4 w-4" />}
              redirectTo="/login"
            />
            <p className="text-xs text-muted">Use se perdeu um aparelho ou suspeita de acesso indevido.</p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
