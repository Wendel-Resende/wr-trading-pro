# Análise Detalhada dos Cálculos da Planilha monitoramento.xlsx

## Estrutura da Planilha

### Colunas Principais (Linha 2 - Headers):

| Coluna | Nome | Descrição |
|--------|------|-----------|
| 1 | Nome da empresa | Nome completo da empresa |
| 2 | COD da ação | Ticker da ação (ex: CPLE3) |
| 3 | Tipo de Ação | ON/PN |
| 4 | Composição | Multiplicador de composição |
| 5 | Preço / Yield | Preço/Yield atual |
| 6 | Payout Estatuto | % do lucro distribuído |
| 7 | Gatilho ROE | Sinal para ROE |
| 8 | Gatilho ajustado | Ajuste do gatilho |
| 9 | Comprar ROE > | Sinal se ROE acima de X |
| 10 | Comprar VPA <= | Sinal se VPA abaixo de X |
| 11 | Comprar LPA > | Sinal se LPA acima de X |
| 12 | DY MÉDIO 3 a.a | Dividend Yield médio 3 anos |
| 13 | PREÇO ATUAL Mercado | Preço atual da ação |
| 14 | PREÇO TETO | Preço máximo de compra |
| 15 | Preço Teto reajustado | Preço teto com ajuste |
| 16 | Meta Papeis | Quantidade alvo de ações |
| 17 | Quant. Adquirida | Quantidade já adquirida |
| 18 | Investimento necessário para meta | Valor para atingir meta |
| 19 | P. médio Compra | Preço médio de compra |
| 20 | Valor. Investido | Total investido |
| 21 | RESULTADO | Lucro/Prejuízo |
| 22 | Valor carteira | Valor atual da posição |
| 23 | PART. NA CARTEIRA DE ACOES | % na carteira |
| 24 | Previsão Recebimento Dividendo anual | Projeção de dividendos |
| 25 | % Yield on cost | Rendimento sobre custo |
| 26 | Patrimônio líquido Ano anterior | PL total |
| 27 | Lucro Líquido Ano anterior | Lucro total |
| 28 | Ações Emitidas | Total de ações emitidas |
| 29 | VPA- Valor Patrimonial por Ação | PL / Ações Emitidas |
| 30 | P / VPA (Múltiplos) | Preço Atual / VPA |
| 31 | LPA - Lucro Por Ação 12 meses | Lucro / Ações |
| 32 | Preço / Lucro 12 meses | Preço Atual / LPA |
| 33 | ROE % | Retorno sobre Patrimônio |
| 34-45 | Jan-Dez | Mapa de dividendos mensais |

---

## Exemplo: CPLE3 (Linha 4)

### Dados da Planilha:

| Campo | Valor | Coluna |
|-------|-------|--------|
| Empresa | COPEL | 1 |
| Código | CPLE3 | 2 |
| Tipo | On | 3 |
| Composição | 1 | 4 |
| Preço/Yield | 0.088889 (8.89%) | 5 |
| Payout Estatuto | 0.25 (25%) | 6 |
| Gatilho ROE | Comprar | 7 |
| Gatilho Ajustado | - | 8 |
| Comprar ROE > | Comprar | 9 |
| Comprar VPA <= | Comprar | 10 |
| Comprar LPA > | Comprar | 11 |
| DY Médio | - | 12 |
| PREÇO ATUAL | 0.76 | 13 |
| PREÇO TETO | 8.55 | 14 |
| Preço Teto Reajustado | 9.5 | 15 |
| Meta Papeis | 0 | 16 |
| Quant. Adquirida | 1000 | 17 |
| Investimento Necessário | 200 | 18 |
| P. Médio Compra | 6840 | 19 |
| Valor Investido | 8.64245 | 20 |
| RESULTADO | 1728.49 | 21 |
| Valor Carteira | -18.49 | 22 |
| Participação | -0.010697 (-1.07%) | 23 |
| Previsão Dividendos | 1710 | 24 |
| Yield on Cost | 0.396356 (39.64%) | 25 |
| PL Ano Anterior | 152 | 26 |
| Lucro Líquido | NaN | 27 |
| Ações Emitidas | NaN | 28 |
| VPA | 8.392649 | 29 |
| P / VPA | 1.018749 | 30 |
| LPA | 1.606223 | 31 |
| Preço / Lucro | 5.323046 | 32 |
| ROE | 0.191385 (19.14%) | 33 |

---

## Análise dos Cálculos

### 1. ✅ VPA - Valor Patrimonial por Ação

**Fórmula:**
```
VPA = Patrimônio Líquido / Ações Emitidas
```

**Status na Planilha:** 
- VPA é informado diretamente: 8.392649
- PL informado: 152 (parece inconsistente)
- Ações Emitidas: NaN

**Problema Identificado:** 
Os dados da planilha parecem ter inconsistências. O PL de 152 com ações emitidas NaN não permite calcular o VPA de 8.392649.

**Recomendação:** 
✅ CORRETO - O VPA deve ser calculado automaticamente quando PL e Ações Emitidas são informados.

---

### 2. ⚠️ PREÇO TETO - PRECISA DE VERIFICAÇÃO

**Fórmula Atual no Código:**
```typescript
Preço Teto = VPA * 0.375 * Composição
```

**Verificação com Dados da Planilha:**
```
VPA = 8.392649
Composição = 1
Preço Teto (fórmula) = 8.392649 * 0.375 * 1 = 3.147243
Preço Teto (planilha) = 8.55
```

**DIFERENÇA:** O valor calculado (3.15) é muito diferente do valor da planilha (8.55).

**Análise Possível:**
A fórmula pode estar incompleta. Possíveis variações:
1. Preço Teto = VPA * (1 + Yield) * Composição
2. Preço Teto = VPA * (fator de ajuste)
3. Preço Teto pode vir de outra fonte/cálculo mais complexo

**NECESSÁRIO:** Verificar na planilha a fórmula exata usada para Preço Teto. Provavelmente há uma célula de cálculo que não está sendo lida.

---

### 3. ❌ VALOR INVESTIDO - INCORRETO NO CÓDIGO ATUAL

**Fórmula Esperada:**
```
Valor Investido = Preço Médio de Compra × Quantidade Adquirida
```

**Verificação com Dados da Planilha:**
```
P. Médio Compra = 6840 (parece valor total, não médio)
Quantidade Adquirida = 1000
Valor Investido (esperado) = 6840
Valor Investido (planilha) = 8.64245
```

**Análise:**
O valor 6840 parece ser o valor TOTAL investido, e 8.64245 pode ser o preço médio por ação (6840/1000 = 6.84, mas 8.64245 é diferente).

**CORREÇÃO NECESSÁRIA:**
No código atual, `valorInvestido` está sendo usado como preço médio, mas deveria ser:
- `valorInvestido` = Total investido
- `precoMedioCompra` = Preço médio por ação

---

### 4. ❌ PREÇO TETO REAJUSTADO - NÃO IMPLEMENTADO

**Valor na Planilha:** 9.5

**Relação com Preço Teto:** 9.5 > 8.55 (aprox. 11% maior)

**Possíveis Fórmulas:**
1. Preço Teto Reajustado = Preço Teto × (1 + Yield)
2. Preço Teto Reajustado = Preço Teto × fator de ajuste
3. Preço Teto Reajustado = Preço Teto + margem de segurança

**NECESSÁRIO:** Implementar cálculo com base na fórmula da planilha.

---

### 5. ❌ INVESTIMENTO NECESSÁRIO PARA META - NÃO IMPLEMENTADO

**Fórmula Esperada:**
```
Investimento Necessário = (Meta Papeis - Quant. Adquirida) × Preço Teto
```

**Verificação com Dados da Planilha:**
```
Meta Papeis = 0
Quant. Adquirida = 1000
Preço Teto = 8.55
Investimento Necessário = (0 - 1000) × 8.55 = -8550
Investimento Necessário (planilha) = 200
```

**Análise:**
A meta de 0 significa que já tem ações demais (1000), então o investimento necessário seria negativo. Mas a planilha mostra 200, o que não faz sentido com esses números.

**POSSÍVEL:** Os números da planilha de exemplo podem estar inconsistentes ou a fórmula é diferente.

---

### 6. ❌ VALOR CARTEIRA - INCORRETO

**Fórmula Esperada:**
```
Valor Carteira = Preço Atual × Quantidade Adquirida
```

**Verificação com Dados da Planilha:**
```
Preço Atual = 0.76
Quantidade Adquirida = 1000
Valor Carteira (esperado) = 0.76 × 1000 = 760
Valor Carteira (planilha) = -18.49
```

**Análise:** 
O valor -18.49 está completamente incorreto. Deveria ser 760. Os dados da planilha parecem ter inconsistências graves.

**CORREÇÃO NECESSÁRIA:**
No código atual, o cálculo está correto:
```typescript
valorCarteira = precoAtual × quantidadeAdquirida
```

A planilha pode ter dados corrompidos ou de exemplo inconsistentes.

---

### 7. ✅ RESULTADO (Lucro/Prejuízo) - CORRETO

**Fórmula:**
```
Resultado = Valor Carteira - Valor Investido
```

**Verificação:**
```
Valor Carteira = -18.49 (incorreto na planilha)
Valor Investido = 8.64245
Resultado (esperado) = -18.49 - 8.64245 = -27.13
Resultado (planilha) = 1728.49
```

**Análise:**
Resultado 1728.49 não bate com os valores. Novamente, dados inconsistentes.

**CORREÇÃO NECESSÁRIA:**
No código atual:
```typescript
resultado = valorCarteira - (precoMedioCompra × quantidadeAdquirida)
```

Isso está correto, desde que os valores de entrada estejam corretos.

---

### 8. ❌ PARTICIPAÇÃO NA CARTEIRA - NÃO IMPLEMENTADO

**Fórmula:**
```
Participação % = (Valor Carteira / Total da Carteira) × 100
```

**Valor na Planilha:** -0.010697 (-1.07%)

**Análise:** 
Valor negativo indica erro no Valor Carteira ou Total da Carteira.

**NECESSÁRIO:** Implementar cálculo com base no total da carteira de todas as ações.

---

## Resumo dos Problemas Identificados

### ❌ PRECISA CORRIGIR:

1. **Preço Teto:** Fórmula atual (VPA * 0.375 * Composição) não bate com a planilha
2. **Valor Investido:** Está sendo usado como preço médio no código
3. **Preço Teto Reajustado:** Não implementado
4. **Investimento Necessário para Meta:** Não implementado
5. **Participação na Carteira:** Implementado mas não está sendo calculado automaticamente

### ✅ CORRETO:

1. **VPA:** Fórmula correta (PL / Ações Emitidas)
2. **Valor Carteira:** Fórmula correta (Preço Atual × Quantidade)
3. **Resultado:** Fórmula correta (Valor Carteira - Valor Investido)
4. **Yield on Cost:** Fórmula correta (Dividendo Anual / Valor Investido × 100)

---

## Recomendações

### 1. Verificar Fórmula de Preço Teto na Planilha
- Abrir o arquivo Excel original
- Verificar a célula de cálculo do Preço Teto
- Documentar a fórmula exata usada
- Implementar no código

### 2. Corrigir Relação entre Valor Investido e Preço Médio
- `valorInvestido` = Preço médio × Quantidade
- `precoMedioCompra` = Preço médio por ação
- Atualizar formulário e APIs

### 3. Implementar Preço Teto Reajustado
- Descobrir fórmula (provavelmente Preço Teto × fator)
- Implementar no serviço

### 4. Implementar Investimento Necessário para Meta
- Fórmula: (Meta - Quantidade Atual) × Preço Teto
- Adicionar ao formulário

### 5. Garantir Cálculo de Participação na Carteira
- Já implementado em `calcularTodasParticipacoes()`
- Chamar automaticamente após atualizações

---

## Próximos Passos

1. **IMEDIATO:** Pedir ao usuário para abrir a planilha em Excel e verificar:
   - Qual é a fórmula da célula de Preço Teto?
   - Qual é a fórmula da célula de Preço Teto Reajustado?
   - Qual é a fórmula da célula de Investimento Necessário?

2. **DEPOIS:** Atualizar o código com as fórmulas corretas

3. **TESTAR:** Verificar se os cálculos batem com a planilha
