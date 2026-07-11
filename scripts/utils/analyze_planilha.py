import pandas as pd

xls = pd.ExcelFile('monitoramento_acoes/monitoramento.xlsx')
print('=== ABA: Painel Gestão ===\n')

df = pd.read_excel(xls, sheet_name='Painel Gestão', header=None)
print('Total de linhas:', len(df), 'Total de colunas:', len(df.columns))

print('\n=== Estrutura da planilha ===')
print('Linha 1 (Títulos de seções):')
print(df.iloc[1:2].to_string())

print('\n=== Linha 3 (Cabeçalho de colunas) ===')
print(df.iloc[3:4].to_string())

print('\n=== Ações cadastradas (linhas de dados) ===')
acoes_encontradas = []
for i in range(len(df)):
    row = df.iloc[i]
    # Verifica se a coluna 1 tem nome de empresa válido
    nome_empresa = str(row[1])
    codigo = str(row[2])
    
    # Ignora linhas de cabeçalho e vazias
    if nome_empresa not in ['Nome da empresa', 'nan', 'NaN', 'SANEAMENTO / ENERGIA / GAS', ''] and pd.notna(row[1]) and nome_empresa.strip() != '':
        # Ignora se for um número (são valores do resumo)
        try:
            float(nome_empresa)
        except ValueError:
            acoes_encontradas.append((i, nome_empresa, codigo))

for idx, nome, codigo in acoes_encontradas:
    print(f'Linha {idx}: {nome} - Código: {codigo}')

print(f'\nTotal de ações cadastradas: {len(acoes_encontradas)}')

# Ler a aba de ordens
print('\n\n=== ABA: Registro de ordens ===')
try:
    df_ordens = pd.read_excel(xls, sheet_name='Registro de ordens', header=None)
    print('Total de linhas:', len(df_ordens), 'Total de colunas:', len(df_ordens.columns))
    print('\nPrimeiras linhas:')
    print(df_ordens.head(10).to_string())
except Exception as e:
    print(f'Erro ao ler aba de ordens: {e}')
