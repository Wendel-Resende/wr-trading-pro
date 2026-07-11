import pandas as pd

df = pd.read_excel('monitoramento_acoes/monitoramento.xlsx', header=None)

print('=== Linha 0-4 ===')
for i in range(5):
    print(f'\n=== Linha {i} ===')
    print(df.iloc[i].to_string())

print('\n\n=== Linha com dados reais (provavelmente linha 2 ou 3) ===')
for i in range(3, 5):
    print(f'\n=== Linha {i} ===')
    print(df.iloc[i].to_string())

print('\n\n=== Buscando linhas com dados de ações ===')
for i in range(len(df)):
    row = df.iloc[i]
    # Procurar por linhas que parecem dados de ações
    if any(str(val) in ['CPLE3', 'SAPR3'] for val in row.values):
        print(f'\n=== Linha {i} (Ação encontrada) ===')
        print(df.iloc[i].to_string())
