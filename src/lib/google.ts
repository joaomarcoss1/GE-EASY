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
}

function toGoogleEvent(e: CalendarEventInput) {
  const base = {
    summary: e.titulo,
    description: [e.descricao, "— Agendado pelo GE EASY"].filter(Boolean).join("\n\n"),
    location: e.local ?? undefined,
    // marca de origem: só eventos criados pelo GE EASY podem ser apagados pelo sistema
    extendedProperties: { private: { geeasy: "1" } },
    reminders: e.lembrete_minutos
      ? { useDefault: false, overrides: [{ method: "popup", minutes: e.lembrete_minutos }] }
      : { useDefault: true },
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

async function driveFetch(token: string, url: string, init?: RequestInit) {
  return fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
}

async function ensureFolder(token: string, name: string, parentId?: string) {
  const safe = name.replace(/'/g, "\\'");
  const q = [`name = '${safe}'`, "mimeType = 'application/vnd.google-apps.folder'", "trashed = false", parentId ? `'${parentId}' in parents` : null]
    .filter(Boolean)
    .join(" and ");
  const found = await driveFetch(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);
  if (found.ok) {
    const files = ((await found.json()) as { files: { id: string }[] }).files;
    if (files[0]) return files[0].id;
  }
  const res = await driveFetch(token, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }),
  });
  if (!res.ok) throw new Error("Falha ao criar pasta no Drive");
  return ((await res.json()) as { id: string }).id;
}

/**
 * Envia um arquivo para o Google Drive do usuário em "GE EASY/<pasta>".
 * Retorna { id, webViewLink } ou null se o Google não estiver conectado.
 */
export async function uploadToDrive(userId: string, folderName: string, file: { name: string; type: string; data: ArrayBuffer }) {
  const token = await getAccessToken(userId);
  if (!token) return null;
  const root = await ensureFolder(token, "GE EASY");
  const folder = await ensureFolder(token, folderName.slice(0, 120), root);

  const boundary = "geeasy" + Math.random().toString(16).slice(2);
  const meta = JSON.stringify({ name: file.name, parents: [folder] });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
    new Uint8Array(file.data),
    `\r\n--${boundary}--`,
  ]);
  const res = await driveFetch(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) {
    console.error("[google.drive]", res.status, await res.text());
    return null;
  }
  return (await res.json()) as { id: string; webViewLink: string };
}
