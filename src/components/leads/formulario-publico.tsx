"use client";
import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { CheckCircle2, Loader2 } from "lucide-react";

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void }) => void } }
}

/** Envia para /api/publico/leads/<slug>; guarda os parâmetros UTM da URL para medir a campanha. */
export function FormularioLead({ slug, empresa, interesses, pedirDocumento, pedirRenda, turnstileKey }: {
  slug: string; empresa: string; interesses: string[]; pedirDocumento: boolean; pedirRenda: boolean; turnstileKey: string;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const caixa = useRef<HTMLDivElement>(null);
  const montar = () => {
    if (turnstileKey && caixa.current && window.turnstile && !caixa.current.childElementCount) window.turnstile.render(caixa.current, { sitekey: turnstileKey, callback: setToken });
  };
  useEffect(montar);

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErro(null);
    const fd = new FormData(e.currentTarget);
    const utm = Object.fromEntries([...new URLSearchParams(window.location.search)].filter(([k]) => k.startsWith("utm_")).map(([k, v]) => [k, v.slice(0, 200)]));
    const corpo = { ...Object.fromEntries(fd), consentimento: fd.get("consentimento") === "on", utm, turnstile: token };
    setEnviando(true);
    try {
      const r = await fetch(`/api/publico/leads/${slug}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = (await r.json().catch(() => ({}))) as { mensagem?: string };
      if (!r.ok) setErro(j.mensagem ?? "Não foi possível enviar.");
      else setOk(j.mensagem ?? "Recebemos seus dados!");
    } catch {
      setErro("Sem conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  if (ok) return <div className="mt-6 flex flex-col items-center gap-3 text-center"><CheckCircle2 className="h-12 w-12 text-emerald-600" /><p className="font-semibold">{ok}</p></div>;
  return (
    <form onSubmit={enviar} className="mt-6 space-y-3">
      {turnstileKey && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" onLoad={montar} />}
      <input className="input" name="nome" placeholder="Nome completo *" required maxLength={200} autoComplete="name" />
      <input className="input" name="telefone" placeholder="WhatsApp com DDD *" required inputMode="tel" maxLength={30} autoComplete="tel" />
      <input className="input" name="email" type="email" placeholder="E-mail" maxLength={200} autoComplete="email" />
      {pedirDocumento && <input className="input" name="documento" placeholder="CPF" inputMode="numeric" maxLength={20} />}
      <input className="input" name="cidade" placeholder="Cidade" maxLength={120} autoComplete="address-level2" />
      {interesses.length > 0 ? (
        <select className="input" name="interesse" defaultValue=""><option value="">Tenho interesse em…</option>{interesses.map((i) => <option key={i} value={i}>{i}</option>)}</select>
      ) : <input className="input" name="interesse" placeholder="Qual o seu interesse?" maxLength={500} />}
      {pedirRenda && <input className="input" name="renda" placeholder="Renda mensal aproximada (R$)" inputMode="decimal" maxLength={20} />}
      <textarea className="input" name="mensagem" rows={3} placeholder="Mensagem (opcional)" maxLength={2000} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" name="consentimento" required className="mt-0.5 h-4 w-4" />
        <span>Autorizo {empresa} a usar estes dados para entrar em contato comigo sobre minha solicitação, conforme a LGPD. Posso pedir a exclusão a qualquer momento.</span>
      </label>
      {turnstileKey && <div ref={caixa} />}
      {erro && <p className="text-sm text-red-600" role="alert">{erro}</p>}
      <button type="submit" disabled={enviando} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 py-3 font-semibold text-white disabled:opacity-60">
        {enviando && <Loader2 className="h-4 w-4 animate-spin" />}Enviar
      </button>
    </form>
  );
}
