"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, KeyRound, LogOut, Trash2 } from "lucide-react";
import { apagarTudo, definirPin, idDoAparelho, kvSet, temPin } from "@/lib/campo/local";
import { pendentes } from "@/lib/campo/fila";
import { salvarPushAssinatura } from "@/lib/actions/campo";
import { signOut } from "@/lib/actions/auth";
import { useCampo } from "./contexto";

const b64ParaBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** PIN de bloqueio, notificações push, apagar os dados do aparelho e sair. */
export function TelaAjustes({ vapidKey }: { vapidKey: string }) {
  const { aviso } = useCampo();
  const router = useRouter();
  const [comPin, setComPin] = useState(false);
  const [pin, setPin] = useState("");
  const [push, setPush] = useState<"ativo" | "inativo" | "indisponivel">("inativo");
  useEffect(() => {
    temPin().then(setComPin);
    if (!("PushManager" in window) || !vapidKey) setPush("indisponivel");
    else navigator.serviceWorker?.ready.then((r) => r.pushManager.getSubscription()).then((s) => setPush(s ? "ativo" : "inativo")).catch(() => undefined);
  }, [vapidKey]);

  const ativarPush = async () => {
    try {
      if ((await Notification.requestPermission()) !== "granted") return aviso("Permita as notificações nas configurações do navegador.", "erro");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ParaBytes(vapidKey) as BufferSource });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await salvarPushAssinatura({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, dispositivo_id: await idDoAparelho() });
      if (!r.ok) return aviso(r.error ?? "Falha ao ativar.", "erro");
      setPush("ativo");
      aviso("Notificações ativadas.");
    } catch {
      aviso("Este navegador não permitiu as notificações. No iPhone, instale o app na tela inicial primeiro.", "erro");
    }
  };

  // ao sair, os dados locais são sempre apagados (aparelho pode ser compartilhado)
  const sair = async () => {
    const pend = (await pendentes()).length;
    if (pend && !confirm(`Há ${pend} registro(s) ainda não enviados. Se sair agora eles serão perdidos. Continuar?`)) return;
    await apagarTudo();
    await signOut();
    router.replace("/login");
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Ajustes</h1>
      <section className="card space-y-3 p-4">
        <p className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" /> PIN de bloqueio</p>
        <p className="text-sm text-muted">O app pede o PIN ao abrir e após 5 minutos fora. Cinco erros apagam os dados do aparelho.</p>
        <input className="input" type="password" inputMode="numeric" maxLength={8} placeholder={comPin ? "Novo PIN (4 a 8 números)" : "Criar PIN (4 a 8 números)"} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        <div className="flex gap-2">
          <button type="button" disabled={pin.length < 4} onClick={async () => { await definirPin(pin); setPin(""); setComPin(true); aviso("PIN definido."); }} className="flex-1 rounded-xl bg-brand-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Salvar PIN</button>
          {comPin && <button type="button" onClick={async () => { await kvSet("pin", undefined); setComPin(false); aviso("PIN removido."); }} className="flex-1 rounded-xl border border-line py-2.5 text-sm font-semibold">Remover</button>}
        </div>
      </section>
      <section className="card space-y-2 p-4">
        <p className="flex items-center gap-2 font-semibold"><Bell className="h-4 w-4" /> Notificações</p>
        <p className="text-sm text-muted">Lead novo, prazo dos 45 dias, rota alterada, mensagem na fila e aprovação de despesas.</p>
        {push === "indisponivel" ? <p className="text-sm text-muted">Indisponível neste navegador ou não configurado pela empresa.</p> : push === "ativo" ? <p className="text-sm text-emerald-700">Ativadas neste aparelho.</p> : <button type="button" onClick={ativarPush} className="w-full rounded-xl bg-accent-500 py-2.5 text-sm font-semibold text-white">Ativar notificações</button>}
      </section>
      <section className="card space-y-2 p-4">
        <button type="button" onClick={sair} className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 py-3 text-sm font-semibold text-red-700"><LogOut className="h-4 w-4" /><Trash2 className="h-4 w-4" /> Sair e apagar os dados deste aparelho</button>
      </section>
      <p className="text-center text-[11px] text-muted">Os dados guardados neste aparelho ficam criptografados.</p>
    </div>
  );
}
