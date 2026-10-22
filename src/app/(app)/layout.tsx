import { getPoliticaSeguranca, requireSession } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { SessionGuard } from "@/components/layout/session-guard";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // requireSession() também é chamado por cada página (o layout não roda de novo na navegação do cliente):
  // é lá que ficam as exigências de empresa ativa, vínculo ativo e 2FA.
  const session = await requireSession();
  const politica = await getPoliticaSeguranca();
  return (
    <AppShell
      profile={session.profile}
      empresa={session.empresa!}
      empresas={session.empresas}
      areas={session.areas}
      areaAtiva={session.areaAtiva}
      plataformaAdmin={session.plataformaAdmin}
    >
      {children}
      <SessionGuard minutos={politica.inatividade_min} />
    </AppShell>
  );
}
