# 📊 Indicadores Fundamentalistas Implementados

## 📅 Data: 11/01/2026

## 🎯 Visão Geral

Todos os indicadores fundamentalistas solicitados foram implementados e calculados automaticamente no sistema de monitoramento de ações da WR Trading Pro.

## 🔢 Indicadores Implementados

### 1. VPA - Valor Patrimonial por Ação

**Fórmula:** `VPA = Patrimônio Líquido / Ações Emitidas`

**Descrição:**
- Representa o valor contábil de cada ação
- Mostra quanto o patrimônio líquido da empresa vale por ação
- É um indicador importante para ações de empresas de capital fechado

**Implementação:**
```typescript
calcularVPA(patrimonioLiquido: number, acoesEmitidas: bigint): number {
  if (!patrimonioLiquido || !acoesEmitidas || acoesEmitidas === BigInt(0)) return 0;
  const acoesNum = Number(acoesEmitidas);
  if (acoesNum === 0) return 0;
  return patrimonioLiquido / acoesNum;
}
```

**Dados de Entrada:**
- `patrimonioLiquido`: Patrimônio líquido total da empresa (campo manual)
- `acoesEmitidas`: Número total de ações emitidas (campo manual)

**Quando é Calculado:**
- Automaticamente quando há dados de patrimônio líquido e ações emitidas
- Recalculado ao atualizar o monitoramento

---

### 2. LPA - Lucro por Ação

**Fórmula:** `LPA = Lucro Líquido / Ações Emitidas`

**Descrição:**
- Mostra quanto do lucro líquido corresponde a cada ação
- Indica a rentabilidade por ação
- Fundamental para calcular o P/L

**Implementação:**
```typescript
calcularLPA(lucroLiquido: number, acoesEmitidas: bigint): number {
  if (!lucroLiquido || !acoesEmitidas || acoesEmitidas === BigInt(0)) return 0;
  const acoesNum = Number(acoesEmitidas);
  if (acoesNum === 0) return 0;
  return lucroLiquido / acoesNum;
}
```

**Dados de Entrada:**
- `lucroLiquido`: Lucro líquido da empresa (campo manual)
- `acoesEmitidas`: Número total de ações emitidas (campo manual)

**Quando é Calculado:**
- Automaticamente quando há dados de lucro líquido e ações emitidas
- Recalculado ao atualizar o monitoramento

---

### 3. P/VPA - Preço sobre Valor Patrimonial

**Fórmula:** `P/VPA = Preço Atual / VPA`

**Descrição:**
- Compara o preço de mercado com o valor patrimonial
- Indica se a ação está cara ou barata em relação ao valor contábil
- `P/VPA < 1`: Ação negociada abaixo do valor patrimonial (potencial valorização)
- `P/VPA > 1`: Ação negociada acima do valor patrimonial
- `P/VPA = 1`: Ação negociada pelo valor patrimonial

**Implementação:**
```typescript
calcularPVPA(precoAtual: number, vpa: number): number {
  if (!precoAtual || !vpa || vpa === 0) return 0;
  return precoAtual / vpa;
}
```

**Dados de Entrada:**
- `precoAtual`: Preço atual da ação (atualizado do MT5)
- `vpa`: Valor Patrimonial por Ação (calculado automaticamente)

**Quando é Calculado:**
- Automaticamente quando há preço atual e VPA
- Recalculado sempre que o preço é atualizado

---

### 4. P/L - Preço sobre Lucro

**Fórmula:** `P/L = Preço Atual / LPA`

**Descrição:**
- Indica quanto anos de lucro atual equivale ao preço da ação
- Mostra quantos anos levaria para recuperar o investimento através do lucro
- `P/L = 15`: Levaria 15 anos para recuperar o investimento
- `P/L alto`: Ação considerada cara em relação ao lucro
- `P/L baixo`: Ação pode estar subvalorizada

**Implementação:**
```typescript
calcularPL(precoAtual: number, lpa: number): number {
  if (!precoAtual || !lpa || lpa === 0) return 0;
  return precoAtual / lpa;
}
```

**Dados de Entrada:**
- `precoAtual`: Preço atual da ação (atualizado do MT5)
- `lpa`: Lucro por Ação (calculado automaticamente)

**Quando é Calculado:**
- Automaticamente quando há preço atual e LPA
- Recalculado sempre que o preço é atualizado

---

### 5. ROE - Return on Equity

**Fórmula:** `ROE = (Lucro Líquido / Patrimônio Líquido) × 100`

**Descrição:**
- Retorna a rentabilidade do patrimônio líquido da empresa
- Mostra o quão eficiente a empresa é em gerar lucro com seu capital
- Exemplo: `ROE = 20%` significa que a empresa gera 20% de retorno sobre o capital
- `ROE > 15%`: Considerado bom
- `ROE > 20%`: Excelente
- `ROE < 10%`: Pode indicar ineficiência

**Implementação:**
```typescript
calcularROE(lucroLiquido: number, patrimonioLiquido: number): number {
  if (!lucroLiquido || !patrimonioLiquido || patrimonioLiquido === 0) return 0;
  return (lucroLiquido / patrimonioLiquido) * 100;
}
```

**Dados de Entrada:**
- `lucroLiquido`: Lucro líquido da empresa (campo manual)
- `patrimonioLiquido`: Patrimônio líquido total da empresa (campo manual)

**Quando é Calculado:**
- Automaticamente quando há dados de lucro líquido e patrimônio líquido
- Recalculado ao atualizar o monitoramento

---

## 📋 Campos de Entrada Necessários

Para calcular todos os indicadores, os seguintes campos devem ser preenchidos manualmente:

| Campo | Tipo | Descrição | Obrigatório Para |
|-------|------|-----------|-----------------|
| `patrimonioLiquido` | Número | Patrimônio líquido total da empresa | VPA, ROE, P/VPA |
| `lucroLiquido` | Número | Lucro líquido da empresa | LPA, ROE, P/L |
| `acoesEmitidas` | BigInt | Número total de ações emitidas | VPA, LPA |
| `precoAtual` | Número | Preço atual da ação (MT5) | P/VPA, P/L |

## 🔄 Fluxo de Cálculo

```
1. Usuário insere dados fundamentais
   ↓
2. Sistema calcula indicadores base
   - VPA = PL / Ações Emitidas
   - LPA = Lucro / Ações Emitidas
   - ROE = (Lucro / PL) × 100
   ↓
3. Sistema atualiza preço (MT5)
   ↓
4. Sistema calcula indicadores de preço
   - P/VPA = Preço / VPA
   - P/L = Preço / LPA
   ↓
5. Valores são exibidos na tabela
```

## 💻 Exemplo de Uso

### Exemplo 1: VALE3

**Dados de Entrada:**
```json
{
  "patrimonioLiquido": 100000000000,
  "lucroLiquido": 25000000000,
  "acoesEmitidas": 5000000000,
  "precoAtual": 65.50
}
```

**Cálculos Automáticos:**
```typescript
VPA = 100.000.000.000 / 5.000.000.000 = R$ 20,00
LPA = 25.000.000.000 / 5.000.000.000 = R$ 5,00
ROE = (25.000.000.000 / 100.000.000.000) × 100 = 25%
P/VPA = 65,50 / 20,00 = 3,28
P/L = 65,50 / 5,00 = 13,10
```

### Exemplo 2: PETR4

**Dados de Entrada:**
```json
{
  "patrimonioLiquido": 300000000000,
  "lucroLiquido": 80000000000,
  "acoesEmitidas": 13000000000,
  "precoAtual": 38.90
}
```

**Cálculos Automáticos:**
```typescript
VPA = 300.000.000.000 / 13.000.000.000 = R$ 23,08
LPA = 80.000.000.000 / 13.000.000.000 = R$ 6,15
ROE = (80.000.000.000 / 300.000.000.000) × 100 = 26,67%
P/VPA = 38,90 / 23,08 = 1,69
P/L = 38,90 / 6,15 = 6,33
```

## 📊 Visualização na Tabela

Os indicadores são exibidos na tabela de monitoramento com destaque:

| Campo | Cor | Formato |
|-------|-----|---------|
| VPA | Branco | Moeda (R$) |
| LPA | Branco | Moeda (R$) |
| P/VPA | Branco | Decimal (2 casas) |
| P/L | Branco | Decimal (2 casas) |
| ROE | Rosa (Cyber Pink) | Porcentagem (%) |

## 🔧 Integração com Cálculos Existentes

Os indicadores fundamentalistas se integram com os cálculos existentes:

### Preço Teto (já existente):
```
Preço Teto = DY Médio 3 Anos / 0,08
```

### Preço Teto Reajustado (já existente):
```
Preço Teto Reajustado = (VPA >= Preço Teto) ? (VPA - Preço Teto)/2 + Preço Teto : 0
```

**Integração:** O VPA calculado automaticamente é usado no cálculo do Preço Teto Reajustado.

## 🚀 Como Utilizar

### 1. Criar Monitoramento

Vá até "Novo Monitoramento" e crie uma ação.

### 2. Preencher Dados Fundamentalistas

No formulário, preencha:
- Patrimônio Líquido
- Lucro Líquido
- Ações Emitidas

### 3. Verificar Cálculos Automáticos

Após salvar:
- VPA, LPA e ROE serão calculados automaticamente
- P/VPA e P/L serão calculados quando o preço for atualizado
- Todos os valores serão exibidos na tabela

### 4. Atualizar Preço (MT5)

Conecte ao MT5 para atualizar o preço em tempo real:
- P/VPA e P/L serão recalculados automaticamente
- Preço Teto Reajustado será recalculado (se VPA existir)

## 📈 Análise dos Indicadores

### VPA (Valor Patrimonial por Ação)
- **Ideal:** Comparar com preço atual
- **Uso:** Avaliar se a ação está cara/barata em relação ao valor contábil

### LPA (Lucro por Ação)
- **Ideal:** Crescente ao longo dos anos
- **Uso:** Avaliar rentabilidade por ação

### P/VPA (Preço sobre Valor Patrimonial)
- **< 0,8:** Ação pode estar subvalorizada
- **0,8 - 1,2:** Faixa considerada normal
- **> 1,5:** Ação pode estar cara

### P/L (Preço sobre Lucro)
- **< 10:** Ação pode estar barata
- **10 - 15:** Faixa considerada normal
- **> 20:** Ação pode estar cara

### ROE (Return on Equity)
- **< 10%:** Baixa rentabilidade
- **10% - 15%:** Rentabilidade média
- **15% - 20%:** Boa rentabilidade
- **> 20%:** Excelente rentabilidade

## ⚠️ Observações Importantes

1. **Dados Manuais:** Patrimônio Líquido, Lucro Líquido e Ações Emitidas são dados fundamentais que devem ser inseridos manualmente
2. **Atualização Automática:** VPA, LPA e ROE são recalculados automaticamente quando os dados são atualizados
3. **Dependência de Preço:** P/VPA e P/L dependem do preço atual atualizado via MT5
4. **Dados Históricos:** Para análise completa, é importante ter dados históricos dos indicadores
5. **Comparação Setorial:** Cada setor tem médias diferentes para P/L, P/VPA e ROE

## 🔍 Troubleshooting

### Indicador aparece como "-"
**Causa:** Dados de entrada não fornecidos
**Solução:** Preencher os campos obrigatórios (Patrimônio Líquido, Lucro Líquido, Ações Emitidas)

### P/VPA e P/L não calculados
**Causa:** Preço atual não disponível
**Solução:** Conectar ao MT5 para atualizar o preço

### ROE aparece como 0
**Causa:** Patrimônio Líquido é 0
**Solução:** Verificar se o Patrimônio Líquido foi inserido corretamente

### ROE extremamente alto (> 100%)
**Causa:** Patrimônio Líquido muito baixo em relação ao lucro
**Solução:** Verificar se os dados estão corretos

## 📚 Referências

- **VPA:** Valor contábil por ação
- **LPA:** Lucro por ação
- **P/VPA:** Múltiplo de mercado vs valor contábil
- **P/L:** Múltiplo de mercado vs lucro
- **ROE:** Eficiência na geração de lucro

## ✅ Status da Implementação

- [x] Implementar cálculo de VPA
- [x] Implementar cálculo de LPA
- [x] Implementar cálculo de P/VPA
- [x] Implementar cálculo de P/L
- [x] Implementar cálculo de ROE
- [x] Adicionar cálculos ao serviço de monitoramento
- [x] Exibir indicadores na tabela
- [x] Destacar ROE com cor rosa
- [x] Integrar com cálculos existentes
- [x] Documentar indicadores
- [x] Criar exemplos de uso
- [x] Adicionar guia de análise

---

**Última Atualização:** 11/01/2026
**Arquivo Modificado:** `src/services/stockMonitoringService.ts`, `src/components/StockMonitoringTable.tsx`
**Status:** ✅ Implementado e Funcionando
