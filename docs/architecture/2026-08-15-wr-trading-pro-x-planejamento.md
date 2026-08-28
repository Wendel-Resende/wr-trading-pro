# WR Trading PRO X — Planejamento (fase de levantamento)

> Documento vivo. Registro dos pontos levantados antes de iniciar a
> construção da nova versão da plataforma, numa pasta de projeto separada:
> **`C:\WR\wr_trade_pro_X`** (já criada no disco, vazia, irmã deste repo).
> Espelha o registro mantido no vault Obsidian (`concepts/wr-trading-pro-x-
> planejamento.md`, fonte de verdade de decisões) — este arquivo deve
> migrar pra lá quando a construção começar.

## Objetivo declarado

Não é arquitetura pela arquitetura: o objetivo final é **lucrar no mercado**
com mais segurança e mais acertividade. Toda decisão técnica abaixo só
importa na medida em que aproxima disso — dados mais bem organizados e
funcionalidades mais informativas para apoiar decisão de trade.

## Baseline de paridade (não perder na reescrita)

Inventário completo das 11 abas da WR Trading Pro atual está em
`docs/architecture/2026-08-15-inventario-abas-wr-trading-pro.md`. Resumo:
Dashboard, Ordens, Portfólio, Ranking Fundamentalista (preditivo), Saúde
Financeira (descritivo + bloco bancos BCB), Spread B3, Opções, Fundamentos
CVM, Monitoramento, Agentes (Sugestão Rápida + Runs Governados), Admin.
Nenhuma está morta hoje. Regra: qualquer funcionalidade que sumir ou for
fundida na X precisa ser decisão consciente, não efeito colateral de
reescrever do zero.

## Decisões tomadas

### 1. MT5 continua como fonte de dados na fase inicial

A Profit DLL (Nelogica) — que traria tape reading + book/DOM que o MT5 não
oferece — fica **adiada por custo de licença**. Não é abandono da ideia, é
sequenciamento: provar a arquitetura e a fusão fundamento+técnico com o que
já está pago e funcionando primeiro.

- Uma segunda conta demo de **forex** já foi cadastrada como perfil de
  conexão MT5 (a WR Trading Pro atual já suporta múltiplos perfis —
  `src/lib/server/mt5-connection-store.ts`), especificamente para testar
  conectividade/dados do MCP nativo em fins de semana — a B3 fecha, o forex
  não. Para teste de conectividade o mercado por trás é irrelevante.
- Foco de exploração da fase 1: **aprofundar o MCP nativo do MT5** — sondar
  se builds mais recentes do terminal já expõem `symbol_info`/`market_book`/
  tick real (gaps hoje documentados no `CLAUDE.md` do repo atual: sem tick
  ao vivo de verdade, sem `symbol_info`, sem `market_book`/DOM, sem tool
  isolada de "ordens abertas").

### 2. Linguagens: TypeScript + Python, sem terceira linguagem de propósito geral

| Camada | Linguagem | Por quê |
|---|---|---|
| UI, API, orquestração, governança | TypeScript | Já é o backbone da plataforma atual; trocar aqui seria retrabalho sem ganho |
| Ingestão de dados, indicadores de fluxo (futuro), backtesting, CVM | Python | Ecossistema de dados/quant maduro; Profit DLL tem wrapper Python pronto quando entrar |
| Hot path de agregação tick-a-tick | Rust via PyO3, **isolado, só sob demanda** | Não é ponto de partida — plano B se o Python comprovadamente travar em volume real |

Go, Java, C# descartados — fragmentariam manutenção sem resolver nada que
TS+Python não resolvam.

### 3. CVM point-in-time real é o maior gap de dado identificado

Hoje o banco usado (`data/cvm/cvm_fundamentos.db`) é **derivado**, gerado por
um pipeline externo ("o lab"), sem protocolo de documento nem data de
publicação real — `knowledgeDate` é estimado por prazo legal de publicação,
não é o dado bruto point-in-time.

O schema Prisma **já tem o modelo canônico bitemporal pronto e vazio**:
`CvmFiling` (documento fonte, `filedAt`/`publishedAt`, cadeia de
retificação via `versionNumber`/`supersedesFilingId`) → `CvmFact` (fato
contábil individual, rastreável ao filing) → `DatasetSnapshot`/
`FeatureValue` (bitemporal de verdade: `knowledgeTime` × `decisionTime`,
padrão de mesa quantitativa institucional). Nunca foi ingerido de verdade.

Isso é provavelmente o **maior item de esforço isolado** de toda a evolução
(ingestão real de XBRL/portal da CVM, ~15 anos × 138 empresas), mas também o
que dá mais legitimidade a qualquer coisa preditiva que a plataforma fizer
depois (o Ranking Fundamentalista já é descrito como preditivo com IC/
t-stat — sem point-in-time real, esse rigor estatístico descansa sobre dado
levemente adiantado no tempo).

### 4. Organograma de arquitetura da WR X

Desenhado e validado via skill `archify` (artifact HTML publicado em
sessão). 5 camadas:

```
Dados de mercado (MT5 hoje / Profit DLL futuro / CVM / BCB)
        ↓
Processamento & features (Indicadores de Fluxo — futuro, quando Profit DLL entrar)
        ↓
Decisão (Ranking Fundamentalista, Saúde Financeira, Spread & Volatilidade, Agentes de IA)
        ↓
Governança de Risco (kill switch, allowlist, notional, concentração, aprovação 6 dígitos)
        ↓
Execução real via MT5 MCP → UI
```

A seta de "ordem aprovada" fecha o ciclo voltando da Governança para o MT5
(execução real).

### 5. Ingestão CVM point-in-time: fonte confirmada, esforço rebaixado

Amostra real de 2024 baixada e inspecionada
(`dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_2024.zip`,
298 MB descompactado, 19 CSVs — 8 demonstrativos con/ind + composição de
capital + parecer, atualização semanal, formato já tabular, **não precisa
parsear XBRL bruto**).

**Achado central:** a preocupação original — se dava pra saber a data real
de publicação de cada relatório, não só a data de referência do período —
está resolvida. O arquivo mestre (`dfp_cia_aberta_2024.csv`) tem:

```
CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;CATEG_DOC;ID_DOC;DT_RECEB;LINK_DOC
```

`DT_RECEB` é a data real de recebimento pela CVM, distinta de `DT_REFER`
(fim do período). Prova concreta observada na amostra: Banco do Brasil
(`DT_REFER` 2024-12-31) recebido em 19/02/2025 (50 dias depois); BRB Banco
de Brasília, mesmo período, só em 09/04/2025 (99 dias — passou do prazo
legal de 90). Confirma que cada empresa publica numa data real diferente, e
usar só "fim do trimestre + prazo legal" (a estimativa atual da plataforma)
tem risco real de look-ahead bias ou de perda de sinal.

`VERSAO` reconstrói a cadeia de retificação sem heurística — caso real
observado: Infracommerce CXaaS (CD_CVM 025747), 4 versões pro mesmo
`DT_REFER`, cada uma com `ID_DOC`/`DT_RECEB` próprios.

Mapeamento CSV → schema Prisma confirmado coluna a coluna:

| `CvmFiling`/`CvmFact` (Prisma) | Coluna CVM |
|---|---|
| `cvmProtocol` | `ID_DOC` |
| `referenceDate` | `DT_REFER` |
| `publishedAt` | **`DT_RECEB`** |
| `versionNumber` | `VERSAO` |
| `isRestatement`/`supersedesFilingId` | derivado ordenando `VERSAO` por `CNPJ_CIA`+`DT_REFER` |
| `sourceUrl` | `LINK_DOC` |
| `statementType`/`scope` | nome do arquivo (`DRE`/`BPA`/... × `_con`/`_ind`) |
| `accountCode`/`accountLabel` | `CD_CONTA`/`DS_CONTA` |
| `periodStart`/`periodEnd` | `DT_INI_EXERC`/`DT_FIM_EXERC` |
| `valueRaw`/`currency`/`originalScale` | `VL_CONTA`/`MOEDA`/`ESCALA_MOEDA` |
| `ShareCapitalFact` | arquivo `composicao_capital` |

Isso muda o item de "maior esforço isolado, incerto" para **"ETL bem
definido sobre fonte tabulada"** — reduz bastante o risco de execução dessa
fase.

### 6. Estrutura de dados de séries temporais: DuckDB + Parquet, embutido, sem servidor

Dois mundos de dado, tratados diferente:

- **(a) Dado transacional/canônico** — `CvmFiling`/`CvmFact`/
  `DatasetSnapshot`/`FeatureValue`, ordens, `AgentRun`, política de risco.
  Poucos registros por entidade, integridade referencial importa (join,
  cadeia de retificação). **Fica relacional via Prisma** (SQLite hoje,
  Postgres se um dia sair do modelo desktop single-user). Um TSDB seria a
  ferramenta errada aqui.
- **(b) Dado de mercado denso** — candle histórico profundo e, sobretudo,
  tick quando a Profit DLL entrar (milhares de ticks/dia por ativo líquido).
  Aqui SQLite (OLTP linha-a-linha) fica fraco pra agregação analítica
  pesada (walk-forward, correlação entre ativos, volume profile). Migra
  para **Parquet particionado por `symbol/timeframe/ano` + DuckDB como
  motor de consulta** — embutido, sem processo de servidor separado, mantém
  a filosofia atual de app desktop. SQLite/Prisma continua sendo a fonte
  "ao vivo" que a UI consulta em tempo real; a migração é só para o
  histórico profundo usado por backtest/pesquisa.

Comparativo completo das opções avaliadas:

| Opção | Modelo | Ops | Por que (não) escolhida |
|---|---|---|---|
| SQLite (status quo) | embutido, linha | zero | Mantido só para o dado "ao vivo"/transacional — fraco em agregação analítica pesada |
| **DuckDB** ✅ | embutido, colunar | zero | Escolhido — rápido em agregação, lê Parquet nativo, zero infraestrutura nova |
| **Parquet particionado** ✅ | arquivo, colunar | zero | Escolhido como camada de armazenamento histórico |
| TimescaleDB | servidor Postgres | serviço externo | Descartado por ora — quebra o modelo de app desktop sem serviço pesado |
| ClickHouse / QuestDB | servidor dedicado | serviço externo, mais pesado | Descartado — overkill pro porte atual (1 usuário) |

**Achado relevante:** essa mesma direção (Parquet particionado + catálogo +
hashes de integridade) já havia sido recomendada, de forma independente,
pela pesquisa do Guardião_Hermes sobre um "WR Trade Lab" (vault Obsidian,
`wr-trade-lab-open-source-architecture`, Camada 3 — Data Lake). Duas
investigações separadas convergindo pro mesmo formato é sinal de que a
direção está certa.

**Quando isso deixaria de bastar:** se a WR X virar multi-usuário ou exigir
escrita concorrente pesada em tempo real — aí TimescaleDB/QuestDB entram
como candidato real. Não parece ser o objetivo declarado agora.

### 7. Referências de infraestrutura já analisadas: Vibe-Trading (prática) e Fincept Terminal (cliente visual)

Análise já concluída — projetos externos estudados como fonte de ideias, não
como base de código. A WR X **não é cópia** de nenhum deles.

- **Vibe-Trading foi a referência prática direta de infraestrutura
  operacional.** Aproveitado dele: organização entre UI/API/MCP; operação
  local com serviços coordenados; estrutura de backtesting e pesquisa;
  Alpha Zoo; separação entre ferramentas e agentes; integração de
  ferramentas financeiras; observabilidade e operação pelo Guardião.
- **Fincept Terminal** foi referência de cliente visual e agregação de
  ferramentas — não de infraestrutura operacional.
- **AI Hedge Fund, Pythia, MiroFish, Colibri** — referências só conceituais,
  sem adoção de infraestrutura.

**O que a WR X reconstrói por conta própria**, além do que os projetos
analisados ofereciam: fundamentos CVM, dados point-in-time com proveniência
real (seção 5), MT5/MCP, risco separado da execução, agentes supervisionados,
e controles que impedem execução financeira direta pelo LLM (aprovação
humana de 6 dígitos, kill switch — já presentes na WR Trading Pro atual e
mantidos na X).

### 8. Revisão profunda de código — Vibe-Trading e Fincept Terminal

Revisão de código-fonte real (não só doc/marketing), delegada a dois agentes
em 2026-08-15. Vibe-Trading revisado pelo clone local
(`//wsl.localhost/Ubuntu/root/.hermes/workspace/Vibe-Trading/`); Fincept
Terminal — cujo binário instalado nesta máquina é compilado (Qt6/C++), sem
código-fonte legível localmente — revisado pelo repositório público
(`github.com/Fincept-Corporation/FinceptTerminal`, AGPL-3.0).

**Vibe-Trading — achados fortes, principalmente governança de risco:**

| Padrão | Arquivo | Nota de adaptação |
|---|---|---|
| Mandate imutável: breach estrutural (nega sempre) × breach quantitativo (pausa p/ reautorização) | `agent/src/live/mandate/model.py`, `enforcement.py` | WR hoje trata toda violação de risk-policy igual — vale diferenciar |
| Normalização `quantity`→`notional` antes da checagem de teto | `agent/src/live/order_guard.py` | **Verificado 2026-08-15: a WR não tem esse bypass.** `notional` nunca é campo de entrada — é sempre calculado (`risk-policy.ts:122`, preço de `snapshot.get(symbol)` server-side); mesma `proposedQuantity`/`input.volume` chega sem re-derivação até `mt5-demo-broker.ts:40`. Item fechado. |
| Look-ahead banido estruturalmente (não por convenção) | `backtest/engines/base.py` (`shift(1)`), `factors/base.py` (operador "olhar pra frente" nem existe) | Confirmar se o Ranking Fundamentalista da WR tem a mesma garantia estrutural |
| Monte Carlo permutation test pós-backtest | `backtest/validation.py` | Peça que falta hoje (WR só tem walk-forward/IC/t-stat cross-sectional) |
| Shadow Account — journal real × regra, aritmético, sem LLM | `shadow_account/backtester.py` | Ideia adaptável: "eu disciplinado" comparando o usuário real ao que a régua faria |
| Tool batching: leitura paralela, escrita sempre serial | `agent/src/agent/loop.py` | MCP Pilot da WR provavelmente chama tools MT5 em sequência — leituras poderiam paralelizar |
| Watchdog não-cancelável pra ordem em voo | `agent/src/agent/loop.py` (`_invoke_tool`) | Ordem que já saiu nunca é "esquecida" por timeout do agente |

**Fincept Terminal — achado principal é confirmação de vantagem da WR, não padrão a copiar:**

| Achado | Caminho | Status |
|---|---|---|
| `BrokerInterface`/`OrderValidator` só validam formato de campo — sem notional/concentração/kill switch, e já mandam ordem real | `src/trading/BrokerInterface.h`, `OrderValidator.h` | CONFIRMADO — trilho `trade.propose/approve` da WR é estruturalmente mais seguro |
| ~30 agentes reais (não 37 do marketing), construídos sobre o framework Agno | `scripts/agents/finagent_core/core_agent.py` | CONFIRMADO — contradiz o próprio README deles ("não usa framework de terceiros") |
| CI madura: sanitizers noturnos, "arch ratchet" contra regressão arquitetural | `.github/workflows/` | CONFIRMADO — vale workflow noturno leve equivalente na WR |
| Múltiplos motores de backtest atrás de interface `base/` comum | `scripts/Analytics/backtesting/{vectorbt,zipline,bt,...}/base/` | CONFIRMADO — reaproveitável se WR quiser trocar motor de scan sem reescrever estratégia |
| Nenhum conector B3 em nenhum dos dois projetos | — | Confirma que não há o que copiar da parte B3-específica |

### 9. Frontend: base técnica mantida, visual reconstruído com design system

Usuário quer uma versão "bem mais evoluída... bonita e profissional" — tanto
base técnica quanto visual. Decisão por camada:

- **Base técnica: Next.js + Electron continuam.** Tauri (shell Rust)
  cogitado e descartado por ora — contradiria a decisão de linguagem já
  fechada (§2: TS+Python, Rust só isolado/sob demanda) e o ganho (binário
  menor/mais rápido) não ataca nenhuma dor relatada até agora. Mesmo
  raciocínio de sequenciamento usado no resto da X: não reconstruir
  plumbing que já funciona (auto-start de `spread_api`/`volatility_api`,
  MCP Pilot, ML Engine, conexão MT5) sem ganho comprovado.
- **Visual: shadcn/ui (Radix + Tailwind) substitui o Tailwind ad-hoc atual**
  (tema cyberpunk — `neon-text-cyan`, `hud-corner` etc. — sem sistema de
  tokens consistente). Componente copiado pro projeto (não é dependência de
  lib fechada), temável, acessível por padrão, padrão de fato em dashboard
  financeiro React profissional.
- **`lightweight-charts` (TradingView) mantido** — já é biblioteca de
  qualidade profissional, nada a trocar.
- **TanStack Query proposto** pra dado de servidor — hoje a WR usa `fetch`
  cru + `useState`/`useEffect` espalhado pelas abas; TanStack dá
  cache/retry/loading state de graça, reduz boilerplate e bug de estado.
- **`react-grid-layout` cogitado** pra dashboard com painéis
  arrastáveis/redimensionáveis, estilo Bloomberg/TradingView.
- Skill `interface-design` (Claude Code) a ser invocada quando a construção
  visual realmente começar — ainda não é o momento, fase atual é só
  levantamento.

### 10. Posicionamento: paridade de dado fundamentalista + execução real + agente de IA

Usuário citou Investidor10, StatusInvest e Fundamentus como referência: eles
entregam dado fundamentalista da CVM (o mesmo dado público que a WR usa) bem
organizado, mas **não operam nada** — são terminais de consulta, sem
execução e sem agente de IA. A WR X entrega paridade (ou vantagem, com
point-in-time real que nenhum dos três declara ter) no dado fundamentalista
**e** fecha o ciclo até execução real via MT5 **e** tem agente de IA
fundindo fundamento+técnico. Diferença de categoria, não de feature — vale
usar esse enquadramento pra julgar prioridade de qualquer funcionalidade
nova da X.

### 11. Escopo do MVP revisado — Spread B3 dentro, universo CVM completo (138 empresas)

Duas mudanças sobre a proposta inicial de MVP:

- **Spread B3 permanece no MVP** (antes cogitado para depois) — inclui
  boleta de 2 pernas, análise, buscador de pares, volatilidade.
- **Ingestão CVM point-in-time cobre as 138 empresas desde o início**, não
  um subconjunto.

**MVP consolidado:** Dashboard, Fundamentos CVM (138 empresas, point-in-time
real), Ranking Fundamentalista, Saúde Financeira, Spread B3, Agentes,
Governança de risco, Ordens/Portfólio, Admin.

**Fora do MVP por ora:** Monitoramento (conveniência operacional, não prova
arquitetura nova), tape reading/Profit DLL (bloqueado por custo),
DuckDB/Parquet (só quando o volume de candle/backtest realmente doer —
SQLite basta no início).

## Pontos ainda em aberto

Lista **não fechada** — segue crescendo a cada sessão de levantamento:

- Reconciliação com a pesquisa paralela do Guardião (`wr-trade-lab-open-
  source-architecture` no vault) — mesmo território, mesma tese de fase
  (MT5 agora / Profit DLL depois), projetos formalmente diferentes.
- Catálogo/particionamento exato do Parquet (por symbol/timeframe/ano foi a
  proposta inicial — falta desenhar o esquema de nomes de arquivo, formato
  de manifest/catálogo e política de hashes de integridade).

## Ver também (vault Obsidian)

- `wr-trade-lab-open-source-architecture` — pesquisa paralela do Guardião,
  mesma tese de fase.
- `wr-trading-pro-professional-upgrade` — estado da WR Trading Pro atual.
- `wr-bcb-bancos-integracao-2026-08-13` — dado BCB já integrado.
- `archify-diagramas-tecnicos` — skill usada para o organograma da WR X.
