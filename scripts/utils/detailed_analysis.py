import pandas as pd
import numpy as np

# Ler o Painel Gestão sem header para pegar estrutura completa
df1 = pd.read_excel('monitoramento_acoes/monitoramento.xlsx', sheet_name='Painel Gestão', header=None)

print('\n' + '='*80)
print('ANÁLISE DETALHADA DA PLANILHA MONITORAMENTO.XLSX')
print('='*80)

print('\n1. ESTRUTURA DAS PLANILHAS:')
print('   - Painel Gestão: Painel principal de monitoramento de ações')
print('   - Registro de ordens: Histórico de operações (vazio no momento)')

print('\n2. CAMPOS PRINCIPAIS DO PAINEL GESTÃO:')
print('\n   a) IDENTIFICAÇÃO DA AÇÃO:')
print('      - Nome da empresa')
print('      - COD da ação (ex: CPLE3, SAPR3, KLBN3, BBAS3, BBDC4)')
print('      - Tipo de Ação (On/Pn)')
print('      - Composição')

print('\n   b) MÉTRICAS FUNDAMENTALISTAS:')
print('      - Preço / Yield')
print('      - Payout Estatuto')
print('      - DY MÉDIO 3 anos')

print('\n   c) GATILHOS DE COMPRA (Indicadores técnicos):')
print('      - Gatilho ROE >')
print('      - Gatilho VPA <=')
print('      - Gatilho LPA >')

print('\n   d) PREÇOS E MERCADO:')
print('      - Preço ATUAL Mercado')
print('      - Preço TETO 3/8')
print('      - Preço Teto 3/8 reajustado')

print('\n   e) CONTROLE DE POSIÇÃO:')
print('      - Meta Papéis (quantidade desejada)')
print('      - Quant. Adquirida')
print('      - P. médio Compra')
print('      - Valor Investido')
print('      - RESULTADO (P&L)')
print('      - Valor carteira')
print('      - Participação na carteira de ações')

print('\n   f) PROJEÇÃO DE DIVIDENDOS:')
print('      - Previsão Recebimento Dividendo anual')
print('      - Yield on cost (%)')

print('\n   g) DADOS FINANCEIROS DA EMPRESA:')
print('      - Patrimônio Líquido (ano anterior)')
print('      - Lucro Líquido (ano anterior)')
print('      - Ações Emitidas')
print('      - VPA - Valor Patrimonial por Ação')
print('      - P/VPA (Multiplos)')
print('      - LPA - Lucro Por Ação (12 meses)')
print('      - Preço/Lucro (12 meses)')
print('      - ROE (%)')

print('\n   h) MAPA DE DIVIDENDOS (mensal):')
print('      - Janeiro a Dezembro: valores previstos')

print('\n3. CAMPOS DO REGISTRO DE ORDENS:')
print('   - Data Operação')
print('   - Compra/venda')
print('   - Nome empresa')
print('   - Cod ação')
print('   - Qtd negociada')
print('   - Preço Negociado')
print('   - Total Corretagem')

print('\n4. EXEMPLOS DE AÇÕES CADASTRADAS:')
acoes_exemplo = []
for i in range(4, len(df1)):
    row = df1.iloc[i]
    if not pd.isna(row[2]):  # Coluna COD da ação
        acoes_exemplo.append({
            'empresa': row[1],
            'cod': row[2],
            'tipo': row[3],
            'preco_atual': row[12],
            'quantidade': row[15],
            'investido': row[17],
            'resultado': row[18]
        })

for acao in acoes_exemplo:
    print(f"\n   {acao['empresa']} ({acao['cod']}):")
    print(f"      - Tipo: {acao['tipo']}")
    print(f"      - Preço: R$ {acao['preco_atual']}")
    print(f"      - Qtd: {acao['quantidade']}")
    print(f"      - Investido: R$ {acao['investido']}")
    print(f"      - Resultado: {acao['resultado']}")

print('\n' + '='*80)
print('ANÁLISE CONCLUÍDA')
print('='*80)