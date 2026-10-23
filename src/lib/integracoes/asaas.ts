import "server-only";
import { serverEnv } from "@/lib/env";

/** Cobrança da assinatura das empresas pela Asaas (boleto, PIX ou cartão, à escolha do cliente). */
export const asaasConfigurado = () => Boolean(serverEnv().asaasApiKey && serverEnv().asaasWebhookToken);

async function asaas<T>(path: string, init?: RequestInit): Promise<T> {
  const { asaasApiKey, asaasApiUrl } = serverEnv();
  const r = await fetch(`${asaasApiUrl}${path}`, {
    ...init,
    headers: { access_token: asaasApiKey, "Content-Type": "application/json", "User-Agent": "GE-EASY", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as T & { errors?: { description?: string }[] };
  if (!r.ok) throw new Error(`Asaas ${r.status}: ${j.errors?.[0]?.description ?? r.statusText}`.slice(0, 300));
  return j;
}

export async function criarClienteAsaas(nome: string, cpfCnpj: string, email: string | null, empresaId: string) {
  const c = await asaas<{ id: string }>("/customers", { method: "POST", body: JSON.stringify({ name: nome, cpfCnpj, email, externalReference: empresaId, notificationDisabled: false }) });
  return c.id;
}

export async function criarAssinaturaAsaas(customer: string, valor: number, vencimento: string, descricao: string, empresaId: string) {
  const s = await asaas<{ id: string }>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({ customer, billingType: "UNDEFINED", value: valor, nextDueDate: vencimento, cycle: "MONTHLY", description: descricao, externalReference: empresaId }),
  });
  const pagamentos = await asaas<{ data?: { invoiceUrl?: string }[] }>(`/subscriptions/${encodeURIComponent(s.id)}/payments?limit=1`);
  return { id: s.id, linkPagamento: pagamentos.data?.[0]?.invoiceUrl ?? null };
}

export async function linkPagamentoPendente(subscription: string) {
  const p = await asaas<{ data?: { invoiceUrl?: string; status?: string }[] }>(`/subscriptions/${encodeURIComponent(subscription)}/payments?status=PENDING&limit=1`);
  const v = await asaas<{ data?: { invoiceUrl?: string }[] }>(`/subscriptions/${encodeURIComponent(subscription)}/payments?status=OVERDUE&limit=1`);
  return v.data?.[0]?.invoiceUrl ?? p.data?.[0]?.invoiceUrl ?? null;
}

export async function trocarPlanoAsaas(subscription: string, valor: number, descricao: string) {
  await asaas(`/subscriptions/${encodeURIComponent(subscription)}`, { method: "PUT", body: JSON.stringify({ value: valor, description: descricao, updatePendingPayments: true }) });
}
