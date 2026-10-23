import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("webhook da Meta", () => {
  beforeAll(() => {
    process.env.WHATSAPP_APP_SECRET = "segredo-de-teste-do-app";
  });

  it("aceita só a assinatura HMAC correta do corpo bruto", async () => {
    const { assinaturaValida } = await import("../integracoes/whatsapp");
    const corpo = '{"object":"whatsapp_business_account"}';
    const ok = "sha256=" + createHmac("sha256", "segredo-de-teste-do-app").update(corpo).digest("hex");
    expect(assinaturaValida(corpo, ok)).toBe(true);
    expect(assinaturaValida(corpo + " ", ok)).toBe(false);
    expect(assinaturaValida(corpo, "sha256=" + "0".repeat(64))).toBe(false);
    expect(assinaturaValida(corpo, null)).toBe(false);
  });

  it("desmonta mensagens, status e leads em eventos idempotentes", async () => {
    const { eventosDoWebhook } = await import("../integracoes/whatsapp");
    const ev = eventosDoWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "100200300" },
                contacts: [{ wa_id: "5585999990000", profile: { name: "Contato Teste" } }],
                messages: [{ id: "wamid.A", from: "5585999990000", type: "text", text: { body: "oi" } }],
                statuses: [{ id: "wamid.B", status: "delivered" }],
              },
            },
          ],
        },
        { id: "777", changes: [{ field: "leadgen", value: { leadgen_id: "L1", page_id: "777" } }] },
      ],
    });
    expect(ev.map((e) => e.externo_id)).toEqual(["msg:wamid.A", "st:wamid.B:delivered", "lead:L1"]);
    expect(ev[0].payload).toMatchObject({ tipo: "mensagem", phone_number_id: "100200300", nome: "Contato Teste" });
    expect(ev[2].origem).toBe("meta_leads");
    expect(eventosDoWebhook({})).toEqual([]);
  });
});
