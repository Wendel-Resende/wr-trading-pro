# Design — Unificação do regex de ticker B3

- **Data:** 2026-07-25
- **Autor:** Claude Code (Opus 4.8)
- **Status:** aprovado (brainstorming) → aguardando plano
- **Origem:** follow-up sistêmico registrado na sessão 2026-07-25 do
  `docs/CODEX_HANDOFF.md` (fix do ticker `B3SA3` em `542b6f4`).

## Problema

O padrão de "ticker B3 canônico" `^[A-Z]{4}\d{1,2}$` (4 letras + 1-2
dígitos) está **duplicado em 9 pontos** (8 Node + 1 Python). Ele rejeita
tickers reais cuja raiz contém dígito — notavelmente **`B3SA3`** (a própria
B3 S.A., `B-3-S-A-3`). Consequência: B3SA3 é silenciosamente
rejeitado/mishandleiado em vários fluxos (foi o que derrubou um treino
inteiro após ~17min — ver `542b6f4`), e a duplicação garante que qualquer
correção pontual deixa os outros sites divergentes.

### Inventário dos sites

| # | Arquivo | Papel | Forma atual |
|---|---|---|---|
| 1 | `src/app/api/v1/_shared/sanitize-text.ts` | canonicaliza rótulo → `DESCONHECIDO` | `^[A-Z]{4}\d{1,2}$` |
| 2 | `src/application/ml-training-run/train-job-port.ts` | valida `universe` (**já corrigido** para `[A-Z0-9]{4}` em `542b6f4`) | `^[A-Z0-9]{4}\d{1,2}$` |
| 3 | `src/app/api/v1/ml/training-runs/route.ts` | valida símbolos do usuário (entrada) | `^[A-Z]{4}\d{1,2}$` |
| 4 | `src/app/api/v1/ml/train/route.ts` | idem (fluxo síncrono legado) | `^[A-Z]{4}\d{1,2}$` |
| 5 | `src/application/ml-hybrid/service.ts` | valida `symbol` da previsão vinda do Python | `^[A-Z]{4}\d{1,2}$` |
| 6 | `src/app/api/v1/ml/predict/_dto.ts` | canonicaliza `symbol` → `DESCONHECIDO` | `^[A-Z]{4}\d{1,2}$` |
| 7 | `src/application/agent-run/service.ts` | extração de texto livre (`\b…\b/g`) + validação exata | `\b[A-Z]{4}\d{1,2}\b` e `^…$` |
| 8 | `src/mcp/pilot/tools/agent-actions.ts` | valida ticker do comitê (case-insensitive) | `^[A-Za-z]{4}\d{1,2}$` |
| 9 | `python/ml_api.py` (`_TICKER_RE`) | **guarda de filesystem** (`bars_snapshot/<sym>.parquet`) + universo/predict | `^[A-Z]{4}\d{1,2}$` |

### Dois pontos sensíveis

- **Extração de texto livre (#7):** afrouxar ingenuamente para
  `[A-Z0-9]{4}` faria o regex casar números puros em texto livre (ex.:
  "lucro de 123456" → "123456" vira "ticker"). Over-matching real.
- **Guarda de segurança (#9):** `_TICKER_RE` valida o `symbol` antes de
  compô-lo em um path de snapshot. Afrouxar é aceitável **se** o padrão
  não introduzir `/`, `.`, `..` ou separadores.

## Padrão canônico escolhido

```
[A-Z][A-Z0-9]{3}\d{1,2}
```

Raiz = **1 letra + 3 alfanuméricos maiúsculos**, seguida de **1-2 dígitos**
de tipo. Propriedades:

- `B3SA3` → `B` + `3SA` + `3` ✓
- `PETR4` → `P` + `ETR` + `4` ✓; `ENGI11` → `E` + `NGI` + `11` ✓
- `123456` → 1º char não é `[A-Z]` → **rejeita** (resolve o over-match da
  extração de texto livre com um único padrão para todos os sites)
- Não contém `/`, `.`, `..` nem separadores → **path-safe** para a guarda
  Python (#9)

Exigir o 1º char letra é estritamente melhor que `[A-Z0-9]{4}`: todas as
raízes B3 reais satisfazem (inclusive B3SA), e o mesmo padrão serve tanto
para match ancorado quanto para extração `\b…\b` sem falso-positivo
numérico.

## Arquitetura

### Fonte única — Node

Novo módulo `src/lib/b3-ticker.ts` (camada neutra, importável por `app/`,
`application/` e `mcp/` sem violar a regra "application não depende de
app/"):

```ts
/** Padrão canônico de ticker B3: raiz de 1 letra + 3 alfanuméricos + 1-2 dígitos de tipo.
 *  Fonte de verdade compartilhada por todo o Node. A cópia Python vive em
 *  python/ml_api.py::_TICKER_RE e DEVE ser mantida idêntica (ver testes de ambos). */
export const B3_TICKER_PATTERN = '[A-Z][A-Z0-9]{3}\\d{1,2}';
export const B3_TICKER_EXACT = new RegExp(`^${B3_TICKER_PATTERN}$`);
/** Instância fresca a cada chamada — regex global é stateful (lastIndex). */
export const b3TickerGlobal = (): RegExp => new RegExp(`\\b${B3_TICKER_PATTERN}\\b`, 'g');
export const isB3Ticker = (raw: string): boolean =>
  typeof raw === 'string' && B3_TICKER_EXACT.test(raw);
/** Uppercase+trim; retorna o ticker canônico ou 'DESCONHECIDO'. */
export const canonicalizeB3Ticker = (raw: string): string => {
  const u = (typeof raw === 'string' ? raw : '').trim().toUpperCase();
  return B3_TICKER_EXACT.test(u) ? u : 'DESCONHECIDO';
};
```

### Migração dos 8 sites Node

- **Zod `.regex(...)`** — #2, #3, #4, #5, #6: substituem o `const TICKER_RE`
  local por `B3_TICKER_EXACT` importado. #2 alinha `[A-Z0-9]{4}` →
  padrão canônico (consistência).
- **Canonicalização** — #1 (`normalizeTickerLabel`) e #6
  (`predict/_dto.ts`): passam a delegar para `canonicalizeB3Ticker`
  (semântica idêntica: match → uppercase; senão `DESCONHECIDO`).
- **agent-run #7**: extração usa `b3TickerGlobal()`; validação de campo
  explícito usa `isB3Ticker`. O padrão canônico elimina o falso-positivo
  numérico da extração.
- **mcp-pilot #8**: o input já é `.toUpperCase()` antes do teste, então a
  case-insensitivity (`[A-Za-z]`) era redundante — passa a `B3_TICKER_EXACT`
  (comportamento observável preservado).

### Python (#9) — cópia sincronizada

`python/ml_api.py`:

```python
# Padrão canônico de ticker B3 — DEVE ser idêntico ao de src/lib/b3-ticker.ts
# (B3_TICKER_PATTERN). Raiz 1 letra + 3 alfanuméricos + 1-2 dígitos; aceita
# B3SA3, rejeita números puros, path-safe (sem / . .. separadores).
_TICKER_RE = re.compile(r'^[A-Z][A-Z0-9]{3}\d{1,2}$')
```

Definição única no arquivo (já referenciada em `symbols_from` e nas guardas
de `/ml/predict`/snapshots). Sincronia Node↔Python garantida por comentário
cruzado + teste em cada linguagem (ver abaixo).

## Estratégia de testes

- **Novo** `scripts/b3-ticker/` (Node, harness no padrão do projeto):
  - aceita `B3SA3`, `PETR4`, `ENGI11`, `KLBN11`, `SANB11`;
  - rejeita número puro (`123456`), lixo (`../etc`, `A/B`, vazio),
    minúsculas cruas, 3 letras, 3 dígitos de tipo;
  - `b3TickerGlobal()` extrai `WEGE3` de texto livre mas **não** captura
    `123456`;
  - `canonicalizeB3Ticker` → uppercase quando casa, `DESCONHECIDO` senão.
- **Python** (`python/tests/test_ml_api.py`): `B3SA3` aceito por
  `symbols_from` e pela guarda de `/ml/predict`; **teste de segurança
  explícito** — `../`, `A/B`, `foo.bar`, string com separador continuam
  rejeitados (nunca compõem path).
- **Auditar/ajustar** testes existentes que fixavam o comportamento antigo
  — em especial `scripts/ml-unified-reads/ml-unified-reads-test.ts`
  (referencia o padrão e o `DESCONHECIDO`): garantir que nenhum caso
  asserte `B3SA3 → DESCONHECIDO`.
- Regressão já existente do `train-job-port` (`fakeTrainResult.universe`
  com `B3SA3`) permanece válida.
- Verificação final: `tsc --noEmit` limpo; suítes Node afetadas
  (`test:ml-training-run`, `test:ml-hybrid`, `test:mcp-pilot`,
  `test:agent-run`, `test:ml-unified-reads`, novo `test:b3-ticker`) verdes;
  `test_ml_api.py` rodado direto (o plugin pytest quebra em import de
  `web3`, pré-existente).

## Fora de escopo (YAGNI)

- Os `SYMBOL_PATTERN` gerais (`src/contracts/v1`, `python/contracts/v1`,
  `reference-data/schemas.ts`) — formato distinto e proposital
  (`[A-Z0-9][A-Z0-9._-]{0,31}`), não são "ticker B3".
- `spread-orders` (`[A-Z0-9]{4,12}`) e `agents/route.ts` (`[A-Z0-9]{3,12}`)
  — formatos próprios, deliberadamente mais amplos.
- Nenhuma mudança de UI, contrato HTTP público ou schema Prisma.

## Riscos

1. **Sincronia Node↔Python** — único ponto frágil (dois literais).
   Mitigação: comentário cruzado nos dois arquivos + teste de aceitação
   (B3SA3) e de rejeição (lixo) em cada linguagem.
2. **Guarda de segurança Python** — mudança path-safe por construção (o
   padrão não admite separadores), com teste de segurança dedicado
   provando que path-traversal/lixo continua rejeitado.
3. **Regressão de canonicalização** — sites #1/#6 podiam ter consumidores
   assumindo `DESCONHECIDO` para B3SA3; auditoria de testes cobre isso.
