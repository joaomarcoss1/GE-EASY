# ADR-0005 — WhatsApp pela Cloud API oficial, com fila de webhooks

**Decisão:** usar a WhatsApp Business Platform (Cloud API da Meta) por número de cada empresa, nunca APIs
não oficiais. O webhook só valida a assinatura (`X-Hub-Signature-256`), grava o evento em `webhook_eventos`
(chave única origem + id externo) e responde 200; o processamento roda em seguida (`after()`) e pelo cron a
cada minuto, com nova tentativa e espera exponencial. A mesma fila atende Lead Ads e a cobrança (Asaas).

**Por quê:** a Meta reenvia eventos e exige resposta rápida; a fila torna tudo idempotente e auditável.
**Alternativas descartadas:** APIs não oficiais (risco de banimento e vazamento); processar no próprio webhook.
