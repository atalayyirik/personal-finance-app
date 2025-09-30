
import functools
import pandas as pd
import yfinance as yf

from .net import http_get
from .utils import _netlog

def _yahoo_get(url, params=None):
    r = http_get(url, params=params or {})
    return {} if r is None else r.json()

def _rating_label_from_mean(mean: float) -> str:
    if mean is None:
        return ""
    try:
        m = float(mean)
    except Exception:
        return ""
    if m <= 1.5:
        return "Strong Buy"
    if m <= 2.5:
        return "Buy"
    if m <= 3.5:
        return "Hold"
    if m <= 4.5:
        return "Sell"
    return "Strong Sell"

def _rating_label_from_trend(trend: dict) -> str:
    if not trend:
        return ""
    sb = int(trend.get("strongBuy", 0) or 0)
    b = int(trend.get("buy", 0) or 0)
    h = int(trend.get("hold", 0) or 0)
    s = int(trend.get("sell", 0) or 0)
    ss = int(trend.get("strongSell", 0) or 0)
    pos, neg = sb + b, s + ss
    if sb >= max(b, h, s, ss) and pos >= (h + neg):
        return "Strong Buy"
    if pos > max(h, neg):
        return "Buy"
    if h >= max(pos, neg):
        return "Hold"
    if neg > pos:
        return "Sell"
    return "Hold"

@functools.lru_cache(maxsize=8192)
def yahoo_get_analyst_rating_label(ticker: str) -> str:
    try:
        url = f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
        params = {"modules": "financialData,recommendationTrend"}
        js = _yahoo_get(url, params=params)
        if not js:
            return ""
        res_list = (js.get("quoteSummary") or {}).get("result") or []
        if not res_list:
            return ""
        res = res_list[0] or {}

        fin = res.get("financialData") or {}
        mean = fin["recommendationMean"]["raw"] if isinstance(fin.get("recommendationMean"), dict) else fin.get("recommendationMean")
        label = _rating_label_from_mean(mean)
        if label:
            return label

        trend = res.get("recommendationTrend") or {}
        periods = trend.get("trend") or []
        latest = periods[0] if periods else {}
        return _rating_label_from_trend(latest)
    except Exception:
        return ""

@functools.lru_cache(maxsize=8192)
def yahoo_get_earnings_dates(ticker: str):
    try:
        tk = yf.Ticker(ticker)
        df = tk.get_earnings_dates(limit=12)
        if df is None or df.empty:
            return {"RecentEarnings": None, "UpcomingEarnings": None}
        dates = df.index if isinstance(df.index, pd.DatetimeIndex) else pd.to_datetime(df.index)
        dates = dates.tz_localize(None)
        today = pd.Timestamp.today().normalize()
        past = dates[dates <= today]
        futr = dates[dates > today]
        recent = past.max().date().isoformat() if len(past) else None
        upcoming = futr.min().date().isoformat() if len(futr) else None
        return {"RecentEarnings": recent, "UpcomingEarnings": upcoming}
    except Exception:
        return {"RecentEarnings": None, "UpcomingEarnings": None}

@functools.lru_cache(maxsize=4096)
def yahoo_price_history_cached(ticker: str, start: str, end: str):
    try:
        end_plus = (pd.to_datetime(end) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    except Exception:
        end_plus = end

    df = None
    try:
        df = yf.download(
            ticker,
            start=start,
            end=end_plus,
            interval="1d",
            auto_adjust=False,
            progress=False,
            threads=False,
        )
    except Exception:
        df = None

    if df is None or df.empty:
        try:
            tk = yf.Ticker(ticker)
            df = tk.history(
                start=start,
                end=end_plus,
                interval="1d",
                auto_adjust=False,
            )
        except Exception:
            df = None

    if df is None or df.empty:
        return pd.DataFrame()

    df = df.reset_index()
    if 'Date' not in df.columns:
        date_col = df.columns[0]
        df = df.rename(columns={date_col: 'Date'})
    df['Date'] = pd.to_datetime(df['Date']).dt.tz_localize(None)
    df['Ticker'] = ticker
    df['ChangePct'] = df['Close'].pct_change() * 100
    return df[['Date', 'Ticker', 'Open', 'High', 'Low', 'Close', 'Volume', 'ChangePct']]

def yahoo_get_agg(ticker: str, _from: str, _to: str):
    return yahoo_price_history_cached(ticker, _from, _to).copy()

def yahoo_close_series(ticker: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.Series:
    df = yahoo_price_history_cached(ticker, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
    if df.empty:
        return pd.Series(dtype=float)
    s = df.set_index('Date')['Close'].sort_index()
    s.index = pd.to_datetime(s.index)
    return s

@functools.lru_cache(maxsize=4096)
def yahoo_get_profile(ticker: str):
    out = {"MarketCap": None, "Sector": None, "Shares": None}
    try:
        tk = yf.Ticker(ticker)
        fast = getattr(tk, 'fast_info', {}) or {}
        market_cap = fast.get('market_cap') or fast.get('market_capitalization')
        if market_cap:
            out['MarketCap'] = float(market_cap)

        shares = (
            fast.get('shares_outstanding')
            or fast.get('implied_shares_outstanding')
            or fast.get('total_shares_outstanding')
        )
        if shares:
            out['Shares'] = float(shares)

        sector = None
        try:
            info = tk.get_info() or {}
            sector = info.get('sector') or info.get('industry') or info.get('longName')
        except Exception:
            sector = None
        if sector:
            out['Sector'] = sector
    except Exception:
        pass
    return out
