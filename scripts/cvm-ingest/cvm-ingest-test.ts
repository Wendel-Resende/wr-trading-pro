import assert from 'node:assert/strict';
import { parseCvmHeaderCsv, CvmHeaderParseError } from '../../src/lib/server/cvm-header-parser';

/**
 * Ingestão point-in-time dos filings da CVM (2026-09-06).
 *
 * O que estes testes protegem: a WR hoje carimba o conhecimento de um
 * fundamento com `data_ref + prazo legal` (+45d ITR, +90d DFP) porque
 * nunca coletou a data de publicação. A CVM publica `DT_RECEB` (entrega
 * real) e `VERSAO` (retificação) no CSV de cabeçalho, e este parser é o
 * que os traz para dentro. Medido na base real: 11% dos documentos do ITR
 * 2024 são retificação, com mediana de 15 dias e p90 de 94 até a última
 * versão.
 *
 * O parser é PURO: recebe texto e devolve estrutura. Download, unzip e
 * decodificação latin-1 ficam no script; aqui nada toca rede nem disco.
 */

const SHA = 'a'.repeat(64);

const HEADER = 'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;CATEG_DOC;ID_DOC;DT_RECEB;LINK_DOC';

function csv(...rows: readonly string[]): string {
  return [HEADER, ...rows].join('\n');
}

/** Uma linha do cabeçalho, com os campos que importam parametrizados. */
function row(o: {
  cnpj?: string;
  refer: string;
  versao: number;
  nome?: string;
  cvm?: string;
  categ?: string;
  idDoc: string;
  receb: string;
}): string {
  return [
    o.cnpj ?? '00.000.000/0001-91',
    o.refer,
    String(o.versao),
    o.nome ?? 'BCO BRASIL S.A.',
    o.cvm ?? '001023',
    o.categ ?? 'ITR',
    o.idDoc,
    o.receb,
    `http://www.rad.cvm.gov.br/doc.aspx?n=${o.idDoc}`,
  ].join(';');
}

function singleRowMapsEveryField(): void {
  const out = parseCvmHeaderCsv(csv(row({ refer: '2024-03-31', versao: 1, idDoc: '136703', receb: '2024-05-08' })), SHA);

  assert.equal(out.filings.length, 1);
  const f = out.filings[0];
  assert.equal(f.issuerCvmCode, '1023', 'cvmCode normalizado perde os zeros à esquerda');
  assert.equal(f.documentType, 'ITR');
  assert.equal(f.cvmProtocol, '136703', 'ID_DOC é o protocolo');
  assert.equal(f.referenceDate, '2024-03-31');
  assert.equal(f.fiscalYear, 2024);
  assert.equal(f.fiscalQuarter, 1);
  assert.equal(f.isRestatement, false);
  assert.equal(f.supersedesCvmProtocol, null);
  assert.equal(f.rawSha256, SHA);
  assert.ok(f.sourceUrl.includes('136703'));

  // O ponto inteiro do trabalho: a data de PUBLICAÇÃO, não a do período.
  assert.equal(f.publishedAt.slice(0, 10), '2024-05-08', 'publishedAt vem de DT_RECEB');
  assert.equal(f.filedAt.slice(0, 10), '2024-05-08', 'filedAt vem de DT_RECEB');
  assert.notEqual(f.publishedAt.slice(0, 10), f.referenceDate, 'publicação nunca é a data contábil');

  console.log('parser: uma linha mapeia todos os campos, publishedAt = DT_RECEB — OK');
}

function restatementChainIsLinked(): void {
  // Caso real medido: BRB, ref 2024-06-30, v1 em 2024-11-22 e v2 em 2024-12-26.
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2024-06-30', versao: 2, idDoc: '143468', receb: '2024-12-26' }),
      row({ refer: '2024-06-30', versao: 1, idDoc: '139761', receb: '2024-11-22' }),
    ),
    SHA,
  );

  const byVersion = new Map(out.filings.map((f) => [f.cvmProtocol, f]));
  const v1 = byVersion.get('139761');
  const v2 = byVersion.get('143468');
  assert.ok(v1 && v2, 'as duas versões devem sobreviver ao parse');

  assert.equal(v1.isRestatement, false, 'a versão 1 não é retificação');
  assert.equal(v1.supersedesCvmProtocol, null);
  assert.equal(v2.isRestatement, true);
  assert.equal(v2.supersedesCvmProtocol, '139761', 'v2 aponta para o protocolo da v1');

  // A ordem das linhas no CSV não pode mudar o resultado — o arquivo real
  // não vem ordenado por versão.
  assert.equal(v1.publishedAt.slice(0, 10), '2024-11-22');
  assert.equal(v2.publishedAt.slice(0, 10), '2024-12-26');
  console.log('parser: cadeia de retificação encadeada por protocolo — OK');
}

function longRestatementChainLinksEachStep(): void {
  // BRB, ref 2024-06-30, teve QUATRO versões. Cada uma aponta para a
  // anterior, nunca todas para a primeira.
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2024-09-30', versao: 1, idDoc: '100', receb: '2024-12-03' }),
      row({ refer: '2024-09-30', versao: 3, idDoc: '300', receb: '2025-04-10' }),
      row({ refer: '2024-09-30', versao: 2, idDoc: '200', receb: '2025-04-09' }),
    ),
    SHA,
  );
  const by = new Map(out.filings.map((f) => [f.cvmProtocol, f]));
  assert.equal(by.get('100')?.supersedesCvmProtocol, null);
  assert.equal(by.get('200')?.supersedesCvmProtocol, '100');
  assert.equal(by.get('300')?.supersedesCvmProtocol, '200', 'v3 sucede a v2, não a v1');
  console.log('parser: cadeia longa encadeia passo a passo — OK');
}

function calendarFiscalYearGetsTheObviousQuarters(): void {
  // Exercício calendário: o ordinal cai exatamente em 03→1, 06→2, 09→3.
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2024-09-30', versao: 1, idDoc: 'c3', receb: '2024-11-11' }),
      row({ refer: '2024-03-31', versao: 1, idDoc: 'c1', receb: '2024-05-08' }),
      row({ refer: '2024-06-30', versao: 1, idDoc: 'c2', receb: '2024-08-09' }),
    ),
    SHA,
  );
  const by = new Map(out.filings.map((f) => [f.cvmProtocol, f]));
  assert.equal(by.get('c1')?.fiscalQuarter, 1);
  assert.equal(by.get('c2')?.fiscalQuarter, 2);
  assert.equal(by.get('c3')?.fiscalQuarter, 3);
  assert.equal(by.get('c1')?.fiscalYear, 2024);
  console.log('parser: exercício calendário → trimestres 1/2/3 — OK');
}

function nonCalendarFiscalYearIsHandled(): void {
  // Caso REAL que quebrou a primeira versão deste parser: CAMIL fecha o
  // exercício em fevereiro e entrega ITR em mai/ago/nov; JALLES MACHADO,
  // BRASILAGRO e CTC fecham em março e entregam em jun/set/dez. Derivar o
  // trimestre pelo mês trataria o ITR de dezembro como erro.
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2023-11-30', versao: 1, idDoc: 'k3', receb: '2024-01-10', cvm: '022691', nome: 'CAMIL ALIMENTOS S.A.' }),
      row({ refer: '2023-05-31', versao: 1, idDoc: 'k1', receb: '2023-07-10', cvm: '022691', nome: 'CAMIL ALIMENTOS S.A.' }),
      row({ refer: '2023-08-31', versao: 1, idDoc: 'k2', receb: '2023-10-10', cvm: '022691', nome: 'CAMIL ALIMENTOS S.A.' }),
      row({ refer: '2023-12-31', versao: 1, idDoc: 'j3', receb: '2024-02-14', cvm: '025771', nome: 'JALLES MACHADO S.A.' }),
      row({ refer: '2023-06-30', versao: 1, idDoc: 'j1', receb: '2023-08-14', cvm: '025771', nome: 'JALLES MACHADO S.A.' }),
      row({ refer: '2023-09-30', versao: 1, idDoc: 'j2', receb: '2023-11-14', cvm: '025771', nome: 'JALLES MACHADO S.A.' }),
    ),
    SHA,
  );
  const by = new Map(out.filings.map((f) => [f.cvmProtocol, f]));
  assert.deepEqual([by.get('k1')?.fiscalQuarter, by.get('k2')?.fiscalQuarter, by.get('k3')?.fiscalQuarter], [1, 2, 3]);
  assert.deepEqual([by.get('j1')?.fiscalQuarter, by.get('j2')?.fiscalQuarter, by.get('j3')?.fiscalQuarter], [1, 2, 3]);
  // O ITR de dezembro é o T3 do exercício, não um T4 nem um erro.
  assert.equal(by.get('j3')?.fiscalQuarter, 3, 'ITR de 31/12 é o terceiro trimestre do exercício');
  assert.equal(by.get('j3')?.fiscalYear, 2023);
  console.log('parser: exercício não-calendário (CAMIL, JALLES) → 1/2/3 — OK');
}

function eachIssuerIsCountedSeparately(): void {
  // O ordinal é por emissor: o T1 de uma empresa não desloca o da outra.
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2024-03-31', versao: 1, idDoc: 'a1', receb: '2024-05-08' }),
      row({ refer: '2024-06-30', versao: 1, idDoc: 'b2', receb: '2024-08-09', cvm: '009512', nome: 'PETROBRAS' }),
    ),
    SHA,
  );
  const by = new Map(out.filings.map((f) => [f.cvmProtocol, f]));
  assert.equal(by.get('a1')?.fiscalQuarter, 1);
  assert.equal(by.get('b2')?.fiscalQuarter, 1, 'primeiro ITR daquele emissor no pacote');
  console.log('parser: ordinal contado por emissor — OK');
}

function versionsDoNotInflateTheOrdinal(): void {
  // Um documento com 3 versões continua sendo UM trimestre. Contar linhas
  // em vez de datas distintas estouraria o limite e inventaria um T3.
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2024-03-31', versao: 1, idDoc: 'v1', receb: '2024-05-08' }),
      row({ refer: '2024-03-31', versao: 2, idDoc: 'v2', receb: '2024-06-08' }),
      row({ refer: '2024-03-31', versao: 3, idDoc: 'v3', receb: '2024-07-08' }),
    ),
    SHA,
  );
  assert.equal(out.filings.length, 3);
  for (const f of out.filings) assert.equal(f.fiscalQuarter, 1, 'as três versões são o mesmo T1');
  console.log('parser: versões não inflam o ordinal do trimestre — OK');
}

function fourthItrIsDroppedAndNamed(): void {
  // Dado REAL de 2011: ITAPEBI, GLOBAL BRASIL e CERAMICA CHIARELLI
  // entregaram quatro ITR (03/06/09/12). O schema não representa ITR de 4º
  // trimestre. Os três primeiros entram; o excedente sai NOMEADO, nunca em
  // silêncio e nunca derrubando o pacote inteiro.
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2011-03-31', versao: 1, idDoc: '1', receb: '2011-05-10', cvm: '019364', nome: 'ITAPEBI GERACAO' }),
      row({ refer: '2011-06-30', versao: 1, idDoc: '2', receb: '2011-08-10', cvm: '019364', nome: 'ITAPEBI GERACAO' }),
      row({ refer: '2011-09-30', versao: 1, idDoc: '3', receb: '2011-11-10', cvm: '019364', nome: 'ITAPEBI GERACAO' }),
      row({ refer: '2011-12-31', versao: 1, idDoc: '4', receb: '2012-02-10', cvm: '019364', nome: 'ITAPEBI GERACAO' }),
    ),
    SHA,
  );
  assert.equal(out.filings.length, 3, 'só os três primeiros são representáveis');
  assert.deepEqual(out.filings.map((f) => f.fiscalQuarter).sort(), [1, 2, 3]);
  assert.ok(!out.filings.some((f) => f.referenceDate === '2011-12-31'), 'o ITR de dezembro não entra');
  assert.equal(out.unrepresentable.length, 1, 'o descarte tem que ser reportado');
  assert.ok(out.unrepresentable[0].includes('2011-12-31'), 'e tem que dizer QUAL foi descartado');
  console.log('parser: quarto ITR do ano é descartado e nomeado — OK');
}

function dfpHasNoQuarter(): void {
  // Regra do schema: ITR exige trimestre 1..3; DFP exige nulo. O 4º
  // trimestre brasileiro chega pela DFP anual, não por um ITR de dezembro.
  const out = parseCvmHeaderCsv(
    csv(row({ refer: '2024-12-31', versao: 1, categ: 'DFP', idDoc: '999', receb: '2025-03-28' })),
    SHA,
  );
  assert.equal(out.filings[0].documentType, 'DFP');
  assert.equal(out.filings[0].fiscalQuarter, null, 'DFP não tem trimestre');
  console.log('parser: DFP entra sem trimestre — OK');
}

function issuersAreDeduplicated(): void {
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2024-03-31', versao: 1, idDoc: '1', receb: '2024-05-08' }),
      row({ refer: '2024-06-30', versao: 1, idDoc: '2', receb: '2024-08-08' }),
      row({ refer: '2024-03-31', versao: 1, idDoc: '3', receb: '2024-05-09', cvm: '009512', nome: 'PETROBRAS' }),
    ),
    SHA,
  );
  assert.equal(out.filings.length, 3);
  assert.equal(out.issuers.length, 2, 'a mesma empresa em vários trimestres é um emissor só');
  const codes = out.issuers.map((i) => i.cvmCode).sort();
  assert.deepEqual(codes, ['1023', '9512']);
  const bb = out.issuers.find((i) => i.cvmCode === '1023');
  assert.equal(bb?.name, 'BCO BRASIL S.A.');
  assert.equal(bb?.cnpj, '00000000000191', 'CNPJ guardado só com dígitos');
  console.log('parser: emissores deduplicados e CNPJ normalizado — OK');
}

function unknownDocumentTypeIsIgnored(): void {
  // Os ZIPs anuais trazem só ITR ou DFP, mas o portal tem outras
  // categorias. Ignorar em silêncio é melhor que falhar o lote inteiro —
  // e o retorno diz quantas linhas foram puladas, para não ser invisível.
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2024-03-31', versao: 1, idDoc: '1', receb: '2024-05-08' }),
      row({ refer: '2024-03-31', versao: 1, categ: 'FCA', idDoc: '2', receb: '2024-05-08' }),
    ),
    SHA,
  );
  assert.equal(out.filings.length, 1);
  assert.equal(out.skipped, 1, 'linha ignorada tem que ser contada');
  console.log('parser: categoria fora de ITR/DFP é pulada e contada — OK');
}

function malformedRowsFailLoud(): void {
  assert.throws(
    () => parseCvmHeaderCsv(csv(row({ refer: 'nao-e-data', versao: 1, idDoc: '1', receb: '2024-05-08' })), SHA),
    CvmHeaderParseError,
    'data de referência inválida deve falhar',
  );
  assert.throws(
    () => parseCvmHeaderCsv(csv(row({ refer: '2024-03-31', versao: 1, idDoc: '', receb: '2024-05-08' })), SHA),
    CvmHeaderParseError,
    'protocolo vazio deve falhar',
  );
  assert.throws(
    () => parseCvmHeaderCsv('CNPJ_CIA;DT_REFER\n1;2', SHA),
    CvmHeaderParseError,
    'cabeçalho sem as colunas exigidas deve falhar',
  );
  console.log('parser: linha malformada falha alto, sem lote parcial — OK');
}

function emptyFileYieldsNothing(): void {
  const out = parseCvmHeaderCsv(csv(), SHA);
  assert.deepEqual(out.filings, []);
  assert.deepEqual(out.issuers, []);
  assert.equal(out.skipped, 0);
  console.log('parser: arquivo só com cabeçalho devolve lote vazio — OK');
}

function parseIsDeterministic(): void {
  const text = csv(
    row({ refer: '2024-06-30', versao: 2, idDoc: '143468', receb: '2024-12-26' }),
    row({ refer: '2024-06-30', versao: 1, idDoc: '139761', receb: '2024-11-22' }),
    row({ refer: '2024-03-31', versao: 1, idDoc: '136703', receb: '2024-05-08' }),
  );
  assert.deepEqual(parseCvmHeaderCsv(text, SHA), parseCvmHeaderCsv(text, SHA));
  console.log('parser: determinístico — OK');
}

function sameDayRestatementsStayOrdered(): void {
  // Caso REAL: ENERGISA entregou a v1 e a v2 do ITR do 1T2023 ambas em
  // 2023-05-11. O domínio exige que a retificação seja estritamente
  // posterior; em meia-noite cravada as duas colidiriam. 24% dos
  // documentos multiversão do dado real caem neste caso.
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2023-03-31', versao: 2, idDoc: '126412', receb: '2023-05-11', cvm: '015253', nome: 'ENERGISA S.A.' }),
      row({ refer: '2023-03-31', versao: 1, idDoc: '126370', receb: '2023-05-11', cvm: '015253', nome: 'ENERGISA S.A.' }),
    ),
    SHA,
  );
  const by = new Map(out.filings.map((f) => [f.cvmProtocol, f]));
  const v1 = by.get('126370');
  const v2 = by.get('126412');
  assert.ok(v1 && v2);
  assert.ok(
    Date.parse(v2.publishedAt) > Date.parse(v1.publishedAt),
    'a v2 tem que ser estritamente posterior mesmo entregue no mesmo dia',
  );
  // E a data continua exata — o desempate vive abaixo do segundo.
  assert.equal(v1.publishedAt.slice(0, 10), '2023-05-11');
  assert.equal(v2.publishedAt.slice(0, 10), '2023-05-11');
  console.log('parser: versões no mesmo dia continuam ordenadas, data intacta — OK');
}

function duplicateVersionNumbersStillChain(): void {
  // Anomalia REAL: a DIBENS LEASING tem dois documentos do mesmo ITR ambos
  // marcados VERSAO=1, com protocolos diferentes e a mesma data. Ordenar
  // por VERSAO daria empate; a cadeia precisa sair da data de entrega.
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2023-09-30', versao: 1, idDoc: '132223', receb: '2023-11-10', cvm: '014214', nome: 'DIBENS LEASING S.A.' }),
      row({ refer: '2023-09-30', versao: 1, idDoc: '132214', receb: '2023-11-10', cvm: '014214', nome: 'DIBENS LEASING S.A.' }),
    ),
    SHA,
  );
  assert.equal(out.filings.length, 2);
  const ordered = [...out.filings].sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1));
  assert.ok(Date.parse(ordered[1].publishedAt) > Date.parse(ordered[0].publishedAt), 'instantes têm que diferir');
  assert.equal(ordered[0].isRestatement, false);
  assert.equal(ordered[1].isRestatement, true);
  assert.equal(ordered[1].supersedesCvmProtocol, ordered[0].cvmProtocol);
  console.log('parser: VERSAO repetida ainda encadeia por data — OK');
}

function laterFilingWinsEvenWithLowerVersion(): void {
  // Anomalia REAL mais dura: um emissor tem v1, v2 e um SEGUNDO v1
  // entregue meses DEPOIS da v2. Para point-in-time o que vale é quando o
  // documento chegou, não o rótulo de versão.
  const out = parseCvmHeaderCsv(
    csv(
      row({ refer: '2024-12-31', versao: 1, categ: 'DFP', idDoc: '146055', receb: '2025-03-31', cvm: '026824' }),
      row({ refer: '2024-12-31', versao: 1, categ: 'DFP', idDoc: '151243', receb: '2025-08-14', cvm: '026824' }),
      row({ refer: '2024-12-31', versao: 2, categ: 'DFP', idDoc: '146255', receb: '2025-04-08', cvm: '026824' }),
    ),
    SHA,
  );
  const ordered = [...out.filings].sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1));
  assert.deepEqual(
    ordered.map((f) => f.cvmProtocol),
    ['146055', '146255', '151243'],
    'a ordem é a das datas de entrega, não a dos números de versão',
  );
  assert.equal(ordered[0].supersedesCvmProtocol, null);
  assert.equal(ordered[1].supersedesCvmProtocol, '146055');
  assert.equal(ordered[2].supersedesCvmProtocol, '146255', 'o último entregue sucede o anterior no tempo');
  console.log('parser: entrega posterior vence rótulo de versão menor — OK');
}

function main(): void {
  singleRowMapsEveryField();
  restatementChainIsLinked();
  longRestatementChainLinksEachStep();
  sameDayRestatementsStayOrdered();
  duplicateVersionNumbersStillChain();
  laterFilingWinsEvenWithLowerVersion();
  calendarFiscalYearGetsTheObviousQuarters();
  nonCalendarFiscalYearIsHandled();
  eachIssuerIsCountedSeparately();
  versionsDoNotInflateTheOrdinal();
  fourthItrIsDroppedAndNamed();
  dfpHasNoQuarter();
  issuersAreDeduplicated();
  unknownDocumentTypeIsIgnored();
  malformedRowsFailLoud();
  emptyFileYieldsNothing();
  parseIsDeterministic();
  console.log('\nIngestão CVM point-in-time: TODOS OS TESTES PASSARAM');
}

main();
