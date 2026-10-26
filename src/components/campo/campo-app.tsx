"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, CloudOff, Home, ListChecks, Loader2, Lock, Map as MapIcon, RefreshCw, Settings, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import { enfileirar, pendentes, sincronizar as enviarFila, type ItemFila, type TipoItem } from "@/lib/campo/fila";
import { cifrar, conferirPin, decifrar, kvGet, kvSet, temPin, type Cifrado } from "@/lib/campo/local";
import { Ctx, type CampoCtx } from "./contexto";
import type { CheckinCampo, Snapshot, Tela } from "./tipos";
import { TelaInicio } from "./tela-inicio";
import { TelaRota } from "./tela-rota";
import { TelaCadastro } from "./tela-cadastro";
import { TelaScanner } from "./tela-scanner";
import { TelaDespesa } from "./tela-despesa";
import { TelaPonto } from "./tela-ponto";
import { TelaFila } from "./tela-fila";
import { TelaAjustes } from "./tela-ajustes";

const TELAS: Tela[] = ["inicio", "rota", "cadastro", "scanner", "despesa", "ponto", "fila", "ajustes"];
const BLOQUEIO_MIN = 5;

/** Reaplica sobre o pacote do servidor o que ainda está na fila (o consultor vê o que fez mesmo sem internet). */
async function aplicarPendentes(base: Snapshot, itens: ItemFila[]): Promise<Snapshot> {
  const s: Snapshot = structuredClone(base);
  for (const it of itens) {
    const p = await decifrar<Record<string, unknown>>(it.payload).catch(() => null);
    if (!p) continue;
    if (it.tipo === "iniciar_rota" || it.tipo === "finalizar_rota") {
      const r = s.rotas.find((x) => x.id === p.rota_id);
      if (r) r.status = it.tipo === "iniciar_rota" ? (r.status === "planejada" ? "em_andamento" : r.status) : "concluida";
    } else if (it.tipo === "checkin") {
      const r = s.rotas.find((x) => x.id === p.rota_id);
      if (r && !r.checkins.some((c) => c.id === it.id)) {
        const c: CheckinCampo = { id: it.id, rota_id: r.id, parada_id: String(p.parada_id), tipo: p.tipo as "chegada" | "saida", registrado_em: it.criado_em, resultado: (p.resultado as string) ?? null, dentro_do_raio: null, pendente: true };
        r.checkins.push(c);
        const pa = r.paradas.find((x) => x.id === p.parada_id);
        if (pa && c.tipo === "chegada") pa.status = "visitada";
      }
    } else if (it.tipo === "pre_cadastro") {
      if (!s.carteira.some((c) => c.id === it.id)) s.carteira.unshift({ id: it.id, nome: String(p.nome), documento: null, cidade: (p.cidade as string) ?? null, status_cadastro: "pre_cadastro" });
    } else if (it.tipo === "ponto") {
      if (!s.ponto_hoje.some((m) => m.id === it.id)) s.ponto_hoje.push({ id: it.id, tipo: String(p.tipo), registrado_em: String(p.dispositivo_em) });
    }
  }
  return s;
}

export function CampoApp({ inicial, vapidKey, versaoMinima }: { inicial: Snapshot | null; vapidKey: string; versaoMinima: string | null }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [snapBase, setSnapBase] = useState<Snapshot | null>(inicial);
  const [snap, setSnap] = useState<Snapshot | null>(inicial);
  const [online, setOnline] = useState(true);
  const [fila, setFila] = useState(0);
  const [sinc, setSinc] = useState(false);
  const [tela, setTela] = useState<Tela>(() => (TELAS.includes(sp.get("tela") as Tela) ? (sp.get("tela") as Tela) : sp.get("rota") ? "rota" : "inicio"));
  const [params, setParams] = useState<Record<string, string>>(() => (sp.get("rota") ? { rota: sp.get("rota")! } : ({} as Record<string, string>)));
  const [msg, setMsg] = useState<{ texto: string; tipo: "ok" | "erro" } | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [carregando, setCarregando] = useState(!inicial);
  const [pin, setPin] = useState("");
  const escondidoEm = useRef<number | null>(null);

  const aviso = useCallback((texto: string, tipo: "ok" | "erro" = "ok") => {
    setMsg({ texto, tipo });
    setTimeout(() => setMsg(null), 4500);
  }, []);

  const recalcular = useCallback(async (base: Snapshot | null) => {
    const itens = await pendentes();
    setFila(itens.length);
    if (base) setSnap(await aplicarPendentes(base, itens));
  }, []);

  /** Busca o pacote novo (se online) e guarda criptografado. */
  const atualizarPacote = useCallback(async () => {
    try {
      const r = await fetch("/api/campo/snapshot", { cache: "no-store" });
      if (r.status === 410) { router.replace("/login?revogado=1"); return; }
      if (!r.ok) return;
      const novo = (await r.json()) as Snapshot;
      await kvSet("snapshot", await cifrar(novo));
      setSnapBase(novo);
      await recalcular(novo);
    } catch {
      // sem internet: segue com o pacote local
    }
  }, [recalcular, router]);

  const sincronizar = useCallback(async () => {
    setSinc(true);
    try {
      const r = await enviarFila();
      if (r.revogado) { router.replace("/login?revogado=1"); return; }
      if (r.enviados) aviso(`${r.enviados} registro(s) enviado(s).`);
      if (r.enviados || !r.offline) await atualizarPacote();
      else await recalcular(snapBase);
    } finally {
      setSinc(false);
    }
  }, [atualizarPacote, aviso, recalcular, router, snapBase]);

  // inicialização: service worker, pacote local, conexão, sincronização periódica, bloqueio por PIN
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    (async () => {
      if (await temPin()) setBloqueado(true);
      const local = await kvGet<Cifrado>("snapshot");
      if (!inicial && local) {
        const s = await decifrar<Snapshot>(local).catch(() => null);
        if (s) { setSnapBase(s); await recalcular(s); }
      } else if (inicial) {
        await kvSet("snapshot", await cifrar(inicial));
        await recalcular(inicial);
      }
      if (navigator.onLine) {
        if (!local && !inicial) await atualizarPacote();
        sincronizar();
      }
      setCarregando(false);
    })();
    const on = () => { setOnline(true); sincronizar(); };
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const mudou = () => pendentes().then((i) => setFila(i.length));
    window.addEventListener("campo:fila", mudou);
    const msgSw = (e: MessageEvent) => { if (e.data?.tipo === "sincronizar") sincronizar(); };
    navigator.serviceWorker?.addEventListener("message", msgSw);
    const t = setInterval(() => { if (navigator.onLine) sincronizar(); }, 90_000);
    const vis = async () => {
      if (document.hidden) escondidoEm.current = Date.now();
      else if (escondidoEm.current && Date.now() - escondidoEm.current > BLOQUEIO_MIN * 60_000 && (await temPin())) setBloqueado(true);
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("campo:fila", mudou);
      navigator.serviceWorker?.removeEventListener("message", msgSw);
      document.removeEventListener("visibilitychange", vis);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inicialização única do app
  }, []);

  const registrar = useCallback<CampoCtx["registrar"]>(async (tipo: TipoItem, payload, resumo, arquivos = []) => {
    await enfileirar(tipo, payload, resumo, arquivos);
    await recalcular(snapBase);
    if (navigator.onLine) sincronizar();
  }, [recalcular, sincronizar, snapBase]);

  const irPara = useCallback((t: Tela, extra?: Record<string, string>) => {
    setTela(t);
    setParams(extra ?? {});
    window.scrollTo(0, 0);
  }, []);

  const ctx = useMemo<CampoCtx | null>(() => (snap ? { snap, online, fila, sincronizando: sinc, irPara, params, registrar, sincronizar, aviso } : null), [snap, online, fila, sinc, irPara, params, registrar, sincronizar, aviso]);

  if (bloqueado) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-brand-950 p-6 text-white">
        <Lock className="h-10 w-10" />
        <p className="text-lg font-semibold">App bloqueado</p>
        <input type="password" inputMode="numeric" autoFocus maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="w-48 rounded-xl border-0 px-4 py-3 text-center text-2xl tracking-[.5em] text-fg" aria-label="PIN" />
        <button
          type="button"
          className="rounded-xl bg-accent-500 px-6 py-3 font-semibold"
          onClick={async () => {
            const r = await conferirPin(pin);
            setPin("");
            if (r === "ok") setBloqueado(false);
            else if (r === "apagado") router.replace("/login?revogado=1");
            else aviso("PIN incorreto. Após 5 erros os dados do aparelho são apagados.", "erro");
          }}
        >
          Desbloquear
        </button>
        {msg && <p className="text-sm text-red-300">{msg.texto}</p>}
      </div>
    );
  }

  if (!ctx && carregando) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-700" /></div>;
  if (!ctx) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <CloudOff className="h-10 w-10 text-muted" />
        <p className="font-semibold">Abra o app uma vez com internet</p>
        <p className="text-sm text-muted">Depois disso ele funciona sem conexão.</p>
        <button type="button" className="rounded-xl bg-brand-700 px-5 py-2.5 font-semibold text-white" onClick={atualizarPacote}>Tentar de novo</button>
      </div>
    );
  }

  const nav: { t: Tela; label: string; icon: React.ReactNode }[] = [
    { t: "inicio", label: "Início", icon: <Home className="h-5 w-5" /> },
    ...(ctx.snap.pode.rotas ? [{ t: "rota" as Tela, label: "Rota", icon: <MapIcon className="h-5 w-5" /> }] : []),
    ...(ctx.snap.pode.cadastrar ? [{ t: "cadastro" as Tela, label: "Cadastro", icon: <UserPlus className="h-5 w-5" /> }, { t: "scanner" as Tela, label: "Scanner", icon: <Camera className="h-5 w-5" /> }] : []),
    { t: "fila", label: "Envios", icon: <ListChecks className="h-5 w-5" /> },
    { t: "ajustes", label: "Ajustes", icon: <Settings className="h-5 w-5" /> },
  ];

  return (
    <Ctx.Provider value={ctx}>
      <div className="mx-auto flex min-h-screen max-w-xl flex-col bg-bg pb-20">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-brand-900 px-4 py-3 text-white">
          <div className="min-w-0">
            <p className="truncate text-xs text-white/70">{ctx.snap.empresa.nome}</p>
            <p className="truncate font-semibold">{ctx.snap.usuario.nome}</p>
          </div>
          <button type="button" onClick={sincronizar} className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold" aria-label="Sincronizar">
            {sinc ? <Loader2 className="h-4 w-4 animate-spin" /> : online ? <RefreshCw className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
            {online ? (fila ? `${fila} a enviar` : "em dia") : `offline${fila ? ` · ${fila}` : ""}`}
          </button>
        </header>
        {versaoMinima && versaoMinima > "1.0.0" && <div className="bg-amber-100 px-4 py-2 text-xs text-amber-900">Há uma versão nova do app. Feche e abra de novo para atualizar.</div>}
        {msg && <div className={cn("mx-4 mt-3 rounded-xl px-4 py-3 text-sm font-medium", msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700")}>{msg.texto}</div>}
        <main className="flex-1 px-4 py-4">
          {tela === "inicio" && <TelaInicio />}
          {tela === "rota" && <TelaRota />}
          {tela === "cadastro" && <TelaCadastro />}
          {tela === "scanner" && <TelaScanner />}
          {tela === "despesa" && <TelaDespesa />}
          {tela === "ponto" && <TelaPonto />}
          {tela === "fila" && <TelaFila />}
          {tela === "ajustes" && <TelaAjustes vapidKey={vapidKey} />}
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-xl border-t border-line bg-surface">
          {nav.map((n) => (
            <button key={n.t} type="button" onClick={() => irPara(n.t)} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold", tela === n.t ? "text-brand-700 dark:text-brand-200" : "text-muted")}>
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
      </div>
    </Ctx.Provider>
  );
}
