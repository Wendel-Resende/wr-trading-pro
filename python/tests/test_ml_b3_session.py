import os, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.b3_session import (B3DailySessionCalendar, InvalidSessionInstantError,
                            b3_daily_close_knowledge_instant,
                            empty_calendar, end_of_utc_civil_day)

def day(y, m, d):
    return datetime(y, m, d, tzinfo=timezone.utc)

def test_empty_calendar_falls_back_to_end_of_civil_day():
    cal = empty_calendar()
    d = day(2026, 3, 10)
    result = b3_daily_close_knowledge_instant(d, cal)
    assert result == end_of_utc_civil_day(d)
    assert result.hour == 23 and result.minute == 59 and result.second == 59
    assert result >= d and result < d + timedelta(days=1)

def test_known_calendar_entry_is_used_exactly():
    d = day(2026, 3, 10)
    real_close = day(2026, 3, 10) + timedelta(hours=21)
    cal = B3DailySessionCalendar({'2026-03-10': real_close})
    assert b3_daily_close_knowledge_instant(d, cal) == real_close

def test_calendar_never_returns_before_civil_day_start():
    """Nenhum caminho (calendário ou fallback) pode devolver um instante
    anterior ao próprio dia civil da barra — isso seria antecipar
    conhecimento, o erro que motivou a correção desta spec."""
    d = day(2026, 3, 10)
    cal = empty_calendar()
    result = b3_daily_close_knowledge_instant(d, cal)
    assert result >= d

def test_fallback_is_end_of_day_not_a_fixed_hour():
    """Não promete nenhuma hora fixa 'sempre depois de qualquer sessão B3' —
    só garante o fim do próprio dia civil quando não há fato de calendário."""
    d1, d2 = day(2026, 1, 5), day(2026, 6, 15)
    cal = empty_calendar()
    r1 = b3_daily_close_knowledge_instant(d1, cal)
    r2 = b3_daily_close_knowledge_instant(d2, cal)
    assert r1 == end_of_utc_civil_day(d1)
    assert r2 == end_of_utc_civil_day(d2)
    assert r1.hour == 23 and r2.hour == 23  # fim de dia, não uma hora de "fechamento" inventada

def test_correcting_a_calendar_entry_does_not_change_past_computation():
    """Registro consultado ANTES de uma correção reflete o valor de então —
    o adaptador em si não guarda estado (é o chamador quem versiona)."""
    d = day(2026, 3, 10)
    cal_v1 = B3DailySessionCalendar({'2026-03-10': day(2026, 3, 10) + timedelta(hours=21)})
    v1_result = b3_daily_close_knowledge_instant(d, cal_v1)
    cal_v2 = B3DailySessionCalendar({'2026-03-10': day(2026, 3, 10) + timedelta(hours=21, minutes=30)})
    v2_result = b3_daily_close_knowledge_instant(d, cal_v2)
    assert v1_result != v2_result  # cada versão do calendário é consultada isoladamente

def test_naive_datetime_is_rejected():
    """G-003 item 2: datetime sem tzinfo nunca é aceito silenciosamente
    como se fosse UTC."""
    naive = datetime(2026, 3, 10)
    cal = empty_calendar()
    try:
        b3_daily_close_knowledge_instant(naive, cal)
        assert False, 'deveria ter rejeitado datetime naive'
    except InvalidSessionInstantError:
        pass
    try:
        end_of_utc_civil_day(naive)
        assert False, 'deveria ter rejeitado datetime naive'
    except InvalidSessionInstantError:
        pass

def test_non_utc_timezone_is_rejected():
    """G-003 item 2: fuso diferente de UTC (mesmo tzinfo-aware) é rejeitado
    explicitamente — nunca reinterpretado como UTC."""
    from datetime import timezone as tz
    non_utc = datetime(2026, 3, 10, tzinfo=tz(timedelta(hours=-3)))
    cal = empty_calendar()
    try:
        b3_daily_close_knowledge_instant(non_utc, cal)
        assert False, 'deveria ter rejeitado fuso nao-UTC'
    except InvalidSessionInstantError:
        pass

def test_trading_day_not_at_midnight_is_rejected():
    """G-003 item 2: instante que não seja exatamente meia-noite UTC (não
    representa o início de um dia civil/barra) é rejeitado."""
    not_midnight = day(2026, 3, 10) + timedelta(hours=12)
    cal = empty_calendar()
    try:
        b3_daily_close_knowledge_instant(not_midnight, cal)
        assert False, 'deveria ter rejeitado instante fora da meia-noite'
    except InvalidSessionInstantError:
        pass

def test_calendar_entry_before_bar_start_is_rejected():
    """G-003 item 2: entrada de calendário anterior ao início (meia-noite
    UTC) da própria barra que descreve é rejeitada na construção."""
    try:
        B3DailySessionCalendar({'2026-03-10': day(2026, 3, 9) + timedelta(hours=23)})
        assert False, 'deveria ter rejeitado entrada anterior ao inicio da barra'
    except InvalidSessionInstantError:
        pass

def test_calendar_entry_outside_civil_day_is_rejected():
    """G-003 item 2: entrada de calendário que caia num dia civil diferente
    da própria chave (ex.: madrugada do dia seguinte) é rejeitada."""
    try:
        B3DailySessionCalendar({'2026-03-10': day(2026, 3, 11)})
        assert False, 'deveria ter rejeitado entrada fora do dia civil'
    except InvalidSessionInstantError:
        pass

def test_calendar_entry_naive_is_rejected():
    """G-003 item 2: entrada de calendário sem tzinfo é rejeitada."""
    try:
        B3DailySessionCalendar({'2026-03-10': datetime(2026, 3, 10, 21)})
        assert False, 'deveria ter rejeitado entrada naive'
    except InvalidSessionInstantError:
        pass

if __name__ == '__main__':
    test_empty_calendar_falls_back_to_end_of_civil_day()
    test_known_calendar_entry_is_used_exactly()
    test_calendar_never_returns_before_civil_day_start()
    test_fallback_is_end_of_day_not_a_fixed_hour()
    test_correcting_a_calendar_entry_does_not_change_past_computation()
    test_naive_datetime_is_rejected()
    test_non_utc_timezone_is_rejected()
    test_trading_day_not_at_midnight_is_rejected()
    test_calendar_entry_before_bar_start_is_rejected()
    test_calendar_entry_outside_civil_day_is_rejected()
    test_calendar_entry_naive_is_rejected()
    print('test_ml_b3_session: OK')
