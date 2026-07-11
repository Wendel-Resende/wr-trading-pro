"""
Script para importar dados da planilha monitoramento.xlsx para o banco de dados SQLite
"""
import sqlite3
import pandas as pd
from datetime import datetime

# Caminho da planilha Excel
SPREADSHEET_PATH = 'monitoramento_acoes/monitoramento.xlsx'
# Caminho do banco de dados SQLite
DATABASE_PATH = 'prisma/dev.db'

def import_data():
    """Importa dados da planilha Excel para o banco de dados"""
    
    print("Carregando planilha Excel...")
    
    try:
        # Carregar todas as planilhas
        xls = pd.ExcelFile(SPREADSHEET_PATH)
        print(f"Planilhas encontradas: {xls.sheet_names}")
        
        # Conectar ao banco de dados SQLite
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        
        # Importar dados da aba Painel Gestão
        if 'Painel Gestão' in xls.sheet_names:
            print("\nImportando dados de Painel Gestão...")
            df_painel = pd.read_excel(xls, sheet_name='Painel Gestão')
            print(f"Linhas encontradas: {len(df_painel)}")
            print(f"Colunas: {df_painel.columns.tolist()}")
            
            # Mostrar primeiras linhas
            print("\nPrimeiras linhas:")
            print(df_painel.head())
            
            # Exportar para CSV para análise posterior
            df_painel.to_csv('monitoramento_acoes/painel_gestao.csv', index=False)
            print("\nDados exportados para: monitoramento_acoes/painel_gestao.csv")
        
        # Importar dados da aba Registro de ordens
        if 'Registro de ordens' in xls.sheet_names:
            print("\nImportando dados de Registro de ordens...")
            df_ordens = pd.read_excel(xls, sheet_name='Registro de ordens')
            print(f"Linhas encontradas: {len(df_ordens)}")
            print(f"Colunas: {df_ordens.columns.tolist()}")
            
            # Mostrar primeiras linhas
            print("\nPrimeiras linhas:")
            print(df_ordens.head())
            
            # Exportar para CSV para análise posterior
            df_ordens.to_csv('monitoramento_acoes/registro_ordens.csv', index=False)
            print("\nDados exportados para: monitoramento_acoes/registro_ordens.csv")
        
        conn.close()
        
        print("\n" + "="*60)
        print("ANÁLISE COMPLETA DA PLANILHA")
        print("="*60)
        print("\nPara importar os dados manualmente, você precisará:")
        print("1. Acessar a página /stock-monitoring da aplicação")
        print("2. Clicar em 'Novo Monitoramento'")
        print("3. Preencher os dados conforme a planilha")
        print("\nOu criar um script de migração específico para seus dados.")
        
    except Exception as e:
        print(f"\nErro ao importar dados: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    import_data()
