# ADR-0006 — App de campo como PWA offline (não nativo)

**Decisão:** o app do consultor é uma PWA servida pelo próprio sistema (`/campo`), com fila local
criptografada (IndexedDB + AES-GCM) e sincronização idempotente por item.

**Por quê:** uma base de código, sessão por cookie (sem tokens no navegador), atualização imediata.
**Custo aceito:** sem detecção de GPS simulado e sem rastreio em segundo plano (não exigido; LGPD).
Se esses dois pontos virarem requisito, empacotar a mesma PWA com Capacitor.
