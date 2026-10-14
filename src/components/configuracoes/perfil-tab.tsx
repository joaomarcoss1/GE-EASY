import { UserCog } from "lucide-react";
import type { Session } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/constants";
import { pct } from "@/lib/format";
import { updateMeuPerfil } from "@/lib/actions/perfil";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { FieldDef } from "@/components/ui/form";
import { SettingsForm } from "./settings-form";

const fields: FieldDef[] = [
  { name: "full_name", label: "Nome completo", required: true, span: 4 },
  { name: "phone", label: "Telefone / WhatsApp", type: "tel", span: 2 },
  { name: "cargo", label: "Cargo", placeholder: "Ex.: Consultora de seguros", span: 3 },
  { name: "avatar_url", label: "Foto (URL)", type: "url", placeholder: "https://…", help: "Imagem https do Google (googleusercontent.com) ou do armazenamento do sistema.", span: 3 },
];

export function PerfilTab({ session }: { session: Session }) {
  const p = session.profile;
  return (
    <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
      <Card className="overflow-hidden">
        <div className="brand-gradient h-16" />
        <CardBody className="-mt-10 text-center">
          <Avatar name={p.full_name} src={p.avatar_url} size={80} className="mx-auto ring-4 ring-surface" />
          <p className="mt-3 text-lg font-bold">{p.full_name}</p>
          <p className="text-sm text-muted">{p.email}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            <Badge tone="brand">{ROLE_LABEL[p.role]}</Badge>
            {p.territorio && <Badge tone="accent">{p.territorio}</Badge>}
          </div>
          <dl className="mt-5 space-y-2 border-t border-line pt-4 text-left text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Comissão</dt>
              <dd className="font-medium">{pct(p.comissao_percentual, 2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Status</dt>
              <dd className="font-medium">{p.active ? "Ativo" : "Pendente"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted">Papel, comissão, território e e-mail são definidos pela administração.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Dados pessoais" description="Essas informações aparecem para a equipe no sistema." icon={<UserCog className="h-4 w-4" />} />
        <SettingsForm action={updateMeuPerfil} fields={fields} values={{ full_name: p.full_name, phone: p.phone, cargo: p.cargo, avatar_url: p.avatar_url }} />
      </Card>
    </div>
  );
}
