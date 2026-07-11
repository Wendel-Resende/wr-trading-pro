"""Test MT5 options for PETR4"""
import MetaTrader5 as mt5
import sys
sys.stdout.reconfigure(encoding='utf-8')

if not mt5.initialize():
    print(f'MT5 init failed: {mt5.last_error()}')
    sys.exit(1)

# Test PETR4 spot
tick = mt5.symbol_info_tick('PETR4')
print(f'PETR4 - ask={tick.ask}, bid={tick.bid}, last={tick.last}')

# Get all symbols with PETR in name using group wildcard
syms = mt5.symbols_get(group='*PETR*')
print(f'Total symbols with PETR (group=*PETR*): {len(syms)}')

# Filter options
CALL_LETTERS = set('ABCDEFGHIJKLMNOPQRSTUVWX')
PUT_LETTERS = set('MNOPQRSTUVWXYZ')
calls, puts = 0, 0
opt_names = []
for s in syms:
    name = s.name
    if name == 'PETR4':
        continue
    if len(name) <= 5:
        continue
    letter = name[4] if len(name) > 4 else ''
    if letter in CALL_LETTERS:
        calls += 1
        opt_names.append((name, 'CALL'))
    elif letter in PUT_LETTERS:
        puts += 1
        opt_names.append((name, 'PUT'))

print(f'Calls: {calls}, Puts: {puts}')

# Select all and check bids
has_bid_calls = []
has_bid_puts = []
for name, otype in opt_names:
    mt5.symbol_select(name, True)

import time
time.sleep(0.5)

for name, otype in opt_names:
    tick = mt5.symbol_info_tick(name)
    if tick and tick.bid > 0:
        if otype == 'CALL':
            has_bid_calls.append((name, tick.bid, tick.ask))
        else:
            has_bid_puts.append((name, tick.bid, tick.ask))

print(f'Calls with bid>0: {len(has_bid_calls)}')
for n, b, a in has_bid_calls[:5]:
    print(f'  {n}: bid={b}, ask={a}')

print(f'Puts with bid>0: {len(has_bid_puts)}')
for n, b, a in has_bid_puts[:5]:
    print(f'  {n}: bid={b}, ask={a}')

mt5.shutdown()