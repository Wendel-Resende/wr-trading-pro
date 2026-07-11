# Análise e Plano de Implementação - Monitoramento de Ações

## Resumo Executivo

Este documento apresenta a análise da planilha `monitoramento.xlsx` e o plano detalhado para integrar suas funcionalidades na plataforma WR Trading Pro.

---

## 1. Análise da Planilha

### 1.1 Estrutura

A planilha possui duas abas principais:

#### Aba 1: Painel Gestão
Painel principal de monitoramento de ações com foco em análise fundamentalista e controle de carteira.

#### Aba 2: Registro de Ordens
Histórico de operações (atualmente vazio, aguarda implementação de funcionalidades de ordens).

### 1.2 Campos Principais do Painel Gestão

#### a) Identificação da Ação
- **Nome da empresa**: Ex: COPEL, SANEPAR, KLABIN, Banco do Brasil, Bradesco
- **COD da ação**: CPLE3, SAPR3, KLBN3, BBAS3, BBDC4
- **Tipo de Ação**: On (Ordinária) ou Pn (Preferencial)
- **Composição**: Fator de composição da ação

#### b) Métricas Fundamentalistas
- **Preço / Yield**: Rendimento atual
- **Payout Estatuto**: Percentual de distribuição de lucros
- **DY MÉDIO 3 a.a**: Dividend Yield médio dos últimos 3 anos

#### c) Gatilhos de Compra (Indicadores Técnicos)
- **Gatilho ROE >**: Return on Equity - indicador de rentabilidade
- **Gatilho VPA <=**: Valor Patrimonial por Ação
- **Gatilho LPA >**: Lucro Por Ação

#### d) Preços e Mercado
- **Preço ATUAL Mercado**: Preço atual da ação
- **Preço TETO 3/8**: Preço máximo de compra (cálculo 3/8)
- **Preço Teto 3/8 reajustado**: Preço máximo ajustado

#### e) Controle de Posição
- **Meta Papéis**: Quantidade desejada de ações
- **Quant. Adquirida**: Quantidade já adquirida
- **P. médio Compra**: Preço médio de entrada
- **Valor Investido**: Total investido na posição
- **RESULTADO (P&L)**: Lucro ou prejuízo da posição
- **Valor carteira**: Valor atual da posição
- **Participação na carteira**: % que a ação representa na carteira total

#### f) Projeção de Dividendos
- **Previsão Recebimento Dividendo anual**: Valor estimado anual
- **Yield on cost (%)**: Rendimento sobre o custo de aquisição

#### g) Dados Financeiros da Empresa
- **Patrimônio Líquido (ano anterior)**
- **Lucro Líquido (ano anterior)**
- **Ações Emitidas**
- **VPA - Valor Patrimonial por Ação**
- **P/VPA (Multiplos)**: Preço sobre VPA
- **LPA - Lucro Por Ação (12 meses)**
- **Preço/Lucro (12 meses)**: Múltiplo P/L
- **ROE (%)**: Return on Equity

#### h) Mapa de Dividendos (Mensal)
- Valores previstos de janeiro a dezembro para cada ação

### 1.3 Campos do Registro de Ordens
- Data Operação
- Compra/venda
- Nome empresa
- Cod ação
- Qtd negociada
- Preço Negociado
- Total Corretagem

### 1.4 Ações Exemplo na Planilha
- **COPEL (CPLE3)**: Energia/Saneamento - 200 ações
- **SANEPAR (SAPR3)**: Saneamento - Posição vazia
- **KLABIN (KLBN3)**: Papel e Celulose - 100 ações
- **Banco do Brasil (BBAS3)**: Bancos - 29 ações
- **Bradesco (BBDC4)**: Bancos - 100 ações

---

## 2. Arquitetura Atual do WR Trading Pro

### 2.1 Banco de Dados (Prisma Schema)
- **Asset**: Ativos (ações, ETF, crypto, forex)
- **Position**: Posições abertas/fechadas
- **Order**: Ordens de compra/venda
- **Prediction**: Previsões de ML
- **MarketData**: Dados históricos de mercado
- **TechnicalIndicator**: Indicadores técnicos
- **SpreadOrder**: Ordens de spread B3

### 2.2 Interface
- Dashboard com múltiplas abas
- Conexão com MetaTrader 5
- Gráficos de velas
- Formulário de ordens
- Book de ofertas
- Posições abertas
- Portfólio
- Spread B3

### 2.3 Serviços
- MT5Service: Integração com MetaTrader 5
- MarketDataService: Dados de mercado
- SpreadOrderService: Ordens de spread
- MLService: Machine Learning

---

## 3. Plano de Implementação

### 3.1 Fase 1: Estrutura de Dados

#### 3.1.1 Novos Models no Prisma Schema

```prisma
// Modelo para monitoramento de ações fundamentalistas
model StockMonitoring {
  id                          String   @id @default(cuid())
  assetId                     String
  asset                       Asset    @relation(fields: [assetId], references: [id])
  
  // Dados fundamentais estáticos
  stockType                   String   // ON, PN
  composition                 Float    @default(1)
  payoutEstatuto              Float?
  dyMedia3Anos                Float?
  
  // Gatilhos de compra
  gatilhoROE                  Float?
  gatilhoVPA                  Float?
  gatilhoLPA                  Float?
  
  // Preços de referência
  precoTeto38                 Float?
  precoTeto38Reajustado       Float?
  
  // Metas
  metaPapeis                  Int      @default(0)
  
  // Dados financeiros
  patrimonioLiquido           Float?
  lucroLiquido                Float?
  acoesEmitidas               BigInt?
  vpa                         Float?
  pVpa                        Float?
  lpa                         Float?
  precoLucro                  Float?
  roe                         Float?
  
  // Projeção de dividendos
  previsaoDividendoAnual      Float?
  yieldOnCost                 Float?
  
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt
  
  @@index([assetId])
}

// Mapa mensal de dividendos
model DividendMap {
  id          String   @id @default(cuid())
  stockId     String
  jan         Float    @default(0)
  fev         Float    @default(0)
  mar         Float    @default(0)
  abr         Float    @default(0)
  mai         Float    @default(0)
  jun         Float    @default(0)
  jul         Float    @default(0)
  ago         Float    @default(0)
  set         Float    @default(0)
  out         Float    @default(0)
  nov         Float    @default(0)
  dez         Float    @default(0)
  total       Float    @default(0)
  ano         Int
  
  stock       StockMonitoring @relation(fields: [stockId], references: [id])
  
  @@unique([stockId, ano])
  @@index([stockId])
}

// Registro histórico de ordens B3
model B3OrderHistory {
  id              String   @id @default(cuid())
  assetId         String
  asset           Asset    @relation(fields: [assetId], references: [id])
  
  dataOperacao    DateTime
  tipoOperacao    String   // COMPRA, VENDA
  quantidade      Int
  precoNegociado  Float
  totalCorretagem Float?
  
  createdAt       DateTime @default(now())
  
  @@index([assetId])
  @@index([dataOperacao])
}
```

### 3.2 Fase 2: Backend API

#### 3.2.1 Novas Rotas API

```
/api/stock-monitoring
  - GET /: Lista todos os monitoramentos
  - GET /:id: Busca monitoramento específico
  - POST /: Cria novo monitoramento
  - PUT /:id: Atualiza monitoramento
  - DELETE /:id: Remove monitoramento
  
/api/stock-monitoring/calculate
  - POST /: Recalcula preços e métricas
  
/api/dividend-map
  - GET /: Listar mapa de dividendos
  - POST /: Criar mapa de dividendos
  - PUT /:id: Atualizar mapa
  
/api/b3-orders
  - GET /: Listar histórico de ordens
  - POST /: Registrar nova ordem
```

#### 3.2.2 Serviços

**stockMonitoringService.ts**
```typescript
interface StockMonitoring {
  assetId: string;
  stockType: 'ON' | 'PN';
  composition: number;
  payoutEstatuto?: number;
  dyMedia3Anos?: number;
  gatilhoROE?: number;
  gatilhoVPA?: number;
  gatilhoLPA?: number;
  precoTeto38?: number;
  precoTeto38Reajustado?: number;
  metaPapeis?: number;
  // ... demais campos
}
```

**stockCalculationService.ts**
```typescript
// Calcular Preço Teto 3/8
function calcularPrecoTeto38(vpa: number, composition: number): number {
  return vpa * 3 / 8 * composition;
}

// Calcular Yield on Cost
function calcularYieldOnCost(dividendoAnual: number, valorInvestido: number): number {
  return (dividendoAnual / valorInvestido) * 100;
}

// Calcular Participação na Carteira
function calcularParticipacaoCarteira(valorPosicao: number, valorCarteira: number): number {
  return (valorPosicao / valorCarteira) * 100;
}
```

### 3.3 Fase 3: Interface Frontend

#### 3.3.1 Nova Aba "Monitoramento Ações"

Adicionar nova aba na navegação principal:
```typescript
{ id: 'stocks', label: 'Monitoramento Ações', icon: TrendingUp }
```

#### 3.3.2 Componentes Principais

**StockMonitoringTable.tsx**
- Tabela com todas as ações monitoradas
- Colunas: Nome, Código, Tipo, Preço Atual, Preço Teto, Posição, Investido, Resultado, Yield, ROE
- Indicadores visuais de compra/venda (gatilhos)
- Destaque para ações abaixo do preço teto
- Alertas visuais para oportunidades

**StockDetailPanel.tsx**
- Painel lateral com detalhes da ação selecionada
- Gráficos de histórico de preços
- Indicadores fundamentalistas completos
- Mapa de dividendos por mês
- Histórico de ordens da ação

**StockOrderForm.tsx**
- Formulário para registrar ordens manuais
- Campos: Data, Tipo, Quantidade, Preço, Corretagem
- Integração com Position do MT5

**DividendCalendar.tsx**
- Calendário visual de recebimentos
- Visão mensal/annual
- Projeção de rendimentos futuros
- Filtros por ação/setor

**PortfolioDashboard.tsx**
- Resumo geral da carteira de ações
- Total investido
- Valor atual
- Resultado global
- Dividendos totais do ano
- Distribuição por setor
- Top performadores

#### 3.3.3 Layout Proposto

```
┌─────────────────────────────────────────────────────────────┐
│ WR TRADING PRO - Monitoramento de Ações                     │
├─────────────────────────────────────────────────────────────┤
│ [Dashboard] [Ordens] [Portfólio] [Previsões] [MODELOS]      │
│ [Spread] [MONITORAMENTO AÇÕES] [Admin]                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ┌─────────────┬──────────────────────────────────────────┐  │
│ │ Filtros     │  Tabela Principal de Ações               │  │
│ │             │                                          │  │
│ │ • Setor     │  ┌──┬──┬──┬──┬──┬──┬──┬──┐               │  │
│ │ • Tipo      │  │  │  │  │  │  │  │  │  │               │  │
│ │ • Status    │  ├──┼──┼──┼──┼──┼──┼──┤                  │  │
│ │ • Ordenação │  │  │  │  │  │  │  │  │  │               │  │
│ │             │  ├──┼──┼──┼──┼──┼──┼──┤                  │  │
│ │ [Adicionar] │  │  │  │  │  │  │  │  │  │               │  │
│ │             │  └──┴──┴──┴──┴──┴──┴──┴──┘               │  │
│ └─────────────┴──────────────────────────────────────────┘  │
│                                                             │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ Resumo da Carteira                                    │   │
│ │ ┌───────────┬───────────┬───────────┬──────────────┐  │   │
│ │ │ Total     │ Atual     │ Resultado │ Dividendos   │  │   │
│ │ │ Investido │           │           │ Anuais       │  │   │
│ │ └───────────┴───────────┴───────────┴──────────────┘  │   │
│ └───────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ Calendário de Dividendos                              │   │
│ │ Jan | Fev | Mar | ... | Dez | Total                   │   │
│ └───────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 Fase 4: Integração com MT5

#### 3.4.1 Sincronização de Preços
- Buscar preços atualizados via MT5Service
- Atualizar Preço Atual em tempo real
- Recalcular valor de posição e resultado automaticamente

#### 3.4.2 Sincronização de Posições
- Importar posições do MT5 automaticamente
- Sincronizar quantidade e preço médio
- Manter histórico de alterações

#### 3.4.3 Execução de Ordens
- Envio de ordens de compra/venda via MT5
- Registro automático no histórico
- Atualização de posições

### 3.5 Fase 5: Funcionalidades Avançadas

#### 3.5.1 Alertas e Notificações
- Preço abaixo do gatilho de compra
- Preço acima do preço teto
- Dividendos pagos
- Mudanças em indicadores fundamentais

#### 3.5.2 Relatórios
- Relatório mensal de performance
- Análise de dividendos recebidos
- Comparação com benchmark (IBOVESPA)
- Análise de setor

#### 3.5.3 Importação/Exportação
- Importar dados da planilha Excel existente
- Exportar dados para Excel
- Backup de dados

---

## 4. Fluxo de Trabalho Sugerido

### 4.1 Implementação em Sprints

**Sprint 1: Fundação (1-2 semanas)**
- Criar models no Prisma
- Criar migrations
- Configurar API routes básicas
- Criar serviços base

**Sprint 2: Interface Básica (2-3 semanas)**
- Criar tabela de monitoramento
- Implementar formulário de cadastro
- Criar painel de detalhes
- Layout responsivo

**Sprint 3: Integração MT5 (1-2 semanas)**
- Sincronizar preços
- Importar posições
- Executar ordens

**Sprint 4: Funcionalidades Avançadas (2-3 semanas)**
- Mapa de dividendos
- Dashboard de carteira
- Alertas
- Relatórios

**Sprint 5: Polimento (1 semana)**
- Testes
- Otimizações
- Documentação

### 4.2 Prioridades

**Alta Prioridade:**
1. Estrutura de dados (Prisma)
2. Tabela principal de monitoramento
3. Cadastro de ações
4. Cálculos automáticos (preço teto, resultado)
5. Sincronização com MT5

**Média Prioridade:**
1. Mapa de dividendos
2. Dashboard de carteira
3. Histórico de ordens
4. Alertas

**Baixa Prioridade:**
1. Relatórios avançados
2. Importação/Exportação
3. Análise de setor
4. Comparação com benchmark

---

## 5. Considerações Técnicas

### 5.1 Performance
- Usar índices no banco de dados para consultas rápidas
- Implementar cache para dados fundamentais estáticos
- Paginação na tabela de ações

### 5.2 Dados de Mercado
- Fontes de dados fundamentalistas (CVM, statusinvest)
- Atualização periódica de dados financeiros
- Histórico de preços para cálculos técnicos

### 5.3 Validações
- Validar preços positivos
- Verificar consistência de dados
- Prevenir duplicação de ações

### 5.4 Segurança
- Criptografia de dados sensíveis
- Logs de todas as operações
- Backup regular do banco de dados

---

## 6. Benefícios da Implementação

### 6.1 Para o Usuário
- Visualização completa da carteira de ações
- Monitoramento automatizado de gatilhos de compra
- Projeções de dividendos
- Histórico completo de operações
- Análises de performance

### 6.2 Para a Plataforma
- Expansão do escopo (ações B3)
- Diferencial competitivo
- Ferramenta de gestão de longo prazo
- Atrair investidores fundamentalistas

---

## 7. Conclusão

A implementação do monitoramento de ações baseado na planilha Excel é uma adição valiosa para a WR Trading Pro. A plataforma já possui a infraestrutura necessária (banco de dados, interface, integração MT5), o que facilita a implementação.

**Próximos Passos Recomendados:**
1. Aprovação do plano
2. Iniciar Sprint 1 (Fundação)
3. Criar estrutura de dados
4. Implementar API básica
5. Desenvolver interface inicial
6. Testar integração com MT5

O tempo estimado total para implementação completa é de **8-11 semanas**, considerando um desenvolvedor trabalhando em tempo integral.

---

## 8. Referências

- Planilha: `monitoramento_acoes/monitoramento.xlsx`
- Schema Atual: `prisma/schema.prisma`
- Interface Principal: `src/app/page.tsx`
- Serviços: `src/services/`

---

*Documento gerado em 11/01/2026*