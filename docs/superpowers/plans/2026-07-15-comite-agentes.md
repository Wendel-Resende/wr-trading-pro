# Comitê de Agentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modo "Comitê" no runtime AgentRun v1: 4 papéis (Fundamentalista CVM, Dividendos, Risco, Cético) deliberando sobre 1 ticker B3, com o Cético rebatendo os demais e a síntese atuando como Gestor.

**Architecture:** Registro de papéis server-side (`committee.ts`) consultado pelo `service.ts` via `node.role`; fatias de contexto por papel em `agent-data-context.ts`; DAG de comitê montado na UI (`AgentRunsPanel.tsx`) + visão de pareceres. Zero mudança em contrato, schema, mapping ou rotas.

**Tech Stack:** TypeScript (Next.js 15 / React 19), Prisma 6 + SQLite, suíte determinística `npm run test:agent-run` (node:assert, sem framework), better-sqlite3 para dados CVM.

**Spec:** `docs/superpowers/specs/2026-07-15-comite-agentes-design.md`

## Global Constraints

- **Contrato intacto:** `ResearchFinding`/`TradeProposal`, schemas strict, mapping e rotas `/api/v1/agent-runs*` NÃO mudam.
- **Retrocompatibilidade:** `role` desconhecido (ex.: `analista-pesquisa`) mantém exatamente o comportamento genérico atual de `executeAgentNodeLive`/`synthesizeOutputLive`.
- **Determinismo dos testes:** `npm run test:agent-run` continua rodando sem rede; LLM apenas via stub injetado (`createAgentRunService(prisma, { agentLlm })`).
- **Contexto limitado:** fatia de dados por papel + prompt ≤ ~2–3 mil tokens (Ollama local roda com `num_ctx=8192`).
- **Segurança:** nenhum segredo no cliente; nunca aceitar `NEXT_PUBLIC_*` no servidor; PROPOSAL sempre `requiresHumanApproval: true` e nunca gera OrderIntent.
- **UI:** pt-BR, classes/estilo cyber existentes (`cyber-card`, `font-orbitron`, `font-space`).
- Commits frequentes com mensagens `feat(agent)`/`test(agent)`; rodapé `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Fatias de contexto por papel — `buildRoleContext`

**Files:**
- Modify: `src/lib/agent-data-context.ts` (adicionar ao final; helpers privados existentes `BRL`, `PCT`, `latestQuarter`, `trailing12m`, `portfolioTickers`, `getDividends` são reutilizados)
- Test: `scripts/agent-run/agent-run-test.ts` (nova função `roleContextTests()`)

**Interfaces:**
- Consumes: `listCompanies()`, `getQuarters(cdCvm)`, `getDividendQuarters(ticker)` (via `getDividends`), `getPortfolio12()`, `buildSingleTickerContext(ticker)`, `buildPromptContext(ticker?)` — todos já existentes no módulo.
- Produces: `export function buildRoleContext(roleKey: string, ticker: string): string` — usado por `committee.ts` (Task 2). Chaves reconhecidas: `'fundamentalista-cvm' | 'dividendos' | 'risco' | 'cetico'`; qualquer outra chave cai em `buildPromptContext(ticker)`.

- [ ] **Step 1: Escrever o teste que falha**

Em `scripts/agent-run/agent-run-test.ts`, adicionar o import no topo (junto aos existentes):

```ts
import { buildRoleContext } from '../../src/lib/agent-data-context';
```

E a função de teste (depois de `migrationAdditivityTests`). Os dados CVM são versionados em `data/cvm/` (snapshot com proveniência), então o teste é estável nesta máquina e em clones:

```ts
function roleContextTests(): void {
  const keys = ['fundamentalista-cvm', 'dividendos', 'risco', 'cetico'] as const;
  const contexts = new Map<string, string>();
  for (const key of keys) {
    const ctx = buildRoleContext(key, 'WEGE3');
    assert.ok(ctx.length > 100, `contexto de ${key} deveria ter conteúdo real`);
    assert.match(ctx, /WEGE3/, `contexto de ${key} deveria citar o ticker`);
    contexts.set(key, ctx);
  }
  // Cada papel recebe uma fatia própria, não o mesmo dump
  assert.notEqual(contexts.get('fundamentalista-cvm'), contexts.get('dividendos'));
  assert.notEqual(contexts.get('dividendos'), contexts.get('risco'));
  assert.match(contexts.get('fundamentalista-cvm')!, /Evolução trimestral/);
  assert.match(contexts.get('dividendos')!, /Proventos por trimestre/);
  assert.match(contexts.get('risco')!, /Indicadores de risco/);
  // Papel desconhecido cai no contexto genérico (carteira) — retrocompat
  const generic = buildRoleContext('papel-desconhecido', 'WEGE3');
  assert.match(generic, /Carteira 12 Dividendos\/JCP/);
  console.log('fatias de contexto por papel: OK (4 fatias distintas por papel; papel desconhecido cai no genérico)');
}
```

Em `main()`, chamar logo após `migrationAdditivityTests();`:

```ts
  roleContextTests();
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm run test:agent-run`
Expected: FAIL na compilação tsc — `Module '"../../src/lib/agent-data-context"' has no exported member 'buildRoleContext'`.

- [ ] **Step 3: Implementar `buildRoleContext`**

Ao final de `src/lib/agent-data-context.ts`:

```ts
// ── Fatias de contexto por papel do comitê ─────────────────────────
//
// Cada papel do comitê recebe apenas a fatia de dados do seu mandato
// (spec 2026-07-15): prompt + fatia ≤ ~2–3 mil tokens para caber no
// num_ctx=8192 do Ollama local. O resumo da carteira inteira NÃO entra
// nos papéis focados — vira ruído e estoura contexto.

function findCompanyByTicker(ticker: string): CvmCompany | null {
  return (
    listCompanies().find((c) => c.ticker.toUpperCase() === ticker.toUpperCase()) ?? null
  );
}

function lastQuarters(quarters: CvmQuarter[], n: number): CvmQuarter[] {
  return [...quarters]
    .sort((a, b) => a.ano - b.ano || a.trimestre - b.trimestre)
    .slice(-n);
}

function fundamentalistaContext(ticker: string, company: CvmCompany): string {
  let ctx = buildSingleTickerContext(ticker).context;
  const q8 = lastQuarters(getQuarters(company.cdCvm), 8);
  ctx += '\n## Evolução trimestral (últimos 8 trimestres)\n';
  for (const q of q8) {
    ctx += `- ${q.ano}T${q.trimestre}: receita ${BRL(q.receitaLiquida, 'bi')} | lucro ${BRL(q.lucroLiquido, 'bi')} | margem líq. ${PCT(q.margemLiquida)} | ROE ${PCT(q.roe)}\n`;
  }
  return ctx;
}

function dividendosContext(ticker: string, company: CvmCompany): string {
  let ctx = `## Dados de proventos para ${company.ticker} — ${company.nome} (${company.setor ?? 'setor não informado'})\n\n`;
  const divs = getDividends(company.ticker);
  const last20 = divs.slice(-20); // ~5 anos
  ctx += '## Proventos por trimestre (saída de caixa, fonte DFC/CVM)\n';
  if (last20.length === 0) {
    ctx += '- Sem registros de proventos na base.\n';
  }
  for (const d of last20) {
    ctx += `- ${d.ano}T${d.trimestre}: ${BRL(d.proventos)}\n`;
  }
  const quarters = getQuarters(company.cdCvm);
  const t12lucro = trailing12m(quarters, 'lucroLiquido');
  const total4 = divs.slice(-4).reduce((s, d) => s + (d.proventos ?? 0), 0);
  if (total4 > 0) {
    ctx += `\nProventos 12m: ${BRL(total4)}`;
    if (t12lucro && t12lucro > 0) {
      ctx += ` | Lucro 12m: ${BRL(t12lucro, 'bi')} | Payout 12m: ~${((total4 / t12lucro) * 100).toFixed(0)}%`;
    }
    ctx += '\n';
  }
  const inPortfolio = portfolioTickers().includes(company.ticker);
  ctx += inPortfolio
    ? 'O ativo PERTENCE à carteira 12 dividendos/JCP vigente da plataforma.\n'
    : 'O ativo NÃO pertence à carteira 12 dividendos/JCP vigente da plataforma.\n';
  return ctx;
}

function riscoContext(ticker: string, company: CvmCompany): string {
  let ctx = `## Indicadores de risco para ${company.ticker} — ${company.nome} (${company.setor ?? 'setor não informado'})\n\n`;
  const quarters = getQuarters(company.cdCvm);
  const latest = latestQuarter(quarters);
  if (latest) {
    ctx += `Último trimestre: ${latest.ano}T${latest.trimestre}\n`;
    ctx += `Dívida/PL: ${PCT(latest.dividaPl)} | Endividamento: ${PCT(latest.endividamento)} | Liquidez corrente: ${latest.liquidezCorrente !== null && Number.isFinite(latest.liquidezCorrente) ? latest.liquidezCorrente.toFixed(2) : 'N/D'}\n`;
  }
  const q8 = lastQuarters(quarters, 8);
  ctx += '\n## Margens por trimestre (volatilidade — últimos 8 trimestres)\n';
  for (const q of q8) {
    ctx += `- ${q.ano}T${q.trimestre}: margem líq. ${PCT(q.margemLiquida)} | margem EBITDA ${PCT(q.margemEbitda)}\n`;
  }
  // Concentração setorial da carteira vigente
  const tickers = portfolioTickers();
  const companies = listCompanies();
  const sameSector = tickers.filter((t) => {
    const c = companies.find((x) => x.ticker === t);
    return c?.setor !== null && c?.setor !== undefined && c.setor === company.setor;
  });
  ctx += `\nSetor "${company.setor ?? 'não informado'}" na carteira 12 vigente: ${sameSector.length} de ${tickers.length} ativos`;
  ctx += sameSector.length > 0 ? ` (${sameSector.join(', ')})\n` : '\n';
  return ctx;
}

/**
 * Fatia de contexto de dados para um papel do comitê (spec 2026-07-15).
 * Papel desconhecido cai no contexto genérico (`buildPromptContext`) —
 * retrocompatível com roles antigos como `analista-pesquisa`.
 */
export function buildRoleContext(roleKey: string, ticker: string): string {
  const company = findCompanyByTicker(ticker);
  if (!company) return `Ticker ${ticker} não encontrado na base CVM (138 empresas).`;
  switch (roleKey) {
    case 'fundamentalista-cvm':
      return fundamentalistaContext(ticker, company);
    case 'dividendos':
      return dividendosContext(ticker, company);
    case 'risco':
      return riscoContext(ticker, company);
    case 'cetico':
      // O material principal do cético são os pareceres dos colegas (via
      // reads); aqui só o compacto do ticker para checar números citados.
      return buildSingleTickerContext(ticker).context;
    default:
      return buildPromptContext(ticker);
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:agent-run`
Expected: PASS — linha `fatias de contexto por papel: OK (...)` e `TODOS OS TESTES PASSARAM` ao final.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-data-context.ts scripts/agent-run/agent-run-test.ts
git commit -m "feat(agent): fatias de contexto de dados por papel do comitê (buildRoleContext)"
```

---

### Task 2: Registro de papéis — `committee.ts`

**Files:**
- Create: `src/application/agent-run/committee.ts`
- Test: `scripts/agent-run/agent-run-test.ts` (nova função `committeeRegistryTests()`)

**Interfaces:**
- Consumes: `buildRoleContext(roleKey, ticker)` (Task 1); `AgentRunKind` de `src/domain/v1/models/agent-run`.
- Produces (usados na Task 3 e nos testes):
  - `interface CommitteeRole { key: string; title: string; systemPrompt(ticker: string, dataContext: string): string; buildContext(ticker: string): string }`
  - `getCommitteeRole(role: string | undefined): CommitteeRole | undefined`
  - `GESTOR_ROLE_KEY = 'gestor'` (const)
  - `buildGestorSystemPrompt(kind: AgentRunKind, schemaHint: string): string`

- [ ] **Step 1: Escrever o teste que falha**

Import no topo de `scripts/agent-run/agent-run-test.ts`:

```ts
import { getCommitteeRole, buildGestorSystemPrompt, GESTOR_ROLE_KEY } from '../../src/application/agent-run/committee';
```

Função de teste (após `roleContextTests`) — puro, sem banco:

```ts
function committeeRegistryTests(): void {
  const keys = ['fundamentalista-cvm', 'dividendos', 'risco', 'cetico'];
  for (const key of keys) {
    const role = getCommitteeRole(key);
    assert.ok(role, `papel ${key} deveria existir no registro`);
    assert.equal(role!.key, key);
    assert.ok(role!.title.length > 0);
    const prompt = role!.systemPrompt('WEGE3', 'DADOS-DE-TESTE');
    assert.match(prompt, /WEGE3/, `prompt de ${key} deveria citar o ticker`);
    assert.match(prompt, /DADOS-DE-TESTE/, `prompt de ${key} deveria embutir a fatia de dados`);
    assert.match(prompt, /não executa ordens/i, `prompt de ${key} deveria negar autoridade de execução`);
  }
  // Instruções distintivas por papel
  assert.match(getCommitteeRole('fundamentalista-cvm')!.systemPrompt('WEGE3', 'X'), /fundamentos/i);
  assert.match(getCommitteeRole('dividendos')!.systemPrompt('WEGE3', 'X'), /proventos/i);
  assert.match(getCommitteeRole('risco')!.systemPrompt('WEGE3', 'X'), /não recomende/i);
  assert.match(getCommitteeRole('cetico')!.systemPrompt('WEGE3', 'X'), /rebat/i);
  // Papel desconhecido e gestor: fora do registro de nós AGENT
  assert.equal(getCommitteeRole('analista-pesquisa'), undefined);
  assert.equal(getCommitteeRole(undefined), undefined);
  assert.equal(getCommitteeRole(GESTOR_ROLE_KEY), undefined);
  // Prompt do gestor embute o schema hint e a regra de aprovação humana em PROPOSAL
  const gestorResearch = buildGestorSystemPrompt('RESEARCH', '{"thesis": "..."}');
  assert.match(gestorResearch, /Gestor/);
  assert.match(gestorResearch, /\{"thesis": "\.\.\."\}/);
  const gestorProposal = buildGestorSystemPrompt('PROPOSAL', '{"direction": "..."}');
  assert.match(gestorProposal, /aprovação humana/i);
  console.log('registro de papéis do comitê: OK (4 papéis + gestor; papel desconhecido → undefined)');
}
```

Em `main()`, após `roleContextTests();`:

```ts
  committeeRegistryTests();
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm run test:agent-run`
Expected: FAIL na compilação tsc — `Cannot find module '../../src/application/agent-run/committee'`.

- [ ] **Step 3: Criar `src/application/agent-run/committee.ts`**

```ts
/**
 * Registro de papéis do Comitê de Agentes (spec 2026-07-15).
 *
 * Os prompts vivem aqui, versionados no git — nunca no input do run
 * (cliente não injeta prompt de sistema; estrutura montada pelo runtime).
 * O runtime (`service.ts`) consulta o registro pelo `role` do nó AGENT;
 * papel desconhecido cai no comportamento genérico, retrocompatível.
 */
import type { AgentRunKind } from '../../domain/v1/models/agent-run';
import { buildRoleContext } from '../../lib/agent-data-context';

export interface CommitteeRole {
  readonly key: string;
  readonly title: string;
  readonly systemPrompt: (ticker: string, dataContext: string) => string;
  readonly buildContext: (ticker: string) => string;
}

const COMMON_RULES =
  'Responda em português, de forma objetiva e fundamentada. ' +
  'Use exclusivamente os dados fornecidos — não invente números; se um dado não estiver disponível, diga isso. ' +
  'Você não executa ordens e não tem autoridade de execução.';

function makeRole(key: string, title: string, mission: string): CommitteeRole {
  return Object.freeze({
    key,
    title,
    systemPrompt: (ticker: string, dataContext: string) =>
      `Você é o agente "${title}" do comitê de investimento da WR Trading Pro (B3/Brasil), deliberando sobre ${ticker}. ` +
      `${mission} ${COMMON_RULES}\n\n` +
      `DADOS DA PLATAFORMA (contexto real, base factual da sua análise):\n${dataContext}`,
    buildContext: (ticker: string) => buildRoleContext(key, ticker),
  });
}

const ROLES: readonly CommitteeRole[] = Object.freeze([
  makeRole(
    'fundamentalista-cvm',
    'Analista Fundamentalista CVM',
    'Avalie lucro, ROE, margens, endividamento e a recorrência dos resultados com base nos fundamentos CVM. ' +
      'Opine somente sobre fundamentos — não fale de dividendos nem de preço.',
  ),
  makeRole(
    'dividendos',
    'Analista de Dividendos',
    'Avalie a recorrência, o payout, a cobertura de caixa e a sustentabilidade dos proventos (dividendos + JCP). ' +
      'Aponte se a política de proventos é compatível com o lucro e o caixa.',
  ),
  makeRole(
    'risco',
    'Analista de Risco',
    'Delimite os riscos: endividamento, volatilidade de margens, concentração setorial e o que pode dar errado. ' +
      'Não recomende compra ou venda — apenas delimite o risco e as condições que o agravariam.',
  ),
  makeRole(
    'cetico',
    'Cético',
    'Você recebeu os pareceres dos colegas em "Saídas de nós anteriores". ' +
      'Ataque os pontos fracos de cada parecer, aponte dados que contradizem as teses e armadilhas como yield trap ou lucro não recorrente. ' +
      'Não repita a análise deles — rebata o que não se sustenta.',
  ),
]);

const BY_KEY = new Map(ROLES.map((r) => [r.key, r] as const));

/** Papel de comitê para um `role` de nó AGENT; `undefined` mantém o caminho genérico. */
export function getCommitteeRole(role: string | undefined): CommitteeRole | undefined {
  if (!role) return undefined;
  return BY_KEY.get(role);
}

/** `role` do nó SYNTHESIS que ativa a síntese como Gestor do comitê. */
export const GESTOR_ROLE_KEY = 'gestor';

/** Prompt de síntese do Gestor — mesmo schema hint de contrato do caminho genérico. */
export function buildGestorSystemPrompt(kind: AgentRunKind, schemaHint: string): string {
  return (
    'Você é o Gestor do comitê de investimento da WR Trading Pro (B3/Brasil). ' +
    'Recebeu os pareceres do Fundamentalista CVM, do Analista de Dividendos, do Analista de Risco e a réplica do Cético. ' +
    'Pondere os pareceres, dê peso real às objeções do Cético e explicite onde os analistas divergem. ' +
    (kind === 'PROPOSAL'
      ? 'Sua decisão é uma proposta que sempre exige aprovação humana e nunca executa ordens. '
      : '') +
    `Responda APENAS com um objeto JSON no formato: ${schemaHint}. Sem texto fora do JSON.`
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:agent-run`
Expected: PASS — linha `registro de papéis do comitê: OK (...)`.

- [ ] **Step 5: Commit**

```bash
git add src/application/agent-run/committee.ts scripts/agent-run/agent-run-test.ts
git commit -m "feat(agent): registro de papéis do comitê (4 papéis + gestor) com prompts versionados"
```

---

### Task 3: Integração no runtime — `service.ts`

**Files:**
- Modify: `src/application/agent-run/service.ts`
- Test: `scripts/agent-run/agent-run-test.ts` (fixture `COMMITTEE_DAG`, `committeeSimulatedTests()`, `committeeLiveStubTests()`)

**Interfaces:**
- Consumes: `getCommitteeRole`, `GESTOR_ROLE_KEY`, `buildGestorSystemPrompt` (Task 2); `buildSingleTickerContext` de `agent-data-context` (existente); `createAgentRunService(prisma, { agentLlm })` (existente em `compose.ts`).
- Produces: comportamento — nós AGENT com papel de comitê usam prompt + fatia do papel; SYNTHESIS com `role: 'gestor'` usa o prompt do gestor; material da síntese rotulado por `role` (fallback `nodeId`). Assinaturas internas alteradas (privadas do módulo): `executeNode(node, nodeStates, input, kind, decisionTime, llm, roleByNodeId)`, `synthesizeOutputLive(node, nodeStates, input, kind, decisionTime, llm, roleByNodeId)`, `collectAgentMaterial(nodeStates, roleByNodeId)`, novo helper `resolveTicker(input)`.

- [ ] **Step 1: Escrever os testes que falham**

Em `scripts/agent-run/agent-run-test.ts`, adicionar import de tipos LLM no topo:

```ts
import type { AgentLlmCompletion, AgentLlmMessage, AgentLlmOptions, AgentLlmPort } from '../../src/domain/v1/ports/agent-llm';
```

Fixture do DAG de comitê (após a const `DAG` existente) — **idêntico ao que a UI montará na Task 4**:

```ts
const COMMITTEE_DAG: AgentRunDag = {
  nodes: [
    { id: 'in', type: 'INPUT' },
    { id: 'fund', type: 'AGENT', role: 'fundamentalista-cvm', provides: ['parecer'] },
    { id: 'divs', type: 'AGENT', role: 'dividendos', provides: ['parecer'] },
    { id: 'risco', type: 'AGENT', role: 'risco', provides: ['parecer'] },
    {
      id: 'cetico',
      type: 'AGENT',
      role: 'cetico',
      reads: ['fund.parecer', 'divs.parecer', 'risco.parecer'],
      provides: ['parecer'],
    },
    {
      id: 'evidence',
      type: 'EVIDENCE',
      reads: ['fund.parecer', 'divs.parecer', 'risco.parecer', 'cetico.parecer'],
    },
    { id: 'synthesis', type: 'SYNTHESIS', role: 'gestor', provides: ['finding'] },
    { id: 'out', type: 'OUTPUT', reads: ['synthesis.finding'] },
  ],
  edges: [
    ['in', 'fund'],
    ['in', 'divs'],
    ['in', 'risco'],
    ['fund', 'cetico'],
    ['divs', 'cetico'],
    ['risco', 'cetico'],
    ['cetico', 'evidence'],
    ['evidence', 'synthesis'],
    ['synthesis', 'out'],
  ],
};
```

Testes (após `paginationDeterminismTests`):

```ts
async function committeeSimulatedTests(prisma: PrismaClient): Promise<void> {
  // Sem porta LLM: o comitê inteiro roda no caminho simulado e continua
  // produzindo um run legível com output contratual.
  const service = createAgentRunService(prisma);
  const run = await service.submit({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: COMMITTEE_DAG,
    input: { ticker: 'WEGE3', question: 'WEGE3 sustenta os dividendos?' },
    decisionTime: '2099-01-01T00:00:00.000Z',
  });
  const finished = await service.advance(run.runId);
  assert.equal(finished.status, 'SUCCEEDED');
  assert.equal(finished.stepsUsed, COMMITTEE_DAG.nodes.length);
  for (const node of COMMITTEE_DAG.nodes) {
    assert.equal(finished.nodeStates[node.id]?.status, 'DONE', `nó ${node.id} deveria estar DONE`);
  }
  // reads do cético resolveram (parecer simulado dos 3 colegas disponível)
  const ceticoOut = finished.nodeStates['cetico']?.output as Record<string, unknown>;
  assert.ok(typeof ceticoOut.parecer === 'string' && (ceticoOut.parecer as string).length > 0);
  assert.equal(finished.output!.kind, 'RESEARCH');
  console.log('comitê simulado: OK (8 nós DONE sem LLM; output contratual; run legível)');
}

class StubCommitteeLlm implements AgentLlmPort {
  readonly calls: { system: string; user: string; opts?: AgentLlmOptions }[] = [];
  async complete(messages: readonly AgentLlmMessage[], opts?: AgentLlmOptions): Promise<AgentLlmCompletion> {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    this.calls.push({ system, user, opts });
    const isSynthesis = system.includes('APENAS com um objeto JSON');
    const content = isSynthesis
      ? '{"thesis": "Tese do gestor: comitê dividido, cético venceu no payout.", "risks": ["payout apertado"], "confidence": 0.7, "invalidation": "queda do FCO por 2 trimestres"}'
      : `Parecer ${this.calls.length}: análise do papel sobre WEGE3.`;
    return { content, provider: 'STUB', model: 'stub-1', totalTokens: 10 };
  }
}

async function committeeLiveStubTests(prisma: PrismaClient): Promise<void> {
  const stub = new StubCommitteeLlm();
  const service = createAgentRunService(prisma, { agentLlm: stub });
  const run = await service.submit({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: COMMITTEE_DAG,
    input: { ticker: 'WEGE3', question: 'WEGE3 sustenta os dividendos?' },
    decisionTime: '2099-01-01T00:00:00.000Z',
  });
  const finished = await service.advance(run.runId);
  assert.equal(finished.status, 'SUCCEEDED');

  // 5 chamadas LLM: fund, divs, risco, cetico (ordem topológica) + gestor
  assert.equal(stub.calls.length, 5, `esperava 5 chamadas LLM, houve ${stub.calls.length}`);
  const [fund, divs, risco, cetico, gestor] = stub.calls;
  // Cada papel recebeu SEU prompt (não o genérico) com SUA fatia de dados
  assert.match(fund.system, /Analista Fundamentalista CVM/);
  assert.match(fund.system, /Evolução trimestral/);
  assert.match(divs.system, /Analista de Dividendos/);
  assert.match(divs.system, /Proventos por trimestre/);
  assert.match(risco.system, /Analista de Risco/);
  assert.match(risco.system, /Indicadores de risco/);
  // Fatias focadas: papéis do comitê NÃO recebem o dump da carteira inteira
  assert.doesNotMatch(fund.system, /Carteira 12 Dividendos\/JCP/);
  // O cético recebeu os pareceres dos 3 colegas via reads
  assert.match(cetico.system, /Cético/);
  assert.match(cetico.user, /fund\.parecer/);
  assert.match(cetico.user, /Parecer 1/);
  assert.match(cetico.user, /Parecer 3/);
  // O gestor recebeu material rotulado por papel e devolveu o contrato
  assert.match(gestor.system, /Gestor/);
  assert.match(gestor.user, /fundamentalista-cvm/);
  assert.match(gestor.user, /cetico/);
  assert.equal(finished.output!.kind, 'RESEARCH');
  assert.equal(
    (finished.output as unknown as Record<string, unknown>).thesis,
    'Tese do gestor: comitê dividido, cético venceu no payout.',
  );
  // Custo: 5 chamadas LLM × 10 tokens + 1 do nó EVIDENCE (custo determinístico por tipo)
  assert.equal(finished.costUsed, 51);
  console.log('comitê com stub LLM: OK (prompts por papel; cético rebate; gestor sintetiza; custo em tokens)');
}
```

Em `main()`, após `paginationDeterminismTests(prisma);`:

```ts
    await committeeSimulatedTests(prisma);
    await committeeLiveStubTests(prisma);
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm run test:agent-run`
Expected: FAIL — `committeeLiveStubTests` quebra nos asserts de prompt (ex.: `fund.system` não contém `Analista Fundamentalista CVM`, pois hoje todo AGENT usa o prompt genérico). `committeeSimulatedTests` já deve passar (o motor atual executa qualquer DAG válido) — confirmar que passa.

- [ ] **Step 3: Integrar o registro no `service.ts`**

3a. Imports — trocar a linha `import { buildPromptContext } from '../../lib/agent-data-context';` por:

```ts
import { buildPromptContext, buildSingleTickerContext } from '../../lib/agent-data-context';
import { buildGestorSystemPrompt, getCommitteeRole, GESTOR_ROLE_KEY } from './committee';
```

3b. Extrair o helper de ticker (logo após a const `TICKER_RE` e `extractTickerFromInput` existentes):

```ts
/** Ticker do run: campo explícito primeiro, senão extração por regex do texto. */
function resolveTicker(input: Record<string, unknown>): string | undefined {
  if (typeof input.ticker === 'string' && input.ticker.trim().length > 0) return input.ticker.trim().toUpperCase();
  if (typeof input.symbol === 'string' && input.symbol.trim().length > 0) return input.symbol.trim().toUpperCase();
  return extractTickerFromInput(input);
}
```

3c. `collectAgentMaterial` — rotular por papel. Assinatura e rótulo mudam:

```ts
function collectAgentMaterial(
  nodeStates: AgentRunNodeStates,
  roleByNodeId: ReadonlyMap<string, string>,
): { texts: string[]; liveNodeIds: string[]; providers: Set<string> } {
  const texts: string[] = [];
  const liveNodeIds: string[] = [];
  const providers = new Set<string>();
  for (const [nodeId, state] of Object.entries(nodeStates)) {
    const out = state.output;
    if (!out) continue;
    const meta = out._llm as NodeLlmMeta | undefined;
    const label = roleByNodeId.get(nodeId) ?? nodeId;
    for (const [key, value] of Object.entries(out)) {
      if (key === '_llm' || typeof value !== 'string' || value.trim().length === 0) continue;
      texts.push(`[${label}.${key}] ${value}`);
    }
    if (meta && meta.simulated === false) {
      liveNodeIds.push(nodeId);
      if (meta.provider) providers.add(meta.provider);
    }
  }
  return { texts, liveNodeIds, providers };
}
```

3d. `executeAgentNodeLive` — papel de comitê usa prompt + fatia próprios. Substituir o trecho do `tickerHint`/`dataContext`/`system` atual por:

```ts
  // Contexto de dados da plataforma (fundamentos, dividendos, carteira)
  const tickerHint = resolveTicker(input);
  const committeeRole = getCommitteeRole(node.role);

  const system =
    committeeRole && tickerHint
      ? committeeRole.systemPrompt(tickerHint, committeeRole.buildContext(tickerHint))
      : `Você é o agente "${node.role ?? node.id}" do runtime governado da WR Trading Pro (B3/Brasil). ` +
        `Objetivo do run: ${kind === 'RESEARCH' ? 'pesquisa/análise' : 'avaliação de proposta (nunca execução)'}. ` +
        'Responda em português, de forma objetiva e fundamentada. Você não executa ordens e não tem autoridade de execução.\n\n' +
        `DADOS DA PLATAFORMA (contexto real, use estes dados na sua análise):\n${buildPromptContext(tickerHint)}`;
```

(O `user` prompt existente não muda — o `readContext` já leva os pareceres dos colegas ao cético.)

3e. `synthesizeOutputLive` — receber o nó e o mapa de papéis; gestor usa prompt próprio. Nova assinatura:

```ts
async function synthesizeOutputLive(
  node: AgentRunNode,
  nodeStates: AgentRunNodeStates,
  input: Record<string, unknown>,
  kind: AgentRunKind,
  decisionTime: string,
  llm: AgentLlmPort,
  roleByNodeId: ReadonlyMap<string, string>,
): Promise<{ contract: AgentRunOutput; meta: NodeLlmMeta; cost: number }> {
```

Dentro dela: `const material = collectAgentMaterial(nodeStates, roleByNodeId);` e a chamada LLM passa a montar system/user conforme o papel:

```ts
  const isGestor = node.role === GESTOR_ROLE_KEY;
  const tickerHint = resolveTicker(input);
  // Gestor: pareceres do comitê + compacto do ativo (sem dump da carteira);
  // síntese genérica: comportamento atual preservado.
  const synthesisSystem = isGestor
    ? buildGestorSystemPrompt(kind, schemaHint)
    : 'Você sintetiza análises de agentes da WR Trading Pro em um contrato estruturado. ' +
      `Responda APENAS com um objeto JSON no formato: ${schemaHint}. Sem texto fora do JSON. ` +
      'Use os dados da plataforma como base factual quando relevante.';
  const synthesisUser = isGestor
    ? `Pareceres do comitê:\n${material.texts.join('\n\n')}\n\nDados de referência do ativo:\n${
        tickerHint ? buildSingleTickerContext(tickerHint).context : buildPromptContext()
      }`
    : `Análises dos agentes:\n${material.texts.join('\n\n')}\n\nDados da plataforma (referência):\n${buildPromptContext()}`;

  try {
    const completion = await llm.complete(
      [
        { role: 'system', content: synthesisSystem },
        { role: 'user', content: synthesisUser },
      ],
      llmPreferences(input)
    );
```

(O restante — parse, sanitização, fallbacks — permanece idêntico. Atenção: `schemaHint` é declarado antes deste bloco no código atual; manter a ordem.)

3f. `executeNode` — nova assinatura com `roleByNodeId`, repassando ao SYNTHESIS:

```ts
async function executeNode(
  node: AgentRunNode,
  nodeStates: AgentRunNodeStates,
  input: Record<string, unknown>,
  kind: AgentRunKind,
  decisionTime: string,
  llm: AgentLlmPort | undefined,
  roleByNodeId: ReadonlyMap<string, string>,
): Promise<NodeExecution> {
```

No case `'SYNTHESIS'`, a chamada vira:

```ts
        const { contract, meta, cost } = await synthesizeOutputLive(node, nodeStates, input, kind, decisionTime, llm, roleByNodeId);
```

3g. `advance` — montar o mapa uma vez, antes do loop de nós:

```ts
    const roleByNodeId: ReadonlyMap<string, string> = new Map(
      sortedNodes.filter((n) => n.role).map((n) => [n.id, n.role!] as const),
    );
```

E a chamada dentro do loop:

```ts
      const execution = await executeNode(node, nodeStates, run.input, run.kind, run.decisionTime, this.ports.agentLlm, roleByNodeId);
```

3h. Atualizar o comentário de cabeçalho do `service.ts` (a nota "sem LLM real" do docblock da classe já está defasada — mencionar que AGENT/SYNTHESIS usam a porta LLM quando presente e que papéis de comitê têm prompts próprios via `committee.ts`).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:agent-run`
Expected: PASS — todas as linhas `OK`, incluindo `comitê simulado: OK (...)` e `comitê com stub LLM: OK (...)`. Os testes antigos (execução topológica, orçamento, etc.) continuam passando — regressão zero no caminho genérico.

- [ ] **Step 5: Verificar o build**

Run: `npm run build`
Expected: build Next.js conclui sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add src/application/agent-run/service.ts scripts/agent-run/agent-run-test.ts
git commit -m "feat(agent): runtime consulta o registro do comitê — prompts por papel, cético com reads, síntese como gestor"
```

---

### Task 4: UI — template Comitê e visão de pareceres

**Files:**
- Modify: `src/components/AgentRunsPanel.tsx`

**Interfaces:**
- Consumes: API existente `/api/v1/agent-runs` (POST/advance); chaves de papel da Task 2 (strings no DAG: `fundamentalista-cvm`, `dividendos`, `risco`, `cetico`, `gestor`); nós AGENT publicam `parecer` (string) em `nodeStates[id].output.parecer`.
- Produces: template "Comitê" na criação (DAG idêntico ao fixture `COMMITTEE_DAG` da Task 3) e seção "Pareceres do Comitê" no detalhe.

- [ ] **Step 1: Adicionar template, DAG de comitê e titulação dos papéis**

Após `buildDefaultDag` em `AgentRunsPanel.tsx`:

```tsx
/** DAG do Comitê (spec 2026-07-15): 3 analistas em paralelo → cético rebate → gestor sintetiza. */
function buildCommitteeDag() {
  return {
    nodes: [
      { id: "in", type: "INPUT" as const },
      { id: "fund", type: "AGENT" as const, role: "fundamentalista-cvm", provides: ["parecer"] },
      { id: "divs", type: "AGENT" as const, role: "dividendos", provides: ["parecer"] },
      { id: "risco", type: "AGENT" as const, role: "risco", provides: ["parecer"] },
      {
        id: "cetico",
        type: "AGENT" as const,
        role: "cetico",
        reads: ["fund.parecer", "divs.parecer", "risco.parecer"],
        provides: ["parecer"],
      },
      {
        id: "evidence",
        type: "EVIDENCE" as const,
        reads: ["fund.parecer", "divs.parecer", "risco.parecer", "cetico.parecer"],
      },
      { id: "synthesis", type: "SYNTHESIS" as const, role: "gestor", provides: ["finding"] },
      { id: "out", type: "OUTPUT" as const, reads: ["synthesis.finding"] },
    ],
    edges: [
      ["in", "fund"],
      ["in", "divs"],
      ["in", "risco"],
      ["fund", "cetico"],
      ["divs", "cetico"],
      ["risco", "cetico"],
      ["cetico", "evidence"],
      ["evidence", "synthesis"],
      ["synthesis", "out"],
    ] as [string, string][],
  };
}

const COMMITTEE_TITLES: Record<string, string> = {
  "fundamentalista-cvm": "Fundamentalista CVM",
  dividendos: "Dividendos",
  risco: "Risco",
  cetico: "Cético (contraditor)",
  gestor: "Gestor (síntese)",
};

const TICKER_INPUT_RE = /^[A-Za-z]{4}\d{1,2}$/;
```

- [ ] **Step 2: Estado e validação no formulário**

No componente, junto aos `useState` existentes:

```tsx
  const [template, setTemplate] = useState<"SIMPLES" | "COMITE">("SIMPLES");
  const [ticker, setTicker] = useState("");
```

No início de `submit()`, antes do `setSubmitting(true)`:

```tsx
    if (template === "COMITE" && !TICKER_INPUT_RE.test(ticker.trim())) {
      setError("O comitê delibera sobre 1 ativo: informe um ticker B3 válido (ex.: WEGE3).");
      return;
    }
```

No corpo do `fetch` de criação, substituir `dag`, `input` e `budget` por:

```tsx
        body: JSON.stringify({
          kind,
          dag:
            template === "COMITE"
              ? buildCommitteeDag()
              : buildDefaultDag(kind === "RESEARCH" ? "analista-pesquisa" : "analista-proposta"),
          input: {
            question: question.trim() || "(sem pergunta)",
            ...(template === "COMITE" ? { ticker: ticker.trim().toUpperCase() } : {}),
            ...(provider ? { llmProvider: provider } : {}),
            ...(model ? { llmModel: model } : {}),
          },
          // Comitê: ~5 chamadas LLM — teto de tokens explícito (spec) e o
          // mesmo timeout de 5 min (Ollama local pode levar minutos por chamada).
          budget:
            template === "COMITE"
              ? { maxSteps, maxCost: 30_000, timeoutMs: 300_000 }
              : { maxSteps, timeoutMs: 300_000 },
          decisionTime: new Date(Date.now() + 60_000).toISOString(),
        }),
```

- [ ] **Step 3: Campos no formulário (JSX)**

Antes do bloco `<div>` do seletor "Tipo", adicionar o seletor de template; depois do campo "Pergunta / contexto", o campo de ticker condicional:

```tsx
          <div>
            <label className="block text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-1">
              Template
            </label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as "SIMPLES" | "COMITE")}
              className="bg-cyber-dark/50 border border-cyber-border rounded-lg px-3 py-2 text-sm text-white font-space outline-none focus:border-cyber-pink"
            >
              <option value="SIMPLES">Simples (1 agente)</option>
              <option value="COMITE">Comitê (4 papéis + gestor)</option>
            </select>
          </div>
```

```tsx
          {template === "COMITE" && (
            <div>
              <label className="block text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-1">
                Ticker (obrigatório)
              </label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="WEGE3"
                maxLength={6}
                className="w-28 bg-cyber-dark/50 border border-cyber-border rounded-lg px-3 py-2 text-sm text-white font-space outline-none focus:border-cyber-pink"
              />
            </div>
          )}
```

- [ ] **Step 4: Seção "Pareceres do Comitê" no detalhe (JSX)**

No painel de detalhe, entre o bloco do erro (`selected.error && ...`) e o bloco do output (`selected.output && ...`):

```tsx
              {selected.dag.nodes.some((n) => n.role && COMMITTEE_TITLES[n.role]) && (
                <div>
                  <p className="text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-2">
                    Pareceres do Comitê
                  </p>
                  <div className="space-y-2">
                    {selected.dag.nodes
                      .filter((n) => n.type === "AGENT" && n.role && COMMITTEE_TITLES[n.role])
                      .map((n) => {
                        const state = selected.nodeStates[n.id];
                        const parecer = state?.output?.parecer;
                        const llm = state?.output?._llm;
                        const isCetico = n.role === "cetico";
                        return (
                          <div
                            key={n.id}
                            className={`border rounded-lg p-3 ${
                              isCetico ? "border-cyber-pink/40 bg-cyber-pink/5" : "border-cyber-border bg-cyber-dark/40"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <p className={`text-xs font-orbitron uppercase tracking-wider ${isCetico ? "text-cyber-pink" : "text-cyber-cyan"}`}>
                                {COMMITTEE_TITLES[n.role!]}
                              </p>
                              <p className="text-[0.6rem] text-gray-500 font-space">
                                {llm
                                  ? llm.simulated
                                    ? `simulado (${llm.reason ?? "sem LLM"})`
                                    : `${llm.provider}/${llm.model} · ${llm.totalTokens ?? "?"} tokens`
                                  : "pendente"}
                              </p>
                            </div>
                            <p className="text-xs text-gray-300 font-space whitespace-pre-wrap max-h-40 overflow-y-auto">
                              {typeof parecer === "string" ? parecer : "—"}
                            </p>
                          </div>
                        );
                      })}
                    {selected.output && (
                      <div className="border border-green-500/40 bg-green-500/5 rounded-lg p-3">
                        <p className="text-xs font-orbitron uppercase tracking-wider text-green-400 mb-1">
                          {COMMITTEE_TITLES.gestor}
                        </p>
                        <p className="text-xs text-gray-300 font-space whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {String(
                            (selected.output as Record<string, unknown>).thesis ??
                              (selected.output as Record<string, unknown>).rationale ??
                              "—",
                          )}
                        </p>
                        {Array.isArray((selected.output as Record<string, unknown>).risks) && (
                          <p className="text-[0.65rem] text-yellow-400/80 font-space mt-1">
                            Riscos: {((selected.output as Record<string, unknown>).risks as string[]).join(" · ")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
```

Atualizar também o docblock do topo do arquivo (a nota "processamento ainda determinístico/simulado" já era defasada; mencionar o template Comitê).

- [ ] **Step 5: Verificar build e lint**

Run: `npm run build`
Expected: build conclui sem erros de tipo/lint nas páginas que usam `AgentRunsPanel`.

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentRunsPanel.tsx
git commit -m "feat(agent): UI do comitê — template com DAG de debate e visão de pareceres por papel"
```

---

### Task 5: Validação E2E live + documentação

**Files:**
- Modify: `docs/CODEX_HANDOFF.md` (nova entrada de sessão)
- Modify: `C:\Users\rwres\hermes-knowledge\log.md` (entrada `[2026-07-15] implementation | Fable 5 — comitê de agentes`) e `C:\Users\rwres\hermes-knowledge\concepts\comite-investimento-multiagente-b3.md` (registrar que a v1 foi implementada na plataforma, com data e escopo; atualizar frontmatter `updated`)

**Interfaces:**
- Consumes: app completo (Tasks 1–4) rodando em dev; Ollama local e/ou DeepSeek configurados no `.env`.
- Produces: confirmação E2E com LLM real + rastro documental (handoff + vault, conforme CLAUDE.md).

- [ ] **Step 1: Subir o ambiente dev**

Run: `npm run dev` (os serviços Python não são necessários para os agentes; o proxy LLM é server-side).
Expected: Next.js em `http://localhost:3000` (ou porta configurada), login ok.

- [ ] **Step 2: Run de comitê com Ollama local**

Na aba Agentes → Runs Governados: template "Comitê (4 papéis + gestor)", kind RESEARCH, ticker `WEGE3`, pergunta "WEGE3 sustenta os dividendos nos próximos 12 meses?", provedor OLLAMA.
Expected:
- Run SUCCEEDED com 8 nós DONE; chips do DAG mostram os 5 nós com tag de provider (não `[SIM]`).
- Seção "Pareceres do Comitê" com 4 pareceres **distintos** (fundamentalista fala de margens/ROE; dividendos de payout/proventos; risco de dívida/volatilidade; cético cita/rebate afirmações dos colegas).
- Parecer do gestor coerente, mencionando divergências; custo do run em tokens plausível (< 30.000).

- [ ] **Step 3: Run de comitê com DeepSeek (provedor de API)**

Mesmo fluxo com provedor DEEPSEEK.
Expected: SUCCEEDED; pareceres em qualidade igual/superior; números citados batem com a base CVM (ex.: payout de WEGE3 ~83%, lucro 12m ~R$ 6,7 bi — validados na sessão de 2026-07-15).

- [ ] **Step 4: Regressão do modo Simples**

Criar um run template "Simples" RESEARCH com pergunta livre.
Expected: comportamento idêntico ao anterior à mudança (prompt genérico, contexto da carteira, SUCCEEDED).

- [ ] **Step 5: Documentar**

- `docs/CODEX_HANDOFF.md`: nova seção de sessão com o resumo da entrega (comitê v1: registro de papéis, fatias de contexto, integração runtime, UI, testes novos no `test:agent-run`, resultados E2E).
- Vault: entrada no `log.md` e atualização da página `comite-investimento-multiagente-b3.md` (frontmatter `updated: 2026-07-15`, seção "Estado: v1 implementada na WR Trading Pro" com escopo da v1 e o que ficou de fora — preço/MT5, otimista, carteira inteira, 2ª rodada).

- [ ] **Step 6: Commit final**

```bash
git add docs/CODEX_HANDOFF.md
git commit -m "docs(handoff): comitê de agentes v1 — entrega, testes e validação E2E"
```

---

## Self-Review (executado na escrita do plano)

- **Cobertura do spec:** §1 registro → Task 2; §1 integração service → Task 3; §2 fatias → Task 1; §3 DAG/template → Tasks 3 (fixture) e 4 (UI); §4 contrato/kind/ticker → constraints + Task 4 Step 2; §5 UI → Task 4; §6 erros/orçamento → sem mudança (constraint) + teste de custo em tokens na Task 3; §7 testes → Tasks 1–3 (determinísticos) e 5 (E2E). Sem lacunas.
- **Placeholders:** nenhum TBD/TODO; todo passo de código tem o código.
- **Consistência de tipos:** `buildRoleContext(roleKey: string, ticker: string): string` (T1) = consumo em T2; `getCommitteeRole/GESTOR_ROLE_KEY/buildGestorSystemPrompt` (T2) = consumo em T3; `COMMITTEE_DAG` (T3) idêntico a `buildCommitteeDag()` (T4); nós AGENT publicam `parecer` (T3 fixture ↔ T4 leitura `output.parecer`).
