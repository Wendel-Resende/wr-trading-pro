# Autenticação Local — Setup (Fase 0, Item 9)

O WR Trading Pro usa autenticação local de usuário único com cookie de sessão
HttpOnly assinado (HMAC-SHA256) e um middleware Next.js que protege o dashboard
e todas as rotas `/api` (exceto `/login` e `/api/auth/*`).

**Importante:** estas credenciais são exclusivas do app local. **Nunca** use
login/senha do MetaTrader 5 nem de corretoras.

## 1. Gerar hash de senha e secret de sessão

```bash
node scripts/auth/generate-password-hash.mjs
```

O script pede a senha (input oculto, mínimo 8 caracteres) e imprime dois
valores prontos para copiar. Nada é gravado em disco.

## 2. Configurar o `.env`

Copie `.env.example` para `.env` (se ainda não existir) e preencha:

```dotenv
WR_AUTH_USERNAME="seu_usuario_local"
WR_AUTH_PASSWORD_HASH="scrypt$16384$8$1$<salt>$<hash>"   # saída do script
WR_AUTH_SESSION_SECRET="<64 caracteres hex>"              # saída do script
```

Opcionais:

| Variável | Padrão | Descrição |
|---|---|---|
| `WR_AUTH_SESSION_TTL_HOURS` | `12` | Duração da sessão em horas (máx. 720) |
| `WR_AUTH_COOKIE_SECURE` | `false` | `true` somente se servir via HTTPS; o app local roda em `http://127.0.0.1` |

Reinicie o servidor (`npm run dev` ou o executável Electron) após alterar o `.env`.

## 3. Comportamento

- **Fail-closed:** sem as 3 variáveis obrigatórias válidas, o login retorna
  503 e nenhuma sessão é aceita — todas as páginas redirecionam para `/login`
  e as rotas `/api` respondem 401 JSON.
- Cookie `wr_session`: HttpOnly, `SameSite=Strict`, `Path=/`, expira junto com
  o token assinado. O secret nunca chega ao browser.
- Comparações de usuário/senha em tempo constante (`timingSafeEqual`); senha
  armazenada apenas como hash scrypt (N=16384, r=8, p=1).
- Endpoints: `POST /api/auth/login`, `GET /api/auth/session`,
  `POST /api/auth/logout`.

## 4. Verificação

```bash
npm run smoke:auth   # token criar/verificar/adulterar/expirar + classificação de rotas
```

Cobre assinatura, adulteração de payload/assinatura, expiração, verificação
scrypt e a classificação pública/protegida de todos os grupos de rotas API.

## Solução de problemas

- **"Autenticação não configurada no servidor"** — faltam variáveis
  `WR_AUTH_*` no `.env` ou o secret tem menos de 32 caracteres.
- **Redireciona sempre para /login após login OK** — secret alterado após o
  cookie ser emitido, ou sessão expirada; faça login novamente.
- **Esqueci a senha** — gere um novo hash com o script do passo 1 e substitua
  `WR_AUTH_PASSWORD_HASH` no `.env`.
