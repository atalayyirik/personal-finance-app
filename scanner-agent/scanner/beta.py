import os
import numpy as np
import pandas as pd

from .polygon_api import poly_get_agg
from .yahoo_api import yahoo_close_series


def _poly_close_series(ticker: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.Series:
    _from, _to = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
    df = poly_get_agg(ticker, _from, _to, "day")
    if df.empty:
        return pd.Series(dtype=float)
    s = df.set_index("Date")["Close"].sort_index()
    s.index = pd.to_datetime(s.index)
    return s

def _polygon_available() -> bool:
    return bool(os.getenv('POLYGON_API_KEY'))


def _close_series(ticker: str, start: pd.Timestamp, end: pd.Timestamp, provider: str) -> pd.Series:
    provider = (provider or 'polygon').lower()
    if provider == 'yahoo':
        series = yahoo_close_series(ticker, start, end)
        if not series.empty:
            return series
        if not _polygon_available():
            return pd.Series(dtype=float)
    return _poly_close_series(ticker, start, end)

def _winsorize(series: pd.Series, p: float) -> pd.Series:
    if series.empty or p <= 0:
        return series
    lo, hi = series.quantile(p), series.quantile(1 - p)
    return series.clip(lower=lo, upper=hi)

def compute_beta_daily_ols(ticker: str, cfg: dict, provider: str = 'polygon'):
    beta_cfg = cfg.get("beta", {})
    bench_sym = beta_cfg.get("benchmark", "SPY")
    years = int(beta_cfg.get("years", 3))
    min_pts = int(beta_cfg.get("min_points", 500))
    winsor_p = float(beta_cfg.get("winsor_pct", 0.01))

    end = pd.Timestamp.today().normalize()
    start = end - pd.DateOffset(years=years)

    s_sym = _close_series(ticker, start, end, provider)
    if s_sym.empty and provider != 'polygon' and _polygon_available():
        s_sym = _close_series(ticker, start, end, 'polygon')
    if s_sym.empty:
        return None

    s_mkt = _close_series(bench_sym, start, end, provider)
    if s_mkt.empty and provider != 'polygon' and _polygon_available():
        s_mkt = _close_series(bench_sym, start, end, 'polygon')
    if s_mkt.empty and bench_sym != "SPY":
        s_mkt = _close_series("SPY", start, end, provider)
        if s_mkt.empty and provider != 'polygon' and _polygon_available():
            s_mkt = _close_series("SPY", start, end, 'polygon')
    if s_mkt.empty:
        return None

    s_mkt = s_mkt.reindex(s_sym.index).ffill()

    ri = np.log(s_sym).diff().dropna()
    rm = np.log(s_mkt).diff().dropna()

    idx = ri.index.intersection(rm.index)
    if len(idx) < min_pts:
        return None
    ri = ri.loc[idx]
    rm = rm.loc[idx]

    if winsor_p > 0:
        ri = _winsorize(ri, winsor_p)
        rm = _winsorize(rm, winsor_p)

    try:
        beta = np.polyfit(rm.values, ri.values, 1)[0]
        return float(beta)
    except Exception:
        return None

def compute_beta(ticker: str, cfg: dict, provider: str = 'polygon'):
    return compute_beta_daily_ols(ticker, cfg, provider)

def compute_beta_polygon(ticker: str, cfg: dict):
    return compute_beta_daily_ols(ticker, cfg, 'polygon')
