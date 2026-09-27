import assert from 'node:assert/strict';
import { dedupeTickerSymbols, getTickerScrollLimit } from '../../src/lib/ticker-tape';

function assertLog(condition: unknown, message: string): void {
  assert.ok(condition, message);
  console.log(`ok: ${message}`);
}

function main(): void {
  assert.deepEqual(
    dedupeTickerSymbols(['petr4', 'PETR4', ' VALE3 ', '', 'vale3', 'ITUB4']),
    ['PETR4', 'VALE3', 'ITUB4'],
    'a faixa mostra cada ticker uma única vez, normalizado',
  );
  assert.deepEqual(dedupeTickerSymbols(['', '  ', 'PETR4']), ['PETR4'], 'descarta símbolos vazios');
  assert.equal(getTickerScrollLimit(600, 800), 0, 'conteúdo menor que a faixa não percorre área inexistente');
  assert.equal(getTickerScrollLimit(1800, 800), 1000, 'a rolagem termina no fim do conteúdo real');
  console.log('ticker-tape: TODOS OS TESTES PASSARAM');
}

main();
