#!/usr/bin/env python3
"""
Wrapper para análise via Ollama API direta.
Chamado pela API Next.js como subprocess.
"""

import sys
import json
import logging
import os
import re
from datetime import datetime
from typing import Optional
import httpx

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "ministral-3:8b"


def call_ollama(prompt: str, model: str = DEFAULT_MODEL, timeout: int = 120) -> str:
    """Chama Ollama API via curl subprocess."""
    import subprocess

    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    })

    cmd = [
        'curl', '-s', '-X', 'POST',
        f"{OLLAMA_BASE_URL}/api/chat",
        '-H', 'Content-Type: application/json',
        '-d', payload,
        '--max-time', str(min(timeout, 300))
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout + 10
        )
        if result.returncode != 0:
            raise Exception(f"curl failed (code {result.returncode})")

        data = json.loads(result.stdout.decode('utf-8', errors='replace'))
        return data.get("message", {}).get("content", "")
    except subprocess.TimeoutExpired:
        raise Exception(f"Ollama timeout apos {timeout}s")
    except Exception as e:
        raise Exception(f"Ollama error: {e}")


def run_quant_analysis(ticker: str, market_data: dict, model_name: Optional[str] = None) -> dict:
    """Executa análise via Ollama direta."""
    try:
        model = model_name or DEFAULT_MODEL
        logger.info(f"Running Quant analysis for {ticker} with {model}")

        price = market_data.get("price", 0)
        change = market_data.get("changePercent", 0)
        prev_close = market_data.get("previousClose", price)
        stop_loss = price * 0.97
        take_profit = price * 1.06
        support = price * 0.97
        resistance = price * 1.03

        # JSON template - match working curl format
        json_template = (
            '\\{\"action\": \"HOLD\", \"entry_price\": ' + f'{price:.2f}'
            + ', \"stop_loss\": ' + f'{stop_loss:.2f}'
            + ', \"take_profit\": ' + f'{take_profit:.2f}'
            + ', \"quantity\": 100, \"risk_score\": 0.5, \"confidence\": 0.5'
            + ', \"rationale\": \"analysis\"}'
        )

        prompt = (
            "Analyze " + ticker + " on B3 market.\n\n"
            "Data: Price " + f'{price:.2f}' + ", Change " + f'{change:+.2f}' + "%, Prev close " + f'{prev_close:.2f}' + "\n\n"
            "Respond ONLY with this JSON (replace values with your analysis):\n"
            + json_template
        )

        logger.info(f"Calling Ollama for {ticker}...")
        output = call_ollama(prompt, model=model, timeout=180)
        logger.info(f"Ollama response received for {ticker}")

        json_str = extract_json(output)
        if json_str:
            result = json.loads(json_str)
            result["ticker"] = ticker
            result["timestamp"] = datetime.now().isoformat()
            result["pipeline"] = "quant-direct"
            return result

        return {
            "ticker": ticker,
            "action": "HOLD",
            "entry_price": price,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
            "quantity": 100,
            "risk_score": 0.5,
            "confidence": 0.5,
            "rationale": output[:500] if output else "Analysis unavailable",
            "raw_output": output[:1000],
            "timestamp": datetime.now().isoformat(),
            "pipeline": "quant-direct"
        }

    except Exception as e:
        logger.error(f"Erro na analise: {e}")
        return {
            "ticker": ticker,
            "error": str(e),
            "status": "failed"
        }


def extract_json(text: str) -> Optional[str]:
    """Extrai JSON do output."""
    patterns = [
        r'```json\s*([\s\S]*?)\s*```',
        r'```\s*([\s\S]*?)\s*```',
        r'(\{[\s\S]*\})',
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            try:
                json.loads(match.group(1) if match.lastindex else match.group())
                return match.group(1) if match.lastindex else match.group()
            except:
                continue
    return None


def run_pipeline(ticker: str, market_data: dict, model_name: Optional[str] = None) -> dict:
    """Alias para compatibilidade."""
    return run_quant_analysis(ticker, market_data, model_name)


def parse_args():
    """Parse arguments."""
    if len(sys.argv) == 1:
        input_data = sys.stdin.read()
        if input_data.strip():
            try:
                data = json.loads(input_data)
                return {
                    "ticker": data.get("ticker", ""),
                    "market_data": data.get("market_data", {}),
                    "model": data.get("model")
                }
            except json.JSONDecodeError:
                return None
        return None

    if len(sys.argv) < 2:
        print("Usage: echo '{\"ticker\": \"PETR4\", ...}' | python agents/pipeline_wrapper.py")
        sys.exit(1)

    try:
        with open(sys.argv[1], 'r') as f:
            data = json.load(f)
            return {
                "ticker": data.get("ticker", ""),
                "market_data": data.get("market_data", {}),
                "model": data.get("model")
            }
    except (FileNotFoundError, json.JSONDecodeError, OSError, ValueError):
        try:
            data = json.loads(sys.argv[1])
            return {
                "ticker": data.get("ticker", ""),
                "market_data": data.get("market_data", {}),
                "model": data.get("model")
            }
        except (json.JSONDecodeError, ValueError):
            sys.exit(1)


def main():
    """Entry point."""
    args = parse_args()
    if not args:
        sys.exit(1)

    ticker = args["ticker"]
    market_data = args["market_data"]
    model = args.get("model")

    if not ticker:
        print(json.dumps({"error": "ticker is required"}))
        sys.exit(1)

    result = run_quant_analysis(ticker, market_data, model)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
