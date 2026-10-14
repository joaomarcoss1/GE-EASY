# Segurança — GE EASY

## Camadas
1. **Rede/HTTP** — `next.config.ts` define CSP (somente o próprio domínio, Supabase e Google), HSTS (2 anos),
   `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`
   (apenas geolocalização no próprio site) e remove o cabeçalho `X-Powered-By`.
2. **Autenticação** — Supabase Auth (cookies httpOnly via `@supabase/ssr`). O middleware valida o JWT com
   `getUser()` em toda requisição, renova a sessão e exige **AAL2** quando o usuário tem 2FA. Login com limite de
   tentativas (5 por IP+e-mail a cada 15 min, além do rate limit do Supabase) e mensagens que não revelam se o e-mail existe.
   Senhas novas: mínimo 10 caracteres com maiúscula, minúscula e número.
3. **Autorização na aplicação** — `requirePermission()` em páginas e `guard()` em Server Actions (`src/lib/rbac.ts`).
4. **Autorização no banco (fonte da verdade)** — RLS em 100% das tabelas do schema `public`:
   - `is_active_user()`, `is_manager()`, `is_backoffice()`, `is_admin()`, `has_role()`, `can_access_cliente()`
     (`SECURITY DEFINER`, `search_path = ''`).
   - Consultores (internos e externos) só leem/alteram registros com `consultor_id` ou `created_by` iguais ao seu id.
   - `enforce_own_consultor` força o consultor como dono do que cria e impede transferência de carteira.
   - `protect_profile_privileges` impede que não-admins alterem papel, status, e-mail ou comissão — e que o admin
     remova o próprio acesso.
   - Usuários novos entram **inativos** (exceto o primeiro, que vira admin) e não acessam nada até aprovação.
   - `anon` não tem privilégio algum no schema `public`.
5. **Storage** — bucket `documentos` privado, limite 25 MB, tipos MIME permitidos, caminho `clientes/<id>/…`
   validado por `storage_can_access()`. Downloads somente por URL assinada de 60 s.
6. **Segredos** — `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY` e `GOOGLE_CLIENT_SECRET` só no servidor
   (`server-only`). Tokens OAuth do Google cifrados com AES-256-GCM em tabela sem políticas (só service role).
   OAuth com `state` aleatório em cookie httpOnly verificado com comparação em tempo constante; desconexão
   via POST com verificação de origem (CSRF).
7. **Auditoria** — trigger `audit_trigger` grava INSERT/UPDATE/DELETE (antes/depois, autor) nas tabelas de negócio;
   visível apenas para administradores.
8. **Entradas e saídas** — zod em todas as Server Actions; CPF/CNPJ validados; termos de busca sanitizados;
   CSV com neutralização de fórmulas; redirecionamentos `next` aceitam só caminhos relativos.

## Avisos do Supabase Advisor
- *Signed-in users can execute SECURITY DEFINER function*: esperado para as funções auxiliares de RLS
  (`is_manager`, `can_access_cliente` etc.). Elas apenas respondem sobre o **próprio** usuário e são necessárias
  para as políticas.
- *RLS enabled no policy* em `integracoes_google`: intencional — somente o service role acessa os tokens.

## Checklist de produção
- [ ] Em *Authentication › Providers › Email*, **desativar "Allow new users to sign up"** após criar o primeiro admin
      (novos usuários entram por convite).
- [ ] Ativar *Leaked password protection* e definir tamanho mínimo de senha 10 no painel do Supabase.
- [ ] Configurar *Site URL* e *Redirect URLs* (`https://SEU-DOMINIO/auth/callback`, `/auth/confirm`).
- [ ] Definir `APP_ENCRYPTION_KEY` (32 bytes base64) e `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor (Vercel).
- [ ] Incentivar/obrigar 2FA para administradores e gestores.
- [ ] Revisar periodicamente *Configurações › Auditoria*.
