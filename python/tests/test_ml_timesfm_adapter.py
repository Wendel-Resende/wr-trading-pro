import os, sys, tempfile
import numpy as np, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.timesfm_adapter import TimesFmFeatureProvider

class StubForecaster:
    def __init__(self): self.calls = 0
    def forecast(self, context, horizon):
        self.calls += 1
        last = context[-1]
        median = [last * (1 + 0.001 * (i + 1)) for i in range(horizon)]
        return {'median': median,
                'q10': [m * 0.98 for m in median], 'q90': [m * 1.02 for m in median]}

def test_features_and_cache():
    stub = StubForecaster()
    cache_dir = tempfile.mkdtemp()
    p = TimesFmFeatureProvider(forecaster=stub, cache_dir=cache_dir, max_context=512)
    closes = pd.Series(np.linspace(100, 110, 300),
                       index=pd.date_range('2024-01-01', periods=300, freq='B'))
    f = p.features_for('WEGE3', closes)
    assert abs(f['tfm_ret_10'] - (1.001 ** 1 * (1 + 0.001 * 10) - 1)) < 0.01  # ~+1%
    assert f['tfm_iq'] > 0
    f2 = p.features_for('WEGE3', closes)  # mesma série → cache, sem nova chamada
    assert stub.calls == 1 and f2 == f
    # Persistência: um SEGUNDO provider apontando pro mesmo cache_dir também
    # dá hit no parquet gravado (leitura única, sem re-chamar o stub).
    stub2 = StubForecaster()
    p2 = TimesFmFeatureProvider(forecaster=stub2, cache_dir=cache_dir, max_context=512)
    f3 = p2.features_for('WEGE3', closes)
    assert stub2.calls == 0 and f3 == f

def test_insufficient_context():
    p = TimesFmFeatureProvider(forecaster=StubForecaster(), cache_dir=tempfile.mkdtemp())
    short = pd.Series([1.0] * 10, index=pd.date_range('2024-01-01', periods=10, freq='B'))
    try:
        p.features_for('X', short); assert False
    except ValueError as e:
        assert 'INSUFFICIENT_DATA' in str(e)

if __name__ == '__main__':
    test_features_and_cache(); test_insufficient_context()
    print('test_ml_timesfm_adapter: OK')
