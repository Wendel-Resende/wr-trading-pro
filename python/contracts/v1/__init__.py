from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Literal, TypeAlias, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

SCHEMA_VERSION_V1 = "1.0.0"
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9._-]{0,31}$")
TIMESTAMP_PATTERN = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$"
)

Identifier = Annotated[str, Field(strict=True, min_length=1, max_length=128, pattern=ID_PATTERN.pattern)]
Symbol = Annotated[str, Field(strict=True, min_length=1, max_length=32, pattern=SYMBOL_PATTERN.pattern)]
Text = Annotated[str, Field(strict=True, min_length=1, max_length=1000)]
Timestamp = Annotated[str, Field(strict=True, max_length=40, pattern=TIMESTAMP_PATTERN.pattern)]
PositiveFinite = Annotated[float, Field(strict=True, gt=0, le=1_000_000_000, allow_inf_nan=False)]
Price = PositiveFinite
Side = Literal["BUY", "SELL"]
Decision = Literal["BUY", "SELL", "HOLD", "NO_DECISION"]
OrderType = Literal["MARKET", "LIMIT"]


def _parse_timestamp(value: str) -> datetime:
    match = TIMESTAMP_PATTERN.fullmatch(value)
    if not match:
        raise ValueError("timestamp inválido ou sem timezone")
    year, month, day, hour, minute, second = map(int, match.group(1, 2, 3, 4, 5, 6))
    offset_hour = int(match.group(10) or 0)
    offset_minute = int(match.group(11) or 0)
    if not 1 <= year <= 9999:
        raise ValueError("ano deve estar entre 0001 e 9999")
    if hour > 23 or minute > 59 or second > 59:
        raise ValueError("hora inválida")
    if offset_hour > 14 or offset_minute > 59 or (offset_hour == 14 and offset_minute != 0):
        raise ValueError("offset deve estar entre -14:00 e +14:00")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("timestamp com calendário inválido") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timestamp sem timezone")
    return parsed


def _validate_timestamp(value: str) -> str:
    _parse_timestamp(value)
    return value


def _timestamp_instant_micros(value: str) -> int:
    """Returns a lossless proleptic-Gregorian UTC key without datetime overflow."""
    parsed = _parse_timestamp(value)
    offset = parsed.utcoffset()
    assert offset is not None
    local_micros = (
        ((parsed.toordinal() - 1) * 86_400 + parsed.hour * 3_600 + parsed.minute * 60 + parsed.second)
        * 1_000_000
        + parsed.microsecond
    )
    return local_micros - int(offset.total_seconds() * 1_000_000)


class StrictWireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    @field_validator("createdAt", check_fields=False)
    @classmethod
    def validate_timestamp(cls, value: str) -> str:
        return _validate_timestamp(value)


class TradingSignalV1(StrictWireModel):
    schemaVersion: Literal["1.0.0"]
    kind: Literal["trading.signal"]
    id: Identifier
    createdAt: Timestamp
    executionEligible: Literal[False]
    instrument: Symbol
    timeframe: Literal["M1", "M5", "M15", "M30", "H1", "H4", "D1"]
    decision: Decision
    confidence: Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
    rationale: Text
    tags: Annotated[list[Annotated[str, Field(strict=True, min_length=1, max_length=32)]], Field(max_length=16)]
    validUntil: Timestamp | None

    _valid_until = field_validator("validUntil")(
        classmethod(lambda cls, value: None if value is None else _validate_timestamp(value))
    )

    @model_validator(mode="after")
    def validate_valid_until(self):
        if self.validUntil is not None and _timestamp_instant_micros(self.validUntil) <= _timestamp_instant_micros(self.createdAt):
            raise ValueError("validUntil deve ser estritamente posterior a createdAt em UTC")
        return self


class ConditionalOrderModel(StrictWireModel):
    orderType: OrderType
    limitPrice: Price | None

    @model_validator(mode="after")
    def validate_limit_price(self):
        if self.orderType == "LIMIT" and self.limitPrice is None:
            raise ValueError("LIMIT exige limitPrice")
        if self.orderType == "MARKET" and self.limitPrice is not None:
            raise ValueError("MARKET proíbe limitPrice")
        return self


class TradeProposalV1(ConditionalOrderModel):
    schemaVersion: Literal["1.0.0"]
    kind: Literal["trade.proposal"]
    id: Identifier
    createdAt: Timestamp
    executionEligible: Literal[False]
    signalId: Identifier
    instrument: Symbol
    side: Side
    quantity: PositiveFinite
    stopLoss: Price | None
    takeProfit: Price | None
    rationale: Text
    expiresAt: Timestamp

    _expires_at = field_validator("expiresAt")(classmethod(lambda cls, value: _validate_timestamp(value)))

    @model_validator(mode="after")
    def validate_expiration(self):
        if _timestamp_instant_micros(self.expiresAt) <= _timestamp_instant_micros(self.createdAt):
            raise ValueError("expiresAt deve ser estritamente posterior a createdAt em UTC")
        return self


class OrderDraftV1(ConditionalOrderModel):
    schemaVersion: Literal["1.0.0"]
    kind: Literal["order.draft"]
    id: Identifier
    createdAt: Timestamp
    executionEligible: Literal[False]
    proposalId: Identifier
    accountId: Identifier
    instrument: Symbol
    side: Side
    quantity: PositiveFinite
    stopLoss: Price | None
    takeProfit: Price | None
    state: Literal["draft"]
    humanApproval: None
    idempotencyKey: None


WireContractV1: TypeAlias = Annotated[Union[TradingSignalV1, TradeProposalV1, OrderDraftV1], Field(discriminator="kind")]
WIRE_CONTRACT_V1_ADAPTER = TypeAdapter(WireContractV1)


def parse_wire_contract_v1(value: object) -> WireContractV1:
    return WIRE_CONTRACT_V1_ADAPTER.validate_python(value, strict=True)


__all__ = ["SCHEMA_VERSION_V1", "TradingSignalV1", "TradeProposalV1", "OrderDraftV1", "WireContractV1", "parse_wire_contract_v1"]
