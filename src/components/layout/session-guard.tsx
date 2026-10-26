"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { signOutInatividade } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/drawer";

const CHAVE = "geeasy:ultima-atividade";
const AVISO_SEG = 60;

function ler(): number {
  try {
    return Number(window.localStorage.getItem(CHAVE)) || Date.now();
  } catch {
    return Date.now();
  }
}
function gravar(t: number) {
  try {
    window.localStorage.setItem(CHAVE, String(t));
  } catch {
    /* modo privado: usa só a memória */
  }
}

/**
 * Encerra a sessão após X minutos sem atividade (compartilhado entre abas).
 * Mostra um aviso 60 s antes, com opção de continuar conectado.
 */
export function SessionGuard({ minutos }: { minutos: number }) {
  const [restante, setRestante] = useState<number | null>(null);
  const ultima = useRef(Date.now());
  const saindo = useRef(false);
  const limiteMs = Math.max(5, minutos) * 60_000;

  const registrar = useCallback(() => {
    const agora = Date.now();
    if (agora - ultima.current < 5_000) return;
    ultima.current = agora;
    gravar(agora);
  }, []);

  const continuar = useCallback(() => {
    ultima.current = Date.now();
    gravar(ultima.current);
    setRestante(null);
  }, []);

  useEffect(() => {
    gravar(Date.now());
    const eventos = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;
    eventos.forEach((e) => window.addEventListener(e, registrar, { passive: true }));
    // "voltar" do navegador pode reexibir a página da memória (bfcache) depois de sair: recarrega para checar a sessão
    const aoVoltar = (e: PageTransitionEvent) => e.persisted && window.location.reload();
    window.addEventListener("pageshow", aoVoltar);
    const timer = window.setInterval(() => {
      const ociosoMs = Date.now() - Math.max(ultima.current, ler());
      const faltam = Math.ceil((limiteMs - ociosoMs) / 1000);
      if (faltam <= 0) {
        if (!saindo.current) {
          saindo.current = true;
          void signOutInatividade();
        }
      } else if (faltam <= AVISO_SEG) setRestante(faltam);
      else setRestante(null);
    }, 1_000);
    return () => {
      eventos.forEach((e) => window.removeEventListener(e, registrar));
      window.removeEventListener("pageshow", aoVoltar);
      window.clearInterval(timer);
    };
  }, [limiteMs, registrar]);

  return (
    <Modal open={restante !== null} onClose={continuar} title="Sua sessão vai expirar">
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm">
          <Clock className="h-5 w-5 text-amber-500" /> Por segurança, você será desconectado em <b>{restante ?? 0}s</b> por inatividade.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => void signOutInatividade()}>Sair agora</Button>
          <Button onClick={continuar}>Continuar conectado</Button>
        </div>
      </div>
    </Modal>
  );
}
