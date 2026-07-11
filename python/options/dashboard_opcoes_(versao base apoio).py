"""WR Trading Pro - Dashboard de Opcoes B3 (v4)"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

import dash
from dash import html, dcc, Input, Output, State
from dash import dash_table
import MetaTrader5 as mt5
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import math
import sqlite3
import json
from pathlib import Path

# --- SQLite Database ---
DB_PATH = Path(__file__).parent / 'options_data.db'

def init_db():
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
        opt_type TEXT
    )''')
    conn.commit()
    conn.close()

init_db()

def save_scan(asset, spot, vol_data, df_c, df_p):
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    now = datetime.now().isoformat()

    # Delete previous scan for this asset (keep only latest)
    cur.execute('SELECT id FROM scans WHERE asset = ? ORDER BY id DESC LIMIT 1', (asset,))
    old = cur.fetchone()
    if old:
        cur.execute('DELETE FROM options WHERE scan_id = ?', (old[0],))
        cur.execute('DELETE FROM scans WHERE id = ?', (old[0],))

    cur.execute('INSERT INTO scans (asset, scanned_at, spot, vol_data) VALUES (?,?,?,?)',
                (asset, now, spot, json.dumps({k: float(v) if isinstance(v, (int,float)) else v for k,v in (vol_data or {}).items()}, default=str)))
    scan_id = cur.lastrowid
    for df, otype in [(df_c, 'CALL'), (df_p, 'PUT')]:
        if df is None or df.empty:
            continue
        for _, row in df.iterrows():
            cur.execute('''INSERT INTO options
                (scan_id, symbol, strike, bid, ask, spread_pct, otm_pct, dte, venc,
                 tipo, estilo, anual_pct, p_exerc, custo_r, cabe_10k, opt_type)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (scan_id, row.get('Simbolo'), row.get('Strike'), row.get('Bid'), row.get('Ask'),
                 row.get('Spread %'), row.get('OTM %'), row.get('DTE'), row.get('Venc'),
                 row.get('Tipo'), row.get('Estilo'), row.get('Anual %'), row.get('P.Exerc %'),
                 row.get('Custo R$'), 1 if row.get('Cabe R$10k') else 0, otype))
    conn.commit()
    conn.close()
    return scan_id

# --- MT5 Init ---
if not mt5.initialize():
    raise RuntimeError(f"MT5 init failed: {mt5.last_error()}")

# --- Config ---
PORT = 8060
LOT_SIZE = 100  # B3 lot size

# --- Theme ---
C = {
    'bg': '#0a0e17', 'card': '#111827', 'card_border': '#1e293b',
    'text': '#e2e8f0', 'text_muted': '#64748b',
    'accent': '#22d3ee', 'green': '#10b981', 'red': '#ef4444', 'purple': '#8b5cf6',
    'yellow': '#f59e0b', 'orange': '#f97316',
}

# B3 month letters
CALL_LETTERS = set('ABCDEFGH')
PUT_LETTERS = set('JKLMNOPQR')

# --- Helper Functions ---
def get_spot(symbol):
    tick = mt5.symbol_info_tick(symbol)
    return tick.ask if tick else 0.0

def get_volatility(asset):
    """Get daily volatility from last N daily candles."""
    rates = mt5.copy_rates_from_pos(asset, mt5.TIMEFRAME_D1, 0, 60)
    if rates is None or len(rates) < 10:
        return None, None, None, None, None, None
    df = pd.DataFrame(rates)
    df['ret'] = df['close'].pct_change()
    daily_std = df['ret'].std()
    daily_mean = df['ret'].mean()
    # Last 30 days (short-term)
    df30 = df.tail(30)
    std_30 = df30['ret'].std()
    mean_30 = df30['ret'].mean()
    # Annualized
    annual_std = daily_std * math.sqrt(252)
    # Recent trend
    last_close = df['close'].iloc[-1]
    prev_close = df['close'].iloc[-6] if len(df) >= 6 else df['close'].iloc[0]
    weekly_pct = (last_close - prev_close) / prev_close * 100
    return {
        'daily_std': daily_std,
        'mean_30d': mean_30,
        'std_30d': std_30,
        'annual_std': annual_std,
        'weekly_pct': weekly_pct,
        'last_close': last_close,
        'n_candles': len(df),
    }, daily_std, mean_30, std_30, annual_std, weekly_pct

def calc_exercise_prob(spot, strike, dte, daily_std, opt_type):
    """Estimate probability of being ITM at expiration (simplified log-normal)."""
    if dte <= 0 or daily_std is None or daily_std <= 0:
        return None
    sigma = daily_std * math.sqrt(dte)
    if sigma <= 0:
        return None
    if opt_type == 'CALL':
        # P(spot_T > strike) = 1 - Phi((ln(strike/spot))/sigma - 0.5*sigma)
        # Simplified: just use ratio
        d = (math.log(strike / spot)) / sigma
        # Approximate normal CDF
        prob = 1 - norm_cdf(d)
    else:  # PUT
        # P(spot_T < strike)
        d = (math.log(strike / spot)) / sigma
        prob = norm_cdf(d)
    return round(prob * 100, 1)

def norm_cdf(x):
    """Approximate standard normal CDF."""
    a1, a2, a3, a4, a5 = 0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429
    p = 0.3275911
    sign = 1 if x >= 0 else -1
    x = abs(x) / math.sqrt(2)
    t = 1.0 / (1.0 + p * x)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-x * x)
    return 0.5 * (1.0 + sign * y)

def parse_strike(sym):
    """Parse B3 option strike from symbol name."""
    name = sym
    for suffix in ['.BVSP', '.B3']:
        name = name.replace(suffix, '')
    digits = ''
    for ch in reversed(name):
        if ch.isdigit():
            digits = ch + digits
        else:
            break
    if digits:
        val = int(digits)
        if val > 1000:
            return val / 100.0
        return val / 10.0
    return None

def get_dte(expiration_ts):
    """Get days to expiration from MT5 timestamp."""
    try:
        exp_date = datetime.fromtimestamp(expiration_ts)
        delta = (exp_date - datetime.now()).days
        return max(0, delta)
    except:
        return 0

def get_expiry_date(expiration_ts):
    """Get expiration date string from MT5 timestamp."""
    try:
        return datetime.fromtimestamp(expiration_ts).strftime('%Y-%m-%d')
    except:
        return 'N/A'

def is_weekly(sym):
    """Check if B3 option is weekly (ends with W+digit)."""
    clean = sym.rstrip('0123456789')
    return clean.endswith('W')

def get_opt_style(info):
    """0=European, 1=American from MT5 option_mode."""
    if not info:
        return 'N/A'
    return 'AMERICANA' if info.option_mode == 1 else 'EUROPEIA'

def determine_type(sym, spot):
    """Determine CALL/PUT from B3 letter convention."""
    strike = parse_strike(sym)
    if strike is None:
        return 'UNKNOWN', strike
    base = sym.rstrip('0123456789')
    if len(base) < 2:
        return 'UNKNOWN', strike
    month_letter = base[-1].upper()
    if month_letter in CALL_LETTERS:
        return 'CALL', strike
    elif month_letter in PUT_LETTERS:
        return 'PUT', strike
    return 'UNKNOWN', strike

def scan_options(asset, vol_data=None):
    """Scan all options for given underlying asset."""
    spot = get_spot(asset)
    if spot <= 0:
        return pd.DataFrame(), pd.DataFrame(), [], 0.0, {}

    # Enable ALL symbols first so hidden options become available
    all_syms = mt5.symbols_get()
    if not all_syms:
        return pd.DataFrame(), pd.DataFrame(), [], spot, {}

    base = asset.rstrip('0123456789')
    # First pass: find matching symbols via substring AND group wildcard
    raw_syms = set(s.name for s in all_syms if base in s.name and s.name != asset)
    # Also try group search to find symbols that might not be in the main list
    group_syms = mt5.symbols_get(group=f"*{base}*")
    if group_syms:
        for s in group_syms:
            if s.name != asset:
                raw_syms.add(s.name)

    # Filter: only options (letters A-R = calls, J-R = puts), remove futures/base
    futures_suf = ('F', 'FUT', 'FI', 'WDO', 'DOL')
    opt_syms = []
    debug_info = {'raw_total': len(raw_syms), 'activated': 0, 'errors': []}
    for sym in raw_syms:
        # Skip if ends with typical future suffix or is the base asset
        name_part = sym[len(base):]
        if not name_part:
            continue
        if name_part[0] in 'FMW':  # futures: PETR4F, PETR4M, etc
            continue
        ok = mt5.symbol_select(sym, True)
        if ok:
            opt_syms.append(sym)
            debug_info['activated'] += 1
        else:
            debug_info['errors'].append(sym)

    # Small delay to let MT5 load tick data for newly activated symbols
    import time
    time.sleep(0.5)

    calls, puts, alerts = [], [], []
    margin = 0.10

    daily_std = vol_data['daily_std'] if vol_data else None

    for sym in opt_syms:
        info = mt5.symbol_info(sym)
        if not info:
            continue

        tick = mt5.symbol_info_tick(sym)
        bid = tick.bid if tick else 0.0
        ask = tick.ask if tick else 0.0
        last = tick.last if tick else 0.0

        premium = bid if bid > 0 else (ask if ask > 0 else last)
        if premium <= 0:
            premium = 0.0
            ask_for_spread = 0.0
        else:
            ask_for_spread = ask if ask > 0 else (bid if bid > 0 else last)

        strike = parse_strike(sym)
        if strike is None:
            continue

        opt_type, strike = determine_type(sym, spot)
        if opt_type == 'UNKNOWN':
            continue

        if strike < spot * (1 - margin) or strike > spot * (1 + margin):
            continue

        dte = get_dte(info.expiration_time)
        exp_date = get_expiry_date(info.expiration_time)
        spread_pct = (ask_for_spread - premium) / ask_for_spread * 100 if ask_for_spread > 0 else (999 if premium == 0 else 0)
        otm_pct = abs(strike - spot) / spot * 100
        ann_pct = (premium / strike) * (365 / max(dte, 1)) * 100 if dte > 0 and premium > 0 else 0
        cost = strike * LOT_SIZE
        fits_10k = cost <= 10000
        weekly = is_weekly(sym)
        style = get_opt_style(info)

        # Exercise probability
        ex_prob = calc_exercise_prob(spot, strike, dte, daily_std, opt_type)

        # Expected move in DTE days
        if daily_std and dte > 0:
            expected_move = spot * daily_std * math.sqrt(dte)
            # For covered call: risk of exercise if expected move exceeds OTM
            will_cover = 'BAIXA' if (opt_type == 'CALL' and otm_pct > expected_move / spot * 100 * 1.5) else 'ALTA'
        else:
            expected_move = None
            will_cover = 'N/A'

        row = {
            'Simbolo': sym, 'Strike': strike, 'Bid': premium, 'Ask': ask_for_spread,
            'Spread %': round(spread_pct, 1), 'OTM %': round(otm_pct, 1),
            'DTE': dte, 'Venc': exp_date, 'Tipo': 'Sem' if weekly else 'Men',
            'Estilo': style, 'Anual %': round(ann_pct, 1),
            'P.Exerc %': ex_prob if ex_prob is not None else 0,
            'Custo R$': round(cost), 'Cabe R$10k': fits_10k,
        }

        if spread_pct > 50:
            alerts.append(f"{sym} spread {spread_pct:.0f}%")

        if opt_type == 'CALL':
            calls.append(row)
        else:
            puts.append(row)

    df_c = pd.DataFrame(calls).sort_values('Anual %', ascending=False) if calls else pd.DataFrame()
    df_p = pd.DataFrame(puts).sort_values('Anual %', ascending=False) if puts else pd.DataFrame()
    return df_c, df_p, alerts, spot, vol_data or {}, debug_info


def make_table(df):
    """Create Dash DataTable from dataframe."""
    if df is None or df.empty:
        return html.Div('Nenhuma opcao encontrada.', style={'color': C['text_muted'], 'padding': '24px'})
    return dash_table.DataTable(
        data=df.to_dict('records'),
        columns=[{'name': c, 'id': c} for c in df.columns],
        style_header={'backgroundColor': '#0d1117', 'color': C['accent'],
                       'fontWeight': '700', 'fontSize': '10px', 'textTransform': 'uppercase',
                       'letterSpacing': '1px', 'borderBottom': f'1px solid {C["card_border"]}'},
        style_cell={'backgroundColor': '#111827', 'color': C['text'], 'border': 'none',
                     'padding': '6px 8px', 'fontSize': '11px', 'fontFamily': "'JetBrains Mono', monospace"},
        style_table={'overflowX': 'auto'},
        style_data_conditional=[
            {'if': {'filter_query': '{Anual %} >= 30', 'column_id': 'Anual %'}, 'color': C['green'], 'fontWeight': '700'},
            {'if': {'filter_query': '{P.Exerc %} > 60', 'column_id': 'P.Exerc %'}, 'color': C['red'], 'fontWeight': '700'},
            {'if': {'filter_query': '{P.Exerc %} < 30', 'column_id': 'P.Exerc %'}, 'color': C['green']},
            {'if': {'filter_query': '{Cabe R$10k} = false', 'column_id': 'Cabe R$10k'}, 'color': C['red']},
            {'if': {'filter_query': '{Cabe R$10k} = true', 'column_id': 'Cabe R$10k'}, 'color': C['green']},
            {'if': {'filter_query': '{Estilo} = AMERICANA', 'column_id': 'Estilo'}, 'color': C['yellow']},
            {'if': {'filter_query': '{Estilo} = EUROPEIA', 'column_id': 'Estilo'}, 'color': C['purple']},
            {'if': {'filter_query': '{Tipo} = Sem', 'column_id': 'Tipo'}, 'color': C['orange']},
            {'if': {'row_index': 'odd'}, 'backgroundColor': '#0d1117'},
        ],
        page_size=15,
        sort_action='native',
        filter_action='native',
    )


def native(v):
    """Convert numpy types for JSON."""
    if isinstance(v, dict):
        return {k: native(val) for k, val in v.items()}
    elif isinstance(v, list):
        return [native(i) for i in v]
    elif isinstance(v, (np.integer,)):
        return int(v)
    elif isinstance(v, (np.floating,)):
        return float(v)
    elif isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def calc_lots(capital, cost_per_lot):
    """Calculate how many lots (100 shares) fit in capital."""
    if cost_per_lot <= 0:
        return 0
    return int(capital / cost_per_lot)


def make_rank_card(df_c, df_p, spot, capital):
    """Build ranking card for best selling opportunities with capital calculations."""
    cards = []

    # --- Covered Call ranking ---
    if df_c is not None and not df_c.empty:
        cc = df_c[(df_c['Bid'] > 0) & (df_c['Spread %'] < 5) & (df_c['DTE'].between(10, 90))].copy()
        if not cc.empty:
            cc['score'] = (cc['Anual %'] * 0.4 + (100 - cc['P.Exerc %']) * 0.3 + (100 - cc['Spread %']) * 0.3)
            cc = cc.nlargest(3, 'score')
            rows = []
            for _, r in cc.iterrows():
                premio = r['Bid'] * 100  # premio por lote
                custo_lote = r['Strike'] * 100  # custo do lote de 100 acoes
                n_lotes = calc_lots(capital, custo_lote)
                ganho_total = premio * n_lotes
                ganho_pct = (ganho_total / capital * 100) if capital > 0 else 0
                rows.append(html.Div([
                    html.Span(f"#{r.name+1} ", style={'color': C['yellow'], 'fontWeight': '700', 'fontSize': '12px'}),
                    html.Span(f"{r['Simbolo']}", style={'color': C['text'], 'fontWeight': '700', 'fontSize': '12px'}),
                    html.Span(f" K={r['Strike']:.2f}", style={'color': C['text_muted'], 'fontSize': '11px'}),
                    html.Span(f" | Premio/lot R${premio:.0f}", style={'color': C['green'], 'fontSize': '11px'}),
                    html.Span(f" | Lotes {n_lotes}", style={'color': C['text'], 'fontSize': '11px'}),
                    html.Span(f" | Ganho R${ganho_total:.0f}", style={'color': C['green'], 'fontWeight': '700', 'fontSize': '12px'}),
                    html.Span(f" ({ganho_pct:.1f}%)", style={'color': C['green'], 'fontSize': '10px'}),
                ], style={'padding': '4px 0', 'borderBottom': f'1px solid {C["card_border"]}'}))
            cards.append(html.Div([
                html.Span('TOP 3 VENDA DE CALL (Covered Call)', style={'fontSize': '11px', 'letterSpacing': '1px', 'color': C['green'], 'fontWeight': '700', 'display': 'block', 'marginBottom': '6px'}),
                html.Div(rows, style={'padding': '4px 0'}),
            ], style={'padding': '12px', 'background': '#0a1a10', 'border': f'1px solid #1a3a20', 'borderRadius': '6px', 'marginBottom': '8px'}))

    # --- Cash-Secured Put ranking ---
    if df_p is not None and not df_p.empty:
        sp = df_p[(df_p['Bid'] > 0) & (df_p['Spread %'] < 5) & (df_p['DTE'].between(10, 90))].copy()
        if not sp.empty:
            sp['score'] = (sp['Anual %'] * 0.4 + (100 - sp['P.Exerc %']) * 0.3 + (100 - sp['Spread %']) * 0.3)
            sp = sp.nlargest(3, 'score')
            rows = []
            for _, r in sp.iterrows():
                premio = r['Bid'] * 100
                # Venda de put: recebe premio, precisa de margem (simplificado como strike*100)
                margem_lote = r['Strike'] * 100
                n_lotes = calc_lots(capital, margem_lote)
                ganho_total = premio * n_lotes
                ganho_pct = (ganho_total / capital * 100) if capital > 0 else 0
                # Se designado: compra acao pelo strike menos o premio ja recebido
                preco_entrada = r['Strike'] - r['Bid']
                rows.append(html.Div([
                    html.Span(f"#{r.name+1} ", style={'color': C['yellow'], 'fontWeight': '700', 'fontSize': '12px'}),
                    html.Span(f"{r['Simbolo']}", style={'color': C['text'], 'fontWeight': '700', 'fontSize': '12px'}),
                    html.Span(f" K={r['Strike']:.2f}", style={'color': C['text_muted'], 'fontSize': '11px'}),
                    html.Span(f" | Premio/lot R${premio:.0f}", style={'color': C['green'], 'fontSize': '11px'}),
                    html.Span(f" | Lotes {n_lotes}", style={'color': C['text'], 'fontSize': '11px'}),
                    html.Span(f" | Ganho R${ganho_total:.0f}", style={'color': C['green'], 'fontWeight': '700', 'fontSize': '12px'}),
                    html.Span(f" ({ganho_pct:.1f}%)", style={'color': C['green'], 'fontSize': '10px'}),
                    html.Span(f" | Se designado: R${preco_entrada:.2f}/acao", style={'color': C['orange'], 'fontSize': '10px'}),
                ], style={'padding': '4px 0', 'borderBottom': f'1px solid {C["card_border"]}'}))
            cards.append(html.Div([
                html.Span('TOP 3 VENDA DE PUT (Cash-Secured Put)', style={'fontSize': '11px', 'letterSpacing': '1px', 'color': C['purple'], 'fontWeight': '700', 'display': 'block', 'marginBottom': '6px'}),
                html.Div(rows, style={'padding': '4px 0'}),
            ], style={'padding': '12px', 'background': '#0f0a1a', 'border': f'1px solid #1a1a3a', 'borderRadius': '6px'}))

    if not cards:
        return html.Div('Nenhuma oportunidade com filtros (liquidez + DTE 10-90d).', style={'color': C['text_muted'], 'fontSize': '11px'})

    return html.Div([
        html.Div([
            html.Span('RANKING DE OPORTUNIDADES', style={'fontSize': '11px', 'letterSpacing': '2px', 'color': C['yellow'], 'fontWeight': '700'}),
            html.Span(f'  |  Capital: R$ {capital:,.0f}', style={'fontSize': '11px', 'color': C['yellow'], 'fontWeight': '700'}),
            html.Span(f'  |  Lote = 100 acoes', style={'fontSize': '9px', 'color': C['text_muted'], 'marginLeft': '8px'}),
        ], style={'marginBottom': '6px'}),
        html.Span('Score = Anual% (40%) + Seguranca (30%) + Liquidez (30%)', style={'fontSize': '9px', 'color': C['text_muted'], 'display': 'block', 'marginBottom': '8px'}),
        html.Div(cards, style={'display': 'flex', 'flexDirection': 'column', 'gap': '8px'}),
    ], style={'padding': '16px', 'background': C['card'], 'border': f'1px solid {C["card_border"]}', 'borderRadius': '6px'})


def make_vol_card(vol_data, spot):
    """Build volatility analysis card."""
    if not vol_data:
        return html.Div('Dados de volatilidade indisponiveis.', style={'color': C['text_muted']})

    v = vol_data
    ds = v.get('daily_std', 0) or 0
    a_std = v.get('annual_std', 0) or 0

    # Projected ranges
    move_1d = spot * ds
    move_5d = spot * ds * math.sqrt(5)
    move_20d = spot * ds * math.sqrt(20)

    w_pct = v.get('weekly_pct', 0) or 0
    trend_color = C['green'] if w_pct > 0 else C['red']
    trend_icon = '↑' if w_pct > 0 else '↓'

    return html.Div([
        html.Div([
            html.Span('ANALISE DE VOLATILIDADE', style={'fontSize': '11px', 'letterSpacing': '2px', 'color': C['yellow'], 'fontWeight': '700'}),
            html.Span(f'({v.get("n_candles", "?")} candles)', style={'fontSize': '9px', 'color': C['text_muted'], 'marginLeft': '8px'}),
        ], style={'marginBottom': '12px'}),

        html.Div([
            html.Span('Vol. Diaria:', style={'color': C['text_muted'], 'fontSize': '11px'}),
            html.Span(f'{ds*100:.2f}%', style={'color': C['text'], 'fontSize': '11px', 'fontWeight': '700', 'marginLeft': '4px'}),
            html.Span('Vol. Anual:', style={'color': C['text_muted'], 'fontSize': '11px', 'marginLeft': '12px'}),
            html.Span(f'{a_std*100:.1f}%', style={'color': C['text'], 'fontSize': '11px', 'fontWeight': '700', 'marginLeft': '4px'}),
            html.Span('Semanal:', style={'color': C['text_muted'], 'fontSize': '11px', 'marginLeft': '12px'}),
            html.Span(f'{trend_icon}{abs(w_pct):.2f}%', style={'color': trend_color, 'fontSize': '11px', 'fontWeight': '700', 'marginLeft': '4px'}),
        ], style={'marginBottom': '12px'}),

        html.Span('MOVIMENTO ESPERADO:', style={'fontSize': '10px', 'color': C['text_muted'], 'fontWeight': '700', 'letterSpacing': '1px', 'display': 'block', 'marginBottom': '6px'}),
        html.Div([
            html.Div([
                html.Span('1 dia', style={'color': C['text_muted'], 'fontSize': '10px', 'display': 'block'}),
                html.Span(f'R${spot:.2f}', style={'color': C['green'], 'fontSize': '10px'}),
                html.Span(f' +/- R${move_1d:.2f}', style={'color': C['text'], 'fontSize': '10px'}),
            ], style={'flex': '1', 'background': '#0d1117', 'padding': '8px', 'borderRadius': '4px', 'textAlign': 'center'}),
            html.Div([
                html.Span('5 dias', style={'color': C['text_muted'], 'fontSize': '10px', 'display': 'block'}),
                html.Span(f'R${spot:.2f}', style={'color': C['green'], 'fontSize': '10px'}),
                html.Span(f' +/- R${move_5d:.2f}', style={'color': C['text'], 'fontSize': '10px'}),
            ], style={'flex': '1', 'background': '#0d1117', 'padding': '8px', 'borderRadius': '4px', 'textAlign': 'center', 'marginLeft': '4px'}),
            html.Div([
                html.Span('20 dias', style={'color': C['text_muted'], 'fontSize': '10px', 'display': 'block'}),
                html.Span(f'R${spot:.2f}', style={'color': C['green'], 'fontSize': '10px'}),
                html.Span(f' +/- R${move_20d:.2f}', style={'color': C['text'], 'fontSize': '10px'}),
            ], style={'flex': '1', 'background': '#0d1117', 'padding': '8px', 'borderRadius': '4px', 'textAlign': 'center', 'marginLeft': '4px'}),
        ], style={'display': 'flex'}),

        html.Div([
            html.Span('P.Exerc = Probabilidade de exercicio ao vencimento (modelo log-normal simplificado)', style={'fontSize': '9px', 'color': C['text_muted'], 'marginTop': '8px', 'display': 'block'}),
            html.Span('AMERICANA = pode ser exercida a qualquer momento | EUROPEIA = apenas no vencimento', style={'fontSize': '9px', 'color': C['text_muted'], 'marginTop': '2px', 'display': 'block'}),
        ], style={'marginTop': '8px'}),
    ], style={'padding': '16px', 'background': C['card'], 'border': f'1px solid {C["card_border"]}', 'borderRadius': '6px'})


# --- App ---
app = dash.Dash(__name__, suppress_callback_exceptions=True)
app.title = 'Dashboard de Opcoes B3'

app.layout = html.Div([
    # Header
    html.Div([
        html.Span('WR TRADING PRO', style={'fontSize': '16px', 'fontWeight': '700', 'color': C['accent'], 'letterSpacing': '3px'}),
        html.Span('DASHBOARD DE OPCOES B3', style={'fontSize': '11px', 'color': C['text_muted'], 'marginLeft': '16px', 'letterSpacing': '2px'}),
        html.Span('v4', style={'fontSize': '9px', 'color': C['text_muted'], 'marginLeft': '8px', 'opacity': '0.5'}),
    ], style={'padding': '20px 24px', 'borderBottom': f'1px solid {C["card_border"]}', 'background': '#080c14'}),

    # Input bar
    html.Div([
        html.Span('ATIVO:', style={'fontSize': '11px', 'color': C['text_muted'], 'fontWeight': '700', 'letterSpacing': '1px', 'marginRight': '8px'}),
        dcc.Input(id='asset-input', type='text', placeholder='Ex: PETR4', value='PETR4',
                   style={'width': '140px', 'padding': '10px 14px', 'fontSize': '14px', 'fontWeight': '700',
                          'background': '#1a1f2e', 'color': C['text'], 'border': f'1px solid {C["card_border"]}',
                          'borderRadius': '6px', 'outline': 'none', 'fontFamily': "'JetBrains Mono', monospace"}),
        html.Button('ESCANEAR', id='scan-btn', n_clicks=0,
                     style={'marginLeft': '8px', 'padding': '10px 20px', 'fontSize': '11px', 'fontWeight': '700',
                            'letterSpacing': '2px', 'background': C['accent'], 'color': '#000', 'border': 'none',
                            'borderRadius': '6px', 'cursor': 'pointer'}),
        html.Span('CAPITAL:', style={'fontSize': '11px', 'color': C['text_muted'], 'fontWeight': '700', 'letterSpacing': '1px', 'marginLeft': '16px', 'marginRight': '8px'}),
        dcc.Input(id='capital-input', type='number', placeholder='10000', value=10000, min=0, step=1000,
                   style={'width': '120px', 'padding': '10px 14px', 'fontSize': '14px', 'fontWeight': '700',
                          'background': '#1a1f2e', 'color': C['yellow'], 'border': f'1px solid {C["card_border"]}',
                          'borderRadius': '6px', 'outline': 'none', 'fontFamily': "'JetBrains Mono', monospace"}),
        html.Span(id='spot-display', style={'marginLeft': '12px', 'fontSize': '13px', 'color': C['green'], 'fontWeight': '700'}),
        html.Span(id='update-time', style={'marginLeft': '12px', 'fontSize': '10px', 'color': C['text_muted']}),
    ], style={'padding': '14px 24px', 'display': 'flex', 'alignItems': 'center', 'flexWrap': 'wrap', 'gap': '4px'}),

    # Debug bar
    html.Div(id='debug-bar', children='Aguardando scan...',
              style={'padding': '6px 24px', 'fontSize': '10px', 'color': C['text_muted'],
                     'background': '#080c14', 'borderBottom': f'1px solid {C["card_border"]}',
                     'fontFamily': "'JetBrains Mono', monospace"}),

    # Volatility card
    html.Div(id='vol-card', style={'padding': '16px 24px'}),

    # Rank card
    html.Div(id='rank-card', style={'padding': '0 24px 12px'}),

    # Content (tables) - vertical stack to avoid overflow
    html.Div([
        html.Div([
            html.Span('COVERED CALLS', style={'fontSize': '11px', 'letterSpacing': '2px', 'color': C['green'], 'fontWeight': '700', 'marginBottom': '10px', 'display': 'block'}),
            html.Div(id='calls-table'),
        ], style={'maxHeight': '400px', 'overflowY': 'auto', 'padding': '0 12px 20px'}),

        html.Div([
            html.Span('CASH-SECURED PUTS', style={'fontSize': '11px', 'letterSpacing': '2px', 'color': C['purple'], 'fontWeight': '700', 'marginBottom': '10px', 'display': 'block'}),
            html.Div(id='puts-table'),
        ], style={'maxHeight': '400px', 'overflowY': 'auto', 'padding': '0 12px 20px'}),
    ], style={'display': 'flex', 'flexDirection': 'column', 'gap': '4px'}),

    # Alerts
    html.Div(id='alerts-bar', style={'display': 'none'}),
], style={'backgroundColor': C['bg'], 'minHeight': '100vh', 'fontFamily': "'JetBrains Mono', monospace"})


@app.callback(
    [Output('calls-table', 'children'),
     Output('puts-table', 'children'),
     Output('spot-display', 'children'),
     Output('update-time', 'children'),
     Output('debug-bar', 'children'),
     Output('alerts-bar', 'children'),
     Output('vol-card', 'children'),
     Output('rank-card', 'children')],
    [Input('scan-btn', 'n_clicks')],
    [State('asset-input', 'value'), State('capital-input', 'value')]
)
def do_scan(n_clicks, asset, capital):
    empty = html.Div('', style={'display': 'none'})
    if not asset:
        return dash.no_update * 7 + [empty]
    try:
        capital = float(capital) if capital else 10000
    except (ValueError, TypeError):
        capital = 10000

    asset = asset.strip().upper()
    now = datetime.now()

    debug = f'[{now:%H:%M:%S}] Escaneando {asset}...'

    try:
        # Get volatility
        vol_data = get_volatility(asset)
        if vol_data:
            vol_summary = vol_data[0]
        else:
            vol_summary = {}

        df_c, df_p, alerts, spot, _, dbg = scan_options(asset, vol_summary)

        n_c = len(df_c) if df_c is not None and not df_c.empty else 0
        n_p = len(df_p) if df_p is not None and not df_p.empty else 0

        debug = f'[{now:%H:%M:%S}] OK | {asset} | spot=R${spot:.2f} | raw={dbg["raw_total"]} | activated={dbg["activated"]} | calls={n_c} | puts={n_p} | errors={len(dbg["errors"])}'

        calls_html = make_table(df_c)
        puts_html = make_table(df_p)
        spot_text = f'R$ {spot:,.2f}'
        time_text = f'Atualizado: {now:%H:%M:%S}'
        vol_html = make_vol_card(vol_summary, spot)

        # Salvar no banco de dados
        scan_id = save_scan(asset, spot, vol_summary, df_c, df_p)
        debug += f' | db_scan={scan_id}'

        rank_html = make_rank_card(df_c, df_p, spot, capital)

        alert_html = html.Div([
            html.Span(f'ALERTAS: {len(alerts)} opcoes com spread > 50%', style={'color': C['red'], 'fontSize': '10px', 'fontWeight': '700'}),
            html.Div([html.Span(a, style={'fontSize': '9px', 'color': C['text_muted'], 'marginRight': '12px'}) for a in alerts[:15]],
                      style={'marginTop': '4px', 'flexWrap': 'wrap', 'display': 'flex'}),
        ], style={'padding': '12px 24px', 'background': '#1a0f0f', 'borderTop': f'1px solid #3b1010', 'display': 'block' if alerts else 'none'})

        return calls_html, puts_html, spot_text, time_text, debug, alert_html, vol_html, rank_html

    except Exception as e:
        debug = f'[{now:%H:%M:%S}] ERRO: {str(e)[:200]}'
        return dash.no_update * 7 + [html.Div(f'Erro: {str(e)[:200]}', style={'color': C['red']})]


if __name__ == '__main__':
    print(f"\n{'=' * 50}")
    print(f"  WR Trading Pro - Dashboard de Opcoes B3 (v4)")
    print(f"  Volatilidade + Exercicio + Semanal/Mensal")
    print(f"  Porta: {PORT}")
    print(f"  http://localhost:{PORT}")
    print(f"{'=' * 50}\n")
    app.run(debug=False, host='0.0.0.0', port=PORT)
