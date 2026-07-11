# 🔍 Divergências: scanner_opcoes.py vs dashboard_opcoes (referência)

> **Contexto:** O script `scanner_opcoes.py` (usado na plataforma) está produzindo resultados diferentes do `dashboard_opcoes_(versao base apoio).py` (script de referência que funciona corretamente).
> **Data:** 2026-04-30
> **Autor:** Guardião 🛡️ (análise comparativa)

---

## 🚨 CRÍTICAS — Mudam o resultado diretamente

### 1. Determinação CALL/PUT — Letras DIVERGENTES

As letras usadas para classificar CALL vs PUT são **diferentes** entre os dois scripts. Isso faz com que uma mesma opção seja classificada como CALL em um e PUT no outro.

**Dashboard (referência ✅):**
```python
CALL_LETTERS = set('ABCDEFGH')   # 8 letras
PUT_LETTERS  = set('JKLMNOPQR')  # 9 letras
```

**Scanner (plataforma ❌):**
```python
# determine_type():
if letter in set('ABCDEFGHIJKL'):   # 12 letras (inclui J K L como CALL!)
    return 'CALL'
elif letter in set('MNOPQRSTUVWX'): # 12 letras (inclui M N O P Q R como PUT!)
    return 'PUT'
```

**Problema:** As letras J, K, L são PUT no dashboard mas CALL no scanner. As letras M, N, O, P, Q, R são PUT no dashboard mas também PUT no scanner — ok, mas J, K, L estão erradas.

**Correção:** Usar as mesmas letras do dashboard:
```python
CALL_LETTERS = set('ABCDEFGH')
PUT_LETTERS  = set('JKLMNOPQR')
```

---

### 2. Cálculo de Anualizado — Base de dias diferente

| | Dashboard (ref) | Scanner (plataforma) |
|---|---|---|
| **Fórmula** | `(premium / strike) * (365 / dte) * 100` | `(premio / strike) * (252 / dte)` |

O dashboard usa **365 dias** (calendário), o scanner usa **252 dias** (úteis). Isso gera ~45% de diferença no resultado anualizado. O dashboard sempre mostrará valores maiores.

**Decisão:** Padronizar para **365** (igual ao dashboard de referência) ou documentar explicitamente qual base usar. O importante é ser igual nos dois.

---

### 3. Parse do Strike — Hardcoded vs Genérico

**Dashboard (referência ✅):** Lê dígitos do final do símbolo, genérico para qualquer ativo:
```python
def parse_strike(sym):
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
```

**Scanner (plataforma ❌):** Assume formato fixo `PETR4` (posição 4):
```python
def parse_strike(symbol):
    resto = symbol[4:]     # <-- HARDCODED para 4 chars (PETR4)
    strike_str = resto[1:]
    # ...
```

**Problema:** Quebra com ativos de nome diferente (ex: VALE3 = 5 chars, ITUB4 = 5 chars).

**Correção:** Usar a versão genérica do dashboard.

---

### 4. determine_type — Posição hardcoded vs genérica

**Dashboard (referência ✅):** Extrai a letra do final (após remover dígitos):
```python
def determine_type(sym, spot):
    base = sym.rstrip('0123456789')
    if len(base) < 2:
        return 'UNKNOWN', strike
    month_letter = base[-1].upper()  # Última letra antes dos dígitos
```

**Scanner (plataforma ❌):** Assume posição fixa 4:
```python
def determine_type(symbol):
    letter = symbol[4] if len(symbol) > 4 else ''  # <-- HARDCODED
```

**Problema:** Não funciona para VALE3, ITUB4, BBAS3, etc.

**Correção:** Usar `sym.rstrip('0123456789')[-1].upper()` como no dashboard.

---

## ⚠️ IMPORTANTES — Afetam volume de dados

### 5. Busca de opções — Critérios diferentes

| Critério | Dashboard (ref) | Scanner (plataforma) |
|---|---|---|
| **Busca** | `base in s.name` + group wildcard `*{base}*` | `s.path.startswith('BOVESPA\\OPCOES\\PETR')` |
| **Semanais** | Inclui semanais (marca "Sem") | **Exclui** (`'W' not in s.name`) |
| **Tamanho nome** | Sem limite | `len(s.name) <= 10` |
| **Ativo** | Qualquer ativo (dinâmico via input) | Hardcoded `PETR4` |

**Problemas:**
- Busca por path pode não encontrar todas as opções dependendo de como o MT5 organiza
- Excluir semanais remove opções válidas (ou deveria ser explícito)
- `len(s.name) <= 10` pode excluir opções legítimas com nomes maiores
- Hardcoded PETR4 impede uso com outros ativos

**Correção:** Usar substring match + group wildcard como no dashboard.

---

### 6. Preço spot — Fonte diferente

| | Dashboard (ref) | Scanner (plataforma) |
|---|---|---|
| **Fonte** | `tick.ask` | `info.last` com fallback `info.ask` |

Impacto menor mas pode causar diferenças sutis nos cálculos de OTM e anualizado.

---

### 7. Filtros de DTE e dados

**Scanner** tem `if dte < 5: continue` (ignora opções com menos de 5 DTE).  
**Dashboard** não tem esse filtro — inclui todas.

---

## 📋 Funcionalidades Faltando no Scanner

O dashboard tem features que o scanner não implementa:

1. **Volatilidade calculada** — daily_std, annual_std, std_30d, mean_30d, weekly_pct
2. **Probabilidade de exercício** — `calc_exercise_prob()` com aproximação normal CDF
3. **Estilo da opção** — Americana/Europeia via `option_mode`
4. **Salvamento em SQLite** — `save_scan()` persiste dados para consultas futuras
5. **Dash DataTable** — interface web com tabelas interativas
6. **Card de volatilidade** — visualização de métricas de risco
7. **Ranking de oportunidades** — `make_rank_card()` com melhores oportunidades
8. **Filtro de capital dinâmico** — aceita input do usuário (não hardcoded R$10k)

---

## ✅ Checklist de Correção (ordem de prioridade)

- [x] **1.** Padronizar letras CALL/PUT: `A-H` = CALL, `J-R` = PUT
- [x] **2.** Padronizar anualizado para 365 dias
- [x] **3.** Tornar `parse_strike()` genérico (remover hardcoded posição 4)
- [x] **4.** Tornar `determine_type()` genérico (usar `rstrip('0123456789')[-1]`)
- [x] **5.** Atualizar busca de opções para substring + group wildcard
- [x] **6.** Remover/ajustar `len(s.name) <= 10`
- [x] **7.** Padronizar fonte do spot price
- [x] **8.** Alinhar filtro DTE entre os dois scripts
- [x] **9.** Implementar volatilidade + probabilidade de exercício (se aplicável)
- [x] **10.** Implementar salvamento SQLite (se aplicável)

Atualização 2026-05-10: itens 1-10 aplicados em `scanner_opcoes.py`. O scanner continua CLI, agora com volatilidade D1, probabilidade simplificada de exercício e salvamento do último scan por ativo em `options_data.db`.

---

## 📁 Arquivos de Referência

- **Script de referência (funcional):** `dashboard_opcoes_(versao base apoio).py`
- **Script da plataforma (com problemas):** `scanner_opcoes.py`
- **Este documento:** `DIVERGENCIAS_SCANNER_vs_DASHBOARD.md`
