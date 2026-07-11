# python/options/ — Módulo de Opções B3

Scripts para análise e scanning de opções da B3 via MetaTrader 5.

## Arquivos

### `scanner_opcoes.py` ⭐ SCRIPT FUNCIONAL — REFERÊNCIA
Scanner CLI de opções (Covered Call + Cash-Secured Put). **JÁ TESTADO E FUNCIONANDO.**
- Filtra strikes ±10% do preço spot
- Calcula prêmio anualizado em base 365 dias, ROI, spread analysis
- Exibe volatilidade D1 e probabilidade simplificada de exercício
- Salva o scan mais recente por ativo em SQLite (`../../data/options/options_data.db`)
- Alertas de liquidez e capital insuficiente
- Top 5 melhores oportunidades
- Uso: `python scanner_opcoes.py` (default PETR4; a função `scanner(asset)` aceita outros ativos)

### `dashboard_opcoes.py` ⭐ DASHBOARD FUNCIONAL — REFERÊNCIA
Dashboard web Dash v4 para visualização de opções. **JÁ TESTADO E FUNCIONANDO.**
- Porta: 8060
- Cards de volatilidade, P.Exercício%, movimento esperado
- Tabelas interativas (Covered Calls + Cash-Secured Puts)
- Suporte a múltiplos ativos (PETR4, VALE3, BBAS3, ITUB4 testados)
- Filtros semanal/mensal, EU/US
- ⚠️ **NÃO entra na plataforma** — usar apenas como referência de código fonte

---

## 🔧 COMO O SCANNER FUNCIONA — Guia Técnico Completo

### Pré-requisito

O **MT5 Desktop precisa estar ABERTO e logado** na conta. A biblioteca `MetaTrader5` do Python se conecta ao terminal MT5 local via pipe/COM. Sem o MT5 aberto, nada funciona.

**Python correto:** `C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe`
(O conda `IA_Day_Trading` tem o `MetaTrader5` instalado)

### Passo 1 — Inicializar MT5

```python
import MetaTrader5 as mt5

if not mt5.initialize():
    print(f"ERRO MT5: {mt5.last_error()}")
    return  # ou sys.exit()
```

`mt5.initialize()` conecta ao terminal MT5 que está rodando no Windows. Se retornar `False`, o MT5 não está aberto ou o Python está usando o env errado.

### Passo 2 — Selecionar o símbolo base no Market Watch

```python
mt5.symbol_select("PETR4", True)
petr4 = mt5.symbol_info("PETR4")
spot = petr4.last if petr4.last > 0 else petr4.ask
```

`symbol_select(nome, True)` **é OBRIGATÓRIO**. Isso coloca o símbolo no Market Watch do MT5. Sem isso, consultas posteriores retornam `None`.

Para obter o preço spot:
- `info.last` = último preço negociado
- `info.ask` = melhor venda (se last = 0)
- Fallback: `info.bid` se ambos forem 0

### Passo 3 — Buscar TODOS os símbolos disponíveis no MT5

```python
symbols = mt5.symbols_get()
```

Isso retorna uma lista de **TODOS** os símbolos disponíveis no broker. Normalmente são milhares. Não é `mt5.symbols_total()` nem `mt5.symbols_get(group="BOVESPA")` — é `mt5.symbols_get()` SEM parâmetros.

### Passo 4 — Filtrar opções do ativo desejado

```python
base = asset.rstrip('0123456789')
raw_syms = set(s.name for s in symbols if base in s.name and s.name != asset)

group_syms = mt5.symbols_get(group=f"*{base}*")
if group_syms:
    raw_syms.update(s.name for s in group_syms if s.name != asset)
```

**O segredo está em combinar a lista geral com o wildcard do MT5:**
- Ações: `BOVESPA\\EQUITIES\\PETR4`
- Opções: `BOVESPA\\OPCOES\\PETR*`
- Mini índice: `BMFBOVESPA\\MINI INDICE\\WIN*`
- Nem toda corretora expõe os símbolos de forma igual no `path`, então o scanner filtra por nome/base e valida a letra da opção.

Cada opção tem um objeto `SymbolInfo` com:
- `s.name` — Nome do símbolo (ex: `PETRF480`)
- `s.path` — Caminho no MT5 (ex: `BOVESPA\OPCOES\PETRF480`)
- `s.expiration_time` — Timestamp Unix do vencimento

### Passo 5 — Selecionar CADA opção no Market Watch

```python
for s in petr_opts:
    mt5.symbol_select(s.name, True)  # OBRIGATÓRIO para cada uma!
```

**Isso é CRÍTICO.** Sem `symbol_select()` em cada opção individual, `mt5.symbol_info()` e `mt5.symbol_info_tick()` retornam `None`.

### Passo 6 — Coletar dados de cada opção

```python
for sym_name in [s.name for s in petr_opts]:
    # Dados do símbolo (strike, expiration, option_mode, etc.)
    info = mt5.symbol_info(sym_name)
    if not info:
        continue

    # Preços atuais (bid, ask, last)
    tick = mt5.symbol_info_tick(sym_name)
    bid = tick.bid if tick else 0.0
    ask = tick.ask if tick else 0.0
    last = tick.last if tick else 0.0
```

**`symbol_info()` retorna:** `SymbolInfo` com campos como `expiration_time`, `option_mode`, `option_right`, `strike` (às vezes), `bid`, `ask`, `last`, etc.

**`symbol_info_tick()` retorna:** `Tick` com `bid`, `ask`, `last`, `volume`, `time`.

### Passo 7 — Parsing do símbolo B3 (nomenclatura)

```
PETRF480
│   │ │││
│   │ ││└── Strike: 480 → R$48.00 (divide por 10)
│   │ │└── Strike: 4800 → R$48.00 (divide por 100, se > 1000)
│   │ └── Parte numérica
│   └── Letra do mês: F = CALL (maio)
└── Prefixo do ativo: PETR
```

**Letras usadas neste módulo, alinhadas ao dashboard de referência:**
- **CALLs:** A, B, C, D, E, F, G, H
- **PUTs:** J, K, L, M, N, O, P, Q, R

```python
def parse_strike(symbol):
    """PETRF480 -> 48.00, VALEG420 -> 42.00"""
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

def determine_type(symbol):
    base = symbol.rstrip('0123456789')
    letter = base[-1].upper()
    if letter in 'ABCDEFGH':
        return 'CALL'
    elif letter in 'JKLMNOPQR':
        return 'PUT'
    return 'UNKNOWN'
```

### Passo 8 — Calcular DTE (Days to Expiration)

```python
from datetime import datetime

dte = (datetime.fromtimestamp(info.expiration_time) - datetime.now()).days
```

**`expiration_time` é um INT (Unix timestamp em segundos).** Precisa converter com `datetime.fromtimestamp()`.

### Passo 9 — Obter preço premium (fim de semana vs horário de mercado)

```python
# Durante mercado: usar BID (realista para quem vende)
# Fim de semana: bid/ask podem ser 0; usar ask/last como fallback
premium = bid if bid > 0 else ask if ask > 0 else last
```

### Passo 10 — Calcular métricas

```python
# Prêmio total por lote
premio_total = premium * 100  # 1 lote B3 = 100 ações

# Prêmio anualizado, alinhado ao dashboard de referência
anual = (premium / strike) * (365 / dte)

# ROI
roi = premio_total / CAPITAL * 100

# Custo Covered Call
custo_acoes = spot * 100

# Margem Cash-Secured Put
margem = strike * 100
```

### Passo 11 — Filtros

```python
# Filtrar strikes na faixa útil (±10% do spot)
RANGE_PCT = 0.10
if not (spot * (1 - RANGE_PCT) <= strike <= spot * (1 + RANGE_PCT)):
    continue

# Ignorar se não tem preço (bid = 0 e ask = 0 e last = 0)
if bid <= 0 and ask <= 0:
    continue
```

### Passo 12 — Probabilidade de exercício (Black-Scholes simplificado)

```python
import math

def norm_cdf(x):
    """Approximate standard normal CDF ( Abramowitz & Stegun )."""
    a1, a2, a3, a4, a5 = 0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429
    p = 0.3275911
    sign = 1 if x >= 0 else -1
    x = abs(x) / math.sqrt(2)
    t = 1.0 / (1.0 + p * x)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-x * x)
    return 0.5 * (1.0 + sign * y)

def calc_exercise_prob(spot, strike, dte, daily_std, opt_type):
    if dte <= 0 or daily_std is None or daily_std <= 0:
        return None
    sigma = daily_std * math.sqrt(dte)
    d = (math.log(strike / spot)) / sigma
    if opt_type == 'CALL':
        return 1 - norm_cdf(d)  # P(spot > strike ao vencer)
    else:
        return norm_cdf(d)       # P(spot < strike ao vencer)
```

### Passo 13 — Volatilidade do ativo

```python
def get_volatility(asset):
    rates = mt5.copy_rates_from_pos(asset, mt5.TIMEFRAME_D1, 0, 60)
    df = pd.DataFrame(rates)
    df['ret'] = df['close'].pct_change()
    daily_std = df['ret'].std()         # Volatilidade diária
    annual_std = daily_std * math.sqrt(252)  # Volatilidade anualizada
    return daily_std, annual_std
```

### Fluxo completo resumido

```
1. mt5.initialize()                          # Conecta ao MT5
2. mt5.symbol_select("PETR4", True)          # Ativa símbolo base
3. spot = mt5.symbol_info("PETR4").last      # Preço spot
4. all_symbols = mt5.symbols_get()           # TODOS os símbolos
5. options = discover_options("PETR4")       # Lista geral + wildcard + validação por letra/strike
6. for opt in options:
       mt5.symbol_select(opt.name, True)     # ATIVA cada opção!
       info = mt5.symbol_info(opt.name)       # Dados do símbolo
       tick = mt5.symbol_info_tick(opt.name)  # Preços atuais
       # Processar...
7. mt5.shutdown()                            # Fecha conexão
```

---

## ⚠️ Armadilhas Comuns

1. **`mt5.symbols_get()` com parâmetro** — NÃO use `mt5.symbols_get("BOVESPA")`. Use SEM parâmetros e filtre no Python.
2. **Esquecer `symbol_select()`** — Sem isso, `symbol_info()` e `symbol_info_tick()` retornam `None`.
3. **Fim de semana** — `bid` e `ask` são 0. Usar `info.last` como fallback.
4. **`expiration_time` é INT** — Não é datetime, é Unix timestamp. Use `datetime.fromtimestamp(ts, unit='s')`.
5. **`SymbolInfo` não tem `market_status`** — Esse atributo não existe no MT5 Python.
6. **Strike no nome** — O `info.strike` do MT5 às vezes está errado. Preferir parse do nome do símbolo.
7. **Python env** — Usar SEMPRE o conda `IA_Day_Trading`: `C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe`
8. **`mt5.copy_rates_from_pos()`** — Para candles. Parâmetros: `(symbol, timeframe, position, count)`.

---

## Funções Reutilizáveis para a Plataforma

| Função | Arquivo original | Descrição |
|--------|-----------------|-----------|
| `parse_strike(symbol)` | scanner_opcoes.py | Extrai strike do símbolo B3 |
| `determine_type(symbol)` | scanner_opcoes.py | Identifica CALL/PUT pela letra |
| `anualizar(premium, strike, dte)` | scanner_opcoes.py | Prêmio anualizado em base 365 dias |
| `get_volatility(asset)` | scanner_opcoes.py / dashboard_opcoes.py | Volatilidade diária/anualizada |
| `calc_exercise_prob(spot, strike, dte, std, type)` | scanner_opcoes.py / dashboard_opcoes.py | Probabilidade de exercício |
| `norm_cdf(x)` | dashboard_opcoes.py | Normal CDF approximation |
| `scan_options(asset, vol_data)` | dashboard_opcoes.py | Scan completo (mais robusto) |
| `get_spot(symbol)` | dashboard_opcoes.py | Preço spot com fallback |

## Dependências
- `MetaTrader5` (pip install MetaTrader5)
- `pandas`, `numpy`
- `dash` (apenas dashboard_opcoes.py)

## Notas de integração
- O dashboard usa Dash standalone — converter componentes para React/Next.js
- A lógica de parsing e cálculos é 100% reutilizável como funções utilitárias TypeScript
- A API bridge do MT5 (`mt5_bridge.py`) pode servir como middleware entre o frontend e o MT5
- Weekend: bid/ask = 0, usar `info.last` como fallback
- `expiration_time` é int Unix timestamp
