"use client";
/**
 * Banco local do app de campo (IndexedDB), com os dados e arquivos CRIPTOGRAFADOS (AES-GCM 256) por uma
 * chave não exportável gerada no aparelho. Revogação/saída: apaga tudo (banco, caches e chave).
 */
const NOME = "geeasy-campo";
const VERSAO = 1;

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const r = indexedDB.open(NOME, VERSAO);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("fila")) db.createObjectStore("fila", { keyPath: "id" });
      if (!db.objectStoreNames.contains("historico")) db.createObjectStore("historico", { keyPath: "id" });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}

async function op<T>(store: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await abrir();
  return new Promise<T>((ok, falha) => {
    const tx = db.transaction(store, modo);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => ok(req.result as T);
    req.onerror = () => falha(req.error);
    tx.oncomplete = () => db.close();
  });
}

export const kvGet = <T>(k: string) => op<T | undefined>("kv", "readonly", (s) => s.get(k));
export const kvSet = (k: string, v: unknown) => op<IDBValidKey>("kv", "readwrite", (s) => s.put(v, k));
export const listar = <T>(store: "fila" | "historico") => op<T[]>(store, "readonly", (s) => s.getAll());
export const gravar = (store: "fila" | "historico", v: unknown) => op<IDBValidKey>(store, "readwrite", (s) => s.put(v));
export const remover = (store: "fila" | "historico", id: string) => op<undefined>(store, "readwrite", (s) => s.delete(id));

async function chave(): Promise<CryptoKey> {
  const atual = await kvGet<CryptoKey>("chave");
  if (atual) return atual;
  const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await kvSet("chave", k);
  return k;
}

export interface Cifrado {
  iv: Uint8Array;
  dados: ArrayBuffer;
}

export async function cifrar(conteudo: unknown): Promise<Cifrado> {
  const bytes = conteudo instanceof ArrayBuffer ? new Uint8Array(conteudo) : new TextEncoder().encode(JSON.stringify(conteudo));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv, dados: await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chave(), bytes) };
}

export async function decifrarBytes(c: Cifrado): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: c.iv as BufferSource }, await chave(), c.dados);
}

export async function decifrar<T>(c: Cifrado): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await decifrarBytes(c))) as T;
}

/** Identificador do aparelho (gerado uma vez; base da revogação remota). */
export async function idDoAparelho(): Promise<string> {
  let id = await kvGet<string>("dispositivo");
  if (!id) {
    id = crypto.randomUUID();
    await kvSet("dispositivo", id);
  }
  return id;
}

/** Apaga tudo o que o app guardou neste aparelho (revogação, troca de usuário ou "sair"). */
export async function apagarTudo() {
  await new Promise<void>((ok) => {
    const r = indexedDB.deleteDatabase(NOME);
    r.onsuccess = r.onerror = r.onblocked = () => ok();
  });
  try {
    const ks = await caches.keys();
    await Promise.all(ks.map((k) => caches.delete(k)));
    navigator.serviceWorker?.controller?.postMessage({ tipo: "limpar" });
  } catch {
    // sem caches no navegador: nada a apagar
  }
}

// ------------------------------------------------------------------ PIN de desbloqueio
async function hashPin(pin: string, sal: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: sal as BufferSource, iterations: 150_000, hash: "SHA-256" }, base, 256);
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function definirPin(pin: string) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  await kvSet("pin", { sal, hash: await hashPin(pin, sal), erros: 0 });
}

export async function temPin() {
  return !!(await kvGet("pin"));
}

/** Confere o PIN. Cinco erros seguidos apagam os dados do aparelho. */
export async function conferirPin(pin: string): Promise<"ok" | "erro" | "apagado"> {
  const p = await kvGet<{ sal: Uint8Array; hash: string; erros: number }>("pin");
  if (!p) return "ok";
  if ((await hashPin(pin, p.sal)) === p.hash) {
    await kvSet("pin", { ...p, erros: 0 });
    return "ok";
  }
  if (p.erros + 1 >= 5) {
    await apagarTudo();
    return "apagado";
  }
  await kvSet("pin", { ...p, erros: p.erros + 1 });
  return "erro";
}
