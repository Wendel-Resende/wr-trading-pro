import { redact, redactedString } from '@/lib/redact';

describe('redact', () => {
  it('masks password in objects', () => {
    const input = { login: 123, password: 'supersecret', server: 'X' };
    expect(redact(input)).toEqual({ login: 123, password: '***', server: 'X' });
  });

  it('masks nested api_key', () => {
    const input = { data: { api_key: 'abc', symbol: 'PETR4' } };
    expect(redact(input)).toEqual({ data: { api_key: '***', symbol: 'PETR4' } });
  });

  it('masks token in arrays', () => {
    const input = [{ token: 't1' }, { token: 't2' }];
    expect(redact(input)).toEqual([{ token: '***' }, { token: '***' }]);
  });

  it('serializes redacted without leaking', () => {
    const out = redactedString({ type: 'LOGIN', data: { password: 'pwned' } });
    expect(out).not.toContain('pwned');
    expect(out).toContain('***');
  });
});
