import assert from 'node:assert/strict';
import {
  DEFAULT_ACTIVE_INSTRUMENT,
  addFavorite,
  deserializeWorkspaceInstrument,
  normalizeWorkspaceInstrument,
  removeFavorite,
  serializeWorkspaceInstrument,
  type WorkspaceInstrumentState,
} from '../../src/lib/workspace/instrument-state';

function assertLog(condition: unknown, message: string): void {
  assert.ok(condition, message);
  console.log(`ok: ${message}`);
}

function main(): void {
  assertLog(DEFAULT_ACTIVE_INSTRUMENT === 'PETR4', 'fallback explícito é PETR4');
  assertLog(normalizeWorkspaceInstrument(' petr4 ') === 'PETR4', 'normaliza ticker B3');
  assertLog(normalizeWorkspaceInstrument('b3sa3') === 'B3SA3', 'aceita ticker B3 com dígito na raiz');
  assertLog(normalizeWorkspaceInstrument('../../secret') === null, 'rejeita valor inseguro');
  assertLog(normalizeWorkspaceInstrument('') === null, 'rejeita vazio');

  const first = addFavorite(['VALE3'], 'petr4');
  assert.deepEqual(first, ['PETR4', 'VALE3'], 'inclui favorito normalizado no início');
  assert.deepEqual(addFavorite(first, 'PETR4'), first, 'não duplica favorito');
  assert.deepEqual(removeFavorite(first, 'petr4'), ['VALE3'], 'remove favorito por forma canônica');
  assert.deepEqual(removeFavorite(first, 'invalido'), first, 'ignora remoção inválida');

  const state: WorkspaceInstrumentState = { activeSymbol: 'VALE3', favorites: ['PETR4', 'VALE3'] };
  assert.deepEqual(deserializeWorkspaceInstrument(serializeWorkspaceInstrument(state)), state, 'serialização é reversível');
  assert.deepEqual(
    deserializeWorkspaceInstrument('{inválido'),
    { activeSymbol: DEFAULT_ACTIVE_INSTRUMENT, favorites: [] },
    'JSON corrompido retorna estado seguro',
  );
  assert.deepEqual(
    deserializeWorkspaceInstrument('{"activeSymbol":"../bad","favorites":["PETR4","petr4","bad"]}'),
    { activeSymbol: DEFAULT_ACTIVE_INSTRUMENT, favorites: ['PETR4'] },
    'estado inválido não atravessa storage',
  );
  console.log('workspace-instrument: TODOS OS TESTES PASSARAM');
}

main();
