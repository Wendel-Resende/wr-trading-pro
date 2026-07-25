# Unificação do regex de ticker B3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o padrão de ticker B3 `^[A-Z]{4}\d{1,2}$` duplicado em 9 pontos por uma fonte única (Node) + cópia sincronizada (Python), usando o padrão canônico `[A-Z][A-Z0-9]{3}\d{1,2}` que aceita `B3SA3`.

**Architecture:** Um módulo compartilhado `src/lib/b3-ticker.ts` exporta o padrão canônico e helpers; os 8 sites Node importam dele; o `_TICKER_RE` do `python/ml_api.py` recebe o mesmo padrão com comentário cruzado. Cada site preserva sua semântica (validação exata, extração de texto livre, canonicalização, guarda de filesystem).

**Tech Stack:** TypeScript (Zod), Node/tsx test harness (`assertLog` + runner `.cjs`), Python 3 (`re`), pytest-style `__main__`.

## Global Constraints

- Padrão canônico exato: `[A-Z][A-Z0-9]{3}\d{1,2}` (raiz 1 letra + 3 alfanuméricos maiúsculos + 1-2 dígitos). Em string JS: `'[A-Z][A-Z0-9]{3}\\d{1,2}'`.
- O padrão nunca contém `/`, `.`, `..` ou separadores — path-safe para a guarda Python.
- Não tocar nos `SYMBOL_PATTERN` gerais (`src/contracts/v1`, `python/contracts/v1`, `reference-data/schemas.ts`) nem em `spread-orders`/`agents/route.ts`.
- Nenhuma mudança de UI, contrato HTTP público ou schema Prisma.
- Testes Node rodam via `npm run test:<suite>`; `tsc --noEmit` deve ficar limpo. `test_ml_api.py` roda direto (`python python/tests/test_ml_api.py`) — o plugin pytest quebra em import não relacionado de `web3` (pré-existente).
- Comentários/código em português seguindo o estilo do arquivo vizinho.

---

## File Structure

- `src/lib/b3-ticker.ts` — **novo**. Fonte única: padrão + `B3_TICKER_EXACT`, `b3TickerGlobal()`, `isB3Ticker()`, `canonicalizeB3Ticker()`.
- `scripts/b3-ticker/b3-ticker-test.ts` — **novo**. Suíte de função pura.
- `scripts/b3-ticker/run-b3-ticker-tests.cjs` — **novo**. Runner tsx (sem Prisma/Python).
- `package.json` — adiciona `test:b3-ticker`.
- Migração (consomem o módulo): `src/app/api/v1/_shared/sanitize-text.ts`, `src/app/api/v1/ml/predict/_dto.ts`, `src/app/api/v1/ml/training-runs/route.ts`, `src/app/api/v1/ml/train/route.ts`, `src/application/ml-hybrid/service.ts`, `src/application/ml-training-run/train-job-port.ts`, `src/mcp/pilot/tools/agent-actions.ts`, `src/application/agent-run/service.ts`.
- `python/ml_api.py` — `_TICKER_RE`.
- `python/tests/test_ml_api.py` — teste de aceitação + segurança.
- Auditoria: `scripts/ml-unified-reads/ml-unified-reads-test.ts`.

---

## Task 1: Módulo compartilhado `src/lib/b3-ticker.ts` + suíte

**Files:**
- Create: `src/lib/b3-ticker.ts`
- Create: `scripts/b3-ticker/b3-ticker-test.ts`
- Create: `scripts/b3-ticker/run-b3-ticker-tests.cjs`
- Modify: `package.json` (script `test:b3-ticker`)

**Interfaces:**
- Produces:
  - `B3_TICKER_PATTERN: string` (= `'[A-Z][A-Z0-9]{3}\\d{1,2}'`)
  - `B3_TICKER_EXACT: RegExp` (`/^[A-Z][A-Z0-9]{3}\d{1,2}$/`)
  - `b3TickerGlobal(): RegExp` (nova instância `/\b…\b/g` a cada chamada)
  - `isB3Ticker(raw: string): boolean`
  - `canonicalizeB3Ticker(raw: string): string` (uppercase+trim ou `'DESCONHECIDO'`)

- [ ] **Step 1: Escrever o teste (falha)**

Create `scripts/b3-ticker/b3-ticker-test.ts`:

```ts
import assert from 'node:assert/strict';
import {
  B3_TICKER_PATTERN,
  B3_TICKER_EXACT,
  b3TickerGlobal,
  isB3Ticker,
  canonicalizeB3Ticker,
} from '../../src/lib/b3-ticker';

function assertLog(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  console.log(`ok: ${msg}`);
}

function main(): void {
  // padrão exato aceita tickers reais, incluindo raiz com dígito
  for (const t of ['B3SA3', 'PETR4', 'VALE3', 'ENGI11', 'KLBN11', 'SANB11', 'BPAC11']) {
    assertLog(isB3Ticker(t), `${t} é ticker B3 válido`);
  }
  // rejeita número puro (crucial p/ extração de texto livre), lixo e formatos errados
  for (const bad of ['123456', '1234', 'ABC3', 'ABCDE3', 'PETR', 'PETR4X', 'petr4', '../etc', 'A/B', 'PETR-4', '']) {
    assertLog(!isB3Ticker(bad), `${bad || '(vazio)'} NÃO é ticker B3`);
  }
  // canonicalização: uppercase quando casa; DESCONHECIDO senão
  assertLog(canonicalizeB3Ticker(' b3sa3 ') === 'B3SA3', 'canonicaliza b3sa3 → B3SA3 (trim+upper)');
  assertLog(canonicalizeB3Ticker('../../SECRET') === 'DESCONHECIDO', 'path traversal → DESCONHECIDO');
  assertLog(canonicalizeB3Ticker('123456') === 'DESCONHECIDO', 'número puro → DESCONHECIDO');
  // extração de texto livre: pega ticker real, NUNCA número puro
  const hits = 'o comitê analisou WEGE3 e B3SA3, com lucro de 123456 reais'.match(b3TickerGlobal()) ?? [];
  assertLog(hits.includes('WEGE3') && hits.includes('B3SA3'), 'extrai WEGE3 e B3SA3 do texto livre');
  assertLog(!hits.includes('123456'), 'extração NÃO captura número puro');
  // b3TickerGlobal() devolve instância fresca (sem lastIndex compartilhado)
  assertLog(b3TickerGlobal() !== b3TickerGlobal(), 'b3TickerGlobal() retorna nova instância a cada chamada');
  // o padrão exportado é o canônico
  assertLog(B3_TICKER_PATTERN === '[A-Z][A-Z0-9]{3}\\d{1,2}', 'B3_TICKER_PATTERN é o canônico');
  assertLog(B3_TICKER_EXACT.test('B3SA3'), 'B3_TICKER_EXACT casa B3SA3');

  console.log('b3-ticker: TODOS OS TESTES PASSARAM');
}

main();
```

Create `scripts/b3-ticker/run-b3-ticker-tests.cjs`:

```js
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const result = spawnSync(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'scripts/b3-ticker/b3-ticker-test.ts'],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) {
  console.error(result.error);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
```

Add to `package.json` scripts (junto aos demais `test:*`):

```json
    "test:b3-ticker": "node scripts/b3-ticker/run-b3-ticker-tests.cjs",
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test:b3-ticker`
Expected: FALHA — `Cannot find module '../../src/lib/b3-ticker'` (módulo ainda não existe).

- [ ] **Step 3: Implementar o módulo**

Create `src/lib/b3-ticker.ts`:

```ts
/**
 * Fonte única do padrão de ticker B3. Raiz de 1 letra + 3 alfanuméricos
 * maiúsculos + 1-2 dígitos de tipo — aceita `B3SA3` (raiz com dígito, a
 * própria B3 S.A.), rejeita número puro e é path-safe (sem `/`, `.`, `..`,
 * separadores). A cópia Python vive em `python/ml_api.py::_TICKER_RE` e DEVE
 * ser mantida idêntica (testes de aceitação/rejeição em ambos os lados).
 */
export const B3_TICKER_PATTERN = '[A-Z][A-Z0-9]{3}\\d{1,2}';

export const B3_TICKER_EXACT = new RegExp(`^${B3_TICKER_PATTERN}$`);

/** Regex global é stateful (lastIndex) — nova instância a cada chamada. */
export const b3TickerGlobal = (): RegExp => new RegExp(`\\b${B3_TICKER_PATTERN}\\b`, 'g');

export const isB3Ticker = (raw: string): boolean =>
  typeof raw === 'string' && B3_TICKER_EXACT.test(raw);

/** Uppercase+trim; devolve o ticker canônico ou `'DESCONHECIDO'`. */
export const canonicalizeB3Ticker = (raw: string): string => {
  const u = (typeof raw === 'string' ? raw : '').trim().toUpperCase();
  return B3_TICKER_EXACT.test(u) ? u : 'DESCONHECIDO';
};
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npm run test:b3-ticker`
Expected: PASS — termina com `b3-ticker: TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/b3-ticker.ts scripts/b3-ticker/ package.json
git commit -m "feat(ml): módulo compartilhado de ticker B3 (aceita B3SA3)"
```

---

## Task 2: Migrar sites de validação exata (Zod) para o módulo

**Files:**
- Modify: `src/application/ml-training-run/train-job-port.ts` (universe, alinhar ao canônico)
- Modify: `src/app/api/v1/ml/training-runs/route.ts`
- Modify: `src/app/api/v1/ml/train/route.ts`
- Modify: `src/application/ml-hybrid/service.ts`
- Modify: `src/mcp/pilot/tools/agent-actions.ts`
- Test: suítes existentes `test:ml-training-run`, `test:ml-hybrid`, `test:mcp-pilot`

**Interfaces:**
- Consumes: `B3_TICKER_EXACT` de `src/lib/b3-ticker` (Task 1).

- [ ] **Step 1: `train-job-port.ts` — alinhar `universe` ao canônico**

Import no topo do arquivo:
```ts
import { B3_TICKER_EXACT } from '../../lib/b3-ticker';
```
Trocar a linha do `universe` (hoje `^[A-Z0-9]{4}\d{1,2}$` após o fix `542b6f4`) por:
```ts
    universe: z.array(z.string().regex(B3_TICKER_EXACT)).min(1).max(2_000),
```
Remover o comentário longo introduzido em `542b6f4` (a explicação agora vive no módulo).

- [ ] **Step 2: `training-runs/route.ts` — usar o módulo**

Import: `import { isB3Ticker } from '@/lib/b3-ticker';` (seguir o estilo de import do arquivo — `@/` se ele já usa).
Remover `const TICKER_RE = /^[A-Z]{4}\d{1,2}$/;`.
Trocar o refine para: `.refine(isB3Ticker, { message: 'ticker fora do formato B3 (raiz de 4 chars + 1-2 dígitos)' })`.

- [ ] **Step 3: `train/route.ts` — idem**

Mesma troca do Step 2 neste arquivo (remover `TICKER_RE` local; `.refine(isB3Ticker, { message: '…' })`; importar `isB3Ticker`).

- [ ] **Step 4: `ml-hybrid/service.ts` — `PREDICT_TICKER_RE` → módulo**

Import `B3_TICKER_EXACT` de `../../lib/b3-ticker`. Remover `const PREDICT_TICKER_RE = /^[A-Z]{4}\d{1,2}$/;`. Trocar `symbol: z.string().regex(PREDICT_TICKER_RE)` por `symbol: z.string().regex(B3_TICKER_EXACT)`.

- [ ] **Step 5: `mcp/pilot/tools/agent-actions.ts` — usar `isB3Ticker`**

Remover `const TICKER_RE = /^[A-Za-z]{4}\d{1,2}$/;`. Importar `isB3Ticker`. O input já é `.toUpperCase()` antes do teste, então trocar `if (!TICKER_RE.test(candidate))` por `if (!isB3Ticker(candidate))`.

- [ ] **Step 6: Adicionar aceitação de B3SA3 nas suítes**

Em `scripts/mcp-pilot/*-test.ts`, no teste do `agent_run.submit` com template `COMITE`, adicionar uma asserção de que `ticker: 'B3SA3'` é aceito (não lança `INVALID_QUERY`). (Se não houver teste de comitê, adicionar um caso mínimo seguindo o padrão `assertLog` do arquivo.)

- [ ] **Step 7: Rodar as suítes afetadas**

Run:
```bash
npm run test:ml-training-run
npm run test:ml-hybrid
npm run test:mcp-pilot
npx tsc --noEmit
```
Expected: todas verdes (`TODOS OS TESTES PASSARAM`); tsc limpo. (No Windows, o `exit 3221226505` no fim de suítes tsx é ruído de teardown, não falha — confira a linha `PASSARAM`.)

- [ ] **Step 8: Commit**

```bash
git add src/application/ml-training-run/train-job-port.ts src/app/api/v1/ml/training-runs/route.ts src/app/api/v1/ml/train/route.ts src/application/ml-hybrid/service.ts src/mcp/pilot/tools/agent-actions.ts scripts/mcp-pilot/
git commit -m "refactor(ml): sites de validação de ticker usam módulo compartilhado"
```

---

## Task 3: Migrar sites de canonicalização + auditar teste de reads

**Files:**
- Modify: `src/app/api/v1/_shared/sanitize-text.ts`
- Modify: `src/app/api/v1/ml/predict/_dto.ts`
- Modify (auditoria): `scripts/ml-unified-reads/ml-unified-reads-test.ts`
- Test: `test:ml-unified-reads`

**Interfaces:**
- Consumes: `canonicalizeB3Ticker` de `src/lib/b3-ticker` (Task 1).

- [ ] **Step 1: `sanitize-text.ts` — delegar para o módulo**

Importar `canonicalizeB3Ticker`. Remover `const TICKER_RE = /^[A-Z]{4}\d{1,2}$/;` e reescrever `normalizeTickerLabel`:
```ts
export function normalizeTickerLabel(raw: string): string {
  return canonicalizeB3Ticker(raw);
}
```
(Manter a assinatura/nome exportados — os consumidores não mudam.)

- [ ] **Step 2: `predict/_dto.ts` — idem**

Importar `canonicalizeB3Ticker`. Remover `const TICKER_RE = /^[A-Z]{4}\d{1,2}$/;`. Trocar a linha 120:
```ts
  const symbol = canonicalizeB3Ticker(data.prediction.symbol);
```

- [ ] **Step 3: Auditar `ml-unified-reads-test.ts`**

Verificar que nenhuma asserção fixa `B3SA3 → DESCONHECIDO`. As asserções existentes (`../../SECRET`, `C:\TOKEN`, `SECRET`, `PETR4X`, `''`, `!!!@@@###`, `PETR-4`/`PETR/4`/`PETR_4`/`PETR 4`) continuam `DESCONHECIDO` no padrão novo — confirmar isso rodando a suíte no Step 4. **Adicionar** uma asserção nova:
```ts
assertLog(normalizeTickerLabel('B3SA3') === 'B3SA3', 'B3SA3 (raiz com dígito) é ticker canônico, não DESCONHECIDO');
```
Se a asserção de contagem "6 viram DESCONHECIDO" (linha ~616) usar algum input com raiz-dígito, ajustar a expectativa; caso contrário, deixar como está.

- [ ] **Step 4: Rodar a suíte**

Run: `npm run test:ml-unified-reads && npx tsc --noEmit`
Expected: verde; a nova asserção de B3SA3 passa; nenhuma regressão de DESCONHECIDO.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/_shared/sanitize-text.ts src/app/api/v1/ml/predict/_dto.ts scripts/ml-unified-reads/ml-unified-reads-test.ts
git commit -m "refactor(ml): canonicalização de ticker usa módulo compartilhado (aceita B3SA3)"
```

---

## Task 4: Migrar extração de texto livre (agent-run)

**Files:**
- Modify: `src/application/agent-run/service.ts:205-227`
- Test: `test:agent-run`

**Interfaces:**
- Consumes: `b3TickerGlobal`, `isB3Ticker` de `src/lib/b3-ticker` (Task 1).

- [ ] **Step 1: Escrever asserção de regressão (falha) em `scripts/agent-run/*-test.ts`**

No harness do agent-run, adicionar um teste que prove: (a) `resolveTicker({ ticker: 'B3SA3' })` retorna `'B3SA3'`; (b) extração de `{ question: 'analise B3SA3 com lucro 123456' }` retorna `'B3SA3'`, nunca `'123456'`. Como `resolveTicker`/`extractTickerFromInput` são internas, testar pela via pública que as usa (ex.: submit de AgentRun COMITE com `question` contendo B3SA3) seguindo o padrão `assertLog` do arquivo. Escrever a asserção primeiro.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:agent-run`
Expected: FALHA na nova asserção (o `[A-Z]{4}` atual não casa B3SA3).

- [ ] **Step 3: Migrar `service.ts`**

Importar de `../../lib/b3-ticker`: `b3TickerGlobal`, `isB3Ticker`. Remover:
```ts
const TICKER_RE = /\b[A-Z]{4}\d{1,2}\b/g;
const TICKER_EXACT_RE = /^[A-Z]{4}\d{1,2}$/;
```
Em `extractTickerFromInput`, trocar `value.match(TICKER_RE)` por `value.match(b3TickerGlobal())` (instância fresca). Em `resolveTicker`, trocar `TICKER_EXACT_RE.test(candidate)` por `isB3Ticker(candidate)`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:agent-run && npx tsc --noEmit`
Expected: verde; a asserção de B3SA3 passa; nada capturando `123456`.

- [ ] **Step 5: Commit**

```bash
git add src/application/agent-run/service.ts scripts/agent-run/
git commit -m "refactor(ml): extração de ticker do agent-run usa módulo compartilhado"
```

---

## Task 5: Sincronizar a guarda Python + teste de segurança

**Files:**
- Modify: `python/ml_api.py:42`
- Test: `python/tests/test_ml_api.py`

**Interfaces:**
- Espelha `B3_TICKER_PATTERN` do módulo Node — mantido idêntico manualmente.

- [ ] **Step 1: Escrever o teste (falha) em `python/tests/test_ml_api.py`**

Adicionar (seguindo o estilo do arquivo — `create_app().test_client()` e/ou chamada direta a `symbols_from`) casos que provem:
- `symbols_from({'symbols': ['B3SA3']})` retorna `['B3SA3']` (aceito);
- tickers de path-traversal/lixo continuam rejeitados (`InvalidSymbolsError`): `'../etc'`, `'A/B'`, `'foo.bar'`, `'123456'`;
- `POST /ml/predict` com `symbol: 'B3SA3'` NÃO retorna `INVALID_SYMBOL` (passa da guarda — pode retornar `MODEL_NOT_FOUND`/`INVALID_HASH`, o que importa é não ser barrado pela regex do símbolo).

```python
def test_b3sa3_aceito_e_pathtraversal_rejeitado():
    app = create_app()
    # symbols_from via rota de start (idempotente) ou helper interno
    c = app.test_client()
    # B3SA3 aceito: /ml/train-jobs com jobId válido não deve dar INVALID_SYMBOLS
    r = c.post('/ml/train-jobs', json={'jobId': 'a'*32, 'symbols': ['B3SA3']})
    assert r.get_json().get('error') != 'INVALID_SYMBOLS', 'B3SA3 deve ser aceito'
    # lixo/path-traversal rejeitado
    for bad in ['../etc', 'A/B', 'foo.bar', '123456']:
        rb = c.post('/ml/train-jobs', json={'jobId': 'b'*32, 'symbols': [bad]})
        assert rb.status_code == 400 and rb.get_json().get('error') == 'INVALID_SYMBOLS', f'{bad} deve ser rejeitado'
    print('ok: B3SA3 aceito; path-traversal/lixo rejeitado')
```
(Se o job Python de fato spawnar no caso B3SA3, cancelar via `/ml/train-jobs/<id>/cancel` no fim do teste para não deixar processo — ou usar o helper `symbols_from` isolado se acessível, evitando o spawn.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `python python/tests/test_ml_api.py`
Expected: FALHA no caso B3SA3 (o `^[A-Z]{4}\d{1,2}$` atual rejeita).

- [ ] **Step 3: Atualizar `_TICKER_RE`**

Em `python/ml_api.py`, trocar a linha 42:
```python
# Padrão canônico de ticker B3 — DEVE ser idêntico ao de src/lib/b3-ticker.ts
# (B3_TICKER_PATTERN): raiz 1 letra + 3 alfanuméricos + 1-2 dígitos. Aceita
# B3SA3, rejeita número puro; path-safe (sem / . .. separadores) — os símbolos
# aceitos aqui compõem diretamente o path do snapshot.
_TICKER_RE = re.compile(r'^[A-Z][A-Z0-9]{3}\d{1,2}$')
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python python/tests/test_ml_api.py`
Expected: PASS — `ok: B3SA3 aceito; path-traversal/lixo rejeitado` e a suíte inteira OK.

- [ ] **Step 5: Commit**

```bash
git add python/ml_api.py python/tests/test_ml_api.py
git commit -m "fix(ml): guarda de ticker do Flask aceita B3SA3 (sincronizada com o Node)"
```

---

## Task 6: Verificação final + documentação

**Files:**
- Modify: `docs/CODEX_HANDOFF.md`
- (fora do repo) vault: `log.md`, `concepts/wr-trading-pro-professional-upgrade.md`

- [ ] **Step 1: Rodar todas as suítes afetadas + tipos**

Run:
```bash
npm run test:b3-ticker
npm run test:ml-training-run
npm run test:ml-hybrid
npm run test:mcp-pilot
npm run test:agent-run
npm run test:ml-unified-reads
python python/tests/test_ml_api.py
npx tsc --noEmit
```
Expected: todas verdes; tsc limpo.

- [ ] **Step 2: Confirmar que nenhum `[A-Z]{4}\d{1,2}` de ticker B3 sobrou**

Run: `git grep -n "A-Z]{4}\\\\d{1,2}"` (Node) e `git grep -n "A-Z]{4}" python/ml_api.py`
Expected: nenhuma ocorrência do padrão de ticker B3 antigo nos 9 sites (só restam os `SYMBOL_PATTERN` gerais, fora de escopo).

- [ ] **Step 3: Atualizar handoff**

Adicionar seção `## Sessão 2026-07-25 (cont. 2) — regex de ticker B3 unificado` em `docs/CODEX_HANDOFF.md`: resume o módulo `b3-ticker`, os 9 sites migrados, o padrão canônico e a marcação do follow-up como resolvido.

- [ ] **Step 4: Commit + push**

```bash
git add docs/CODEX_HANDOFF.md
git commit -m "docs(handoff): regex de ticker B3 unificado (follow-up resolvido)"
git push origin main
```

- [ ] **Step 5: Atualizar o vault** (conforme SCHEMA.md)

Entrada em `log.md` (`## [2026-07-25] refactor | regex de ticker B3 unificado`) e nota no topo de "Estado atual" em `concepts/wr-trading-pro-professional-upgrade.md` (bump `updated`), marcando o follow-up como resolvido e apontando spec/plano.

---

## Self-Review

- **Cobertura do spec:** módulo único (Task 1) ✓; 8 sites Node (Tasks 2-4) ✓; Python + segurança (Task 5) ✓; testes dos dois lados + auditoria ml-unified-reads (Tasks 1,3,4,5) ✓; sincronia por comentário cruzado (Tasks 1,5) ✓; fora de escopo respeitado (Global Constraints) ✓; verificação final (Task 6) ✓.
- **Placeholders:** nenhum passo sem código/comando concreto.
- **Consistência de tipos:** `B3_TICKER_EXACT`/`b3TickerGlobal`/`isB3Ticker`/`canonicalizeB3Ticker` definidos na Task 1 e consumidos com os mesmos nomes nas Tasks 2-4; `_TICKER_RE` idêntico ao `B3_TICKER_PATTERN`.
