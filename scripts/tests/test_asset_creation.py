#!/usr/bin/env python3
"""
Script de teste para verificar se a criação de monitoramento de ações funciona corretamente
com a solução implementada para o erro de chave estrangeira.
"""

import requests
import json

BASE_URL = "http://localhost:3000/api"

def print_result(test_name, success, message, data=None):
    """Formata e imprime o resultado do teste"""
    status = "✅ PASSOU" if success else "❌ FALHOU"
    print(f"\n{status} - {test_name}")
    print(f"Mensagem: {message}")
    if data:
        print(f"Dados: {json.dumps(data, indent=2, ensure_ascii=False)}")
    return success

def test_create_monitoramento():
    """Testa criação de monitoramento com código de ação"""
    test_name = "Criar monitoramento de ação PETR4"
    
    data = {
        "assetId": "PETR4",
        "stockType": "PN",
        "vpa": 45.50,
        "payoutEstatuto": 50.0,
        "dyMedia3Anos": 8.5,
        "gatilhoROE": 15.0,
        "gatilhoVPA": 40.0,
        "gatilhoLPA": 5.0,
        "precoTetoReajustado": 40.0,
        "quantidadeAdquirida": 100,
        "precoMedioCompra": 35.00,
        "precoAtual": 36.50
    }
    
    try:
        response = requests.post(f"{BASE_URL}/stock-monitoring", json=data)
        
        if response.status_code == 201:
            result = response.json()
            return print_result(
                test_name, 
                True, 
                "Monitoramento criado com sucesso",
                result.get("data")
            )
        else:
            return print_result(
                test_name,
                False,
                f"Erro HTTP {response.status_code}: {response.text}",
                json.loads(response.text) if response.text else None
            )
            
    except requests.exceptions.ConnectionError:
        return print_result(
            test_name,
            False,
            "Não foi possível conectar ao servidor. Certifique-se de que o Next.js está rodando.",
            None
        )
    except Exception as e:
        return print_result(
            test_name,
            False,
            f"Erro inesperado: {str(e)}",
            None
        )

def test_create_monitoramento_nova_acao():
    """Testa criação de monitoramento com ação que não existe (deve criar asset automaticamente)"""
    test_name = "Criar monitoramento com ação inexistente (TESTE1)"
    
    data = {
        "assetId": "TESTE1",
        "stockType": "ON",
        "vpa": 20.00,
        "payoutEstatuto": 45.0,
        "dyMedia3Anos": 6.0,
        "precoAtual": 18.50
    }
    
    try:
        response = requests.post(f"{BASE_URL}/stock-monitoring", json=data)
        
        if response.status_code == 201:
            result = response.json()
            return print_result(
                test_name, 
                True, 
                "Monitoramento criado com sucesso (asset criado automaticamente)",
                result.get("data")
            )
        else:
            return print_result(
                test_name,
                False,
                f"Erro HTTP {response.status_code}: {response.text}",
                json.loads(response.text) if response.text else None
            )
            
    except requests.exceptions.ConnectionError:
        return print_result(
            test_name,
            False,
            "Não foi possível conectar ao servidor",
            None
        )
    except Exception as e:
        return print_result(
            test_name,
            False,
            f"Erro inesperado: {str(e)}",
            None
        )

def test_list_monitoramentos():
    """Testa listagem de monitoramentos"""
    test_name = "Listar todos os monitoramentos"
    
    try:
        response = requests.get(f"{BASE_URL}/stock-monitoring")
        
        if response.status_code == 200:
            result = response.json()
            count = len(result.get("data", []))
            return print_result(
                test_name, 
                True, 
                f"Encontrados {count} monitoramento(s)",
                {"count": count}
            )
        else:
            return print_result(
                test_name,
                False,
                f"Erro HTTP {response.status_code}: {response.text}",
                None
            )
            
    except Exception as e:
        return print_result(
            test_name,
            False,
            f"Erro inesperado: {str(e)}",
            None
        )

def main():
    """Executa todos os testes"""
    print("=" * 60)
    print("TESTES DE CRIAÇÃO DE MONITORAMENTO DE AÇÕES")
    print("=" * 60)
    print("\nVerificando se a solução para o erro de chave estrangeira funciona...")
    
    results = []
    
    # Executar testes
    results.append(test_create_monitoramento())
    results.append(test_create_monitoramento_nova_acao())
    results.append(test_list_monitoramentos())
    
    # Resumo
    print("\n" + "=" * 60)
    print("RESUMO DOS TESTES")
    print("=" * 60)
    passed = sum(results)
    total = len(results)
    percentage = (passed / total * 100) if total > 0 else 0
    
    print(f"\nTotal: {passed}/{total} testes passaram ({percentage:.0f}%)")
    
    if passed == total:
        print("\n🎉 Todos os testes passaram! A solução está funcionando corretamente.")
    else:
        print(f"\n⚠️ {total - passed} teste(s) falharam. Verifique os erros acima.")
    
    print("\n" + "=" * 60)

if __name__ == "__main__":
    main()
