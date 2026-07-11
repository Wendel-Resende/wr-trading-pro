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

print("Testando análise de spread...")
print(f"Payload: {json.dumps(payload, indent=2)}\n")

response = requests.post(url, json=payload)

print(f"Status Code: {response.status_code}")
print(f"Response: {json.dumps(response.json(), indent=2)}")