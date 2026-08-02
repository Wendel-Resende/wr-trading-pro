# Autenticação do WebSocket MT5 — Setup (Fase 0, Item 10)

> OBSOLETO (2026-08-02): a ponte WebSocket (ws://localhost:8766) e o ws-token
> foram REMOVIDOS no Ponto 4 da migração MCP nativo. Este documento é mantido
> apenas como registro histórico.

O WebSocket do MT5 Bridge (`ws://localhost:8766`) exige um **token efêmero de
uso único** antes de qualquer outra mensagem. O token é derivado da sessão
HttpOnly (`wr_session`) e assinado com um secret separado (`WR_WS_TOKEN_SECRET`).
Sem AUTH válido, o cliente não entra em `bridge.clients` — não recebe
broadcasts e nenhum comando é processado.

## Fluxo

1. O browser (com sessão válida) faz `POST /api/auth/ws-token`. O handler
   valida diretamente o cookie `wr_session` (configuração completa
   `getAuthConfig()`, HMAC da sessão, `sub === username`) e emite o token.
   Nada é aceito do body; sem sessão → 401; sem secret → 503. Resposta
   `Cache-Control: no-store`.
2. O browser abre o WebSocket e envia como **primeira mensagem**:
   `{"type":"AUTH","data":{"token":"wst1...."}}` (nunca em query string,
   header, localStorage ou logs).
3. O bridge valida assinatura (HMAC-SHA256, `hmac.compare_digest`), formato,
   `aud`, `iat`/`exp`/TTL com pequeno clock skew, e **consome o `jti`** em uma
   replay cache em memória — o segundo uso do mesmo token é rejeitado.
4. O bridge responde `{"type":"AUTH_OK", ...}`; só então o cliente envia
   `LOGIN` e passa a receber dados. Qualquer falha fecha a conexão com
   código 1008 e razão genérica.
5. Reconexões sempre buscam um token novo (o anterior já foi consumido
   e/ou expirou).

## Formato do token

```
wst1.<payload base64url>.<HMAC-SHA256 base64url>
payload: { "sub", "aud": "mt5-ws", "iat", "exp", "jti" }
```

- TTL padrão 30s, teto 60s (`WR_WS_TOKEN_TTL_SECONDS`).
- `jti`: 16 bytes aleatórios criptográficos — uso único.
- Implementações espelhadas: `src/lib/auth/ws-token.ts` (emissão/verificação)
  e `python/ws_token.py` (verificação no bridge). Mudanças de formato devem
  ser feitas nos dois.

## Configuração do secret

`WR_WS_TOKEN_SECRET` (mínimo 32 caracteres, server-side only, nunca
`NEXT_PUBLIC_`). **Fail-closed:** sem secret o endpoint responde 503 e o
bridge rejeita todas as conexões.

### Executável Electron

Nada a configurar: `electron/main.ts` gera um secret criptográfico **efêmero
por processo** quando `WR_WS_TOKEN_SECRET` não vem do ambiente, e injeta o
mesmo valor via env no servidor Next e no `mt5_bridge.py`. O valor não é
persistido nem logado.

### Dev externo (4 terminais)

O Next (`npm run dev`) e o `mt5_bridge.py` precisam ver o **mesmo** valor:

```powershell
# Gerar uma vez:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Coloque no .env (o Next lê automaticamente):
#   WR_WS_TOKEN_SECRET="<valor gerado>"

# Terminal do bridge (PowerShell):
$env:WR_WS_TOKEN_SECRET = "<mesmo valor>"
python python/mt5_bridge.py
```

## Verificação

```bash
npm run smoke:ws-token     # TS: criar/verificar/adulterar/expirar/audience/TTL
npm run test:ws-token:py   # Python: idem + replay (jti de uso único) + fixture cross-language
```

O teste Python inclui um token fixture gerado pela implementação TypeScript,
garantindo a interoperabilidade dos dois lados.

## Solução de problemas

- **Bridge loga "WR_WS_TOKEN_SECRET não configurado"** — exporte o secret no
  terminal do bridge (dev externo) ou rode via Electron.
- **Browser: "Autenticação do MT5 Bridge não configurada no servidor" (503)**
  — falta `WR_WS_TOKEN_SECRET` no `.env` do Next (mínimo 32 caracteres).
- **Conexão fecha logo após abrir (1008)** — secrets diferentes entre Next e
  bridge, relógio muito defasado, ou token expirado/reutilizado; o cliente
  busca token novo automaticamente na reconexão.
- **"Sessão expirada" ao conectar** — o cookie `wr_session` expirou; faça
  login novamente (ver docs/AUTH_SETUP.md).
