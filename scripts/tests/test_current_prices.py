import requests
import json

url = "http://localhost:5000/api/spread/analyze"
payload = {
    "symbol1": "PETR4",
    "symbol2": "VALE3",
    "data_inicial": "2024-01-01",
    "data_final": "2024-12-31",
    "ganho_minimo": 0.10
}

print("Testando preços atuais...")
response = requests.post(url, json=payload)

if response.status_code == 200:
    data = response.json()
    if data['success']:
        result = data['data']
        print(f"\n✅ Sucesso!")
        print(f"\nPreços Atuais:")
        print(f"  {result['symbol1']}: R$ {result['current_price1']:.2f}")
        print(f"  {result['symbol2']}: R$ {result['current_price2']:.2f}")
        print(f"\nSpread Atual: R$ {result['spread_atual']:.2f}")
        print(f"  (Diferença: {abs(result['current_price1'] - result['current_price2']):.2f})")
        print(f"\nTotal de oportunidades: {result['total_oportunidades']}")
    else:
        print(f"❌ Erro: {data.get('error')}")
else:
    print(f"❌ Status Code: {response.status_code}")
    print(response.text)