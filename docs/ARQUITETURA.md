# Arquitetura — GE EASY

```
Navegador (React 19)
  │  Server Components (leitura) · Server Actions (escrita, zod) · Route Handlers (CSV, .ics, OAuth)
  ▼
Next.js 15 (Vercel)  ──── middleware: sessão, AAL2, redirecionamentos
  │  @supabase/ssr com o JWT do usuário  →  RLS aplica as regras de acesso
  │  service role (somente servidor)      →  criação de usuários, tokens Google
  ▼
Supabase: Postgres (RLS, triggers, pg_cron) · Auth (2FA) · Storage (bucket privado)
  ▲
Google APIs: Calendar (calendar.events) · Drive (drive.file) · OAuth 2.0
```

## Banco de dados (principais tabelas)
| Tabela | Descrição |
|---|---|
| `profiles` | Usuários (papel, ativo, território, % comissão) — 1:1 com `auth.users` |
| `parceiros`, `produtos` | Administradoras, seguradoras e produtos com % de comissão |
| `clientes`, `interacoes` | CRM e linha do tempo |
| `oportunidades` | Funil (etapas `novo` → `ganho/perdido`) |
| `consorcio_cotas`, `consorcio_lances` | Consórcios, lances e contemplação |
| `seguro_apolices`, `seguro_sinistros` | Seguros, renovações (`renovacao_de`) e sinistros |
| `comissoes` | Gerada por trigger (cota ativa / apólice vigente); estorno automático no cancelamento |
| `metas` | Metas mensais por consultor ou equipe |
| `agenda_eventos`, `tarefas`, `visitas` | Agenda (com `google_event_id`), tarefas e check-ins geolocalizados |
| `documentos` | Metadados dos arquivos (Storage e Drive) |
| `notificacoes` | Alertas (renovações, tarefas atrasadas) gerados pelo `pg_cron` diário |
| `integracoes_google` | Tokens OAuth cifrados (somente service role) |
| `configuracoes`, `audit_logs` | Parâmetros da empresa e trilha de auditoria |

## Automação no banco
- `gerar_comissao_cota` / `gerar_comissao_apolice`: calculam comissão da corretora e do consultor.
- `lance_contempla_cota`: lance contemplado → cota contemplada.
- `registrar_interacao_sistema`: eventos de negócio aparecem na linha do tempo do cliente.
- `gerar_alertas` (pg_cron, 08:00 de Brasília): renovações em 30 dias, apólices vencidas, tarefas atrasadas.
