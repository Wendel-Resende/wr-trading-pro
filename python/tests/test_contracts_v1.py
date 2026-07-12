import copy
import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))
from contracts.v1 import parse_wire_contract_v1  # noqa: E402
from pydantic import ValidationError  # noqa: E402


class WireContractsV1Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_dir = ROOT / "contracts/fixtures/v1"
        cls.valid = json.loads((fixture_dir / "valid.json").read_text(encoding="utf-8"))
        cls.invalid = json.loads((fixture_dir / "invalid.json").read_text(encoding="utf-8"))

    def assert_rejected(self, payload, label):
        with self.subTest(case=label):
            with self.assertRaises(ValidationError):
                parse_wire_contract_v1(payload)

    def test_shared_valid_fixtures_and_round_trip(self):
        normalized = [parse_wire_contract_v1(item).model_dump(mode="json") for item in self.valid]
        reparsed = [parse_wire_contract_v1(item).model_dump(mode="json") for item in normalized]
        self.assertEqual(normalized, reparsed)
        self.assertEqual(normalized, self.valid)
        self.assertEqual(
            [item["decision"] for item in normalized if item["kind"] == "trading.signal"],
            ["BUY", "HOLD", "NO_DECISION", "HOLD", "NO_DECISION", "HOLD"],
        )

    def test_shared_invalid_corpus(self):
        for fixture in self.invalid:
            self.assert_rejected(fixture["payload"], fixture["name"])

    def test_non_json_special_numbers_and_boole_are_rejected(self):
        cases = [(0, "confidence")]
        for fixture_index in (3, 4):
            cases.extend((fixture_index, field) for field in ("quantity", "limitPrice", "stopLoss", "takeProfit"))
        for fixture_index, field in cases:
            for value in (math.nan, math.inf, -math.inf, True, False):
                payload = copy.deepcopy(self.valid[fixture_index])
                payload[field] = value
                self.assert_rejected(payload, f"{payload['kind']}.{field}={value!r}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
