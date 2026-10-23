"use client";
import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";

type Plano = { codigo: string; nome: string; descricao: string | null; preco_mensal: number; limites: { max_usuarios?: number } };
const slugDe = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export function FormCadastro({ planos, planoInicial, turnstileKey, raiz }: { planos: Plano[]; planoInicial?: string; turnstileKey: string; raiz: string }) {
  const [empresa, setEmpresa] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [plano, setPlano] = useState(planos.some((p) => p.codigo === planoInicial) ? planoInicial! : planos[1]?.codigo ?? planos[0]?.codigo ?? "profissional");
  const [erro, setErro] = useState<{ mensagem: string; campo?: string } | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [token, setToken] = useState("");
  const caixa = useRef<HTMLDivElement>(null);
  const montar = () => {
    const w = window as unknown as { turnstile?: { render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void }) => void } };
    if (turnstileKey && caixa.current && w.turnstile && !caixa.current.childElementCount) w.turnstile.render(caixa.current, { sitekey: turnstileKey, callback: setToken });
  };
  useEffect(montar);

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErro(null);
    const fd = new FormData(e.currentTarget);
    setEnviando(true);
    try {
      const r = await fetch("/api/publico/cadastro", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(fd), slug, plano, termos: fd.get("termos") === "on", turnstile: token }) });
      const j = (await r.json().catch(() => ({}))) as { mensagem?: string; campo?: string };
      if (r.ok) setOk(j.mensagem ?? "Conta criada.");
      else setErro({ mensagem: j.mensagem ?? "Não foi possível criar a conta.", campo: j.campo });
    } catch {
      setErro({ mensagem: "Sem conexão. Tente novamente." });
    } finally {
      setEnviando(false);
    }
  };

  if (ok) return <div className="mt-8 flex flex-col items-center gap-3 text-center"><CheckCircle2 className="h-12 w-12 text-emerald-600" /><p className="font-semibold">{ok}</p></div>;
  const inv = (c: string) => (erro?.campo === c ? true : undefined);
  return (
    <form onSubmit={enviar} className="mt-6 space-y-3">
      {turnstileKey && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" onLoad={montar} />}
      <label className="label" htmlFor="c-empresa">Empresa</label>
      <input id="c-empresa" className="input" name="empresa" required maxLength={160} value={empresa} aria-invalid={inv("empresa")}
        onChange={(e) => { setEmpresa(e.target.value); if (!slugManual) setSlug(slugDe(e.target.value)); }} />
      <label className="label" htmlFor="c-slug">Endereço de acesso</label>
      <div className="flex items-center gap-2">
        <input id="c-slug" className="input" required minLength={3} maxLength={40} value={slug} aria-invalid={inv("slug")} onChange={(e) => { setSlugManual(true); setSlug(slugDe(e.target.value)); }} />
        {raiz && <span className="shrink-0 text-sm text-muted">.{raiz}</span>}
      </div>
      <label className="label" htmlFor="c-cnpj">CNPJ (opcional)</label>
      <input id="c-cnpj" className="input" name="cnpj" inputMode="numeric" maxLength={20} aria-invalid={inv("cnpj")} />
      <div className="grid gap-2 sm:grid-cols-3">
        {planos.map((p) => (
          <button key={p.codigo} type="button" onClick={() => setPlano(p.codigo)}
            className={`rounded-xl border p-3 text-left text-sm ${plano === p.codigo ? "border-brand-600 ring-2 ring-brand-500/20" : "border-line"}`}>
            <p className="font-semibold">{p.nome}</p>
            <p className="text-xs text-muted">{Number(p.preco_mensal).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês · até {p.limites.max_usuarios ?? "—"} usuários</p>
          </button>
        ))}
      </div>
      <label className="label" htmlFor="c-nome">Seu nome</label>
      <input id="c-nome" className="input" name="nome" required maxLength={120} autoComplete="name" aria-invalid={inv("nome")} />
      <label className="label" htmlFor="c-email">Seu e-mail</label>
      <input id="c-email" className="input" name="email" type="email" required maxLength={160} autoComplete="email" aria-invalid={inv("email")} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" name="termos" required className="mt-0.5 h-4 w-4" />
        <span>Li e aceito os termos de uso e a <Link href="/privacidade" className="font-semibold text-brand-600" target="_blank">política de privacidade</Link>. A empresa é a controladora dos dados que cadastrar; a plataforma atua como operadora (LGPD).</span>
      </label>
      {turnstileKey && <div ref={caixa} />}
      {erro && <p className="text-sm text-red-600" role="alert">{erro.mensagem}</p>}
      <button type="submit" disabled={enviando} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 py-3 font-semibold text-white disabled:opacity-60">
        {enviando && <Loader2 className="h-4 w-4 animate-spin" />}Começar o teste grátis
      </button>
    </form>
  );
}
