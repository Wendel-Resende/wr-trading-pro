#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))
from contracts.v1 import parse_wire_contract_v1  # noqa: E402

fixture_dir = ROOT / "contracts/fixtures/v1"
valid = json.loads((fixture_dir / "valid.json").read_text(encoding="utf-8"))
invalid = json.loads((fixture_dir / "invalid.json").read_text(encoding="utf-8"))
normalized = [parse_wire_contract_v1(item).model_dump(mode="json") for item in valid]
decisions = []
for fixture in invalid:
    try:
        parse_wire_contract_v1(fixture["payload"])
    except ValidationError as exc:
        decisions.append({"name": fixture["name"], "accepted": False, "error": str(exc)})
    else:
        decisions.append({"name": fixture["name"], "accepted": True, "error": None})
print(json.dumps({"normalizedValid": normalized, "invalidResults": decisions}, separators=(",", ":"), ensure_ascii=True))
