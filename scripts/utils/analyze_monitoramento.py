import pandas as pd
import numpy as np

# Ler a planilha Painel Gestão sem header
df1 = pd.read_excel('monitoramento_acoes/monitoramento.xlsx', sheet_name='Painel Gestão', header=None)

print('\n=== ESTRUTURA COMPLETA DO PAINEL GESTÃO ===\n')
for i in range(min(10, len(df1))):
    print(f'Linha {i}: {df1.iloc[i].tolist()[:15]}...')

print('\n\n=== COLUNAS PRINCIPAIS (baseado na linha 3) ===\n')
if len(df1) > 3:
    print(df1.iloc[3].tolist())

# Ler Registro de Ordens
print('\n\n=== REGISTRO DE ORDENS ===\n')
df2 = pd.read_excel('monitoramento_acoes/monitoramento.xlsx', sheet_name='Registro de ordens')
print(f'Colunas: {df2.columns.tolist()}')
print(f'Linhas: {len(df2)}')