# Python Services — WR Trading Pro

Scripts Python que servem o Next.js WR Trading Pro.

## Serviços ativos

| Script | Porta | Função |
|--------|-------|--------|
| `mt5_bridge.py` | 8766 (WebSocket) | Bridge MT5 → Next.js |
| `spread_api.py` | 5000 (HTTP) | API de análise de spread |
| `volatility_api.py` | 5555 (HTTP) | API de volatilidade |
| `profitdll_bridge.py` | - | Bridge Profit DLL (futuro) |

## Como iniciar

```bash
# Instalar dependências
pip install -r requirements.txt

# Iniciar bridge MT5 (obrigatório para dados em tempo real)
python mt5_bridge.py

# Iniciar API de spread (necessário para análise de pares)
python spread_api.py

# Iniciar API de volatilidade
python volatility_api.py
```
