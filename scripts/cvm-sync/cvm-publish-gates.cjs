/**
 * Gates de publicação do snapshot CVM (`data/cvm/cvm_fundamentos.db`).
 *
 * Por que existe: o banco vivo já perdeu a tabela `fundamental_indicators`
 * DUAS vezes (2026-08-15 e 2026-08-21), derrubando Saúde Financeira, Ficha
 * Fundamentalista, Ranking Setorial e as features direcionais do ML. As duas
 * vezes o arquivo foi substituído por um estado anterior sem que nada
 * conferisse o que estava entrando — o publicador só validava as tabelas que
 * ele mesmo escrevia.
 *
 * O publicador real da linhagem canônica é
 * `/root/.hermes/workspace/cvm_fundamentos/scripts/merge_2t26_preserve_history.py`
 * (WSL), cuja linha 10 é `shutil.copy2(backup, target)`: ele SUBSTITUI o banco
 * inteiro por um backup e depois reinsere só as linhas do trimestre novo das
 * tabelas que têm (cd_cvm, ano, trimestre). Toda tabela fora desse formato —
 * `fundamental_indicators` inclusive — herda o estado do backup escolhido.
 *
 * Este módulo é PURO em relação a I/O de rede e não escreve nada: recebe
 * caminhos de arquivo e devolve o veredito. Quem escreve é
 * `publish-cvm-snapshot.cjs`, e quem exercita cada gate com defeito injetado é
 * `cvm-publish-gates-test.ts`.
 */

const { DatabaseSync } = require('node:sqlite');

/** Colunas exigidas em `fundamental_indicators` (conjunto, não ordem). */
const FI_COLUMNS = Object.freeze([
  'id', 'cd_cvm', 'ano', 'trimestre', 'data_ref',
  'roic', 'roe', 'roa', 'margem_bruta', 'margem_liquida', 'margem_ebitda',
  'margem_ebit', 'giro_ativos', 'divida_liquida_ebitda', 'divida_bruta_pl',
  'pl_ativos', 'icj', 'payout_ratio', 'p_ebitda', 'ev_ebitda', 'ev_ebit',
  'crescimento_receita_yoy', 'crescimento_lucro_yoy', 'cagr5y_receita',
  'cagr5y_lucro', 'preco_ref', 'fonte', 'criado_em',
]);

/** Tabelas CVM trimestrais cuja chave (cd_cvm, ano, trimestre) é única. */
const CVM_QUARTERLY_TABLES = Object.freeze([
  'fundamental_indicators', 'indicadores', 'dre_trimestral',
  'bpa_trimestral', 'bpp_trimestral', 'dfc_trimestral',
]);

const CVM_TABLES = Object.freeze([
  'empresas', 'indicadores', 'bpa_trimestral', 'bpp_trimestral', 'capital_social',
  'dfc_trimestral', 'dividendos_jcp_dmpl', 'dra_trimestral', 'dre_trimestral',
  'dva_trimestral', 'fundamental_indicators',
]);

/**
 * Fração mínima das empresas do trimestre mais recente da `dre_trimestral`
 * que precisa aparecer em `fundamental_indicators`. Não é 100% de propósito:
 * o pipeline pula legitimamente quem não tem 2 trimestres na janela de 12
 * meses. Exigir todos transformaria uma lacuna esperada em bloqueio.
 */
const COVERAGE_MIN_RATIO = 0.9;

function open(file) {
  return new DatabaseSync(file, { readOnly: true });
}

function tableExists(db, name) {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
      .n > 0
  );
}

function countRows(db, table) {
  if (!tableExists(db, table)) return null;
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n);
}

function bcbTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'bcb_%' ORDER BY name")
    .all()
    .map((r) => String(r.name));
}

// ── Gates ────────────────────────────────────────────────────────────────
// Cada gate recebe o banco candidato aberto e devolve string de falha ou null.

function gateIntegridade(db) {
  const row = db.prepare('PRAGMA integrity_check').get();
  const value = row && (row.integrity_check ?? Object.values(row)[0]);
  if (value !== 'ok') return `PRAGMA integrity_check devolveu "${value}"`;
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  if (fk.length > 0) return `PRAGMA foreign_key_check acusou ${fk.length} violação(ões)`;
  return null;
}

function gateFundamentalIndicators(db) {
  if (!tableExists(db, 'fundamental_indicators')) {
    return 'tabela `fundamental_indicators` AUSENTE — é a espinha da Saúde Financeira, da Ficha e do Ranking Setorial';
  }
  const cols = db
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all('fundamental_indicators')
    .map((r) => String(r.name));
  const faltando = FI_COLUMNS.filter((c) => !cols.includes(c));
  if (faltando.length > 0) {
    return `\`fundamental_indicators\` sem as colunas: ${faltando.join(', ')}`;
  }
  const n = countRows(db, 'fundamental_indicators');
  if (!n) return '`fundamental_indicators` existe mas está vazia';
  return null;
}

/**
 * O trimestre mais recente publicado na `dre_trimestral` precisa estar
 * refletido em `fundamental_indicators`. É o gate que teria pego 2026-08-21:
 * lá a `dre` tinha 2T26 e a tabela de indicadores não existia.
 */
function gateCobertura(db) {
  if (!tableExists(db, 'dre_trimestral') || !tableExists(db, 'fundamental_indicators')) {
    return 'sem `dre_trimestral` ou `fundamental_indicators` para comparar cobertura';
  }
  const ult = db
    .prepare('SELECT ano, trimestre FROM dre_trimestral ORDER BY ano DESC, trimestre DESC LIMIT 1')
    .get();
  if (!ult) return '`dre_trimestral` vazia';
  const esperado = Number(
    db.prepare('SELECT COUNT(DISTINCT cd_cvm) AS n FROM dre_trimestral WHERE ano = ? AND trimestre = ?')
      .get(ult.ano, ult.trimestre).n,
  );
  const obtido = Number(
    db.prepare(
      'SELECT COUNT(DISTINCT cd_cvm) AS n FROM fundamental_indicators WHERE ano = ? AND trimestre = ?',
    ).get(ult.ano, ult.trimestre).n,
  );
  const alvo = Math.ceil(esperado * COVERAGE_MIN_RATIO);
  if (obtido < alvo) {
    return `cobertura de ${ult.ano}T${ult.trimestre} incoerente: \`dre_trimestral\` tem ${esperado} empresas, \`fundamental_indicators\` só ${obtido} (mínimo ${alvo}) — rode build_fundamental_indicators.py antes de publicar`;
  }
  return null;
}

function gateDuplicidades(db) {
  const problemas = [];
  for (const t of CVM_QUARTERLY_TABLES) {
    if (!tableExists(db, t)) continue;
    const dup = db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT cd_cvm, ano, trimestre FROM "${t}" GROUP BY 1, 2, 3 HAVING COUNT(*) > 1)`,
      )
      .get().n;
    if (Number(dup) > 0) problemas.push(`${t}: ${dup} chave(s) (cd_cvm, ano, trimestre) repetida(s)`);
  }
  if (tableExists(db, 'empresas')) {
    const dupTicker = db
      .prepare(
        "SELECT COUNT(*) AS n FROM (SELECT ticker FROM empresas WHERE ticker IS NOT NULL AND ticker <> '' GROUP BY 1 HAVING COUNT(*) > 1)",
      )
      .get().n;
    if (Number(dupTicker) > 0) problemas.push(`empresas: ${dupTicker} ticker(s) duplicado(s)`);
  }
  return problemas.length > 0 ? problemas.join('; ') : null;
}

/**
 * `empresas.setor_cvm` vazio não é detalhe cosmético: é o campo que tira banco
 * do ranking da indústria. Em 2026-08-28 BBAS3, BBDC4 e ITUB4 estavam com ele
 * NULL e entraram no ranking industrial, julgados por uma régua que descreve
 * doença num banco.
 */
function gateSetores(db) {
  if (!tableExists(db, 'empresas')) return 'tabela `empresas` ausente';
  const semSetor = db
    .prepare(
      "SELECT ticker FROM empresas WHERE ticker IS NOT NULL AND ticker <> '' AND (setor_cvm IS NULL OR TRIM(setor_cvm) = '') ORDER BY ticker",
    )
    .all()
    .map((r) => String(r.ticker));
  if (semSetor.length > 0) {
    return `${semSetor.length} empresa(s) com \`setor_cvm\` vazio (banco entraria no ranking da indústria): ${semSetor.join(', ')}`;
  }
  return null;
}

/** Nenhuma tabela CVM ou BCB pode encolher em relação ao destino atual. */
function gateSemRegressao(dbNovo, dbAtual) {
  if (!dbAtual) return null;
  const problemas = [];
  const tabelas = [...CVM_TABLES, ...bcbTables(dbAtual)];
  for (const t of tabelas) {
    const antes = countRows(dbAtual, t);
    if (antes === null) continue; // não existia antes: não há regressão a apurar
    const depois = countRows(dbNovo, t);
    if (depois === null) problemas.push(`${t}: tabela DESAPARECE (tinha ${antes} linhas)`);
    else if (depois < antes) problemas.push(`${t}: ${antes} -> ${depois}`);
  }
  return problemas.length > 0 ? `regressão vs destino atual — ${problemas.join('; ')}` : null;
}

const GATES = Object.freeze([
  { nome: 'INTEGRIDADE', fn: (novo) => gateIntegridade(novo) },
  { nome: 'FUNDAMENTAL_INDICATORS', fn: (novo) => gateFundamentalIndicators(novo) },
  { nome: 'COBERTURA_TRIMESTRE', fn: (novo) => gateCobertura(novo) },
  { nome: 'SEM_DUPLICIDADES', fn: (novo) => gateDuplicidades(novo) },
  { nome: 'SETORES_VALIDOS', fn: (novo) => gateSetores(novo) },
  { nome: 'SEM_REGRESSAO', fn: (novo, atual) => gateSemRegressao(novo, atual) },
]);

/**
 * Roda todos os gates. `atualFile` é opcional (na primeira publicação não há
 * destino com que comparar). Devolve `{ ok, falhas: [{ gate, detalhe }] }` —
 * roda TODOS os gates mesmo após a primeira falha, porque saber que o arquivo
 * tem três problemas em vez de um muda o que se faz com ele.
 */
function runGates(novoFile, atualFile) {
  const novo = open(novoFile);
  const atual = atualFile ? open(atualFile) : null;
  const falhas = [];
  try {
    for (const g of GATES) {
      let detalhe;
      try {
        detalhe = g.fn(novo, atual);
      } catch (err) {
        detalhe = `erro ao avaliar: ${err && err.message ? err.message : String(err)}`;
      }
      if (detalhe) falhas.push({ gate: g.nome, detalhe });
    }
  } finally {
    novo.close();
    if (atual) atual.close();
  }
  return { ok: falhas.length === 0, falhas };
}

module.exports = {
  runGates,
  GATES,
  FI_COLUMNS,
  CVM_TABLES,
  CVM_QUARTERLY_TABLES,
  COVERAGE_MIN_RATIO,
};
