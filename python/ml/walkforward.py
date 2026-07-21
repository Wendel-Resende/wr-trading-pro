"""Splits walk-forward anuais com janela expansiva e embargo.

G-003 item 4: o embargo é a regra VERIFICÁVEL de 21 pregões — contados
sobre o próprio calendário de dias de negociação presente em `dates` (só
existem linhas para dias em que o mercado efetivamente operou), não uma
aproximação em dias corridos. Um embargo de "30 dias corridos" pode conter
qualquer número de pregões reais dependendo de feriados/fins de semana no
meio do caminho; contar posições no vetor ordenado de dias únicos de
negociação é imune a isso — feriados/interrupções simplesmente não
aparecem no vetor, então "21 posições atrás" é sempre exatamente 21
pregões atrás, nunca mais nem menos.
"""
import pandas as pd

EMBARGO_TRADING_DAYS = 21

def walkforward_splits(dates: pd.Series, embargo_trading_days: int = EMBARGO_TRADING_DAYS, min_train_years: int = 2):
    dates = pd.to_datetime(dates)
    trading_days = pd.Series(sorted(dates.unique()))
    years = sorted(dates.dt.year.unique())
    splits = []
    for test_year in years[min_train_years:]:
        test_mask = (dates.dt.year == test_year).to_numpy()
        if not test_mask.any():
            continue
        test_start = dates[test_mask].min()
        test_start_idx = int(trading_days.searchsorted(test_start, side='left'))
        train_end_idx = test_start_idx - embargo_trading_days - 1
        if train_end_idx < 0:
            continue  # histórico insuficiente para caber o embargo de 21 pregões antes deste ano
        train_end = trading_days.iloc[train_end_idx]
        train_mask = (dates <= train_end).to_numpy()
        if train_mask.sum() >= 100 and test_mask.sum() >= 20:
            splits.append({'fold_id': len(splits), 'test_year': int(test_year), 'train_end': train_end,
                           'embargo_trading_days': embargo_trading_days,
                           # campo legado mantido para compatibilidade de schema do CSV publicado
                           # (`walkforward_predictions.csv` já grava `embargoCalDays` — ver ml/train.py);
                           # não é mais usado para calcular o corte, só reportado por auditoria/proveniência.
                           'embargo_cal_days': int((test_start - train_end).days),
                           'train_mask': train_mask, 'test_mask': test_mask})
    if not splits:
        raise ValueError('INSUFFICIENT_DATA: historico insuficiente para walk-forward')
    return splits
