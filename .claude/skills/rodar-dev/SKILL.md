---
name: rodar-dev
description: Use ao rodar, subir ou empacotar o WR Trade Pro — os 4 terminais do modo desenvolvimento (spread_api, volatility_api, ml_api, next dev) e o executável Electron.
---

# Como rodar o WR Trade Pro

## Modo desenvolvimento (4 terminais)

Todos os scripts Python rodam na conda env `IA_Day_Trading`.

```bash
# Terminal 1
python python/spread_api.py

# Terminal 2
python python/volatility_api.py

# Terminal 3
python python/ml_api.py

# Terminal 4
npm run dev
```

## Executável Electron (auto-start dos serviços)

```bash
# Criar o executável:
npm run electron:package

# Ou usar o executável já buildado:
dist_electron/win-unpacked/WR Trade Pro.exe
# ou
release/build/win-unpacked/WR Trade Pro.exe
```

O Electron faz spawn automático de `spread_api`/`volatility_api`; MCP Pilot e ML Engine
são iniciados sob demanda pela aba Admin.
