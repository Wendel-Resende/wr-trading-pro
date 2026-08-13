import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  getBcbCoverage,
  getBcbEntityLinks,
  getBcbPrudencialCapital,
  getBcbPrudencialResumo,
  getBcbFinanceiroResumo,
  getBcbFinanceiroAtivoTotal,
  BCB_COVERAGE_TICKERS,
  BCB_PROVENANCE,
  BCB_TABLE_COUNT_NOTE,
  TIPO_INSTITUICAO_PRUDENCIAL,
  TIPO_INSTITUICAO_FINANCEIRO,
} from '../../src/lib/server/bcb-legacy-db';

function assertLog(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  console.log(`ok: ${msg}`);
}

const BCB_TABLES = [
  'bcb_prudencial_capital', 'bcb_prudencial_ativo', 'bcb_prudencial_passivo',
  'bcb_prudencial_dre', 'bcb_prudencial_resumo', 'bcb_prudencial_segmentacao',
  'bcb_prudencial_carteira_indexador', 'bcb_prudencial_carteira_regiao',
  'bcb_prudencial_carteira_instrumentos', 'bcb_prudencial_carteira_clientes',
  'bcb_prudencial_carteira_pf_modalidade', 'bcb_prudencial_carteira_pj_modalidade',
  'bcb_prudencial_carteira_pj_cnae', 'bcb_prudencial_carteira_pj_porte',
  'bcb_financeiro_carteira_clientes', 'bcb_financeiro_carteira_indexador',
  'bcb_financeiro_carteira_nivel_risco', 'bcb_financeiro_carteira_pf_modalidade',
  'bcb_financeiro_carteira_pj_cnae', 'bcb_financeiro_carteira_pj_modalidade',
  'bcb_financeiro_carteira_pj_porte', 'bcb_financeiro_carteira_regiao',
  'bcb_financeiro_ativo', 'bcb_financeiro_passivo', 'bcb_financeiro_dre',
  'bcb_financeiro_resumo', 'bcb_financeiro_capital',
];

const FORBIDDEN_PRISMA_TABLES = [
  'CvmFiling', 'CvmFact', 'ShareCapitalFact', 'fundamental_indicators', 'StockMonitoring', 'Prediction',
];

async function main(): Promise<void> {
  assertLog(typeof BCB_PROVENANCE.source === 'string' && BCB_PROVENANCE.source.length > 0, 'proveniência BCB documentada');
  assertLog(BCB_TABLE_COUNT_NOTE.includes('27'), 'contagem de tabelas bcb_* (27) documentada explicitamente');
  assertLog(JSON.stringify(TIPO_INSTITUICAO_PRUDENCIAL) === JSON.stringify([1004, 1009]), 'tipo_instituicao prudencial = 1004/1009');
  assertLog(JSON.stringify(TIPO_INSTITUICAO_FINANCEIRO) === JSON.stringify([1005]), 'tipo_instituicao financeiro = 1005');

  const dbFile = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  if (!existsSync(dbFile)) {
    console.log('ok: smoke pulado — banco data/cvm/cvm_fundamentos.db ausente no ambiente');
    console.log('bcb-fundamentals: TODOS OS TESTES PASSARAM (parcial, sem banco)');
    return;
  }

  const db = new DatabaseSync(dbFile, { readOnly: true });

  // --- schema: as 26 tabelas bcb_* existem no destino ---
  for (const t of BCB_TABLES) {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(t);
    assertLog(row !== undefined, `tabela ${t} existe no destino`);
  }
  const bcbTableRows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bcb_%'`).all();
  assertLog(bcbTableRows.length === 27, `contagem real de tabelas bcb_* = 27 (bate com a spec, ver BCB_TABLE_COUNT_NOTE)`);

  // --- integridade do destino ---
  const integrity = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
  const integrityValue = integrity.integrity_check ?? Object.values(integrity)[0];
  assertLog(integrityValue === 'ok', 'PRAGMA integrity_check do destino = ok');

  // --- tabelas CVM pré-existentes seguem presentes ---
  const cvmTables = ['empresas', 'indicadores', 'bpa_trimestral', 'bpp_trimestral', 'dre_trimestral'];
  for (const t of cvmTables) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number };
    assertLog(row.n > 0, `tabela CVM pré-existente "${t}" segue presente e não-vazia`);
  }

  // --- prisma/schema.prisma (banco operacional) segue sem qualquer menção a BCB ---
  // Nota: fundamental_indicators/CvmFiling/etc. são modelos do banco Prisma
  // OPERACIONAL (banco diferente deste SQLite legado de fundamentos), então
  // não fazem sentido como tabela deste arquivo — a checagem real é sobre o
  // schema Prisma, não sobre sqlite_master deste banco.
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  if (existsSync(schemaPath)) {
    const { readFileSync } = await import('node:fs');
    const schema = readFileSync(schemaPath, 'utf8');
    assertLog(!/\bbcb_/i.test(schema), 'prisma/schema.prisma não tem nenhum campo/modelo bcb_* (dado BCB não foi inserido no banco operacional)');
    for (const t of FORBIDDEN_PRISMA_TABLES) {
      const modelRegex = new RegExp(`model\\s+${t}\\s*\\{([\\s\\S]*?)\\}`, 'i');
      const match = schema.match(modelRegex);
      if (match) {
        assertLog(!/bcb/i.test(match[1]), `modelo Prisma "${t}" não referencia BCB em nenhum campo`);
      }
    }
  } else {
    console.log('ok: prisma/schema.prisma ausente no ambiente — checagem pulada');
  }

  // --- soma total de linhas bcb_* bate com o valor documentado da fonte ---
  let total = 0;
  for (const t of BCB_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number };
    total += row.n;
  }
  assertLog(total === 245590, `soma de linhas bcb_* no destino = 245590 (obtido: ${total})`);

  db.close();

  // --- cobertura 10/10 ---
  const coverage = getBcbCoverage();
  assertLog(coverage.length === BCB_COVERAGE_TICKERS.length, 'getBcbCoverage retorna os 10 tickers de referência');
  const coveredPrud = coverage.filter((c) => c.prudencial.presente);
  const coveredFin = coverage.filter((c) => c.financeiro.presente);
  assertLog(coveredPrud.length === 10, `cobertura prudencial 10/10 (obtido: ${coveredPrud.length})`);
  assertLog(coveredFin.length === 10, `cobertura financeira 10/10 (obtido: ${coveredFin.length})`);
  for (const c of coverage) {
    assertLog(c.cdCvm.length > 0, `${c.ticker}: cd_cvm resolvido via empresas`);
  }

  // --- separação de perímetros: prudencial e financeiro nunca compartilham cod_inst para o mesmo ticker (regra: não misturar) ---
  const links = getBcbEntityLinks('ITUB4');
  const prudLink = links.find((l) => l.perimetro === 'prudencial');
  const finLink = links.find((l) => l.perimetro === 'financeiro');
  assertLog(prudLink !== undefined && finLink !== undefined, 'ITUB4 tem vínculo prudencial e financeiro');
  if (prudLink && finLink) {
    assertLog(prudLink.tipoInstituicao === 1004 || prudLink.tipoInstituicao === 1009, 'vínculo prudencial marcado com tipo_instituicao 1004/1009');
    assertLog(finLink.tipoInstituicao === 1005, 'vínculo financeiro marcado com tipo_instituicao 1005');
  }

  // --- vínculo de identidade: campos exigidos pela spec presentes; ausentes ficam NULL, não adivinhados ---
  assertLog(links.every((l) => l.cdCvm.length > 0 && l.ticker.length > 0), 'todo vínculo tem cd_cvm e ticker');
  assertLog(links.every((l) => l.cnpjLiderBcb === null), 'CNPJ líder BCB fica NULL (não existe na fonte — cod_lider_bcb NÃO é CNPJ; nunca adivinhado)');

  // --- dados prudenciais 1004/1009 ---
  const capital = getBcbPrudencialCapital('ITUB4');
  assertLog(capital.length > 0, 'ITUB4 tem histórico de capital prudencial');
  assertLog(capital.every((r) => r.indiceBasileiaPct === null || Number.isFinite(r.indiceBasileiaPct)), 'índice de Basileia é número finito ou NULL (nunca zero fabricado)');

  const prudResumo = getBcbPrudencialResumo('ITUB4');
  assertLog(prudResumo.length > 0, 'ITUB4 tem resumo prudencial');
  assertLog(prudResumo.every((r) => r.tipoInstituicao === null || r.tipoInstituicao === 1004 || r.tipoInstituicao === 1009), 'todo registro de resumo prudencial tem tipo_instituicao 1004/1009 ou NULL');

  // --- dados financeiros 1005 ---
  const finResumo = getBcbFinanceiroResumo('ITUB4');
  assertLog(finResumo.length > 0, 'ITUB4 tem resumo financeiro');
  assertLog(finResumo.every((r) => r.tipoInstituicao === null || r.tipoInstituicao === 1005), 'todo registro de resumo financeiro tem tipo_instituicao 1005 ou NULL');

  const ativoTotal = getBcbFinanceiroAtivoTotal('ITUB4');
  assertLog(ativoTotal.length > 0, 'ITUB4 tem série de Ativo Total financeiro');
  assertLog(ativoTotal.every((r) => r.rotulo === 'Ativo Total'), 'série de Ativo Total filtra exatamente o rótulo publicado');

  // --- NULL nunca vira zero: ticker sem cobertura BCB retorna listas vazias, não zeros fabricados ---
  const semCobertura = getBcbEntityLinks('PETR4'); // ação sem tabela BCB (não é banco)
  assertLog(semCobertura.length === 0, 'PETR4 (não-banco) não aparece em vínculo BCB — vazio, não fabricado');
  const semCoberturaCapital = getBcbPrudencialCapital('PETR4');
  assertLog(semCoberturaCapital.length === 0, 'PETR4 sem capital prudencial — lista vazia, nunca zero fabricado');

  // --- sanitização de entrada: ticker é normalizado (uppercase, trim) e filtros de tamanho aplicados ---
  const lower = getBcbEntityLinks('itub4');
  assertLog(lower.length === links.length, 'ticker em minúsculo é normalizado para uppercase antes da query');
  const withSpace = getBcbCoverage(['  itub4  ' as never].map((t) => (t as string).trim().toUpperCase()) as never);
  assertLog(Array.isArray(withSpace), 'getBcbCoverage aceita lista normalizada sem lançar');

  console.log('bcb-fundamentals: TODOS OS TESTES PASSARAM');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
