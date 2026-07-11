"""Test MT5 options - check symbol naming"""
import MetaTrader5 as mt5
import sys
sys.stdout.reconfigure(encoding='utf-8')

if not mt5.initialize():
    print(f'MT5 init failed: {mt5.last_error()}')
    sys.exit(1)

# Get all symbols with PETR
syms = mt5.symbols_get(group='*PETR*')
print(f'Total: {len(syms)}')

# Show sample of symbols (first 30)
print('\nFirst 30 symbols:')
for s in syms[:30]:
    print(f'  {s.name}')

# Look at the unique patterns after PETR
patterns = {}
for s in syms:
    name = s.name
    if name == 'PETR4':
        continue
    if name.startswith('PETR'):
        rest = name[4:]
        if len(rest) >= 2:
            key = rest[:2]
            patterns[key] = patterns.get(key, 0) + 1

print(f'\nUnique patterns after PETR: {len(patterns)}')
for k, v in sorted(patterns.items(), key=lambda x: -x[1])[:20]:
    print(f'  PETR{k}: {v} symbols')

mt5.shutdown()