"""Adaptador único de sessão B3 D1 (espelho de src/domain/v1/time/b3-session.ts).

Item A / revisão 4, decisão D-session: nenhuma hora fixa é afirmada como
"sempre posterior a qualquer sessão B3" sem fonte. Se um calendário real
(versionado, com proveniência) tiver uma entrada para o dia civil pedido,
usa exatamente esse instante. Sem entrada, cai no único limite que não
depende de nenhum fato de mercado: o fim do próprio dia civil em UTC — tudo
que aconteceu naquele pregão, aconteceu antes desse instante, por definição
de calendário, não por estimativa de horário de fechamento.
"""
from datetime import datetime, timedelta, timezone


class InvalidSessionInstantError(ValueError):
    """G-003 item 2: instante de calendário/pregão rejeitado — não-UTC,
    fora do dia civil da chave, ou anterior ao início da barra."""


def _require_utc_midnight(value: datetime, *, label: str) -> datetime:
    """Rejeita datetime naive/não-UTC ou que não seja exatamente meia-noite
    (início do dia civil, que é como toda barra D1 B3 é chaveada aqui)."""
    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise InvalidSessionInstantError(
            f'{label} deve ser timezone-aware em UTC (tzinfo=timezone.utc); recebido: {value!r}')
    if (value.hour, value.minute, value.second, value.microsecond) != (0, 0, 0, 0):
        raise InvalidSessionInstantError(
            f'{label} deve ser meia-noite UTC (início do dia civil da barra); recebido: {value!r}')
    return value


class B3DailySessionCalendar:
    """Fonte de fatos sobre fechamento de sessões B3 por dia civil.

    `entries` mapeia 'YYYY-MM-DD' -> datetime UTC do fechamento REAL e
    verificado daquele pregão. Nasce vazio nesta v1.1 (desvio consciente 6
    da spec): sem entradas cadastradas, todo dia cai no fallback de fim de
    dia civil — mais conservador do que um horário de fechamento real
    seria, nunca menos.

    G-003 item 2: toda entrada é validada na entrada do calendário (nunca em
    uso posterior) — rejeita instante não-UTC, instante que caia em um dia
    civil diferente da chave do pregão, ou instante anterior ao início
    (meia-noite UTC) da própria barra que ele descreve.
    """

    def __init__(self, entries: dict[str, datetime] | None = None):
        self._entries: dict[str, datetime] = {}
        for key, value in (entries or {}).items():
            self._entries[key] = self._validate_entry(key, value)

    @staticmethod
    def _validate_entry(key: str, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() != timedelta(0):
            raise InvalidSessionInstantError(
                f"entrada de calendário para '{key}' deve ser timezone-aware em UTC; recebido: {value!r}")
        day_start = datetime.strptime(key, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        day_end = day_start + timedelta(days=1)
        if value < day_start:
            raise InvalidSessionInstantError(
                f"entrada de calendário para '{key}' é anterior ao início da barra "
                f"({day_start.isoformat()}); recebido: {value!r}")
        if value >= day_end:
            raise InvalidSessionInstantError(
                f"entrada de calendário para '{key}' cai fora do dia civil da chave "
                f"(deve estar em [{day_start.isoformat()}, {day_end.isoformat()})); recebido: {value!r}")
        return value

    def close_instant_for(self, trading_day_utc_midnight: datetime) -> datetime | None:
        _require_utc_midnight(trading_day_utc_midnight, label='trading_day_utc_midnight')
        key = trading_day_utc_midnight.strftime('%Y-%m-%d')
        return self._entries.get(key)


def end_of_utc_civil_day(trading_day_utc_midnight: datetime) -> datetime:
    _require_utc_midnight(trading_day_utc_midnight, label='trading_day_utc_midnight')
    day = trading_day_utc_midnight.replace(hour=0, minute=0, second=0, microsecond=0)
    return day + timedelta(days=1) - timedelta(microseconds=1)


def b3_daily_close_knowledge_instant(
    trading_day_utc_midnight: datetime, calendar: B3DailySessionCalendar
) -> datetime:
    """Instante conservador em que o OHLC de um pregão D1 B3 é conhecido.

    Usa o calendário quando há fato registrado; senão, fim do dia civil em
    UTC (fallback fail-safe, nunca antecipa). `trading_day_utc_midnight`
    naive, não-UTC, ou que não seja meia-noite UTC é rejeitado explicitamente
    (G-003 item 2) — nunca é aceito silenciosamente e reinterpretado.
    """
    known = calendar.close_instant_for(trading_day_utc_midnight)
    if known is not None:
        return known
    return end_of_utc_civil_day(trading_day_utc_midnight)


def empty_calendar() -> B3DailySessionCalendar:
    """Calendário vazio — estado inicial honesto desta v1.1."""
    return B3DailySessionCalendar()


UTC = timezone.utc
