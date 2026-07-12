import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const domainRoot = fileURLToPath(new URL('../../src/domain/', import.meta.url));
const executionPort = readFileSync(new URL('../../src/domain/v1/ports/execution-broker.ts', import.meta.url), 'utf8');

function typeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? typeScriptFiles(path) : extname(path) === '.ts' ? [path] : [];
  });
}

const sources = typeScriptFiles(domainRoot).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const allSource = sources.map(({ text }) => text).join('\n');

for (const port of [
  'InstrumentCatalog',
  'MarketDataProvider',
  'HistoricalBarsProvider',
  'PortfolioProvider',
  'ExecutionBroker',
]) {
  assert.match(allSource, new RegExp(`export interface ${port}\\b`), `porta ausente: ${port}`);
}

for (const { path, text } of sources) {
  assert.doesNotMatch(text, /from\s+['"](?:react|next(?:\/|['"])?|@prisma|electron)/i, `import de tecnologia em ${path}`);
  assert.doesNotMatch(text, /\b(?:MT5|Profit|Prisma)\b/i, `nome acoplado a tecnologia em ${path}`);
}

assert.match(allSource, /DOMAIN_CONTRACT_VERSION = 1 as const/);
assert.doesNotMatch(allSource, /\b(?:TradeProposal|RiskDecision)\b/);
assert.match(executionPort, /readonly capability: 'deferred-until-governed-order-intent'/);
assert.doesNotMatch(executionPort, /\b(?:submit|send|place|execute|cancel)\s*(?:\(|:)/i);
assert.doesNotMatch(allSource, /\b(?:interface|type|class)\s+(?:ExecutionRequest|CancellationRequest|OrderIntent)\b/);

console.log(`Domain contracts v1 smoke test: OK (${sources.length} arquivos verificados)`);
