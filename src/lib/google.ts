import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { env, googleConfigured, serverEnv } from "@/lib/env";

/**
 * Integração Google Workspace (Agenda + Drive) via OAuth 2.0.
 * - Escopos mínimos: calendar.events (eventos) e drive.file (apenas arquivos criados pelo app).
 * - Tokens criptografados com AES-256-GCM e guardados em tabela acessível só pelo service role.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
];

export const googleRedirectUri = () => `${env.siteUrl}/api/integracoes/google/callback`;

export function googleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: serverEnv().googleClientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const { googleClientId, googleClientSecret } = serverEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId,
      client_secret: googleClientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Falha ao trocar código OAuth (${res.status})`);
  return res.json();
}

export async function saveTokens(userId: string, t: TokenResponse) {
  const admin = createAdminClient();
  let email: string | null = null;
  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${t.access_token}` },
  });
  if (info.ok) email = ((await info.json()) as { email?: string }).email ?? null;

  const row: Record<string, unknown> = {
    user_id: userId,
    google_email: email,
    access_token_enc: encrypt(t.access_token),
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    scopes: t.scope,
  };
  if (t.refresh_token) row.refresh_token_enc = encrypt(t.refresh_token);
  const { error } = await admin.from("integracoes_google").upsert(row, { onConflict: "user_id" });
  if (error) throw new Error("Falha ao salvar integração");
}

export async function disconnectGoogle(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("integracoes_google").select("refresh_token_enc, access_token_enc").eq("user_id", userId).maybeSingle();
  const token = data?.refresh_token_enc ?? data?.access_token_enc;
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(token))}`, { method: "POST" });
    } catch {
      /* revogação best-effort */
    }
  }
  await admin.from("integracoes_google").delete().eq("user_id", userId);
}

/** Retorna um access token válido (renova com o refresh token se preciso) ou null se não conectado. */
export async function getAccessToken(userId: string): Promise<string | null> {
  if (!googleConfigured()) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("integracoes_google").select("*").eq("user_id", userId).maybeSingle();
  if (!data?.access_token_enc) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() > Date.now()) return decrypt(data.access_token_enc);
  if (!data.refresh_token_enc) return null;

  const { googleClientId, googleClientSecret } = serverEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: decrypt(data.refresh_token_enc),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const t = (await res.json()) as TokenResponse;
  await admin
    .from("integracoes_google")
    .update({ access_token_enc: encrypt(t.access_token), expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString() })
    .eq("user_id", userId);
  return t.access_token;
}

async function getCalendarId(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("integracoes_google").select("calendar_id").eq("user_id", userId).maybeSingle();
  return data?.calendar_id || "primary";
}

// ---------------------------------------------------------------- Agenda

export interface CalendarEventInput {
  titulo: string;
  descricao?: string | null;
  local?: string | null;
  inicio: string; // ISO
  fim: string; // ISO
  dia_inteiro?: boolean;
  lembrete_minutos?: number | null;
  /** Vários lembretes (minutos antes do início); tem precedência sobre lembrete_minutos. */
  lembretes?: number[];
  /** colorId do Google Agenda (ex.: "11" = vermelho). */
  cor?: string;
}

function toGoogleEvent(e: CalendarEventInput) {
  const base = {
    summary: e.titulo,
    description: [e.descricao, "— Agendado pelo GE EASY"].filter(Boolean).join("\n\n"),
    location: e.local ?? undefined,
    // marca de origem: só eventos criados pelo GE EASY podem ser apagados pelo sistema
    extendedProperties: { private: { geeasy: "1" } },
    reminders: e.lembretes?.length
      ? { useDefault: false, overrides: e.lembretes.slice(0, 5).map((minutes) => ({ method: "popup", minutes })) }
      : e.lembrete_minutos
        ? { useDefault: false, overrides: [{ method: "popup", minutes: e.lembrete_minutos }] }
        : { useDefault: true },
    ...(e.cor ? { colorId: e.cor } : {}),
  };
  if (e.dia_inteiro) {
    const start = e.inicio.slice(0, 10);
    const endDate = new Date(e.fim.slice(0, 10) + "T00:00:00Z");
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    return { ...base, start: { date: start }, end: { date: endDate.toISOString().slice(0, 10) } };
  }
  return {
    ...base,
    start: { dateTime: e.inicio, timeZone: "America/Sao_Paulo" },
    end: { dateTime: e.fim, timeZone: "America/Sao_Paulo" },
  };
}

/** Cria ou atualiza o evento no Google Agenda. Retorna o id do evento ou null. */
export async function upsertCalendarEvent(userId: string, e: CalendarEventInput, googleEventId?: string | null) {
  const token = await getAccessToken(userId);
  if (!token) return null;
  const cal = encodeURIComponent(await getCalendarId(userId));
  if (googleEventId) {
    const check = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${encodeURIComponent(googleEventId)}?fields=extendedProperties`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ev = check.ok ? ((await check.json()) as { extendedProperties?: { private?: Record<string, string> } }) : null;
    if (ev?.extendedProperties?.private?.geeasy !== "1") googleEventId = null; // não altera eventos alheios: cria um novo
  }
  const url = googleEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${encodeURIComponent(googleEventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${cal}/events`;
  const res = await fetch(url, {
    method: googleEventId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(toGoogleEvent(e)),
  });
  if (!res.ok) {
    console.error("[google.calendar]", res.status, await res.text());
    return null;
  }
  return ((await res.json()) as { id: string }).id;
}

export async function deleteCalendarEvent(userId: string, googleEventId: string) {
  const token = await getAccessToken(userId);
  if (!token) return;
  const cal = encodeURIComponent(await getCalendarId(userId));
  const url = `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${encodeURIComponent(googleEventId)}`;
  // Segurança: o id vem do banco; só apaga se o evento foi criado pelo GE EASY (marca privada)
  const check = await fetch(`${url}?fields=extendedProperties`, { headers: { Authorization: `Bearer ${token}` } });
  if (!check.ok) return;
  const ev = (await check.json()) as { extendedProperties?: { private?: Record<string, string> } };
  if (ev.extendedProperties?.private?.geeasy !== "1") return;
  await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}

export interface GoogleEventItem {
  id: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

/** Lista eventos do Google Agenda no intervalo (para exibir junto da agenda interna). */
export async function listCalendarEvents(userId: string, timeMin: string, timeMax: string): Promise<GoogleEventItem[]> {
  const token = await getAccessToken(userId);
  if (!token) return [];
  const cal = encodeURIComponent(await getCalendarId(userId));
  const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return (((await res.json()) as { items?: GoogleEventItem[] }).items ?? []).filter((i) => i.start);
}

// ---------------------------------------------------------------- Drive

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

export class DriveError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function driveFetch(token: string, url: string, init?: RequestInit) {
  return fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(45_000), headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
}

/** Escapa valores usados na linguagem de consulta do Drive ('...'). */
export const driveQ = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Nome de arquivo/pasta seguro para o Drive. */
export const driveName = (v: string, max = 150) => v.replace(/[\u0000-\u001f/\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "Sem nome";

/** Procura a pasta pelo nome dentro do pai (somente as criadas pelo app, pelo escopo drive.file) ou cria. */
export async function findOrCreateFolder(token: string, name: string, parentId?: string | null): Promise<string> {
  const nome = driveName(name);
  const q = [`name = '${driveQ(nome)}'`, `mimeType = '${FOLDER_MIME}'`, "trashed = false", parentId ? `'${driveQ(parentId)}' in parents` : null].filter(Boolean).join(" and ");
  const found = await driveFetch(token, `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
  if (found.ok) {
    const files = ((await found.json()) as { files: { id: string }[] }).files;
    if (files[0]) return files[0].id;
  } else if (found.status === 401 || found.status === 403) {
    throw new DriveError("Acesso ao Google Drive negado. Reconecte a conta Google do escritório.", found.status);
  }
  const res = await driveFetch(token, `${DRIVE_API}?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nome, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  if (!res.ok) throw new DriveError(`Falha ao criar a pasta "${nome}" no Drive.`, res.status);
  return ((await res.json()) as { id: string }).id;
}

/** Confere se a pasta ainda existe e não está na lixeira. */
export async function folderExists(token: string, id: string) {
  const res = await driveFetch(token, `${DRIVE_API}/${encodeURIComponent(id)}?fields=id,trashed`);
  if (!res.ok) return false;
  return !((await res.json()) as { trashed?: boolean }).trashed;
}

/**
 * Envia um arquivo para a pasta. Com `converterParaDocs`, o HTML enviado vira um Google Docs editável.
 * Lança DriveError (status 404 = pasta de destino não existe mais).
 */
export async function uploadDriveFile(
  token: string,
  parentId: string,
  file: { name: string; type: string; data: ArrayBuffer | Uint8Array; description?: string },
  opts: { converterParaDocs?: boolean } = {},
) {
  const boundary = "geeasy" + crypto.randomUUID().replace(/-/g, "");
  const meta = JSON.stringify({
    name: driveName(file.name, 200),
    parents: [parentId],
    description: file.description?.slice(0, 1000),
    ...(opts.converterParaDocs ? { mimeType: GOOGLE_DOC_MIME } : {}),
  });
  const bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
    bytes as BlobPart,
    `\r\n--${boundary}--`,
  ]);
  const res = await driveFetch(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[google.drive]", res.status, txt.slice(0, 300));
    throw new DriveError(res.status === 404 ? "Pasta de destino não encontrada no Drive." : `Falha no envio ao Drive (${res.status}).`, res.status);
  }
  return (await res.json()) as { id: string; webViewLink: string };
}

export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
