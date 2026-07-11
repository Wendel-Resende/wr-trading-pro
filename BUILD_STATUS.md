# WR Trade Pro - Build Status

## Objetivo

Manter o projeto Next.js/Electron buildando com sucesso usando o modo servidor do Next.js, preservando as API routes usadas pelo app.

## Estado Atual

Ultima verificacao: 2026-05-20

Comandos executados:

```bash
npm run build
npm run electron:compile
C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe -m py_compile python\options\scanner_opcoes.py python\spread_api.py python\mt5_bridge.py python\profitdll_bridge.py python\volatility_api.py
```

Resultado:

```text
Compiled successfully
electron:compile aprovado
py_compile aprovado para servicos Python principais
```

Status: build aprovado apos limpeza estrutural do projeto.

## Validacao de Dados de Opcoes 2026-05-20

Banco canonico:

```text
data/options/options_data.db
```

Validacoes feitas:

- `PRAGMA integrity_check = ok`.
- `scans`: 11.
- `options`: 138.
- Sem options orfas (`options.scan_id` sem `scans.id`): 0.
- O banco legado `python/options/options_data.db` tinha 1 scan antigo de `PETR4` com 53 opcoes.
- Esse historico foi importado para o banco canonico antes da remocao do banco legado.
- `PETR4` agora possui 2 scans historicos no banco canonico:
  - `2026-05-10T17:17:12.755313`, spot `46.01`.
  - `2026-05-13T18:44:12.228Z`, spot `44.83`.

## Estado Anterior

Ultima verificacao: 2026-05-12

Comandos executados:

```bash
npm run build
npm run electron:compile
python -m py_compile python/options/scanner_opcoes.py
python -m py_compile python/spread_api.py
npx electron-builder --win --dir
```

Resultado:

```text
Compiled successfully
electron:compile aprovado
py_compile aprovado para scanner_opcoes.py e spread_api.py
electron-builder win-unpacked aprovado
```

Status: build aprovado.

## Validacao Desktop 2026-05-12

Pacote atualizado:

```text
release/win-unpacked/WR Trade Pro.exe
```

Ultima atualizacao confirmada do executavel:

```text
2026-05-12 19:37:51
```

Validacoes feitas:

- `release/win-unpacked/resources/app/electron/dist/main.js` contem `APP_DATA_DIR`, `OPTIONS_DATA_DIR` e `data/options/options_data.db`.
- O codigo empacotado nao usa mais `app.getPath('userData')` para o banco de opcoes.
- Simulacao da descoberta de raiz a partir de `release/win-unpacked` apontou para:
  - `C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_`
- Banco esperado para novos scans de opcoes:
  - `C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\data\options\options_data.db`
- `release/win-unpacked/resources/app/python/spread_api.py` contem o filtro estatistico de pares (`calcular_qualidade_par`, `score`, `direcao_entrada`).
- O filtro de Spread B3 considera o `ganho_minimo` escolhido pelo usuario: um par so fica `Ideal` se tiver oportunidade historica atingindo esse valor.
- A tela de Spread B3 exibe detalhes de auditoria dos pares: spread atual/medio, spread assinado, meia-vida e maior ganho historico.
- A classificacao operacional do Spread B3 separa pares em `Ideal Forte`, `Ideal Limite`, `Acompanhar` e `Fraco`.

## Estado Anterior

Ultima verificacao: 2026-05-11

Comandos executados:

```bash
npm run build
npm run electron:compile
npx electron-builder --win --dir --config.directories.output=codex-electron-check-final
```

Resultado:

```text
Compiled successfully
Linting and checking validity of types
Generating static pages (22/22)
Finalizing page optimization
electron:compile aprovado
electron-builder win-unpacked aprovado
```

Status: build aprovado.

## Validacao Desktop 2026-05-11

Pacote de teste validado:

```text
codex-electron-check-final/win-unpacked/WR Trade Pro.exe
```

Validacoes feitas contra o app empacotado:

- Next.js production server em `127.0.0.1:3001` respondeu `200`.
- `spread_api.py` iniciou e escutou em `5000` (raiz retorna `404`, esperado).
- `volatility_api.py` iniciou e escutou em `5555` (raiz retorna `404`, esperado).
- `mt5_bridge.py` iniciou em `8766` e aceitou conexao WebSocket.
- Encerramento dos processos de teste deixou apenas conexoes `TIME_WAIT`, sem listeners vivos.

Correcoes aplicadas nesta validacao:

- `websockets` do ambiente Conda `IA_Day_Trading` atualizado para `15.0.1`.
- `mt5_bridge.py` e `profitdll_bridge.py` passaram a usar `websockets.legacy.server.serve`.
- `spread_api.py` e `volatility_api.py` agora rodam Flask com `debug=False` e `use_reloader=False`, evitando processos filhos soltos no desktop.

## Configuracao Atual do Next.js

Arquivo: `next.config.mjs`

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: [],
  },
};

export default nextConfig;
```

Observacao importante: o projeto nao usa `output: 'export'` atualmente. Isso e intencional, porque o app depende de API routes dinamicas em `src/app/api/*` para Prisma, monitoramento, spread orders, agentes, logs e metricas.

## Rotas no Build

O build gera paginas estaticas quando possivel e mantem as API routes como rotas dinamicas server-rendered on demand.

Exemplos de rotas dinamicas esperadas:

- `/api/stock-monitoring`
- `/api/stock-monitoring/summary`
- `/api/spread-orders`
- `/api/historical-candles`
- `/api/agents`
- `/api/logs`
- `/api/metrics`

## Historico de Correcoes Relevantes

### `src/services/profit-dll/ProfitDllService.ts`

`TConnectorState` precisa ser importado como valor, nao apenas como tipo, porque o enum e usado em comparacoes runtime.

```ts
import { TConnectorState } from '@/types/profit/enums';
```

Comparacoes devem usar o enum numerico:

```ts
if (this.status.state === TConnectorState.Authenticated)
```

### `src/types/profit/enums.ts`

O enum duplicado `TConnectorSubscribeResult` foi renomeado para evitar conflito com a interface de mesmo nome exportada por `connector.types.ts`.

```ts
export enum TConnectorSubscribeResultEnum { ... }
```

## Como Rodar

Desenvolvimento web:

```bash
npm run dev
```

Build Next.js:

```bash
npm run build
```

Electron em desenvolvimento:

```bash
npm run electron:compile
npm run electron:dev
```

Pacote desktop:

```bash
npm run electron:package
```

## Notas

- As API routes exigem servidor Node.js/Next.js em runtime.
- O empacotamento Electron inicia o servidor Next.js de producao e os servicos Python conforme `electron/main.ts`.
- Dados locais gerados pela plataforma devem ficar dentro do repositorio em `data/`; o banco de opcoes oficial e `data/options/options_data.db`.
- Artefatos locais como `release/`, `graphify-out/`, `agent_workspace/` e bancos SQLite temporarios nao devem entrar no git.
