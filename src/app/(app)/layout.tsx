import { getPoliticaSeguranca, requireSession } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { SessionGuard } from "@/components/layout/session-guard";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // requireSession() também é chamado por cada página (o layout não roda de novo na navegação do cliente):
  // é lá que ficam as exigências de sessão ativa e de 2FA.
  const { profile } = await requireSession();
  const politica = await getPoliticaSeguranca();
  return (
    <AppShell profile={profile}>
      {children}
      <SessionGuard minutos={politica.inatividade_min} />
    </AppShell>
  );
}
