"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, KeyRound, Loader2, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import type { Factor } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { dateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";

interface Enrollment {
  factorId: string;
  qr: string;
  secret: string;
}

const qrSrc = (qr: string) => (qr.startsWith("data:") ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`);

/** Autenticação em dois fatores (TOTP) via Supabase Auth MFA. */
export function MfaManager() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enroll, setEnroll] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Factor | null>(null);
  const router = useRouter();
  const toast = useToast();

  const load = useCallback(async () => {
    const { data, error } = await createClient().auth.mfa.listFactors();
    if (error) {
      setError("Não foi possível carregar os fatores de autenticação.");
      setFactors([]);
      return;
    }
    setFactors(data.all.filter((f) => f.factor_type === "totp"));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const verified = (factors ?? []).filter((f) => f.status === "verified");

  async function start() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // Remove inscrições não concluídas (evita conflito de nome)
    for (const f of factors ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "GE EASY", friendlyName: `Autenticador ${new Date().toLocaleString("pt-BR")}` });
    setBusy(false);
    if (error || !data) {
      setError("Não foi possível iniciar a configuração do 2FA. Tente novamente.");
      return;
    }
    setCode("");
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function cancel() {
    if (enroll) await createClient().auth.mfa.unenroll({ factorId: enroll.factorId });
    setEnroll(null);
    setCode("");
    void load();
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll || !/^\d{6}$/.test(code)) {
      setError("Digite o código de 6 dígitos do aplicativo.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: enroll.factorId, code });
    setBusy(false);
    if (error) {
      setError("Código inválido ou expirado. Confira o horário do celular e tente novamente.");
      return;
    }
    setEnroll(null);
    setCode("");
    toast("Autenticação em dois fatores ativada.");
    await load();
    router.refresh();
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    const { error } = await createClient().auth.mfa.unenroll({ factorId: removing.id });
    setBusy(false);
    setRemoving(null);
    if (error) {
      toast(/aal2/i.test(error.message) ? "Para remover, entre novamente usando o código do autenticador." : "Não foi possível remover o fator.", "error");
      return;
    }
    toast("Fator removido.");
    await load();
    router.refresh();
  }

  if (factors === null)
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2/60 p-4 sm:flex-row sm:items-center">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${verified.length ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300"}`}>
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">{verified.length ? "2FA ativado" : "2FA desativado"}</p>
          <p className="text-xs text-muted">
            {verified.length
              ? "Ao entrar, será solicitado o código do aplicativo autenticador."
              : "Proteja sua conta com um código do Google Authenticator, Microsoft Authenticator, 1Password ou similar."}
          </p>
        </div>
        {!enroll && (
          <Button type="button" variant={verified.length ? "secondary" : "accent"} onClick={start} loading={busy}>
            <Smartphone className="h-4 w-4" /> {verified.length ? "Adicionar outro aparelho" : "Ativar 2FA"}
          </Button>
        )}
      </div>

      {error && !enroll && (
        <p className="flex items-center gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      )}

      {enroll && (
        <div className="grid gap-5 rounded-2xl border border-brand-200 p-5 dark:border-brand-800 md:grid-cols-[200px_1fr]">
          <div className="mx-auto rounded-2xl bg-white p-3 shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc(enroll.qr)} alt="QR code para o aplicativo autenticador" width={176} height={176} className="h-44 w-44" />
          </div>
          <form onSubmit={verify} className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>Abra o aplicativo autenticador no celular.</li>
              <li>Escaneie o QR code ou digite a chave abaixo.</li>
              <li>Informe o código de 6 dígitos gerado.</li>
            </ol>
            <div>
              <p className="label">Chave manual</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs">{enroll.secret}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Copiar chave"
                  onClick={() => navigator.clipboard?.writeText(enroll.secret).then(() => toast("Chave copiada.", "info"), () => undefined)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <label htmlFor="totp-code" className="label">
                Código de verificação
              </label>
              <input
                id="totp-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="input h-12 max-w-[200px] text-center font-mono text-lg tracking-[0.4em]"
              />
            </div>
            {error && (
              <p className="flex items-center gap-2 text-sm font-medium text-red-600">
                <AlertTriangle className="h-4 w-4" /> {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" variant="accent" loading={busy}>
                <KeyRound className="h-4 w-4" /> Verificar e ativar
              </Button>
              <Button type="button" variant="ghost" onClick={cancel} disabled={busy}>
                Cancelar
              </Button>
            </div>
          </form>
        </div>
      )}

      {verified.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {verified.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-3">
              <Smartphone className="h-5 w-5 text-brand-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.friendly_name || "Aplicativo autenticador"}</p>
                <p className="text-xs text-muted">Adicionado em {dateTime(f.created_at)}</p>
              </div>
              <Badge tone="green" dot>
                Verificado
              </Badge>
              <Button type="button" variant="ghost" size="icon" aria-label="Remover fator" title="Remover" onClick={() => setRemoving(f)} className="hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-950/40">
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Remover este autenticador?">
        <p className="text-sm text-muted">
          {verified.length <= 1 ? "Este é o seu único fator: a autenticação em dois fatores será desativada e sua conta ficará menos protegida." : "O aparelho deixará de gerar códigos válidos para sua conta."}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRemoving(null)}>
            Cancelar
          </Button>
          <Button variant="danger" loading={busy} onClick={remove}>
            Remover
          </Button>
        </div>
      </Modal>
    </div>
  );
}
