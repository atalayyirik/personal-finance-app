import os, pandas as pd
from .net import http_get
from .utils import _netlog

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")

def _poly_get(url, params=None):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not found. Put it in .env like: POLYGON_API_KEY=xxxxx")
        raise SystemExit(1)
    headers = {"Authorization": f"Bearer {POLYGON_API_KEY}"}
    r = http_get(url, headers=headers, params=params or {})
    return {} if r is None else r.json()

def poly_get_agg(ticker: str, _from: str, _to: str, timespan="day"):
    url = f"https://api.polygon.io/v2/aggs/ticker/{ticker}/range/1/{timespan}/{_from}/{_to}"
    js = _poly_get(url, params={"adjusted": "true"})
    if not js or js.get("resultsCount", 0) == 0:
        return pd.DataFrame()
    rows = js["results"]
    df = pd.DataFrame(rows)
    df["Date"]   = pd.to_datetime(df["t"], unit="ms", utc=True).dt.tz_convert(None)
    df["Open"]   = df["o"]; df["High"] = df["h"]; df["Low"] = df["l"]; df["Close"] = df["c"]; df["Volume"] = df["v"]
    df["Ticker"] = ticker
    df["ChangePct"] = df["Close"].pct_change() * 100
    return df[["Date","Ticker","Open","High","Low","Close","Volume","ChangePct"]]

def poly_get_profile(ticker: str):
    out = {"MarketCap": None, "Sector": None, "Shares": None}
    try:
        url = f"https://api.polygon.io/v3/reference/tickers/{ticker}"
        js = _poly_get(url)
        res = js.get("results", {}) if js else {}
        out["MarketCap"] = res.get("market_cap")
        out["Sector"] = res.get("sic_description") or res.get("description")
        out["Shares"] = (
            res.get("share_class_shares_outstanding")
            or res.get("weighted_shares_outstanding")
            or res.get("shares_outstanding")
        )
    except Exception:
        pass
    return out
