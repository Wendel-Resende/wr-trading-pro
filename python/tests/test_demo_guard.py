"""
Testes unitários da guarda DEMO do bridge MT5 — WR Trading Pro (MCP Piloto, Task 7)

Rodar (conda env IA_Day_Trading):
    python -m unittest python.tests.test_demo_guard -v

Cobre `is_order_allowed_by_account`, função pura extraída de
`handle_send_order` em `python/mt5_bridge.py` — testável sem o módulo
MetaTrader5 (não importado aqui), usando objetos fake com atributo
`trade_mode`.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from mt5_bridge import is_order_allowed_by_account  # noqa: E402


class FakeAccount:
    """Substitui `mt5.account_info()` nos testes — só precisa do atributo `trade_mode`."""

    def __init__(self, trade_mode: int):
        self.trade_mode = trade_mode


class TestIsOrderAllowedByAccount(unittest.TestCase):
    def test_demo_only_e_conta_demo_permite(self):
        self.assertTrue(is_order_allowed_by_account(True, FakeAccount(trade_mode=0)))

    def test_demo_only_e_conta_nao_demo_bloqueia(self):
        self.assertFalse(is_order_allowed_by_account(True, FakeAccount(trade_mode=2)))

    def test_demo_only_e_conta_ausente_bloqueia(self):
        self.assertFalse(is_order_allowed_by_account(True, None))

    def test_demo_only_desligado_sempre_permite(self):
        self.assertTrue(is_order_allowed_by_account(False, FakeAccount(trade_mode=2)))
        self.assertTrue(is_order_allowed_by_account(False, None))

    def test_demo_mode_value_customizado(self):
        # Prova de que a comparação usa o parâmetro, não um valor fixo —
        # o chamador real passa `mt5.ACCOUNT_TRADE_MODE_DEMO`.
        self.assertTrue(is_order_allowed_by_account(True, FakeAccount(trade_mode=5), demo_mode_value=5))
        self.assertFalse(is_order_allowed_by_account(True, FakeAccount(trade_mode=0), demo_mode_value=5))


if __name__ == '__main__':
    unittest.main(verbosity=2)
