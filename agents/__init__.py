"""
WR Trading Pro - Agents Module
Multi-agent trading system inspired by AutoHedge

Architecture:
    Director Agent (orchestrator)
        ├── Quant Agent (technical analysis)
        ├── Risk Agent (risk assessment & position sizing)
        ├── Execution Agent (order generation)
        └── Sentiment Agent (market sentiment)
"""

from .workers import TradingAgents, create_agents
from .prompts import (
    DIRECTOR_PROMPT,
    QUANT_PROMPT,
    RISK_PROMPT,
    EXECUTION_PROMPT,
    SENTIMENT_PROMPT,
)

__all__ = [
    "TradingAgents",
    "create_agents",
    "DIRECTOR_PROMPT",
    "QUANT_PROMPT",
    "RISK_PROMPT",
    "EXECUTION_PROMPT",
    "SENTIMENT_PROMPT",
]