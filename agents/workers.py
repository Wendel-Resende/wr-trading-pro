"""
Agentes de Trading - WR Trading Pro
Arquitetura multi-agent inspirada no AutoHedge

Pipeline: Director -> Quant -> Risk -> Execution
"""

import os
import json
import logging
from datetime import datetime
from typing import Optional
from swarms import Agent

from .prompts import (
    DIRECTOR_PROMPT,
    EXECUTION_PROMPT,
    QUANT_PROMPT,
    RISK_PROMPT,
    SENTIMENT_PROMPT,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Data/Time suffix for agent prompts
_NOW = datetime.now()
_DATE_TIME_LINE = _NOW.strftime("%A, %B %d, %Y at %H:%M")
if _NOW.tzinfo:
    _DATE_TIME_LINE += f" {_NOW.tzname() or ''}"
_SYSTEM_SUFFIX = f"\n\nCurrent date and time (use this as now): {_DATE_TIME_LINE.strip()}"


class TradingAgents:
    """Sistema de agentes de trading para WR Trading Pro"""
    
    def __init__(self, model_name: str = "openai/gpt-4o-mini"):
        self.model_name = model_name
        self._init_agents()
    
    def _init_agents(self):
        """Inicializar todos os agentes"""
        
        # Sentiment Agent - análise de notícias e redes sociais
        self.sentiment_agent = Agent(
            agent_name="Sentiment-Agent",
            system_prompt=SENTIMENT_PROMPT + _SYSTEM_SUFFIX,
            model_name=self.model_name,
            verbose=True,
            max_loops=1,
        )
        
        # Risk Agent - avaliação de risco e dimensionamento
        self.risk_agent = Agent(
            agent_name="Risk-Manager",
            system_prompt=RISK_PROMPT.strip()
            + "\n\nWhen you receive a message, it will contain:\nStock, Thesis, Quant Analysis.\n\nProvide risk assessment including:\n1. Recommended position size\n2. Maximum drawdown risk\n3. Market risk exposure\n4. Overall risk score",
            model_name=self.model_name,
            output_type="str",
            max_loops=1,
            verbose=True,
            context_length=16000,
        )
        
        # Execution Agent - geração de ordens
        self.execution_agent = Agent(
            agent_name="Execution-Agent",
            system_prompt=EXECUTION_PROMPT.strip()
            + "\n\nWhen you receive a message, it will contain:\nStock, Thesis, Risk Assessment.\n\nGenerate trade order including:\n1. Order type (market/limit)\n2. Quantity\n3. Entry price\n4. Stop loss\n5. Take profit\n6. Time in force",
            model_name=self.model_name,
            output_type="str",
            max_loops=1,
            verbose=True,
            context_length=16000,
        )
        
        # Quant Agent - análise técnica
        self.quant_agent = Agent(
            agent_name="Quant-Analyst",
            system_prompt=QUANT_PROMPT.strip()
            + "\n\nWhen you receive a message, it will contain:\nStock and Thesis from your Director.\n\nGenerate quantitative analysis with: ticker, technical_score (0-1), volume_score (0-1), trend_strength (0-1), volatility, probability_score (0-1), key_levels (support, resistance, pivot).",
            model_name=self.model_name,
            output_type="str",
            max_loops=1,
            verbose=True,
            context_length=16000,
        )
        
        # All agents list for handoffs
        self.all_agents = [
            self.sentiment_agent,
            self.risk_agent,
            self.execution_agent,
            self.quant_agent,
        ]
        
        # Director Agent - orchestrator principal
        self.director_agent = Agent(
            agent_name="Trading-Director",
            system_prompt=DIRECTOR_PROMPT + _SYSTEM_SUFFIX,
            model_name=self.model_name,
            max_loops=1,
            handoffs=self.all_agents,
        )
        
        logger.info("Trading Agents initialized successfully")
    
    def run_analysis(self, task: str, ticker: Optional[str] = None) -> dict:
        """
        Executar análise completa do pipeline de trading.
        
        Args:
            task: Descrição da tarefa/estratégia
            ticker: Símbolo do ativo (ex: "PETR4")
        
        Returns:
            Dict com thesis, análise quant, avaliação de risco e ordem proposta
        """
        logger.info(f"Starting trading analysis for task: {task}")
        
        # Run Director Agent
        director_output = self.director_agent.run(
            f"Analyze and generate trading thesis for: {task}"
        )
        
        result = {
            "director_thesis": director_output,
            "timestamp": datetime.now().isoformat(),
            "ticker": ticker,
            "status": "completed"
        }
        
        return result
    
    def run_pipeline(self, ticker: str, thesis: str, market_data: dict) -> dict:
        """
        Executar pipeline completo: Quant -> Risk -> Execution
        
        Args:
            ticker: Símbolo do ativo (ex: "PETR4")
            thesis: Thesis de trading do Director
            market_data: Dados de mercado (preços, indicadores, etc.)
        
        Returns:
            Dict com análise quant, avaliação de risco e ordem
        """
        logger.info(f"Running pipeline for {ticker}")
        
        # Step 1: Quant Agent
        quant_prompt = f"""Analyze {ticker} with the following thesis:
{thesis}

Market Data:
{json.dumps(market_data, indent=2)}

Provide technical analysis including scores (0-1) for technical_score, volume_score, trend_strength, probability_score, and key_levels (support, resistance, pivot)."""
        
        quant_output = self.quant_agent.run(quant_prompt)
        
        # Step 2: Risk Agent
        risk_prompt = f"""Evaluate risk for {ticker}:
        
Thesis: {thesis}

Quant Analysis: {quant_output}

Provide risk assessment including recommended position size, maximum drawdown risk, market risk exposure, and overall risk score (0-1)."""
        
        risk_output = self.risk_agent.run(risk_prompt)
        
        # Step 3: Execution Agent
        execution_prompt = f"""Generate trade order for {ticker}:

Thesis: {thesis}

Risk Assessment: {risk_output}

Provide trade order including: order type (market/limit), quantity, entry price, stop loss, take profit, and time in force. Consider B3 market conditions (10:00-17:00 BRT)."""
        
        execution_output = self.execution_agent.run(execution_prompt)
        
        return {
            "ticker": ticker,
            "quant_analysis": quant_output,
            "risk_assessment": risk_output,
            "execution_order": execution_output,
            "timestamp": datetime.now().isoformat(),
        }


def create_agents(model_name: str = "openai/gpt-4o-mini") -> TradingAgents:
    """Factory function to create TradingAgents instance"""
    return TradingAgents(model_name=model_name)


# Standalone execution for testing
if __name__ == "__main__":
    agents = create_agents()
    
    # Test pipeline
    result = agents.run_pipeline(
        ticker="PETR4",
        thesis="Compra baseada em análise técnica de reversão de alta no suporte de R$ 38,50 com RSI sobrevendido abaixo de 30. Tendência de fundo positiva com petróleo em alta.",
        market_data={
            "price": 38.20,
            "rsi": 28,
            "macd": "bullish crossover",
            "support": 38.50,
            "resistance": 40.00,
            "volume": "above average"
        }
    )
    
    print("\n=== PIPELINE RESULT ===")
    print(json.dumps(result, indent=2, ensure_ascii=False))