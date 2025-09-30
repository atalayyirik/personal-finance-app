import numpy as np
import pandas as pd

def compute_ytd_pct(df: pd.DataFrame):
    if df.empty: return None
    last = df.iloc[-1]
    year_start = pd.Timestamp(year=pd.Timestamp(last["Date"]).year, month=1, day=1)
    ydf = df[df["Date"] >= year_start]
    if len(ydf) == 0: return None
    first_close = float(ydf["Close"].iloc[0])
    last_close  = float(ydf["Close"].iloc[-1])
    return (last_close / first_close - 1.0) * 100.0

def ta_sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(int(n), min_periods=1).mean()

def stochrsi(close: pd.Series, rsi_len=14, k=3, d=3):
    delta = close.diff()
    up = delta.clip(lower=0.0)
    down = (-delta).clip(lower=0.0)
    roll_up = up.ewm(alpha=1/rsi_len, adjust=False).mean()
    roll_down = down.ewm(alpha=1/rsi_len, adjust=False).mean()
    rs = roll_up / roll_down.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    rsi_min = rsi.rolling(rsi_len, min_periods=1).min()
    rsi_max = rsi.rolling(rsi_len, min_periods=1).max()
    stoch = (rsi - rsi_min) / (rsi_max - rsi_min).replace(0, np.nan)
    k_line = stoch.rolling(k, min_periods=1).mean()
    d_line = k_line.rolling(d, min_periods=1).mean()
    return rsi, k_line, d_line
