"""Splits walk-forward anuais com janela expansiva e embargo."""
import pandas as pd

EMBARGO_CAL_DAYS = 30  # ~21 pregões em dias corridos

def walkforward_splits(dates: pd.Series, min_train_years: int = 2):
    dates = pd.to_datetime(dates)
    years = sorted(dates.dt.year.unique())
    splits = []
    for test_year in years[min_train_years:]:
        train_end = pd.Timestamp(f'{test_year - 1}-12-31') - pd.Timedelta(days=EMBARGO_CAL_DAYS)
        train_mask = (dates <= train_end).to_numpy()
        test_mask = (dates.dt.year == test_year).to_numpy()
        if train_mask.sum() >= 100 and test_mask.sum() >= 20:
            splits.append({'test_year': int(test_year), 'train_end': train_end,
                           'train_mask': train_mask, 'test_mask': test_mask})
    if not splits:
        raise ValueError('INSUFFICIENT_DATA: historico insuficiente para walk-forward')
    return splits
