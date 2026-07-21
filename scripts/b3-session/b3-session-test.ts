import {
  b3DailyCloseKnowledgeInstant,
  emptyB3SessionCalendar,
  endOfUtcCivilDay,
  staticB3SessionCalendar,
} from '../../src/domain/v1/time/b3-session';

let passed = 0;
const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
};
const assertThrows = (fn: () => void, message: string): void => {
  try {
    fn();
    throw new Error(`FAIL (expected throw): ${message}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('FAIL')) throw error;
    passed += 1;
  }
};

// caminho feliz: calendário vazio cai no fim do dia civil.
assert(
  b3DailyCloseKnowledgeInstant('2026-07-20T00:00:00.000Z', emptyB3SessionCalendar()) === '2026-07-20T23:59:59.999Z',
  'fallback fim de dia civil',
);
assert(endOfUtcCivilDay('2026-07-20T00:00:00.000Z') === '2026-07-20T23:59:59.999Z', 'endOfUtcCivilDay');

// caminho feliz: entrada de calendário válida é usada exatamente.
const cal = staticB3SessionCalendar({ '2026-07-20': '2026-07-20T21:05:00.000Z' });
assert(
  b3DailyCloseKnowledgeInstant('2026-07-20T00:00:00.000Z', cal) === '2026-07-20T21:05:00.000Z',
  'entrada de calendário usada exatamente',
);

// G-003 item 2: tradingDayUtcMidnight não-UTC (offset +/-) é rejeitado.
assertThrows(
  () => b3DailyCloseKnowledgeInstant('2026-07-20T00:00:00.000-03:00', emptyB3SessionCalendar()),
  'tradingDayUtcMidnight não-UTC deve ser rejeitado',
);

// tradingDayUtcMidnight naive/malformado é rejeitado.
assertThrows(
  () => b3DailyCloseKnowledgeInstant('not-a-date', emptyB3SessionCalendar()),
  'tradingDayUtcMidnight malformado deve ser rejeitado',
);

// tradingDayUtcMidnight que não é meia-noite exata é rejeitado.
assertThrows(
  () => b3DailyCloseKnowledgeInstant('2026-07-20T12:00:00.000Z', emptyB3SessionCalendar()),
  'tradingDayUtcMidnight fora da meia-noite deve ser rejeitado',
);

// entrada de calendário não-UTC é rejeitada na construção do calendário.
assertThrows(
  () => staticB3SessionCalendar({ '2026-07-20': '2026-07-20T21:05:00.000-03:00' }),
  'entrada de calendário não-UTC deve ser rejeitada',
);

// entrada de calendário anterior ao início da barra (dia civil anterior) é rejeitada.
assertThrows(
  () => staticB3SessionCalendar({ '2026-07-20': '2026-07-19T23:00:00.000Z' }),
  'entrada de calendário anterior ao início da barra deve ser rejeitada',
);

// entrada de calendário fora do dia civil da chave (dia seguinte) é rejeitada.
assertThrows(
  () => staticB3SessionCalendar({ '2026-07-20': '2026-07-21T00:00:00.000Z' }),
  'entrada de calendário fora do dia civil deve ser rejeitada',
);

// G-007 item 1: tradingDayUtcMidnight com fração sub-milissegundo (microssegundos)
// deve ser rejeitado — não é meia-noite UTC exata.
assertThrows(
  () => b3DailyCloseKnowledgeInstant('2026-07-20T00:00:00.000001Z', emptyB3SessionCalendar()),
  'tradingDayUtcMidnight com microssegundos deve ser rejeitado',
);

console.log(`b3-session-test: OK (${passed} assertions)`);
