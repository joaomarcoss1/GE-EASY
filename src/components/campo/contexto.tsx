"use client";
import { createContext, useContext } from "react";
import type { TipoItem } from "@/lib/campo/fila";
import type { Snapshot, Tela } from "./tipos";

export interface CampoCtx {
  snap: Snapshot;
  online: boolean;
  fila: number;
  sincronizando: boolean;
  irPara: (t: Tela, extra?: Record<string, string>) => void;
  params: Record<string, string>;
  /** Grava na fila (criptografado) e aplica o efeito na tela na hora (modo offline) */
  registrar: (tipo: TipoItem, payload: Record<string, unknown> & { id: string }, resumo: string, arquivos?: { campo: string; nome: string; blob: Blob }[]) => Promise<void>;
  sincronizar: () => Promise<void>;
  aviso: (msg: string, tipo?: "ok" | "erro") => void;
}

export const Ctx = createContext<CampoCtx | null>(null);
export const useCampo = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("fora do app de campo");
  return c;
};
