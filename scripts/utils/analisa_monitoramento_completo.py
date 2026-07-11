"""
Script completo para analisar a planilha monitoramento.xlsx
"""

import pandas as pd
import numpy as np

print("=" * 80)
print("ANÁLISE DA PLANILHA DE MONITORAMENTO DE AÇÕES")
print("=" * 80)

# Ler o arquivo Excel
file_path = 'monitoramento_acoes/monitoramento.xlsx'
xls = pd.ExcelFile(file_path)

print("\n📋 PLANILHAS ENCONTRADAS:")
for i, sheet in enumerate(xls.sheet_names, 1):
    print(f"  {i}. {sheet}")

# Ler cada planilha
for sheet_name in xls.sheet_names:
    print(f"\n{'=' * 80}")
    print(f"ANÁLISE: {sheet_name}")
    print(f"{'=' * 80}")
    
    # Ler sem cabeçalho para ver a estrutura crua
    df_raw = pd.read_excel(file_path, sheet_name=sheet_name, header=None)
    print(f"\nDimensões: {df_raw.shape[0]} linhas x {df_raw.shape[1]} colunas")
    
    # Mostrar as primeiras linhas crua
    print(f"\n=== ESTRUTURA BRUTA (primeiras 15 linhas) ===")
    for i in range(min(15, len(df_raw))):