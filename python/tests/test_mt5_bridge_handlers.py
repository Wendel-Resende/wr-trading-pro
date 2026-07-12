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

    def __init__(self):
        self.info = None
        self.rates = []
        self.chart_calls = []
        self.raise_info = False

    def symbol_info(self, symbol):
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


if __name__ == "__main__":
    unittest.main()
