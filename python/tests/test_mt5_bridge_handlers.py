import asyncio
import json
import math
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mt5_bridge as bridge_module


class FakeWebSocket:
    def __init__(self):
        self.messages = []

    async def send(self, payload):
        self.messages.append(json.loads(payload))


class SymbolInfo:
    def __init__(self, name, value=1.0):
        self.name = name
        self.value = value

    def _asdict(self):
        return {"name": self.name, "value": self.value}


class FakeMt5:
    TIMEFRAME_M1 = 1
    TIMEFRAME_M5 = 5
    TIMEFRAME_M15 = 15
    TIMEFRAME_M30 = 30
    TIMEFRAME_H1 = 60
    TIMEFRAME_H4 = 240
    TIMEFRAME_D1 = 1440
    TIMEFRAME_W1 = 10080
    TIMEFRAME_MN1 = 43200

    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    ORDER_TYPE_BUY_LIMIT = 2
    ORDER_TYPE_SELL_LIMIT = 3
    ORDER_TYPE_BUY_STOP = 4
    ORDER_TYPE_SELL_STOP = 5

    def __init__(self):
        self.info = None
        self.rates = []
        self.chart_calls = []
        self.raise_info = False
        self.symbol_info_calls = []

    def symbol_info(self, symbol):
        self.symbol_info_calls.append(symbol)
        if self.raise_info:
            raise RuntimeError("terminal failure")
        return self.info

    def copy_rates_from_pos(self, *args):
        self.chart_calls.append(("pos", args))
        return self.rates

    def copy_rates_range(self, *args):
        self.chart_calls.append(("range", args))
        return self.rates

    def last_error(self):
        return (1, "failed")


class BridgeHandlerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.old_available = bridge_module.MT5_AVAILABLE
        self.old_mt5 = getattr(bridge_module, "mt5", None)
        self.mt5 = FakeMt5()
        bridge_module.mt5 = self.mt5
        bridge_module.MT5_AVAILABLE = True
        self.bridge = bridge_module.MT5Bridge()
        self.bridge.is_connected = True
        self.requester = FakeWebSocket()
        self.other = FakeWebSocket()
        self.bridge.clients = {self.requester, self.other}

    async def asyncTearDown(self):
        bridge_module.MT5_AVAILABLE = self.old_available
        if self.old_mt5 is None:
            delattr(bridge_module, "mt5")
        else:
            bridge_module.mt5 = self.old_mt5

    async def test_symbol_not_found_is_correlated_and_requester_only(self):
        await self.bridge.handle_get_symbol_info(self.requester, {"symbol": "MISS"})
        data = self.requester.messages[0]["data"]
        self.assertEqual(data["code"], "SYMBOL_NOT_FOUND")
        self.assertEqual(data["symbol"], "MISS")
        self.assertEqual(self.other.messages, [])

    async def test_symbol_operational_failure_is_not_not_found(self):
        self.mt5.raise_info = True
        await self.bridge.handle_get_symbol_info(self.requester, {"symbol": "WIN"})
        self.assertEqual(self.requester.messages[0]["data"]["code"], "SYMBOL_INFO_ERROR")

    async def test_chart_success_preserves_correlation_and_requester(self):
        self.mt5.rates = [{"time": 1, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "tick_volume": 3}]
        await self.bridge.handle_get_chart_data(self.requester, {"requestId": 7, "symbol": "WIN", "timeframe": "M1"})
        data = self.requester.messages[0]["data"]
        self.assertEqual((data["requestId"], data["symbol"], data["timeframe"]), (7, "WIN", "M1"))
        self.assertEqual(self.other.messages, [])

    async def test_chart_errors_are_correlated_and_unknown_timeframe_fails_closed(self):
        await self.bridge.handle_get_chart_data(self.requester, {"requestId": 8, "symbol": "WIN", "timeframe": "TYPO"})
        data = self.requester.messages[0]["data"]
        self.assertEqual(data["code"], "CHART_TIMEFRAME_ERROR")
        self.assertEqual((data["requestId"], data["symbol"], data["timeframe"]), (8, "WIN", "TYPO"))
        self.assertEqual(self.mt5.chart_calls, [])

    async def test_strict_json_refuses_nan_for_direct_and_broadcast(self):
        await self.bridge.send_to_client(self.requester, {"value": math.nan})
        await self.bridge.broadcast({"value": math.inf})
        self.assertEqual(self.requester.messages, [])
        self.assertEqual(self.other.messages, [])

    async def test_unknown_order_type_fails_closed_and_requester_only(self):
        """CR-5: tipo de ordem desconhecido deve ser rejeitado, nunca cair
        para um default (ex.: ORDER_TYPE_BUY), e o erro deve ir só para
        quem enviou a ordem, não para todos os clientes (CR-3)."""
        import os

        os.environ["WR_TRADING_ENABLED"] = "true"
        try:
            await self.bridge.handle_send_order(
                self.requester,
                {"symbol": "PETR4", "type": "ORDER_TYPE_TYPO", "volume": 1},
            )
        finally:
            del os.environ["WR_TRADING_ENABLED"]

        self.assertEqual(len(self.requester.messages), 1)
        data = self.requester.messages[0]["data"]
        self.assertEqual(data["code"], "INVALID_ORDER_TYPE")
        self.assertEqual(self.other.messages, [])
        # Nunca deve avançar para consultar informações do símbolo/enviar ordem.
        self.assertEqual(self.mt5.symbol_info_calls, [])

    async def test_kill_switch_blocks_order_when_disabled(self):
        """R-5: sem WR_TRADING_ENABLED=true, nenhuma ordem real é enviada."""
        import os

        os.environ.pop("WR_TRADING_ENABLED", None)
        await self.bridge.handle_send_order(
            self.requester,
            {"symbol": "PETR4", "type": "ORDER_TYPE_BUY", "volume": 1},
        )
        self.assertEqual(self.requester.messages[0]["data"]["code"], "TRADING_DISABLED")
        self.assertEqual(self.other.messages, [])
        self.assertEqual(self.mt5.symbol_info_calls, [])


class RedactionTests(unittest.TestCase):
    """R-9: testes unitários do redator central de segredos em log (CR-4)."""

    def test_redact_value_masks_known_sensitive_keys(self):
        self.assertEqual(bridge_module._redact_value("password", "abc123"), "***")
        self.assertEqual(bridge_module._redact_value("api_key", "xyz"), "***")
        self.assertEqual(bridge_module._redact_value("Authorization", "Bearer xyz"), "***")

    def test_redact_value_preserves_non_sensitive_keys(self):
        self.assertEqual(bridge_module._redact_value("symbol", "PETR4"), "PETR4")
        self.assertEqual(bridge_module._redact_value("volume", 10), 10)

    def test_redact_masks_nested_dict_fields(self):
        payload = {
            "login": 12345,
            "password": "supersecret",
            "server": "Demo-Server",
            "nested": {"token": "abcdef", "symbol": "WIN"},
        }
        result = bridge_module.redact(payload)
        self.assertEqual(result["password"], "***")
        self.assertEqual(result["nested"]["token"], "***")
        self.assertEqual(result["login"], 12345)
        self.assertEqual(result["nested"]["symbol"], "WIN")

    def test_redact_masks_fields_inside_lists(self):
        payload = {"accounts": [{"password": "p1"}, {"password": "p2"}]}
        result = bridge_module.redact(payload)
        self.assertEqual([item["password"] for item in result["accounts"]], ["***", "***"])

    def test_redact_masks_raw_strings_that_look_like_secrets(self):
        result = bridge_module.redact("token=abc123secret")
        self.assertEqual(result, "***")

    def test_redacted_str_never_leaks_password_in_output(self):
        payload = {"login": 1, "password": "topsecret", "server": "Demo"}
        output = bridge_module.redacted_str(payload)
        self.assertNotIn("topsecret", output)
        self.assertIn("***", output)


if __name__ == "__main__":
    unittest.main()
