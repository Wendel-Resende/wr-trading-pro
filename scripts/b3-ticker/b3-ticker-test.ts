import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  B3_TICKER_PATTERN,
  B3_TICKER_EXACT,
  b3TickerGlobal,
  isB3Ticker,
  canonicalizeB3Ticker,
} from '../../src/lib/b3-ticker';

function assertLog(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  console.log(`ok: ${msg}`);
}

function main(): void {
  // padrão exato aceita tickers reais, incluindo raiz com dígito
  for (const t of ['B3SA3', 'PETR4', 'VALE3', 'ENGI11', 'KLBN11', 'SANB11', 'BPAC11']) {
    assertLog(isB3Ticker(t), `${t} é ticker B3 válido`);
  }
  // rejeita número puro (crucial p/ extração de texto livre), lixo e formatos errados
  for (const bad of ['123456', '1234', 'ABC3', 'ABCDE3', 'PETR', 'PETR4X', 'petr4', '../etc', 'A/B', 'PETR-4', '']) {
    assertLog(!isB3Ticker(bad), `${bad || '(vazio)'} NÃO é ticker B3`);
  }
  // canonicalização: uppercase quando casa; DESCONHECIDO senão
  assertLog(canonicalizeB3Ticker(' b3sa3 ') === 'B3SA3', 'canonicaliza b3sa3 → B3SA3 (trim+upper)');
  assertLog(canonicalizeB3Ticker('../../SECRET') === 'DESCONHECIDO', 'path traversal → DESCONHECIDO');
  assertLog(canonicalizeB3Ticker('123456') === 'DESCONHECIDO', 'número puro → DESCONHECIDO');
  // extração de texto livre: pega ticker real, NUNCA número puro
  const hits: string[] =
    'o comitê analisou WEGE3 e B3SA3, com lucro de 123456 reais'.match(b3TickerGlobal()) ?? [];
  assertLog(hits.includes('WEGE3') && hits.includes('B3SA3'), 'extrai WEGE3 e B3SA3 do texto livre');
  assertLog(!hits.includes('123456'), 'extração NÃO captura número puro');
  // b3TickerGlobal() devolve instância fresca (sem lastIndex compartilhado)
  assertLog(b3TickerGlobal() !== b3TickerGlobal(), 'b3TickerGlobal() retorna nova instância a cada chamada');
  // o padrão exportado é o canônico
  assertLog(B3_TICKER_PATTERN === '[A-Z][A-Z0-9]{3}\\d{1,2}', 'B3_TICKER_PATTERN é o canônico');
  assertLog(B3_TICKER_EXACT.test('B3SA3'), 'B3_TICKER_EXACT casa B3SA3');

  // INVARIANTE CROSS-LANGUAGE: a guarda Python `_TICKER_RE` em python/ml_api.py
  // é uma cópia MANUAL do mesmo corpo canônico. Este teste lê a fonte Python e
  // trava o drift: se um lado mudar sem o outro, falha aqui. O corpo é idêntico;
  // as âncoras diferem de propósito — Python usa `\Z` (não `$`, que casa antes de
  // um `\n` final) para reproduzir a semântica do `$` do JS.
  const pySource = readFileSync(path.join(process.cwd(), 'python', 'ml_api.py'), 'utf8');
  const pyMatch = pySource.match(/_TICKER_RE\s*=\s*re\.compile\(r'([^']*)'\)/);
  assertLog(pyMatch !== null, '_TICKER_RE encontrado em python/ml_api.py');
  const pyFull = pyMatch![1]; // ex.: ^[A-Z][A-Z0-9]{3}\d{1,2}\Z
  const pyBody = pyFull.replace(/^\^/, '').replace(/\\Z$/, '');
  assertLog(
    pyBody === B3_TICKER_PATTERN,
    `corpo do _TICKER_RE Python ("${pyBody}") idêntico a B3_TICKER_PATTERN ("${B3_TICKER_PATTERN}")`,
  );
  assertLog(
    pyFull === `^${B3_TICKER_PATTERN}\\Z`,
    `_TICKER_RE Python ancorado com ^…\\Z (esperado "^${B3_TICKER_PATTERN}\\Z", obtido "${pyFull}")`,
  );

  console.log('b3-ticker: TODOS OS TESTES PASSARAM');
}

main();
