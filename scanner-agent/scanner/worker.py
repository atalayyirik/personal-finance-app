import os
import pandas as pd
from .polygon_api import poly_get_agg, poly_get_profile
from .beta import compute_beta
from .indicators import compute_ytd_pct, stochrsi, ta_sma
from .yahoo_api import (
    yahoo_get_agg,
    yahoo_get_profile,
    yahoo_get_earnings_dates,
    yahoo_get_analyst_rating_label,
)
from .utils import human_money, _netlog
from .plotting import plot_ticker_stockcharts


def process_ticker(
    t: str,
    _from: str,
    _to: str,
    cfg: dict,
    include_earnings: bool,
    include_analyst: bool,
    accepted_dir: str,
    rejected_dir: str,
    make_charts: bool,
    skip_if_empty: bool,
    write_all: bool,
):
    """
    Bir tickeri işler, filtreleri uygular ve CSV satırını döndürür.
    - passes == True ise her zaman row döner.
    - write_all == True ise passes olmasa da row döner.
    - plotting: write_all True ise HERKES için plot; değilse sadece passes True olanlara plot.
    - fail varsa grafiğe kırmızı 'FAIL: <reason>' watermark basılır.
    """
    try:
        options_cfg = cfg.get("options", {}) or {}
        data_provider = os.getenv("SCANNER_DATA_PROVIDER") or options_cfg.get("data_provider") or "polygon"
        data_provider = str(data_provider).lower()
        polygon_key = os.getenv("POLYGON_API_KEY")
        polygon_available = bool(polygon_key)

        try:
            if data_provider == "yahoo":
                df = yahoo_get_agg(t, _from, _to)
                if df.empty and polygon_available:
                    df = poly_get_agg(t, _from, _to, "day")
            else:
                df = poly_get_agg(t, _from, _to, "day")
        except Exception as exc:
            _netlog(f"[worker warn] data fetch failed for {t}: {exc}")
            df = pd.DataFrame()

        if df.empty:
            if skip_if_empty:
                return None
            return None

        last_close = float(df["Close"].iloc[-1])

        vol_cfg = cfg.get("volume", {}) or {}
        win = int(vol_cfg.get("avg_window_days", 20))
        avg_volN = df["Volume"].rolling(win, min_periods=1).mean()
        avg_dollar_volN = (df["Close"] * df["Volume"]).rolling(win, min_periods=1).mean()
        last_avg_vol = float(avg_volN.iloc[-1])
        last_avg_dollar = float(avg_dollar_volN.iloc[-1])

        ytd = compute_ytd_pct(df)
        beta = compute_beta(t, cfg, data_provider)
        if data_provider == "yahoo":
            prof = yahoo_get_profile(t)
            if (not prof or all(v is None for v in prof.values())) and polygon_available:
                prof = poly_get_profile(t)
        else:
            prof = poly_get_profile(t)

        earn = {"RecentEarnings": None, "UpcomingEarnings": None}
        if include_earnings:
            earn = yahoo_get_earnings_dates(t)

        analyst = ""
        if include_analyst:
            analyst = yahoo_get_analyst_rating_label(t)

        mc = prof.get("MarketCap")
        if not mc and prof.get("Shares"):
            try:
                mc = float(prof["Shares"]) * last_close
            except Exception:
                mc = None
        mc_fmt = human_money(mc) if mc else ""

        uni = cfg.get("universe", {}) or {}
        vol = cfg.get("volume", {}) or {}
        fun = cfg.get("fundamentals", {}) or {}
        mom = cfg.get("momentum", {}) or {}
        trn = cfg.get("trend", {}) or {}

        fail_reasons = []

        pass_universe = (last_close >= float(uni.get("min_price", -float("inf"))) and
                         last_close <= float(uni.get("max_price", float("inf"))))
        if not pass_universe:
            fail_reasons.append("Universe")

        pass_volume = (
            last_avg_vol >= float(vol.get("min_avg_volume", 0)) and
            last_avg_dollar >= float(vol.get("min_avg_dollar_vol", 0))
        )
        if not pass_volume:
            fail_reasons.append("Volume")

        mc_min = float(fun.get("market_cap_min", 0))
        mc_max = float(fun.get("market_cap_max", float("inf")))
        pass_mc = (mc is not None) and (mc_min <= mc <= mc_max)
        if not pass_mc:
            fail_reasons.append("MarketCap")

        beta_min = float(fun.get("beta_min_5y", -float("inf")))
        pass_beta = (beta is not None) and (beta >= beta_min)
        if not pass_beta:
            fail_reasons.append("Beta")

        ytd_min = float(fun.get("ytd_min_pct", -float("inf")))
        ytd_max = float(fun.get("ytd_max_pct", float("inf")))
        require_ytd = bool(fun.get("require_ytd", True))
        if ytd is None:
            pass_ytd = (not require_ytd)
        else:
            pass_ytd = (ytd_min <= ytd <= ytd_max)
        if not pass_ytd:
            fail_reasons.append("YTD")

        allowed = set([str(a).strip() for a in fun.get("analyst_ratings_allow", [])])
        require_rating = bool(fun.get("require_analyst_rating", False))
        if allowed:
            if analyst == "" and require_rating:
                pass_rating = False
            elif analyst == "" and not require_rating:
                pass_rating = True
            else:
                pass_rating = (analyst in allowed)
        else:
            pass_rating = True
        if not pass_rating:
            fail_reasons.append("Analyst")

        pass_stoch = True
        if bool(mom.get("enable_stochrsi", False)):
            rsi, k_line, d_line = stochrsi(
                df["Close"],
                rsi_len=int(mom.get("stochrsi_len", mom.get("rsi_len", 14))),
                k=int(mom.get("stochrsi_k", 3)),
                d=int(mom.get("stochrsi_d", 3)),
            )
            last_stoch = float(k_line.iloc[-1])
            stoch_max = float(mom.get("stochrsi_max", 0.5))
            pass_stoch = (last_stoch < stoch_max)
            if not pass_stoch:
                fail_reasons.append("StochRSI")

        pass_ma_cross = True
        if bool(trn.get("enable_ma_cross_filter", False)):
            ma_mid_n = int(trn.get("ma_mid", 50))
            ma_slow_n = int(trn.get("ma_slow", 200))
            ma50 = ta_sma(df["Close"], ma_mid_n)
            ma200 = ta_sma(df["Close"], ma_slow_n)

            if len(ma50) >= 2 and len(ma200) >= 2:
                last50, last200 = float(ma50.iloc[-1]), float(ma200.iloc[-1])

                cond_now_above = (last50 >= last200)

                lookahead = int(trn.get("ma_cross_lookahead_days", 20))
                max_gap_pct = float(trn.get("ma_cross_max_gap_pct", 3.0))

                gap = max(0.0, last200 - last50)

                def slope(series):
                    if len(series) >= 6:
                        return (float(series.iloc[-1]) - float(series.iloc[-6])) / 5.0
                    return float(series.iloc[-1]) - float(series.iloc[-2])

                d50 = slope(ma50)
                d200 = slope(ma200)
                rel_slope = d50 - d200

                will_cross_soon = False
                if (last50 < last200) and (rel_slope > 0):
                    est_days = gap / rel_slope if rel_slope > 1e-9 else float("inf")
                    gap_pct = (gap / last200 * 100.0) if last200 > 0 else 100.0
                    if est_days <= lookahead and gap_pct <= max_gap_pct:
                        will_cross_soon = True

                pass_ma_cross = (cond_now_above or will_cross_soon)
            else:
                pass_ma_cross = False

            if not pass_ma_cross:
                fail_reasons.append("MA50x200")

        passes = (len(fail_reasons) == 0)
        fail_text = "" if passes else ",".join(fail_reasons)

        last = df.iloc[-1]
        row = {
            "Ticker": t,
            "Date": pd.to_datetime(last["Date"]).date(),
            "Close": round(float(last["Close"]), 2),
            "ChangePct": round(float(last["ChangePct"]), 2),
            "Market Cap": mc_fmt,
            "YTDpct": round(ytd, 2) if ytd is not None else "",
            "Beta": round(beta, 2) if beta is not None else "",
            "AnalystRating": analyst,
            "RecentEarnings": earn.get("RecentEarnings"),
            "UpcomingEarnings": earn.get("UpcomingEarnings"),
            "Sector": prof.get("Sector"),
            "FailReason": fail_text,
        }

        should_plot = (write_all or (make_charts and passes))
        if should_plot:
            try:
                out_dir = accepted_dir if passes else rejected_dir
                plot_ticker_stockcharts(df.copy(), cfg, out_dir, fail_reason=(fail_text or None))
            except Exception as e:
                _netlog(f"[plot warn] {t}: {e}")

        if passes or write_all:
            return row
        return None

    except Exception as e:
        _netlog(f"[worker warn] {t}: {e}")
        return None
