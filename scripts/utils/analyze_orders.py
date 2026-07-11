#!/usr/bin/env python3
"""
Script para análise de ordens executadas no sistema
"""
import sqlite3
from datetime import datetime
import json

def analyze_orders():
    """Analisa as ordens executadas no banco de dados"""
    
    # Conectar ao banco de dados
    conn = sqlite3.connect('prisma/dev.db')
    cursor = conn.cursor()
    
    print("=" * 80)
    print("RELATÓRIO DE ORDENS EXECUTADAS")
    print("=" * 80)
    print(f"Data do Relatório: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    print("=" * 80)
    print()
    
    # === ANÁLISE DE ORDENS DE SPREAD ===
    print("📊 ORDENS DE SPREAD")
    print("=" * 80)
    
    cursor.execute("""
        SELECT 
            so.id,
            so.type1,
            so.type2,
            so.quantity1,
            so.quantity2,
            so.price1,
            so.price2,
            so.spreadValue,
            so.status,
            so.isAutomated,
            so.automationTarget,
            so.automationCondition,
            so.createdAt,
            so.filledAt,
            a1.symbol as symbol1,
            a1.name as name1,
            a1.type as assetType1,
            a2.symbol as symbol2,
            a2.name as name2,
            a2.type as assetType2
        FROM SpreadOrder so
        LEFT JOIN Asset a1 ON so.assetId1 = a1.id
        LEFT JOIN Asset a2 ON so.assetId2 = a2.id
        ORDER BY so.createdAt DESC
    """)
    
    spread_orders = cursor.fetchall()
    
    if spread_orders:
        print(f"✅ Total de ordens de spread: {len(spread_orders)}")
        print()
        
        # Estatísticas de spread
        manual_count = sum(1 for o in spread_orders if not o[9])  # isAutomated = False
        auto_count = sum(1 for o in spread_orders if o[9])  # isAutomated = True
        
        print("📊 Estatísticas de Spread:")
        print(f"  • Manuais: {manual_count}")
        print(f"  • Automáticas: {auto_count}")
        print()
        
        # Detalhes das ordens de spread
        for i, order in enumerate(spread_orders, 1):
            (
                order_id,
                type1,
                type2,
                quantity1,
                quantity2,
                price1,
                price2,
                spread_value,
                status,
                is_automated,
                auto_target,
                auto_condition,
                created_at,
                filled_at,
                symbol1,
                name1,
                asset_type1,
                symbol2,
                name2,
                asset_type2
            ) = order
            
            print(f"Ordem de Spread #{i}")
            print(f"  ID: {order_id}")
            print(f"  Ativo 1: {symbol1} ({name1}) - {asset_type1}")
            print(f"  Ativo 2: {symbol2} ({name2}) - {asset_type2}")
            print(f"  Ação 1: {type1} {quantity1} @ R${price1:.2f}")
            print(f"  Ação 2: {type2} {quantity2} @ R${price2:.2f}")
            print(f"  Spread: R${spread_value:.2f}")
            print(f"  Status: {status}")
            print(f"  Tipo: {'AUTOMÁTICA' if is_automated else 'MANUAL'}")
            if is_automated:
                print(f"  Condição: {auto_condition} R${auto_target:.2f}")
            print(f"  Criada em: {created_at}")
            if filled_at:
                print(f"  Executada em: {filled_at}")
            print()
    else:
        print("❌ Nenhuma ordem de spread encontrada.")
        print()
    
    print("=" * 80)
    print()
    
    # === ANÁLISE DE ORDENS NORMAIS ===
    print("📊 ORDENS NORMAIS")
    print("=" * 80)
    
    # Buscar todas as ordens
    cursor.execute("""
        SELECT 
            o.id,
            o.type,
            o.orderType,
            o.quantity,
            o.price,
            o.status,
            o.createdAt,
            o.filledAt,
            a.symbol,
            a.name,
            a.type as assetType
        FROM 'Order' o
        LEFT JOIN Asset a ON o.assetId = a.id
        ORDER BY o.createdAt DESC
    """)
    
    orders = cursor.fetchall()
    
    if orders:
        print(f"✅ Total de ordens normais: {len(orders)}")
        print()
        
        # Estatísticas por status
        cursor.execute("""
            SELECT status, COUNT(*) as count
            FROM 'Order'
            GROUP BY status
        """)
        status_stats = cursor.fetchall()
        
        print("📊 Estatísticas por Status:")
        for status, count in status_stats:
            print(f"  • {status}: {count}")
        print()
        
        # Estatísticas por tipo
        cursor.execute("""
            SELECT type, COUNT(*) as count
            FROM 'Order'
            GROUP BY type
        """)
        type_stats = cursor.fetchall()
        
        print("📊 Estatísticas por Tipo:")
        for order_type, count in type_stats:
            print(f"  • {order_type}: {count}")
        print()
        
        # Detalhes das ordens
        for i, order in enumerate(orders, 1):
            (
                order_id,
                order_type,
                order_type_desc,
                quantity,
                price,
                status,
                created_at,
                filled_at,
                symbol,
                name,
                asset_type
            ) = order
            
            print(f"Ordem #{i}")
            print(f"  ID: {order_id}")
            print(f"  Ativo: {symbol} ({name}) - {asset_type}")
            print(f"  Tipo: {order_type} ({order_type_desc})")
            print(f"  Quantidade: {quantity}")
            print(f"  Preço: {price}")
            print(f"  Status: {status}")
            print(f"  Criada em: {created_at}")
            if filled_at:
                print(f"  Executada em: {filled_at}")
            print()
    else:
        print("❌ Nenhuma ordem normal encontrada.")
        print()
    
    # Buscar informações de ativos
    cursor.execute("SELECT symbol, type FROM Asset ORDER BY symbol")
    assets = cursor.fetchall()
    
    print("=" * 80)
    print("ATIVOS CADASTRADOS")
    print("=" * 80)
    print()
    for symbol, asset_type in assets:
        print(f"  • {symbol} - {asset_type}")
    print()
    
    conn.close()
    print("=" * 80)
    print("FIM DO RELATÓRIO")
    print("=" * 80)

if __name__ == "__main__":
    analyze_orders()