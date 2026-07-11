"""Test MT5 options for VALE3"""
import MetaTrader5 as mt5
import time
import sys
sys.stdout.reconfigure(encoding='utf-8')

if not mt5.initialize():
    print(f'MT5 init failed: {mt5.last_error()}')
    sys.exit(1)

# Test VALE3 spot
tick = mt5.symbol_info_tick('VALE3')
print(f'VALE3 - ask={tick.ask}, bid={tick.bid}, last={tick.last}')

# Get all symbols with VALE in name
syms = mt5.symbols_get(group='*VALE*')
print(f'Total symbols with VALE: {len(syms)}')

# F=call, R=put convention from Python script
CALL_SUFFIXES = set('FEG')
PUT_SUFFIXES = set('RQS')
calls, puts = 0, 0
opt_names = []
for s in syms:
    name = s.name
    if name == 'VALE3':
        continue
    if len(name) <= 5:
        continue
    # suffix is the 5th char (index 4): F/C/E=call, R/Q/P=put
    suffix = name[4] if len(name) > 4 else ''
    if suffix in CALL_SUFFIXES:
        calls += 1
        opt_names.append((name, 'CALL', suffix))
    elif suffix in PUT_SUFFIXES:
        puts += 1
        opt_names.append((name, 'PUT', suffix))

print(f'Calls (F/E/G suffix): {calls}, Puts (R/Q/S suffix): {puts}')

# Select all and check bids
has_bid_calls = []
has_bid_puts = []
for name, otype, suff in opt_names:
    mt5.symbol_select(name, True)

time.sleep(0.5)

for name, otype, suff in opt_names:
    tick = mt5.symbol_info_tick(name)
    if tick and tick.bid > 0:
        if otype == 'CALL':
            has_bid_calls.append((name, tick.bid, tick.ask))
        else:
            has_bid_puts.append((name, tick.bid, tick.ask))

print(f'Calls with bid>0: {len(has_bid_calls)}')
for n, b, a in sorted(has_bid_calls, key=lambda x: -x[1])[:5]:
    print(f'  {n}: bid={b}, ask={a}')

print(f'Puts with bid>0: {len(has_bid_puts)}')
for n, b, a in sorted(has_bid_puts, key=lambda x: -x[1])[:5]:
    print(f'  {n}: bid={b}, ask={a}')

mt5.shutdown()