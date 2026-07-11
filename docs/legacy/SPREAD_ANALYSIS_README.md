# Sistema de Análise de Spread B3

Sistema completo de análise de spread para identificação de oportunidades de arbitragem entre pares de ações da B3.

## 📋 Índice

- [Visão Geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Estratégia de Spread](#estratégia-de-spread)
- [Pares Sugeridos](#pares-sugeridos)
- [Componentes](#componentes)
- [Como Usar](#como-usar)
- [Exemplos](#exemplos)

## 🎯 Visão Geral

O sistema permite:

1. **Análise de Par Específico**: Analisar arbitragem entre dois ativos específicos
2. **Busca de Melhores Pares**: Encontrar automaticamente os melhores pares para arbitragem
3. **Ranking de Oportunidades**: Classificar pares por ganho, retorno e número de oportunidades
4. **Métricas Estatísticas**: Visualizar métricas detalhadas das oportunidades encontradas

## 🏗️ Arquitetura

### Estrutura de Arquivos

```
src/
├── types/
│   └── spread.ts              # Tipos TypeScript
├── services/
│   └── spreadService.ts       # Serviço de cálculo
├── components/
│   ├── SpreadAnalysis.tsx     # Componente de análise de par
│   └── SpreadPairsFinder.tsx  # Componente de busca de pares
└── app/
    └── spread/
        └── page.tsx           # Página principal
```

## 📊 Estratégia de Spread

### Estratégia de Arbitragem

O sistema implementa uma estratégia de spread trading baseada em arbitragem entre classes diferentes do mesmo ativo:

```
Dia 1 (Entrada):
1. Venda 1 unidade de A1 (preço: PA1) → Recebe PA1
2. Compra 1 unidade de B1 (preço: PB1) → Gasta PB1
   Saldo após T+0: PA1 − PB1

Dia 2 (Saída, após T+0):
3. Compra 1 unidade de A2 (preço: PA2) → Gasta PA2
4. Venda 1 unidade de B2 (preço: PB2) → Recebe PB2
   Saldo após T+1: PA1 − PB1 − PA2 + PB2

Ganho Líquido: (PA1 − PA2) + (PB2 − PB1)
```

### Critérios de Validação

- **Volume Mínimo**: Apenas dias com volume > 0 são considerados
- **Ganho Positivo**: Apenas oportunidades com ganho > 0 são exibidas
- **Ganho Mínimo**: Filtragem por valor mínimo configurável (ex: R$ 0,10)

## 💼 Pares Sugeridos

O sistema inclui os seguintes pares de ações da B3:

1. **PETR3 - PETR4** (Petrobras)
2. **BBAS3 - BBAS4** (Banco do Brasil)
3. **VALE3 - VALE5** (Vale)
4. **BBDC4 - BBDC5** (Bradesco)
5. **GGBR4 - GGBR5** (Gerdau)
6. **ITSA3 - ITSA4** (Itaúsa)
7. **ITUB3 - ITUB4** (Itaú Unibanco)
8. **BBSE3 - BBSE4** (BB Seguridade)
9. **B3SA3 - B3SA4** (B3)

## 🧩 Componentes

### 1. Tipos TypeScript (`src/types/spread.ts`)

Define todos os tipos utilizados pelo sistema:

- `SpreadDataPoint`: Dados históricos de um ativo
- `SpreadConfig`: Configuração da análise
- `SpreadResult`: Resultado da análise
- `SpreadOpportunity`: Oportunidade de arbitragem
- `SpreadMetrics`: Métricas estatísticas
- `SpreadPairAnalysis`: Análise de um par
- `SpreadRanking`: Ranking de pares
- `PARES_SUGERIDOS`: Lista de pares predefinidos

### 2. Serviço de Spread (`src/services/spreadService.ts`)

Classe `SpreadCalculator` com métodos:

- `calcularSpread()`: Calcula spread entre dois ativos
- `encontrarMelhoresPares()`: Encontra os melhores pares para arbitragem
- `criarRanking()`: Cria ranking por diferentes critérios
- `calcularMetrics()`: Calcula métricas estatísticas
- `getHistoricalData()`: Obtém dados históricos via MT5

### 3. Componente de Análise (`src/components/SpreadAnalysis.tsx`)

Permite análise de um par específico:

- Configuração dos parâmetros
- Exibição da estratégia
- Visualização de preços atuais
- Tabela de oportunidades encontradas
- Métricas estatísticas

### 4. Buscador de Pares (`src/components/SpreadPairsFinder.tsx`)

Busca automaticamente os melhores pares:

- Ranking por maior ganho
- Ranking por melhor retorno
- Ranking por mais oportunidades
- Lista completa de pares analisados

### 5. Dashboard (`src/app/page.tsx`)

O sistema de spread está integrado diretamente no Dashboard principal:

- Aba "Spread B3" na navegação superior
- Configuração de parâmetros
- Seleção de aba (Análise/Busca)
- Predefinição de ganhos mínimos
- Integração com MT5 (compartilha a conexão do Dashboard)

## 🚀 Como Usar

### Acesso ao Sistema

**Via Dashboard Principal**:
- Abra o dashboard em `/`
- Clique na aba "Spread B3" na navegação superior
- A análise de spread compartilha a conexão MT5 do Dashboard

**Vantagens da Integração**:
- Não há necessidade de reconectar ao MT5
- Estado da conexão compartilhado
- Interface unificada com o Dashboard
- Acesso fácil a outras funcionalidades

### Análise de Par Específico

1. **Configurar Parâmetros**:
   - Informe o símbolo 1 (ex: PETR4)
   - Informe o símbolo 2 (ex: PETR3)
   - Selecione o período de análise
   - Defina o ganho mínimo

2. **Executar Análise**:
   - Clique em "Analisar Oportunidades"
   - Aguarde o processamento

3. **Visualizar Resultados**:
   - Preços atuais dos ativos
   - Métricas estatísticas
   - Tabela de oportunidades com todos os detalhes

### Buscar Melhores Pares

1. **Configurar Parâmetros**:
   - Selecione o período de análise
   - Defina o ganho mínimo

2. **Executar Busca**:
   - Clique em "Encontrar Melhores Pares"
   - O sistema analisará todos os pares sugeridos

3. **Visualizar Rankings**:
   - Top 5 por maior ganho
   - Top 5 por melhor retorno
   - Top 5 por mais oportunidades
   - Lista completa de todos os pares

## 📈 Exemplos

### Exemplo 1: Análise PETR4 x PETR3

```
Configuração:
- Símbolo 1: PETR4
- Símbolo 2: PETR3
- Período: Últimos 30 dias
- Ganhos Mínimo: R$ 0,10

Resultado:
- 15 oportunidades encontradas
- Ganho médio: R$ 0,45
- Melhor retorno: 0,35%
- Maior ganho: R$ 1,20
```

### Exemplo 2: Busca de Melhores Pares

```
Configuração:
- Período: Últimos 90 dias
- Ganhos Mínimo: R$ 0,25

Ranking por Ganho:
1. PETR3-PETR4: R$ 2,50 (35 oportunidades)
2. GGBR4-GGBR5: R$ 1,45 (18 oportunidades)

Ranking por Retorno:
1. ITSA3-ITSA4: 0,85% (28 oportunidades)
2. PETR3-PETR4: 0,65% (35 oportunidades)
3. BBDC4-BBDC5: 0,52% (15 oportunidades)
```

## 🔧 Requisitos

- MetaTrader 5 conectado
- Acesso a dados da B3
- Navegador moderno com suporte a JavaScript

## 📝 Notas

- O sistema utiliza dados do MT5 via WebSocket
- Análise em tempo real com período diário (D1)
- Validação de volume para garantir liquidez
- Filtragem por ganho mínimo para reduzir ruído

## 🎨 Interface

O sistema utiliza o tema "Cyberpunk" da aplicação:

- Cores: Pink, Cyan, Purple
- Fontes: Orbitron (títulos), Space Mono (código)
- Efeitos: Neon, Gradient, HUD corners

## 🚧 Limitações

- Análise limitada a período diário (D1)
- Número máximo de 500 dias históricos
- Timeout de 10 segundos para requisições
- Pares limitados aos sugeridos no sistema

## 📞 Suporte

Para dúvidas ou problemas, consulte a documentação geral do projeto ou entre em contato com a equipe de desenvolvimento.