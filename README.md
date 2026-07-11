# WR Trading Pro

Plataforma de trading avançada com análise quantitativa, machine learning e integrações em tempo real.

## 🚀 Tecnologias

- **Frontend**: Next.js 15, React 19, TypeScript
- **Estilização**: Tailwind CSS com tema Cyberpunk
- **Banco de Dados**: SQLite com Prisma ORM
- **Gráficos**: TradingView Lightweight Charts, Recharts
- **Ícones**: Lucide React
- **Fontes**: Orbitron, Space Mono, JetBrains Mono

## ✨ Funcionalidades

### Dashboard em Tempo Real
- Ticker de preços em tempo real
- Gráficos de candlestick interativos
- Indicadores técnicos (RSI, MACD, Bollinger Bands)
- Book de ofertas

### Análise Quantitativa
- Cálculo de indicadores técnicos
- Recomendações de compra/venda
- Análise de tendências
- Scores de confiança

### Gestão de Portfólio
- Visualização de posições ativas
- Cálculo de P&L em tempo real
- Gráfico de alocação de ativos
- Histórico de operações

### Execução de Ordens
- Ordens de mercado, limite e stop
- Validação de risco em tempo real
- Stop loss e take profit
- Histórico de execuções

### Assistente de IA
- Chat com IA para análise de trading
- Sugestões de otimização de portfólio
- Interpretação de sinais de mercado
- Suporte multi-provider (OpenAI, Deepseek, Ollama, Qwen, Groq)

### Integrações de Mercado
- **Mock**: Dados simulados para desenvolvimento
- **B3**: Integração com B3 Data Solutions (planejado)
- **ProfitDLL**: Integração com Nelogica Data Solutions (planejado)
- **MetaTrader 5**: Integração com MT5 (planejado)

## 🛠️ Instalação

```bash
# Instalar dependências
npm install

# Iniciar banco de dados
npx prisma db push

# Executar em modo desenvolvimento
npm run dev
```

## 📁 Estrutura do Projeto

```
wr-trade-pro/
├── prisma/
│   └── schema.prisma          # Schema do banco de dados
├── src/
│   ├── app/
│   │   ├── globals.css        # Estilos globais
│   │   ├── layout.tsx         # Layout principal
│   │   └── page.tsx          # Página do dashboard
│   ├── components/
│   │   ├── AIChat.tsx        # Componente de chat com IA
│   │   ├── CandlestickChart.tsx  # Gráfico de candlestick
│   │   ├── OrderForm.tsx      # Formulário de ordens
│   │   ├── Portfolio.tsx      # Gestão de portfólio
│   │   └── PriceTicker.tsx    # Ticker de preços
│   ├── lib/
│   │   └── prisma.ts         # Cliente Prisma
│   ├── services/
│   │   ├── marketDataService.ts      # Serviço de dados de mercado
│   │   └── technicalAnalysisService.ts  # Serviço de análise técnica
│   └── types/
│       └── index.ts          # Tipos TypeScript
├── .env                     # Variáveis de ambiente
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.mjs
```

## 🎨 Tema Cyberpunk

A plataforma utiliza um tema cyberpunk com:
- Cores neon (rosa, ciano, roxo)
- Fontes geométricas ousadas (Orbitron, Space Mono, JetBrains Mono)
- Efeitos de brilho neon (text-shadow, glow effects)
- Componentes HUD com linhas técnicas e colchetes de canto
- Fundo escuro com grid ciano sutil

## 🔧 Configuração

### Variáveis de Ambiente

```env
# Database
DATABASE_URL="file:./dev.db"

# AI Providers (opcional)
OPENAI_API_KEY=""
DEEPSEEK_API_KEY=""
OLLAMA_ENDPOINT="http://localhost:11434"
QWEN_API_KEY=""
GROQ_API_KEY=""

# Data Sources (opcional)
B3_API_KEY=""
B3_API_SECRET=""
PROFITDLL_USERNAME=""
PROFITDLL_PASSWORD=""
MT5_LOGIN=""
MT5_PASSWORD=""
MT5_SERVER=""
```

## 📊 Indicadores Técnicos Implementados

- **RSI** (Relative Strength Index)
- **MACD** (Moving Average Convergence Divergence)
- **Bollinger Bands**
- **SMA** (Simple Moving Average)
- **EMA** (Exponential Moving Average)

## 🚧 Roadmap

- [ ] Integração real com B3 Data Solutions
- [ ] Integração com ProfitDLL (Nelogica)
- [ ] Integração com MetaTrader 5
- [ ] Implementação de modelos de ML (LSTM, GRU, Transformer)
- [ ] Dashboard administrativo completo
- [ ] Sistema de alertas em tempo real
- [ ] Backtesting de estratégias
- [ ] Otimização de portfólio automática
- [ ] Testes unitários e de integração
- [ ] Deployment em produção

## 📝 Licença

Este projeto é para fins educacionais e de demonstração.

## ⚠️ Aviso

Trading envolve riscos significativos. Esta plataforma é para fins educacionais e não constitui recomendação de investimento. Sempre faça sua própria pesquisa e consulte um profissional qualificado antes de tomar decisões de investimento.