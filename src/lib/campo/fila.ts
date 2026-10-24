"use client";
import { apagarTudo, cifrar, decifrar, decifrarBytes, gravar, idDoAparelho, listar, remover, type Cifrado } from "./local";

/**
 * Fila de sincronização do app de campo (modo offline): cada registro recebe um UUID no aparelho
 * (idempotência — reenviar não duplica), fica criptografado no IndexedDB e é enviado em ordem quando
 * houver internet. Erro de rede/servidor: tenta de novo depois; recusa definitiva: sai da fila e vai para
 * o histórico com o motivo.
 */
export type TipoItem = "pre_cadastro" | "documento" | "iniciar_rota" | "checkin" | "finalizar_rota" | "despesa" | "ponto";

export interface ItemFila {
  id: string;
  tipo: TipoItem;
  criado_em: string;
  resumo: string;
  payload: Cifrado;
  arquivos: { campo: string; nome: string; mime: string; conteudo: Cifrado }[];
  tentativas: number;
  erro?: string;
}

export interface Historico {
  id: string;
  tipo: TipoItem;
  resumo: string;
  status: "ok" | "duplicado" | "rejeitado";
  mensagem: string;
  em: string;
  dados?: Record<string, unknown>;
}

const VERSAO_APP = "1.0.0";

export async function enfileirar(tipo: TipoItem, payload: Record<string, unknown> & { id: string }, resumo: string, arquivos: { campo: string; nome: string; blob: Blob }[] = []) {
  const item: ItemFila = {
    id: payload.id,
    tipo,
    criado_em: new Date().toISOString(),
    resumo,
    payload: await cifrar(payload),
    arquivos: await Promise.all(arquivos.map(async (a) => ({ campo: a.campo, nome: a.nome, mime: a.blob.type || "application/octet-stream", conteudo: await cifrar(await a.blob.arrayBuffer()) }))),
    tentativas: 0,
  };
  await gravar("fila", item);
  avisarMudanca();
  try {
    const reg = await navigator.serviceWorker?.ready;
    await (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })?.sync?.register("fila-campo");
  } catch {
    // sem Background Sync: o app envia ao voltar a conexão
  }
}

export const pendentes = async () => (await listar<ItemFila>("fila")).sort((a, b) => a.criado_em.localeCompare(b.criado_em));
export const historico = async () => (await listar<Historico>("historico")).sort((a, b) => b.em.localeCompare(a.em)).slice(0, 100);

function avisarMudanca() {
  window.dispatchEvent(new Event("campo:fila"));
}

let emAndamento: Promise<ResultadoSync> | null = null;

interface ResultadoSync {
  enviados: number;
  falhas: number;
  restantes: number;
  revogado?: boolean;
  offline?: boolean;
}

function plataforma() {
  const ua = navigator.userAgent;
  return /android/i.test(ua) ? "Android" : /iphone|ipad/i.test(ua) ? "iOS" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "macOS" : "Navegador";
}

/** Envia a fila em ordem (uma requisição por item). Só uma sincronização por vez. */
export function sincronizar(): Promise<ResultadoSync> {
  if (emAndamento) return emAndamento;
  emAndamento = (async () => {
    const r: ResultadoSync = { enviados: 0, falhas: 0, restantes: 0 };
    const fila = await pendentes();
    const dispositivo = { id: await idDoAparelho(), nome: `${plataforma()} · ${navigator.userAgent.slice(0, 60)}`, plataforma: plataforma(), versao: VERSAO_APP, fila: fila.length };
    if (!navigator.onLine) return { ...r, restantes: fila.length, offline: true };
    // mesmo sem itens: registra o aparelho e confere a revogação
    if (!fila.length) {
      const res = await fetch("/api/campo/sync", { method: "POST", body: formulario(dispositivo, null) }).catch(() => null);
      if (res?.status === 410) return revogar(r);
      return r;
    }
    for (let i = 0; i < fila.length; i++) {
      const item = fila[i];
      let res: Response | null = null;
      try {
        const fd = formulario(dispositivo, { id: item.id, tipo: item.tipo, payload: await decifrar(item.payload) });
        for (const a of item.arquivos) fd.append(a.campo, new Blob([await decifrarBytes(a.conteudo)], { type: a.mime }), a.nome);
        res = await fetch("/api/campo/sync", { method: "POST", body: fd });
      } catch {
        res = null;
      }
      if (res?.status === 410) return revogar(r);
      if (res?.status === 401) return { ...r, restantes: fila.length - i, offline: true }; // sessão expirada: entrar de novo
      const json = res ? ((await res.json().catch(() => null)) as { status?: Historico["status"]; mensagem?: string; dados?: Record<string, unknown> } | null) : null;
      if (!res || res.status >= 500 || !json?.status) {
        await gravar("fila", { ...item, tentativas: item.tentativas + 1, erro: json?.mensagem ?? "Sem conexão com o servidor" });
        r.falhas++;
        r.restantes = fila.length - i;
        break; // mantém a ordem: tenta de novo depois
      }
      await gravar("historico", { id: item.id, tipo: item.tipo, resumo: item.resumo, status: json.status, mensagem: json.mensagem ?? "", em: new Date().toISOString(), dados: json.dados } satisfies Historico);
      await remover("fila", item.id);
      r.enviados++;
    }
    if (!r.restantes) r.restantes = (await pendentes()).length;
    avisarMudanca();
    return r;
  })().finally(() => {
    emAndamento = null;
  });
  return emAndamento;
}

function formulario(dispositivo: Record<string, unknown>, item: Record<string, unknown> | null) {
  const fd = new FormData();
  fd.append("meta", JSON.stringify({ dispositivo, item }));
  return fd;
}

async function revogar(r: ResultadoSync): Promise<ResultadoSync> {
  await apagarTudo();
  avisarMudanca();
  return { ...r, revogado: true };
}
