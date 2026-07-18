"""
Scanner de Opções B3 — Covered Call & Cash-Secured Put
Filtro inteligente: apenas strikes na faixa útil, prêmio anualizado,
melhores oportunidades para capital de R$10k.

Regra: usa BID para vender (realista), não mid/ask.
"""
import MetaTrader5 as mt5
from datetime import datetime
import json
import math
from pathlib import Path
import sqlite3
import sys
sys.stdout.reconfigure(encoding='utf-8')

# === CONFIG ===
CAPITAL = 10_000  # R$ disponível
LOT_SIZE = 100    # 1 lote B3 = 100 ações
RANGE_PCT = 0.10  # ±10% do preço spot
MIN_PREMIO_ANUALIZADO = 0.05  # mínimo 5% ao ano para considerar
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / 'data' / 'options' / 'options_data.db'

# B3 month letters (CORRIGIDO: alinha com dashboard de referência)
CALL_LETTERS = set('ABCDEFGH')   # A-H = CALL (8 letras)
PUT_LETTERS  = set('JKLMNOPQR')  # J-R = PUT (9 letras)


def parse_strike(symbol):
    """Extrai strike de símbolo B3 (genérico para qualquer ativo: PETR4, VALE3, etc.)
    Extrai os dígitos do final, ignora letras do meio.
    PETRF480 -> 48.00, VALEG420 -> 42.00
    """
    name = symbol.replace('.BVSP', '').replace('.B3', '')
    digits = ''
    for ch in reversed(name):
        if ch.isdigit():
            digits = ch + digits
        else:
            break
    if digits:
        val = int(digits)
        return val / 100.0 if val >= 1000 else val / 10.0
    return 0


def determine_type(symbol, spot):
    """Determina CALL/PUT extraindo a letra mês (genérico).
    Extrai a letra antes do strike (última letra não-dígito).
    """
    base = symbol.rstrip('0123456789')
    if len(base) < 2:
        return 'UNKNOWN', 0
    month_letter = base[-1].upper()
    strike = parse_strike(symbol)
    if month_letter in CALL_LETTERS:
        return 'CALL', strike
    elif month_letter in PUT_LETTERS:
        return 'PUT', strike
    return 'UNKNOWN', strike


def get_dte(exp_ts):
    exp = get_expiry_datetime(exp_ts)
    if not exp:
        return 999
    return max(0, (exp - datetime.now()).days)


def get_expiry_datetime(exp_ts):
    if not exp_ts:
        return None
    try:
        return datetime.fromtimestamp(exp_ts)
    except (OSError, OverflowError, ValueError):
        return None


def anualizar(premio_por_acao, strike, dte):
    """Prêmio anualizado = (premio / strike) * (365 / dte) (fração, dashboard ref)"""
    if dte <= 0 or strike <= 0:
        return 0
    return (premio_por_acao / strike) * (365 / dte)


def norm_cdf(x):
    """Approximate standard normal CDF."""
    a1, a2, a3, a4, a5 = 0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429
    p = 0.3275911
    sign = 1 if x >= 0 else -1
    x = abs(x) / math.sqrt(2)
    t = 1.0 / (1.0 + p * x)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-x * x)
    return 0.5 * (1.0 + sign * y)


def calc_exercise_prob(spot, strike, dte, daily_std, opt_type):
    """Probabilidade simplificada de encerrar ITM no vencimento."""
    if spot <= 0 or strike <= 0 or dte <= 0 or daily_std is None or daily_std <= 0:
        return None
    sigma = daily_std * math.sqrt(dte)
    if sigma <= 0:
        return None
    d = math.log(strike / spot) / sigma
    prob = 1 - norm_cdf(d) if opt_type == 'CALL' else norm_cdf(d)
    return round(prob * 100, 1)


def stdev(values):
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1))


def get_volatility(asset):
    """Volatilidade diaria/anualizada por candles D1, alinhada ao dashboard."""
    rates = mt5.copy_rates_from_pos(asset, mt5.TIMEFRAME_D1, 0, 60)
    if rates is None or len(rates) < 10:
        return {}

    closes = [float(r['close']) for r in rates if float(r['close']) > 0]
    if len(closes) < 10:
        return {}

    returns = [(closes[i] / closes[i - 1]) - 1 for i in range(1, len(closes))]
    ret_30 = returns[-30:] if len(returns) >= 30 else returns
    daily_std = stdev(returns)
    mean_30d = sum(ret_30) / len(ret_30) if ret_30 else 0.0
    std_30d = stdev(ret_30)
    annual_std = daily_std * math.sqrt(252)
    prev_close = closes[-6] if len(closes) >= 6 else closes[0]
    weekly_pct = ((closes[-1] - prev_close) / prev_close) * 100 if prev_close > 0 else 0.0

    return {
        'daily_std': daily_std,
        'mean_30d': mean_30d,
        'std_30d': std_30d,
        'annual_std': annual_std,
        'weekly_pct': weekly_pct,
        'last_close': closes[-1],
        'n_candles': len(closes),
    }


def get_spot(asset):
    """Preco spot com fallback para last/ask/bid, tolerante a fim de semana."""
    mt5.symbol_select(asset, True)
    tick = mt5.symbol_info_tick(asset)
    if tick:
        for price in (tick.ask, tick.last, tick.bid):
            if price and price > 0:
                return price

    info = mt5.symbol_info(asset)
    if info:
        for price in (info.ask, info.last, info.bid):
            if price and price > 0:
                return price
    return 0.0


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute('''CREATE TABLE IF NOT EXISTS scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset TEXT,
        scanned_at TEXT,
        spot REAL,
        vol_data TEXT
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id INTEGER REFERENCES scans(id),
        symbol TEXT,
        strike REAL,
        bid REAL,
        ask REAL,
        spread_pct REAL,
        otm_pct REAL,
        dte INTEGER,
        venc TEXT,
        tipo TEXT,
        estilo TEXT,
        anual_pct REAL,
        p_exerc REAL,
        custo_r REAL,
        cabe_10k INTEGER,
        cabe_capital INTEGER,
        opt_type TEXT
    )''')
    existing_columns = {row[1] for row in conn.execute('PRAGMA table_info(options)').fetchall()}
    if 'cabe_10k' not in existing_columns:
        conn.execute('ALTER TABLE options ADD COLUMN cabe_10k INTEGER')
    if 'cabe_capital' not in existing_columns:
        conn.execute('ALTER TABLE options ADD COLUMN cabe_capital INTEGER')
    conn.commit()
    conn.close()


def save_scan(asset, spot, vol_data, calls, puts):
    """Salva somente o scan mais recente de cada ativo, como no dashboard base."""
    init_db()
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    cur.execute('SELECT id FROM scans WHERE asset = ? ORDER BY id DESC LIMIT 1', (asset,))
    old = cur.fetchone()
    if old:
        cur.execute('DELETE FROM options WHERE scan_id = ?', (old[0],))
        cur.execute('DELETE FROM scans WHERE id = ?', (old[0],))

    serializable_vol = {
        k: float(v) if isinstance(v, (int, float)) else v
        for k, v in (vol_data or {}).items()
    }
    cur.execute(
        'INSERT INTO scans (asset, scanned_at, spot, vol_data) VALUES (?,?,?,?)',
        (asset, datetime.now().isoformat(), spot, json.dumps(serializable_vol, default=str)),
    )
    scan_id = cur.lastrowid

    for rows, opt_type in ((calls, 'CALL'), (puts, 'PUT')):
        for row in rows:
            cur.execute('''INSERT INTO options
                (scan_id, symbol, strike, bid, ask, spread_pct, otm_pct, dte, venc,
                 tipo, estilo, anual_pct, p_exerc, custo_r, cabe_10k, cabe_capital, opt_type)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (
                    scan_id, row['symbol'], row['strike'], row['bid'], row['ask'],
                    row['spread_pct'], row['otm_pct'], row['dte'], row['venc'],
                    row['tipo_venc'], row['estilo'], row['anual'] * 100,
                    row['p_exerc'] if row['p_exerc'] is not None else 0,
                    row['custo'], 1 if row['cabe_10k'] else 0,
                    1 if row['cabe_10k'] else 0, opt_type,
                ))

    conn.commit()
    conn.close()
    return scan_id


def is_weekly(symbol):
    clean = symbol.rstrip('0123456789')
    return clean.endswith('W')


def get_opt_style(info):
    mode = getattr(info, 'option_mode', None)
    if mode is None:
        return 'N/A'
    return 'AMERICANA' if mode == 1 else 'EUROPEIA'


def discover_options(asset):
    """Busca opcoes por lista geral e wildcard, como no dashboard de referencia."""
    base = asset.rstrip('0123456789')
    raw = {}

    all_syms = mt5.symbols_get()
    if all_syms:
        for s in all_syms:
            if base in s.name and s.name != asset:
                raw[s.name] = s

    group_syms = mt5.symbols_get(group=f'*{base}*')
    if group_syms:
        for s in group_syms:
            if s.name != asset:
                raw[s.name] = s

    options = []
    for s in raw.values():
        name_part = s.name[len(base):] if s.name.startswith(base) else ''
        if not name_part:
            continue
        tipo, strike = determine_type(s.name, 0)
        if tipo == 'UNKNOWN' or strike <= 0:
            continue
        if mt5.symbol_select(s.name, True):
            options.append(s)
    return options


def _collect_raw_options(symbol, spot, range_pct, capital):
    """Coleta as opções cruas (dentro da faixa OTM) para `symbol` — extraído
    do corpo original de `scanner()` para ser reutilizado por `scan_options`
    (rota `POST /api/options/scan`) sem duplicar a lógica de filtro OTM.
    Requer MT5 já inicializado; não fecha a conexão (chamador decide).
    Retorna `(vol_data, calls, puts)` no mesmo formato usado pelo CLI.
    """
    vol_data = get_volatility(symbol)
    daily_std = vol_data.get('daily_std') if vol_data else None

    option_symbols = discover_options(symbol)

    all_opts = []
    for s in option_symbols:
        info = mt5.symbol_info(s.name)
        if not info:
            continue
        tipo, strike = determine_type(s.name, spot)
        if tipo == 'UNKNOWN':
            continue
        dte = get_dte(s.expiration_time)
        if not (spot * (1 - range_pct) <= strike <= spot * (1 + range_pct)):
            continue
        if tipo == 'CALL' and strike <= spot:
            continue
        if tipo == 'PUT' and strike >= spot:
            continue

        bid = info.bid
        ask = info.ask
        last = info.last
        premium = bid if bid > 0 else ask if ask > 0 else last
        if premium <= 0:
            continue
        ask_for_spread = ask if ask > 0 else premium
        spread_pct = ((ask_for_spread - premium) / ask_for_spread * 100) if ask_for_spread > 0 else 0
        otm_pct = abs(strike - spot) / spot * 100
        p_exerc = calc_exercise_prob(spot, strike, dte, daily_std, tipo)
        anual = anualizar(premium, strike, dte)
        exp = get_expiry_datetime(s.expiration_time)

        all_opts.append({
            'symbol': s.name, 'tipo': tipo, 'strike': strike,
            'bid': premium, 'ask': ask_for_spread, 'dte': dte,
            'exp': exp, 'venc': exp.strftime('%Y-%m-%d') if exp else 'N/A',
            'spread_pct': spread_pct, 'otm_pct': otm_pct, 'p_exerc': p_exerc,
            'anual': anual,
            'tipo_venc': 'Sem' if is_weekly(s.name) else 'Men',
            'estilo': get_opt_style(info),
            'custo': strike * LOT_SIZE,
            'cabe_10k': (strike * LOT_SIZE) <= capital,
        })

    calls = [o for o in all_opts if o['tipo'] == 'CALL']
    puts = [o for o in all_opts if o['tipo'] == 'PUT']
    return vol_data, calls, puts


def _build_offers(calls, puts, spot, capital):
    """Constrói as listas resumidas (covered call / cash-secured put) a
    partir das opções cruas de `_collect_raw_options` — mesma lógica usada
    no loop de impressão do CLI, sem os `print`.
    """
    cc_best = []
    for c in sorted(calls, key=lambda x: (x['dte'], abs(x['strike'] - spot))):
        if c['bid'] <= 0:
            continue
        premio_total = c['bid'] * LOT_SIZE
        anual = anualizar(c['bid'], c['strike'], c['dte'])
        exp_str = c['exp'].strftime('%Y-%m-%d') if c['exp'] else '?'
        roi = premio_total / capital * 100 if capital > 0 else 0
        otm = (c['strike'] - spot) / spot * 100
        cc_best.append({
            'symbol': c['symbol'], 'exp': exp_str, 'dte': c['dte'],
            'strike': c['strike'], 'bid': c['bid'], 'otm_pct': otm,
            'premio_total': premio_total, 'anual': anual, 'roi': roi,
            'p_exerc': c['p_exerc'], 'spread_pct': c['spread_pct'],
        })

    csp_best = []
    for p in sorted(puts, key=lambda x: (x['dte'], abs(x['strike'] - spot))):
        if p['bid'] <= 0:
            continue
        premio_total = p['bid'] * LOT_SIZE
        margem = p['strike'] * LOT_SIZE
        anual = anualizar(p['bid'], p['strike'], p['dte'])
        exp_str = p['exp'].strftime('%Y-%m-%d') if p['exp'] else '?'
        roi = premio_total / margem * 100 if margem > 0 else 0
        otm = (spot - p['strike']) / spot * 100
        csp_best.append({
            'symbol': p['symbol'], 'exp': exp_str, 'dte': p['dte'],
            'strike': p['strike'], 'bid': p['bid'], 'otm_pct': otm,
            'premio_total': premio_total, 'anual': anual, 'roi': roi,
            'margem': margem, 'cabe': margem <= capital,
            'p_exerc': p['p_exerc'], 'spread_pct': p['spread_pct'],
        })
    return cc_best, csp_best


def _build_top(cc_best, csp_best, min_annual):
    """Combina covered calls + cash-secured puts e devolve o top 5 por
    prêmio anualizado (>= `min_annual`; se nenhum atingir o mínimo, cai
    para o top 5 geral — mesmo comportamento do CLI original)."""
    combined = []
    for c in cc_best:
        combined.append({**c, 'tipo': 'COVERED CALL', 'nota': f"OTM {c['otm_pct']:+.1f}%"})
    for p in csp_best:
        combined.append({**p, 'tipo': 'CASH-SECURED PUT', 'nota': f"OTM {p['otm_pct']:+.1f}% | {'cabe' if p['cabe'] else 'NÃO cabe no capital'}"})
    combined.sort(key=lambda x: (x['anual'], -x.get('spread_pct', 999)), reverse=True)
    return [o for o in combined if o['anual'] >= min_annual][:5] or combined[:5]


def scan_options(symbol='PETR4', capital=CAPITAL, strike_range_pct=None, min_annual_pct=None):
    """Núcleo do scan, extraído para ser chamável tanto pelo CLI (`scanner`)
    quanto pela rota `POST /api/options/scan` de `spread_api.py`.

    `strike_range_pct`/`min_annual_pct` são frações decimais (0.10 = 10%),
    mesma unidade de `RANGE_PCT`/`MIN_PREMIO_ANUALIZADO`.
    Levanta `RuntimeError` se o MT5 não estiver disponível/conectado ou o
    spot não puder ser obtido — o chamador decide como traduzir isso
    (a rota Flask devolve 503 MT5_DISCONNECTED).

    Retorna `{spot, volatility, calls, puts, top}` e persiste o scan no
    banco `data/options/options_data.db`, exatamente como o CLI fazia
    (mesma regra OTM: CALL com strike > spot, PUT com strike < spot).
    """
    range_pct = RANGE_PCT if strike_range_pct is None else strike_range_pct
    min_annual = MIN_PREMIO_ANUALIZADO if min_annual_pct is None else min_annual_pct

    if not mt5.initialize():
        raise RuntimeError(f"MT5 não disponível/conectado: {mt5.last_error()}")
    try:
        spot = get_spot(symbol)
        if spot <= 0:
            raise RuntimeError(f"não foi possível obter preço spot para {symbol}")

        vol_data, calls, puts = _collect_raw_options(symbol, spot, range_pct, capital)
        cc_best, csp_best = _build_offers(calls, puts, spot, capital)
        top = _build_top(cc_best, csp_best, min_annual)
        scan_id = save_scan(symbol, spot, vol_data, calls, puts)
    finally:
        mt5.shutdown()

    return {
        'spot': spot,
        'volatility': vol_data,
        'calls': cc_best,
        'puts': csp_best,
        'top': top,
        'scan_id': scan_id,
    }


def scanner(asset='PETR4'):
    if not mt5.initialize():
        print(f"ERRO MT5: {mt5.last_error()}")
        return

    spot = get_spot(asset)
    if spot <= 0:
        print(f"ERRO: nao foi possivel obter preco spot para {asset}")
        mt5.shutdown()
        return

    print(f"{asset} spot: R${spot:.2f}")
    print(f"Capital: R${CAPITAL:,.0f} | Lote: {LOT_SIZE} | Max ações: {CAPITAL // (int(spot) * LOT_SIZE)} lotes")
    print(f"Faixa de strikes: R${spot * (1 - RANGE_PCT):.2f} — R${spot * (1 + RANGE_PCT):.2f}\n")

    vol_data, calls, puts = _collect_raw_options(asset, spot, RANGE_PCT, CAPITAL)
    if vol_data:
        print(
            f"Volatilidade: diária {vol_data['daily_std']:.2%} | "
            f"anual {vol_data['annual_std']:.2%} | "
            f"5 pregões {vol_data['weekly_pct']:+.2f}% | "
            f"candles {vol_data['n_candles']}\n"
        )
    else:
        print("Volatilidade: indisponível (candles D1 insuficientes)\n")

    print(f"Opções na faixa: {len(calls)} calls, {len(puts)} puts")

    # === COVERED CALLS (Vender CALL,持有 ações) ===
    print(f"\n{'=' * 90}")
    print(f"  📈 COVERED CALLS — Vender CALL (receber prêmio, manter ações)")
    print(f"  Setup: Comprar {LOT_SIZE} {asset} + Vender 1 CALL. Custo = spot × {LOT_SIZE}")
    print(f"{'=' * 90}")
    print(f"  {'VENC':>12} {'DTE':>4} {'STRIKE':>8} {'BID':>8} {'PREMIO':>10} {'ANUAL%':>8} {'P.EX%':>7} {'CUSTO':>10} {'ROI':>8}")
    print(f"  {'-' * 12} {'-' * 4} {'-' * 8} {'-' * 8} {'-' * 10} {'-' * 8} {'-' * 7} {'-' * 10} {'-' * 8}")

    cc_best = []
    for c in sorted(calls, key=lambda x: (x['dte'], abs(x['strike'] - spot))):
        if c['bid'] <= 0:
            continue
        premio_total = c['bid'] * LOT_SIZE
        custo_acoes = spot * LOT_SIZE
        premio_pct = premio_total / custo_acoes
        anual = anualizar(c['bid'], c['strike'], c['dte'])
        exp_str = c['exp'].strftime('%Y-%m-%d') if c['exp'] else '?'

        # ROI no capital investido
        roi = premio_total / CAPITAL * 100 if CAPITAL > 0 else 0

        marker = '⭐' if anual >= MIN_PREMIO_ANUALIZADO else ''
        otm = (c['strike'] - spot) / spot * 100
        p_exerc_str = f"{c['p_exerc']:.1f}%" if c['p_exerc'] is not None else "N/A"
        print(f"  {exp_str:>12} {c['dte']:>4} R${c['strike']:>6.2f} R${c['bid']:>6.2f} R${premio_total:>8.0f} {anual:>7.1%} {p_exerc_str:>7} R${custo_acoes:>8.0f} {roi:>7.2f}%{marker}")

        cc_best.append({
            'symbol': c['symbol'], 'exp': exp_str, 'dte': c['dte'],
            'strike': c['strike'], 'bid': c['bid'], 'otm_pct': otm,
            'premio_total': premio_total, 'anual': anual, 'roi': roi,
            'p_exerc': c['p_exerc'], 'spread_pct': c['spread_pct'],
        })

    # === CASH-SECURED PUTS (Vender PUT, receber prêmio, obrigação de comprar) ===
    print(f"\n{'=' * 90}")
    print(f"  📉 CASH-SECURED PUTS — Vender PUT (receber prêmio, obrigação de comprar ao strike)")
    print(f"  Setup: Margem ≈ strike × {LOT_SIZE}. Lucro máximo = prêmio recebido.")
    print(f"{'=' * 90}")
    print(f"  {'VENC':>12} {'DTE':>4} {'STRIKE':>8} {'BID':>8} {'PREMIO':>10} {'ANUAL%':>8} {'P.EX%':>7} {'MARGEM':>10} {'ROI':>8}")
    print(f"  {'-' * 12} {'-' * 4} {'-' * 8} {'-' * 8} {'-' * 10} {'-' * 8} {'-' * 7} {'-' * 10} {'-' * 8}")

    csp_best = []
    for p in sorted(puts, key=lambda x: (x['dte'], abs(x['strike'] - spot))):
        if p['bid'] <= 0:
            continue
        premio_total = p['bid'] * LOT_SIZE
        margem = p['strike'] * LOT_SIZE
        premio_pct = premio_total / margem
        anual = anualizar(p['bid'], p['strike'], p['dte'])
        exp_str = p['exp'].strftime('%Y-%m-%d') if p['exp'] else '?'
        roi = premio_total / margem * 100

        # Verificar se cabe no capital
        cabe = '✅' if margem <= CAPITAL else '❌'

        marker = '⭐' if anual >= MIN_PREMIO_ANUALIZADO else ''
        otm = (spot - p['strike']) / spot * 100
        p_exerc_str = f"{p['p_exerc']:.1f}%" if p['p_exerc'] is not None else "N/A"
        print(f"  {exp_str:>12} {p['dte']:>4} R${p['strike']:>6.2f} R${p['bid']:>6.2f} R${premio_total:>8.0f} {anual:>7.1%} {p_exerc_str:>7} R${margem:>8.0f} {roi:>7.2f}%{cabe}{marker}")

        csp_best.append({
            'symbol': p['symbol'], 'exp': exp_str, 'dte': p['dte'],
            'strike': p['strike'], 'bid': p['bid'], 'otm_pct': otm,
            'premio_total': premio_total, 'anual': anual, 'roi': roi,
            'margem': margem, 'cabe': margem <= CAPITAL,
            'p_exerc': p['p_exerc'], 'spread_pct': p['spread_pct'],
        })

    # === TOP 5 MELHORES OPORTUNIDADES ===
    print(f"\n{'=' * 90}")
    print(f"  🏆 TOP 5 — Melhores oportunidades (prêmio anualizado, BID realista)")
    print(f"{'=' * 90}")

    combined = []
    for c in cc_best:
        combined.append({**c, 'tipo': 'COVERED CALL', 'nota': f"OTM {c['otm_pct']:+.1f}%"})
    for p in csp_best:
        combined.append({**p, 'tipo': 'CASH-SECURED PUT', 'nota': f"OTM {p['otm_pct']:+.1f}% | {'cabe' if p['cabe'] else 'NÃO cabe no capital'}"})

    combined.sort(key=lambda x: (x['anual'], -x.get('spread_pct', 999)), reverse=True)

    for i, opp in enumerate(combined[:5], 1):
        print(f"  #{i} {opp['tipo']}")
        print(f"      {opp['symbol']} | Venc: {opp['exp']} ({opp['dte']} DTE) | Strike: R${opp['strike']:.2f}")
        print(f"      Venda a BID: R${opp['bid']:.2f} → Prêmio: R${opp['premio_total']:.0f}")
        p_exerc_str = f"{opp['p_exerc']:.1f}%" if opp.get('p_exerc') is not None else "N/A"
        print(f"      Anualizado: {opp['anual']:.1%} | P.Exerc: {p_exerc_str} | ROI: {opp['roi']:.2f}% | {opp['nota']}")
        print()

    # === ALERTAS ===
    print(f"{'=' * 90}")
    print(f"  ⚠️  ALERTAS DE QUALIDADE")
    print(f"{'=' * 90}")

    # Spread analysis
    wide_spreads = []
    for c in calls:
        if c['bid'] > 0 and c['ask'] > 0:
            spread_pct = (c['ask'] - c['bid']) / c['bid'] * 100
            if spread_pct > 50:
                wide_spreads.append((c['symbol'], spread_pct, c['bid'], c['ask']))
    for p in puts:
        if p['bid'] > 0 and p['ask'] > 0:
            spread_pct = (p['ask'] - p['bid']) / p['bid'] * 100
            if spread_pct > 50:
                wide_spreads.append((p['symbol'], spread_pct, p['bid'], p['ask']))

    if wide_spreads:
        print(f"  ❌ {len(wide_spreads)} opções com spread > 50% (liquidez baixa!):")
        for sym, sp, b, a in wide_spreads[:5]:
            print(f"      {sym}: bid R${b:.2f} ask R${a:.2f} → spread {sp:.0f}%")
    else:
        print(f"  ✅ Spreads razoáveis na faixa analisada")

    # Capital check
    lotes_possiveis = CAPITAL // (int(spot) * LOT_SIZE)
    if lotes_possiveis == 0:
        print(f"  ❌ Capital de R${CAPITAL} não compra nem 1 lote ({LOT_SIZE} ações) de {asset} a R${spot:.2f}")
    else:
        print(f"  ✅ Capital permite {lotes_possiveis} lote(s) de {asset}")

    print(f"\n  💡 Nota: Prêmios calculados pelo BID (preço real de venda). Spread bid-ask reduz receita efetiva.")
    print(f"  💡 Fim de semana: dados podem estar stale. Rodar novamente segunda-feira em horário de mercado.")

    scan_id = save_scan(asset, spot, vol_data, calls, puts)
    print(f"  💾 Scan salvo em {DB_PATH} (scan_id={scan_id})")

    mt5.shutdown()


if __name__ == '__main__':
    scanner('PETR4')
