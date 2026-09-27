import assert from 'node:assert/strict';
import { nextSortDirection, sortRows, type SortDirection } from '../../src/lib/table-sort';

function main(): void {
  assert.equal(nextSortDirection(null), 'asc');
  assert.equal(nextSortDirection('asc'), 'desc');
  assert.equal(nextSortDirection('desc'), null);

  const source = [
    { ticker: 'VALE3', score: 4, label: 'B' },
    { ticker: 'PETR4', score: null, label: 'A' },
    { ticker: 'ITUB4', score: 4, label: 'C' },
    { ticker: 'ABEV3', score: 1, label: 'D' },
  ];
  const asc = sortRows(source, (row) => row.score, 'asc');
  assert.deepEqual(asc.map((row) => row.ticker), ['ABEV3', 'VALE3', 'ITUB4', 'PETR4']);
  assert.deepEqual(source.map((row) => row.ticker), ['VALE3', 'PETR4', 'ITUB4', 'ABEV3']);
  const desc = sortRows(source, (row) => row.score, 'desc');
  assert.deepEqual(desc.map((row) => row.ticker), ['VALE3', 'ITUB4', 'ABEV3', 'PETR4']);
  assert.deepEqual(sortRows(source, (row) => row.label, 'asc').map((row) => row.label), ['A', 'B', 'C', 'D']);
  console.log('table-sort: TODOS OS TESTES PASSARAM');
}

main();
