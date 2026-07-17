---
name: verify
description: Receita de verificação runtime do WR Trading Pro — subir o servidor Next buildado em ambiente isolado (banco temporário + credenciais de teste) e dirigir as rotas /api/v1 autenticadas.
---

# Verificação runtime — WR Trading Pro

Como exercitar mudanças de backend (rotas `/api/v1/*`, runtime AgentRun, proxy LLM)
de ponta a ponta sem tocar o `.env`, o `prisma/dev.db` nem o app do usuário.

## Receita que funciona

1. **Build:** `npm run build` (o `next start` serve o `.next` existente).
2. **Banco isolado:** SQLite temporário fora do repo, migrado com a URL em
   formato Windows — o formato importa, `file:C:/...`:
   ```bash
   DATABASE_URL="file:C:/caminho/temp/verify.db" node node_modules/prisma/build/index.js migrate deploy
   ```
   ⚠️ Não usar path estilo Git Bash (`file:/c/...`): o Prisma cria um banco em
   outro lugar e o servidor abre um banco vazio (`P2021 table does not exist`).
3. **Credenciais de teste:** hash scrypt com os mesmos parâmetros de
   `src/lib/auth/password.ts` (`N=16384,r=8,p=1,keyLength=64,salt=16`), formato
   `scrypt$N$r$p$saltHex$hashHex`.
4. **Env SOMENTE via `.env.local` temporário** (remover ao final!):
   - ⚠️ Variáveis exportadas no processo NÃO funcionam para valores com `$`:
     o dotenv-expand do `@next/env` expande `$...` até em env pré-existente do
     processo e corrompe o hash (`scrypt$16384$...` → `scrypt6384`), mesmo com
     escape. Em `.env.local`, o escape `\$` é honrado — usar `\$` em cada `$`.
   - `.env.local` tem precedência sobre `.env`; chaves de provedor podem ser
     desativadas com valor vazio (`OPENAI_API_KEY=`).
   - Verificar antes que `.env.local` não existe; **apagar ao terminar**.
5. **Servidor:** `npx next start -H 127.0.0.1 -p 3210` (porta livre ≠ 3001).
   Aguardar `GET /login` → 200.
6. **Sessão:** `POST /api/auth/login` com `{"username","password"}` e `curl -c cookies.txt`;
   depois `-b cookies.txt` em toda chamada (`/api/v1/*` é fail-closed → 401 sem cookie).

## Truques úteis

- **Provedor LLM pendurado:** `node -e "require('http').createServer(()=>{}).listen(3999,'127.0.0.1')"`
  e `OLLAMA_ENDPOINT=http://127.0.0.1:3999` no `.env.local` (allowlist aceita loopback).
  Com as demais chaves vazias, todo nó AGENT/SYNTHESIS bate no servidor mudo.
- **Semear estado de run:** criar via API e mutar direto com o client Prisma do
  repo (cwd no repo, `DATABASE_URL` do banco temporário):
  `node -e "...prisma.agentRun.update({data:{status:'RUNNING',updatedAt:new Date(...)}})"`.
- Logs do servidor mostram o erro real por trás de `INTERNAL_ERROR` (sanitizado na resposta).

## Fluxos que valem dirigir

- `POST /api/v1/agent-runs` → `POST .../advance` (síncrono; medir tempo) → `GET .../{id}`.
- `POST /api/v1/agent-runs/reap` (reaper de órfãos; idempotente).
- Probes: sem cookie → 401; método errado → 405; body inválido → 400.

## Limpeza obrigatória

Matar os servidores (`netstat -ano | grep :PORTA` → `taskkill //PID x //F`) e
**remover `.env.local`** — esquecê-lo muda o comportamento do app do usuário.
