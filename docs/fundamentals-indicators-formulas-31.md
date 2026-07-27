# Fórmulas de Indicadores Fundamentalistas — 31 Indicadores

**Documento:** Especificação técnica para implementação das 31 fórmulas de cálculo  
**Fonte:** Investidor10 (extraído 2026-07-26)  
**Objetivo:** Guiar implementação em `cvm-fundamentals-*.ts`  
**Status:** Referência técnica para desenvolvimento

---

## 📋 Convenções

- **Valores CVM:** Decimal (ex: 0,1357 para 13,57%)
- **Séries:** Trimestral (T1-T4) + 12M rolling
- **Unidades:** Explícitas por indicador
- **Validações:** Denominador zero → `null` + motivo
- **Point-in-Time:** Usar `knowledgeDate` (prazo legal) para consistência temporal

---

## 🏷️ CATEGORIA 1: VALUATION (12 indicadores)

### 1.1 P/L (Price-to-Earnings)
```
P/L = Preço Atual da Ação / LPA (Lucro Por Ação)
    = Preço Atual / (Lucro Líquido / Número de Ações)

Fontes CVM:
  - Lucro Líquido: DRE.vlr_lucro_liquido (12M rolling)
  - Número de Ações: tabela capital_social ou últimos dados

Unidade: Razão (adimensional, ex: 18,40x)
Validação: Se LPA ≤ 0 → null (empresa com prejuízo)
Nota: Requer preço de mercado (MT5 ou atualização externa)
```

### 1.2 P/VP (Price-to-Book Value)
```
P/VP = Preço Atual da Ação / VPA (Valor Patrimonial por Ação)
     = Preço Atual / (Patrimônio Líquido / Número de Ações)

Fontes CVM:
  - Patrimônio Líquido: BPA.vlr_pl (último trimestre)
  - Número de Ações: capital_social

Unidade: Razão (ex: 1,58x)
Validação: Se PL ≤ 0 → null
Nota: Requer preço de mercado
```

### 1.3 PSR (Price-to-Sales Ratio)
```
PSR = Preço Atual da Ação / RPA (Receita Por Ação)
    = Preço Atual / (Receita Líquida / Número de Ações)

Fontes CVM:
  - Receita Líquida: DRE.vlr_receita_liquida (12M rolling)
  - Número de Ações: capital_social

Unidade: Razão (ex: 0,94x)
Validação: Se Receita ≤ 0 → null
Nota: Requer preço de mercado
```

### 1.4 EV/EBITDA (Enterprise Value / EBITDA)
```
EV/EBITDA = Valor da Empresa / EBITDA
          = (Capitalização de Mercado + Dívida Líquida) / EBITDA

Fontes CVM:
  - Capitalização: Preço × Número de Ações
  - Dívida Líquida: Derivada do BPA e DFC
  - EBITDA: DRE.vlr_lucro_operacional + Depreciação + Amortização
           (ou aproximado: EBIT + D&A)

Unidade: Razão (ex: 5,58x)
Validação: Se EBITDA ≤ 0 → null
Nota: EBITDA pode não estar disponível diretamente; calcular de EBIT + D&A
```

### 1.5 EV/EBIT (Enterprise Value / EBIT)
```
EV/EBIT = Valor da Empresa / EBIT
        = (Capitalização + Dívida Líquida) / EBIT

Fontes CVM:
  - Capitalização: Preço × Número de Ações
  - Dívida Líquida: Derivada
  - EBIT: DRE.vlr_lucro_operacional (ou lucro antes de juros/impostos)

Unidade: Razão (ex: 8,69x)
Validação: Se EBIT ≤ 0 → null
```

### 1.6 P/EBITDA (Price-to-EBITDA)
```
P/EBITDA = Preço Atual / (EBITDA / Número de Ações)
         = Preço Atual / EBITDA_Por_Ação

Fontes CVM:
  - EBITDA: Conforme 1.4
  - Número de Ações: capital_social

Unidade: Razão (ex: 3,14x)
Validação: Se EBITDA ≤ 0 → null
```

### 1.7 P/EBIT (Price-to-EBIT)
```
P/EBIT = Preço Atual / (EBIT / Número de Ações)
       = Preço Atual / EBIT_Por_Ação

Fontes CVM:
  - EBIT: DRE.vlr_lucro_operacional
  - Número de Ações: capital_social

Unidade: Razão (ex: 4,89x)
Validação: Se EBIT ≤ 0 → null
```

### 1.8 P/Ativo (Price-to-Assets)
```
P/Ativo = Preço Atual da Ação / (Total Ativo / Número de Ações)
        = Preço Atual / Ativo_Por_Ação

Fontes CVM:
  - Total Ativo: BPA.vlr_ativo_total (último trimestre)
  - Número de Ações: capital_social

Unidade: Razão (ex: 0,49x)
Validação: Se Ativo ≤ 0 → null
```

### 1.9 P/Ativo Circulante Líquido
```
P/ACL = Preço Atual / (Ativo Circulante Líquido / Número de Ações)

Ativo Circulante Líquido = Ativo Circulante - Passivo Circulante

Fontes CVM:
  - Ativo Circulante: BPA.vlr_ativo_circulante
  - Passivo Circulante: BPA.vlr_passivo_circulante
  - Número de Ações: capital_social

Unidade: Razão (ex: -0,63x - pode ser negativo)
Validação: Se ACL ≤ 0 → permitir (indica passivo circulante > ativo)
```

### 1.10 P/Capital de Giro
```
P/CapGiro = Preço Atual / (Capital de Giro / Número de Ações)

Capital de Giro = Ativo Circulante - Passivo Circulante

Fontes CVM: (idem 1.9)

Unidade: Razão (ex: 11,06x)
Validação: Se CapGiro ≤ 0 → null
Nota: Altamente sensível a empresas com capital de giro negativo/baixo
```

### 1.11 LPA (Lucro Por Ação)
```
LPA = Lucro Líquido / Número de Ações em Circulação

Fontes CVM:
  - Lucro Líquido: DRE.vlr_lucro_liquido (12M rolling)
  - Número de Ações: capital_social

Unidade: R$ por ação (ex: 2,00)
Validação: Se número de ações ≤ 0 → null
Nota: Negativo indica prejuízo; é válido mostrar
```

### 1.12 VPA (Valor Patrimonial Por Ação)
```
VPA = Patrimônio Líquido / Número de Ações em Circulação

Fontes CVM:
  - Patrimônio Líquido: BPA.vlr_pl (último trimestre)
  - Número de Ações: capital_social

Unidade: R$ por ação (ex: 23,40)
Validação: Se PL ≤ 0 → null
```

---

## 💰 CATEGORIA 2: EFICIÊNCIA / MARGENS (5 indicadores)

### 2.1 Margem Bruta
```
Margem Bruta = Lucro Bruto / Receita Líquida
             = (Receita Líquida - Custo de Vendas) / Receita Líquida

Fontes CVM:
  - Receita Líquida: DRE.vlr_receita_liquida
  - Lucro Bruto: DRE.vlr_lucro_bruto
             OU Receita - Custo de Vendas

Unidade: % (0-100%, ex: 26,39)
Validação: Se Receita ≤ 0 → null
Escala: Decimal (0,2639) → multiplicar por 100 na UI
```

### 2.2 Margem EBITDA
```
Margem EBITDA = EBITDA / Receita Líquida

EBITDA = Lucro Operacional + Depreciação + Amortização
       ≈ EBIT + D&A

Fontes CVM:
  - EBIT: DRE.vlr_lucro_operacional
  - Depreciação: DRE.vlr_depreciacao (se disponível)
  - Amortização: DRE.vlr_amortizacao (se disponível)
  - Receita Líquida: DRE.vlr_receita_liquida

Unidade: % (0-100%, ex: 30,07)
Validação: Se Receita ≤ 0 → null
Escala: Decimal → ×100 na UI
Nota: Se D&A não disponíveis, usar EBIT como proxy (resultará em margens mais baixas)
```

### 2.3 Margem EBIT (Margem Operacional)
```
Margem EBIT = EBIT / Receita Líquida
            = Lucro Operacional / Receita Líquida

Fontes CVM:
  - EBIT: DRE.vlr_lucro_operacional
  - Receita Líquida: DRE.vlr_receita_liquida

Unidade: % (ex: 19,31)
Validação: Se Receita ≤ 0 → null
Escala: Decimal → ×100
```

### 2.4 Margem Líquida
```
Margem Líquida = Lucro Líquido / Receita Líquida

Fontes CVM:
  - Lucro Líquido: DRE.vlr_lucro_liquido
  - Receita Líquida: DRE.vlr_receita_liquida

Unidade: % (ex: 5,13)
Validação: Se Receita ≤ 0 → null
Escala: Decimal → ×100
```

### 2.5 Giro de Ativos
```
Giro de Ativos = Receita Líquida / Total de Ativo

Fontes CVM:
  - Receita Líquida: DRE.vlr_receita_liquida (12M rolling)
  - Total Ativo: BPA.vlr_ativo_total (média do período ou final)

Unidade: Razão (ex: 0,51x)
Validação: Se Ativo ≤ 0 → null
Nota: Mede eficiência na utilização de ativos
```

---

## 📈 CATEGORIA 3: RENTABILIDADE / RETORNO (3 indicadores)

### 3.1 ROE (Return on Equity)
```
ROE = Lucro Líquido / Patrimônio Líquido Médio
    ≈ Lucro Líquido (12M) / PL (último trimestre)

Fontes CVM:
  - Lucro Líquido: DRE.vlr_lucro_liquido (12M rolling)
  - Patrimônio Líquido: BPA.vlr_pl (último trimestre)

Unidade: % (ex: 8,57)
Validação: Se PL ≤ 0 → null
Escala: Decimal → ×100
Nota: Pode estar disponível em fundamental_indicators (usar se confiável)
```

### 3.2 ROA (Return on Assets)
```
ROA = Lucro Líquido / Total de Ativo Médio
    ≈ Lucro Líquido (12M) / Ativo Total (último trimestre)

Fontes CVM:
  - Lucro Líquido: DRE.vlr_lucro_liquido (12M rolling)
  - Total Ativo: BPA.vlr_ativo_total (último trimestre)

Unidade: % (ex: 2,63)
Validação: Se Ativo ≤ 0 → null
Escala: Decimal → ×100
```

### 3.3 ROIC (Return on Invested Capital)
```
ROIC = EBIT / Capital Investido
     = EBIT / (Patrimônio Líquido + Dívida Líquida)

Fontes CVM:
  - EBIT: DRE.vlr_lucro_operacional (12M rolling)
  - Patrimônio Líquido: BPA.vlr_pl
  - Dívida Líquida: Derivada (ver seção Endividamento)

Unidade: % (ex: 10,16)
Validação: Se CapInv ≤ 0 → null
Escala: Decimal → ×100
Nota: Capital Investido = Patrimônio + Dívida Líquida; sensível a endividamento
```

---

## 🎁 CATEGORIA 4: DIVIDENDOS (2 indicadores)

### 4.1 DY (Dividend Yield)
```
DY = Proventos Pagos (12 meses) / Preço Atual da Ação

Fontes CVM:
  - Proventos Pagos: DFC.vlr_distribuicao_proventos (últimos 12 meses)
              OU tabela separada de dividendos/JCP
  - Preço Atual: MT5 ou source externa

Unidade: % (ex: 5,66)
Validação: Se Preço ≤ 0 → null
Escala: Decimal → ×100
Nota: Requer integração com histórico de proventos; pode não estar em DRE/BPA/DFC padrão
```

### 4.2 Payout
```
Payout = Proventos Pagos / Lucro Líquido
       = Dividendos Distribuídos / Lucro Líquido (12M)

Fontes CVM:
  - Proventos Pagos: DFC.vlr_distribuicao_proventos (ou tabela separada)
  - Lucro Líquido: DRE.vlr_lucro_liquido (12M rolling)

Unidade: % (ex: 98,05)
Validação: Se Lucro Líquido ≤ 0 → null (pode retornar >100% se distribuir mais que lucrou)
Escala: Decimal → ×100
Nota: >100% indica distribuição de reservas ou lucros acumulados
```

---

## 📉 CATEGORIA 5: ENDIVIDAMENTO / ALAVANCAGEM (7 indicadores)

### 5.1 Liquidez Corrente
```
Liquidez Corrente = Ativo Circulante / Passivo Circulante

Fontes CVM:
  - Ativo Circulante: BPA.vlr_ativo_circulante
  - Passivo Circulante: BPA.vlr_passivo_circulante

Unidade: Razão (ex: 1,23x)
Validação: Se Passivo Circulante ≤ 0 → null
Nota: >1,0 indica capacidade de pagar dívidas de curto prazo
      Interpretação: valores acima de 1,0 são positivos
```

### 5.2 Dívida Líquida / EBITDA
```
Dívida Líq/EBITDA = Dívida Líquida / EBITDA

Dívida Líquida = Dívida Bruta - Disponibilidades

Fontes CVM:
  - Dívida Bruta: BPA.vlr_emprestimos + BPA.vlr_financiamentos
  - Disponibilidades: BPA.vlr_caixa + BPA.vlr_equivalentes_caixa
  - EBITDA: Conforme seção 2.2

Unidade: Razão/múltiplo (ex: 2,44x)
Validação: Se EBITDA ≤ 0 → null
Nota: Mede quantos anos de EBITDA seriam necessários para pagar dívida
      Valores <2,0 são considerados saudáveis
```

### 5.3 Dívida Líquida / EBIT
```
Dívida Líq/EBIT = Dívida Líquida / EBIT

Fontes CVM: (idem 5.2 para dívida líquida + EBIT da seção 2.3)

Unidade: Razão (ex: 3,81x)
Validação: Se EBIT ≤ 0 → null
Nota: Similar ao 5.2, mas usando EBIT (mais conservador)
```

### 5.4 Dívida Líquida / Patrimônio
```
Dívida Líq/PL = Dívida Líquida / Patrimônio Líquido

Fontes CVM:
  - Dívida Líquida: Conforme 5.2
  - Patrimônio Líquido: BPA.vlr_pl

Unidade: Razão (ex: 1,23x)
Validação: Se PL ≤ 0 → null
Nota: Mede proporção de dívida em relação ao patrimônio
      <1,0 indica mais patrimônio que dívida
      >1,0 indica mais dívida que patrimônio
```

### 5.5 Dívida Bruta / Patrimônio
```
Dívida Bruta/PL = Dívida Bruta Total / Patrimônio Líquido

Fontes CVM:
  - Dívida Bruta: BPA.vlr_emprestimos + BPA.vlr_financiamentos
  - Patrimônio Líquido: BPA.vlr_pl

Unidade: Razão (ex: 1,59x)
Validação: Se PL ≤ 0 → null
Nota: Não desconta caixa; mais conservador que Dívida Líquida/PL
```

### 5.6 Patrimônio / Ativos
```
PL/Ativo = Patrimônio Líquido / Total de Ativos

Fontes CVM:
  - Patrimônio Líquido: BPA.vlr_pl
  - Total Ativo: BPA.vlr_ativo_total

Unidade: Razão (ex: 0,31)
Validação: Se Ativo ≤ 0 → null
Nota: Mede proporção do ativo financiado por patrimônio vs. passivo
      Valores >0,5 indicam mais patrimônio; <0,3 indica alta alavancagem
```

### 5.7 Passivos / Ativos
```
Passivo/Ativo = Passivo Total / Total de Ativos

Fontes CVM:
  - Passivo Total: BPA.vlr_passivo_total
  - Total Ativo: BPA.vlr_ativo_total

Unidade: Razão (ex: 0,69)
Validação: Se Ativo ≤ 0 → null
Nota: Complementar a 5.6; PA + PL/Ativo = 1,0
      Mede proporção de ativo financiado por passivo (alavancagem)
```

---

## 🚀 CATEGORIA 6: CRESCIMENTO (2 indicadores)

### 6.1 CAGR Receitas (5 anos)
```
CAGR Receitas = (Receita_Hoje / Receita_5AnosAtras) ^ (1/5) - 1

Fontes CVM:
  - Receita Líquida (12M rolling): DRE.vlr_receita_liquida
  - Períodos: Últimos 12 meses vs. 60 meses (5 anos) atrás

Unidade: % (ex: 32,30)
Validação: Se Receita inicial ≤ 0 → null
Escala: Decimal → ×100
Nota: Requer histórico de 5+ anos
      CAGR = (V_f / V_i)^(1/n) - 1, onde n=5
```

### 6.2 CAGR Lucros (5 anos)
```
CAGR Lucros = (Lucro_Hoje / Lucro_5AnosAtras) ^ (1/5) - 1

Fontes CVM:
  - Lucro Líquido (12M rolling): DRE.vlr_lucro_liquido
  - Períodos: Últimos 12 meses vs. 60 meses atrás

Unidade: % (ex: 12,28)
Validação: Se Lucro inicial ≤ 0 ou se empresa teve prejuízo no período → null
Escala: Decimal → ×100
Nota: Mais volátil que CAGR Receitas; pode ser negativo se lucro decaiu
      Requer histórico completo
```

---

## 🔗 Mapeamento para Schema CVM Existente

### Tabelas Principais
```
- DRE (Demonstração de Resultado)
  * vlr_receita_liquida
  * vlr_lucro_bruto
  * vlr_lucro_operacional (EBIT)
  * vlr_lucro_liquido
  * vlr_depreciacao (se disponível)
  * vlr_amortizacao (se disponível)

- BPA (Balanço Patrimonial Ativo/Passivo)
  * vlr_ativo_circulante
  * vlr_ativo_total
  * vlr_passivo_circulante
  * vlr_passivo_total
  * vlr_pl (Patrimônio Líquido)
  * vlr_caixa
  * vlr_equivalentes_caixa

- DFC (Demonstração de Fluxo de Caixa)
  * vlr_distribuicao_proventos (se presente)

- capital_social
  * numero_acoes (ou tabela separada)
```

### Derivados Recomendados
```
- EBITDA = EBIT + Depreciação + Amortização
- Dívida Bruta = Empréstimos + Financiamentos
- Dívida Líquida = Dívida Bruta - Caixa - Equivalentes
- Capital Investido = PL + Dívida Líquida
- Ativo Circulante Líquido = Ativo Circ. - Passivo Circ.
```

---

## ⚠️ Armadilhas & Validações

### Valores Negativos
- **LPA negativo** → permitir (prejuízo é válido)
- **Lucro operacional negativo** → permitir (empresa com prejuízo operacional)
- **PL negativo** → null para todos os indicadores que o usam (passivo > ativo)
- **P/Ativo Circ. Liq. negativo** → permitir (empresa com capital de giro negativo)
- **CAGR com lucro inicial negativo** → null (base inválida)

### Casos Edge
- **Receita zero** → null para todas as margens
- **Ativo total zero** → null para ROA, Giro, P/Ativo
- **Patrimônio zero** → null para ROE, P/VP, VPA
- **EBITDA zero/negativo** → null para EV/EBITDA, Dívida Líq/EBITDA
- **Passivo circulante zero** → null para Liquidez Corrente (improvável, mas proteger)

### Escalas
- **CVM padrão:** Decimal (0,1357 = 13,57%)
- **Output da UI:** Percentual ×100 quando aplicável
- **Razões:** Mantêm unidade adimensional (ex: 18,40x)
- **Por ação:** R$ (ex: 2,00, 23,40)

### Ponto-in-Time
- Usar `knowledgeDate` de cada período para consistência
- DRE/EBITDA são 12M rolling → sempre usar dados mais recentes disponíveis
- BPA/PL são ponto-em-tempo (final do trimestre)
- Não misturar períodos diferentes sem cuidado

---

## 📊 Resumo de Implementação

| Categoria | Qt. | Complexidade | Fonte Principal | Notas |
|-----------|-----|--------------|-----------------|-------|
| Valuation | 12 | Média | BPA + DRE + Preço | Requer MT5 ou fonte de preço |
| Eficiência | 5 | Baixa | DRE | Margens simples; robustas |
| Rentabilidade | 3 | Média | DRE + BPA | ROE/ROA/ROIC; disponíveis em pipeline |
| Dividendos | 2 | Alta | DFC + histórico | DY requer histórico de proventos |
| Endividamento | 7 | Média | BPA + DFC | Dívida líquida é derivada |
| Crescimento | 2 | Alta | DRE histórico | Requer 5+ anos de dados |

---

**Documento de Referência para Desenvolvimento**  
Atualizado: 2026-07-26
