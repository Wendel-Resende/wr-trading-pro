# Agente de Trading - WR Trading Pro

## Visão Geral

Sistema de agente de trading que analisa o mercado e sugere operações (BUY/SELL/HOLD) para ativos da B3. O agente usa dados de mercado em tempo real do MT5 e análise via LLM local (Ollama) ou OpenAI.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENTE DE TRADING                        │
│                  (Análise Automática)                      │
├─────────────────────────────────────────────────────────────┤
│  Input:                                                     │
│    - Ticker (ex: PETR4, VALE3, BBDC4)                       │
│    - Market Data em tempo real (MT5):                       │
│      • Preço, Bid, Ask                                     │
│      • Variação percentual                                  │
│      • Fechamento anterior                                 │
│                                                             │
│  Output:                                                    │
│    - BUY / SELL / HOLD                                      │
│    - Entry Price, Stop Loss, Take Profit                    │
│    - Risk Score, Confidence                                 │
│    - Rationale (explicação em português)                   │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    ┌──────────┐       ┌──────────┐       ┌──────────┐
    │   Mock   │       │ OpenAI   │       │  Ollama   │
    │  (Teste) │       │  (GPT)   │       │ (Local)   │
    └──────────┘       └──────────┘       └──────────┘
```

## Arquitetura de Arquivos

### Backend
- `src/app/api/agents/route.ts` - API route que processa requisições e conecta com LLM

### Frontend
- `src/components/AgentPanel.tsx` - Componente principal da UI
- `src/components/tabs/AgentTab.tsx` - Tab wrapper
- `src/app/page.tsx` - Integração como tab principal (não dentro de Admin)

### Python Module (futuro/pipeline completo)
- `agents/__init__.py` - Exports do módulo
- `agents/prompts.py` - Prompts do sistema (adaptados para B3)
- `agents/workers.py` - Classes dos agentes (Director, Quant, Risk, Execution, Sentiment)

**Nota:** O pipeline Python completo (multi-agent) ainda não está integrado. A API atual usa chamadas diretas ao LLM.

## Modos de LLM

| Modo | Configuração | Uso |
|------|--------------|-----|
| **Ollama Local** (padrão) | URL `http://localhost:11434` | Ministral 3 (8B), Gemma 4, Qwen 3.5 |
| **OpenAI** | API Key necessária | GPT-4o-mini |
| **Mock** | Nenhuma | Testes sem LLM (análise básica por variação) |

## Modelos Locais Disponíveis (Ollama)

| Modelo | Parâmetros | Uso Recomendado |
|--------|------------|-----------------|
| `ministral-3:8b` | 8.9B | **Recomendado** - melhor para análise |
| `gemma4:e2b` | 5.1B | Mais rápido |
| `qwen3.5:0.8b` | 873M | Mais leve |

## Como Funciona

### 1. Usuário digita ticker
- Campo de texto para qualquer símbolo B3 (PETR4, VALE3, BBDC4, etc.)
- Dados são puxados em tempo real do MT5 via WebSocket

### 2. Dados do MT5
```typescript
{
  price: 19.30,    // Preço atual
  bid: 19.27,      // Bid
  ask: 19.50,     // Ask
  previousClose: 19.31,
  changePercent: -0.05  // Variação em %
}
```

### 3. Timeout (5 segundos)
- Se o ativo não for encontrado no MT5 em 5s, mostra erro:
  `"Ativo X não encontrado no MT5. Verifique se o símbolo está no Market Watch."`

### 4. Análise via LLM
```typescript
// Prompt enviado para o LLM
prompt = `
Voce e um analista de trading profissional para o mercado brasileiro (B3).

Analise o ativo {ticker} com os seguintes dados de mercado:

DADOS ATUAIS:
- Preco Atual: R$ {price}
- Bid: R$ {bid}
- Ask: R$ {ask}
- Spread: R$ {spread}
- Fechamento Anterior: R$ {previousClose}
- Variacao: {changePercent}%

[...]
`
```

### 5. Output
```json
{
  "action": "HOLD",
  "ticker": "BBDC4",
  "entry_price": 19.30,
  "stop_loss": 18.91,
  "take_profit": 19.88,
  "quantity": 100,
  "risk_score": 0.25,
  "confidence": 0.50,
  "rationale": "Variacao de -0.05%. Sem sinal claro.",
  "timestamp": "2026-05-02T12:20:03.000Z"
}
```

## Interface do Usuário

```
┌─────────────────────────────────────────────────────┐
│ 🤖 Agente de Trading              [MT5 OK] [⚙️]    │
├─────────────────────────────────────────────────────┤
│ Ativo: [BBDC4                               ]       │
│                                                      │
│ ┌────────────────────────────────────────────────┐  │
│ │ BBDC4              Live                        │  │
│ │                                                │  │
│ │ Preco      Bid       Ask      Variacao        │  │
│ │ R$ 19.30  19.27    19.50      -0.05%          │  │
│ │                                                │  │
│ │ [     Analisar e Sugerir Operacao     ]       │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ ┌────────────────────────────────────────────────┐  │
│ │              HOLD BBDC4                        │  │
│ ├────────────────────────────────────────────────┤  │
│ │ Entrada    Stop     Target                     │  │
│ │ 19.30     18.91     19.88                      │  │
│ ├────────────────────────────────────────────────┤  │
│ │ Risco: 25%      Confianca: 50%                 │  │
│ ├────────────────────────────────────────────────┤  │
│ │ Racional: Variacao de -0.05%. Sem sinal claro. │  │
│ └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Configurações (Settings)

```
┌─────────────────────────────────────────────────────┐
│ Configuracao do LLM                                 │
├─────────────────────────────────────────────────────┤
│ Modo: [Ollama Local (Recomendado) ▼]               │
│                                                      │
│ Modelo Local: [Ministral 3 (8B) - Melhor analise ▼]│
│ URL do Ollama: [http://localhost:11434]             │
│                                                      │
│ [              Salvar Configuracao            ]     │
└─────────────────────────────────────────────────────┘
```

## Integração com MT5

O agente usa o `mt5Service` para:
1. `subscribeTicks(ticker)` - Assina ticks do símbolo
2. `unsubscribeTicks(ticker)` - Cancela assinatura quando ticker muda
3. Dados em tempo real: price, bid, ask, changePercent

**Importante:** O símbolo deve estar no Market Watch do MT5 para receber dados.

## API Endpoint

```
POST /api/agents
{
  "action": "suggest-operation",
  "ticker": "BBDC4",
  "market_data": {
    "price": 19.30,
    "bid": 19.27,
    "ask": 19.50,
    "previousClose": 19.31,
    "changePercent": -0.05
  },
  "llm_mode": "local",
  "local_url": "http://localhost:11434",
  "local_model": "ministral-3:8b"
}
```

## Configuração para Desenvolvimento

```bash
# Terminal 1: Dev server
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
npm run dev

# Terminal 2 (opcional): Ollama local
ollama serve

# Acessar: http://localhost:3000
# Ir para aba "Agentes"
```

## Próximos Passos Possíveis

1. **Pipeline Multi-Agent Python**: Integrar o `agents/` module com Director → Quant → Risk → Execution
2. **Histórico de Análises**: Salvar sugestões anteriores
3. **Alertas Automáticos**: Notificar quando agente sugere BUY/SELL
4. **Seleção de Ativos**: Adicionar dropdown com ativos do MT5
5. **Múltiplos LLMs**: Comparar análises de diferentes modelos

---

**Última Atualização:** 2026-05-02
**Status:** Funcional - LLM local (Ollama) integrado e operando