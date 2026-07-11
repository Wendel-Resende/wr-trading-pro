"""
Executar teste da API em subprocess separado
"""
import subprocess
import sys

print("Executando teste da API...")
result = subprocess.run([sys.executable, "test_api_fix.py"], capture_output=True, text=True)
print(result.stdout)
if result.stderr:
    print("STDERR:", result.stderr)
print(f"Código de retorno: {result.returncode}")