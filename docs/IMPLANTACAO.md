# Implantação — GE EASY

## 1. Supabase (projeto `GE EASY` — `oiwmydggyloqezfsajxp`)
As migrações de `supabase/migrations/` já foram aplicadas. Em um projeto novo:
`supabase db push` (CLI) ou cole os arquivos no SQL Editor na ordem.

No painel:
1. **Authentication › URL Configuration**: *Site URL* = `https://SEU-DOMINIO`; *Redirect URLs*:
   `https://SEU-DOMINIO/auth/callback` e `https://SEU-DOMINIO/auth/confirm` (e `http://localhost:3000/**` para dev).
2. Crie o primeiro usuário (tela de login não tem cadastro público: use *Authentication › Users › Add user*,
   marcando "Auto confirm"). **O primeiro usuário vira administrador automaticamente.**
3. Depois disso, desative *Allow new users to sign up* (os demais entram por convite).
4. *Project Settings › API*: copie a URL, a chave publicável e a **service_role** (só para o servidor).

## 2. Google Cloud (Agenda + Drive) — opcional
1. Crie um projeto em console.cloud.google.com e ative **Google Calendar API** e **Google Drive API**.
2. *Tela de consentimento OAuth*: tipo Interno (Workspace) ou Externo; escopos `calendar.events` e `drive.file`.
3. *Credenciais › Criar ID do cliente OAuth › Aplicativo da Web* com URI de redirecionamento
   `https://SEU-DOMINIO/api/integracoes/google/callback`.
4. Copie *Client ID* e *Client secret* para as variáveis de ambiente.
Cada usuário conecta a própria conta em *Configurações › Integrações*.

## 3. Vercel
1. Importe o repositório `joaomarcoss1/GE-EASY`.
2. Variáveis de ambiente (Production e Preview):

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://oiwmydggyloqezfsajxp.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publicável (`sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role (**secreta**) |
| `NEXT_PUBLIC_SITE_URL` | `https://SEU-DOMINIO` |
| `APP_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | do passo 2 |

3. Deploy. Região sugerida: `gru1` (São Paulo).

## 4. Pós-implantação
- Cadastre administradoras, seguradoras e produtos (com % de comissão) em *Configurações › Cadastros*.
- Defina % de comissão de cada consultor em *Configurações › Usuários*.
- Cadastre as metas do mês em *Metas & ranking*.
