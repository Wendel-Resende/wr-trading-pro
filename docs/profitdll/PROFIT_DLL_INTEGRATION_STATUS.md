# Profit DLL Integration - Estado do Projeto

## Objetivo
Integrar a **Profit DLL (Nelogica)** como fonte adicional de dados de mercado no projeto wr-trade-pro.

## Contexto
- Projeto já possui integração com **MT5** (ticks em tempo real, candles, ordens)
- **Stack**: Next.js 15, TypeScript, Prisma, Tailwind CSS, Socket.IO, lightweight-charts, Recharts
- **Arquitetura confirmada**: servidor Python intermediário em `ws://localhost:8765` + frontend Next.js
- **Status da DLL**: Sem assinatura — aguardando chave de ativação

## Entregas Concluídas

### 1. Documentação
- [x] Manual da Profit DLL lido integralmente (76 páginas)
- [x] Exemplo Python lido integralmente (main.py, profitTypes.py, profit_dll.py — 1.454 linhas)

### 2. Tipos TypeScript (`src/types/profit/`)
- [x] `connector.types.ts` — mapeamento das structs C (baseado no manual PDF)
- [x] `enums.ts` — mapeamento dos enums C
- [x] `index.ts` — barrel export

### 3. Serviço (`src/services/profit-dll/`)
- [x] `ProfitDllService.ts` — stub do serviço
- [x] `index.ts` — barrel export

## Divergências Identificadas (a resolver)

O mapeamento feito a partir do **manual PDF** pode ter diferenças do **exemplo Python**:

| Struct/Enum | Fonte | Status |
|---|---|---|
| `TConnectorOrderType` | profitTypes.py | Verificar no manual |
| `TConnectorOrderSide` | profitTypes.py | Verificar no manual |
| `TConnectorPositionType` | profitTypes.py | Verificar no manual |
| `TConnectorTradingMessageResultCode` | profitTypes.py | Verificar no manual |
| `SystemTime` | profitTypes.py + manual | OK |
| `TConnectorAccountIdentifier` | profitTypes.py | Verificar no manual |
| `TConnectorAssetIdentifier` | profitTypes.py | Verificar no manual |
| `TConnectorSendOrder` | profitTypes.py + manual | Comparar campos |
| `TConnectorChangeOrder` | profitTypes.py + manual | Comparar campos |
| `TConnectorCancelOrder` | profitTypes.py + manual | Comparar campos |
| `TConnectorOrder` | profitTypes.py | Verificar |
| `TConnectorTrade` | profitTypes.py | Verificar |
| `TNewTradeCallback` | profitTypes.py | Verificar signature |
| `TTheoreticalPriceCallback` | profitTypes.py | Verificar signature |
| `TNewDailyCallback` | profitTypes.py | Verificar signature |

## Decisões Pendentes

1. **Arquitetura de integração**: Usar o serviço WebSocket Python existente (`ws://localhost:8765`) ou criar um wrapper TypeScript direto para a DLL?
   - O servidor Python já existe e faz o bridge
   - Vantagem: reaproveitar código existente
   - Desvantagem: mais uma camada de indireção

2. **Mapeamento de tipos**: Comparar `src/types/profit/` com `profitTypes.py` e corrigir divergências

## Próximos Passos (sequência)

1. [ ] Comparar `src/types/profit/connector.types.ts` com `profitTypes.py` e corrigir divergências
2. [ ] Comparar `src/types/profit/enums.ts` com as definições do Python
3. [ ] Decidir arquitetura: Python bridge vs. wrapper TypeScript direto
4. [ ] Aguardar chave de ativação da Profit DLL
5. [ ] Implementar serviço completo quando credenciais estiverem disponíveis
6. [ ] Testar conexão e fluxo de dados

## Arquivos Relevantes

```
wr_trade_pro_/
├── src/services/profitDLLService.ts       # Stub atual do serviço
├── src/types/profitDLL.ts                # Tipos existentes (Python bridge)
├── src/types/profit/                    # Tipos novos (baseado no manual)
│   ├── connector.types.ts
│   ├── enums.ts
│   └── index.ts
├── src/services/profit-dll/            # Serviço novo
│   ├── ProfitDllService.ts
│   └── index.ts
└── ProfitDLL/Exemplo Python/           # Referência Python
    ├── main.py                        # 1275 linhas — callbacks e comandos
    ├── profitTypes.py                 # 456 linhas — structs e enums ctypes
    └── profit_dll.py                  # 103 linhas — wrapper DLL
```

## Recursos

- Manual PDF: `ProfitDLL/Nelogica_Profit_DLL.pdf` (76 páginas)
- Exemplo Python: `ProfitDLL/Exemplo Python/`
- Código de erros: `NL_*` (0x00000000 a 0xFFFFFFFF)

---

_Última atualização: 2026-04-22_
