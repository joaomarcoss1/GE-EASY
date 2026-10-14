"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function MfaForm() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const sp = useSearchParams();
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => setFactorId(data?.totp.find((f) => f.status === "verified")?.id ?? null));
  }, [supabase]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setLoading(false);
    if (error) return setError("Código inválido. Tente novamente.");
    const next = sp.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    router.refresh();
  };

  return (
    <div>
      <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"><ShieldCheck className="h-6 w-6" /></div>
      <h2 className="text-2xl font-bold tracking-tight">Verificação em duas etapas</h2>
      <p className="mb-8 mt-1.5 text-sm text-muted">Digite o código de 6 dígitos do seu aplicativo autenticador.</p>
      <form onSubmit={verify} className="space-y-4">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="input h-14 text-center text-2xl font-semibold tracking-[0.5em]" autoFocus aria-label="Código 2FA" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" variant="accent" loading={loading} disabled={code.length !== 6 || !factorId} className="h-12 w-full">Verificar</Button>
      </form>
    </div>
  );
}
