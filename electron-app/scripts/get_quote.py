#!/usr/bin/env python3

"""Fetch latest quote data for a ticker symbol via Yahoo Finance or Polygon."""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


YAHOO_CHART_URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1m"
)

POLYGON_AGG_PATH = "/v2/aggs/ticker/{symbol}/range/1/minute/{start}/{end}"
POLYGON_PREV_PATH = "/v2/aggs/ticker/{symbol}/prev"

DEFAULT_PROVIDER = "polygon"
PROVIDERS = {"polygon", "yahoo"}


def _iso_from_epoch(epoch: float | None) -> str | None:
    if epoch is None:
        return None
    try:
        dt = _dt.datetime.fromtimestamp(float(epoch), tz=_dt.timezone.utc)
    except Exception:
        return None
    return dt.isoformat()

def _load_json(url: str, headers: dict[str, str] | None = None) -> dict:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=8) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def fetch_quote_yahoo(symbol: str) -> dict:
    encoded = urllib.parse.quote(symbol)
    url = YAHOO_CHART_URL.format(symbol=encoded)
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
    }
    data = _load_json(url, headers=headers)
    chart = data.get("chart", {})
    error = chart.get("error")
    if error:
        raise ValueError(error.get("description") or "Servis hatası")

    results = chart.get("result") or []
    if not results:
        raise ValueError("Sonuç bulunamadı")

    meta = results[0].get("meta") or {}

    price = meta.get("regularMarketPrice")
    prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")
    currency = meta.get("currency") or "USD"
    symbol_resolved = meta.get("symbol", symbol)
    market_time = meta.get("regularMarketTime")

    change = None
    change_pct = None
    if price is not None and prev_close is not None:
        change = price - prev_close
        if prev_close not in (0, 0.0):
            change_pct = (change / prev_close) * 100

    return {
        "symbol": symbol_resolved,
        "price": price,
        "currency": currency,
        "source": "Yahoo Finance",
        "change": change,
        "change_percent": change_pct,
        "prev_close": prev_close,
        "as_of": _iso_from_epoch(market_time),
        "fetched_at": _dt.datetime.now(tz=_dt.timezone.utc).isoformat(),
    }


def _polygon_call(path: str, *, api_key: str, params: dict[str, str] | None = None) -> dict:
    params = {k: v for k, v in (params or {}).items() if v is not None}
    params["apiKey"] = api_key
    query = urllib.parse.urlencode(params)
    url = f"https://api.polygon.io{path}?{query}"
    data = _load_json(url)
    status = (data.get("status") or "").lower()
    if status not in {"ok", "success", ""} and data.get("error"):
        raise ValueError(str(data.get("error")))
    return data


def fetch_quote_polygon(symbol: str, *, api_key: str | None = None) -> dict:
    api_key = api_key or os.getenv("POLYGON_API_KEY") or os.getenv("POLYGON_KEY")
    if not api_key:
        raise ValueError("Polygon API anahtarı bulunamadı")

    encoded = urllib.parse.quote(symbol)
    now = _dt.datetime.now(tz=_dt.timezone.utc)
    start = (now - _dt.timedelta(days=3)).strftime("%Y-%m-%d")
    end = now.strftime("%Y-%m-%d")

    agg_path = POLYGON_AGG_PATH.format(symbol=encoded, start=start, end=end)
    agg_data = _polygon_call(
        agg_path,
        api_key=api_key,
        params={
            "adjusted": "true",
            "sort": "desc",
            "limit": "120",
        },
    )

    results = agg_data.get("results") or []
    latest = next((row for row in results if row.get("c") is not None), None)
    if not latest:
        raise ValueError("Sonuç bulunamadı")

    price = latest.get("c")
    timestamp_ns = latest.get("t")

    prev_data = _polygon_call(
        POLYGON_PREV_PATH.format(symbol=encoded),
        api_key=api_key,
        params={"adjusted": "true"},
    )
    prev_results = prev_data.get("results") or []
    prev_close = prev_results[0].get("c") if prev_results else None

    change = None
    change_pct = None
    if price is not None and prev_close is not None:
        change = price - prev_close
        if prev_close not in (0, 0.0):
            change_pct = (change / prev_close) * 100

    return {
        "symbol": (agg_data.get("ticker") or symbol).upper(),
        "price": price,
        "currency": "USD",
        "source": "Polygon.io",
        "change": change,
        "change_percent": change_pct,
        "prev_close": prev_close,
        "as_of": _iso_from_epoch_ns(timestamp_ns),
        "fetched_at": now.isoformat(),
    }


def _iso_from_epoch_ns(epoch_ns: float | None) -> str | None:
    if epoch_ns is None:
        return None
    try:
        epoch_ns = float(epoch_ns)
    except Exception:
        return None

    if epoch_ns > 1e15:  # nanoseconds
        seconds = epoch_ns / 1_000_000_000
    elif epoch_ns > 1e12:  # milliseconds
        seconds = epoch_ns / 1_000
    else:
        seconds = epoch_ns

    try:
        dt = _dt.datetime.fromtimestamp(seconds, tz=_dt.timezone.utc)
    except Exception:
        return None
    return dt.isoformat()


def fetch_quote(symbol: str, *, provider: str = DEFAULT_PROVIDER, api_key: str | None = None) -> dict:
    provider_normalized = (provider or DEFAULT_PROVIDER).lower()
    if provider_normalized not in PROVIDERS:
        raise ValueError(f"Desteklenmeyen sağlayıcı: {provider}")

    if provider_normalized == "yahoo":
        return fetch_quote_yahoo(symbol)
    return fetch_quote_polygon(symbol, api_key=api_key)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Get latest quote for a ticker")
    parser.add_argument("symbol", help="Ticker sembolü")
    parser.add_argument(
        "--provider",
        choices=sorted(PROVIDERS),
        default=os.getenv("QUOTE_PROVIDER", DEFAULT_PROVIDER),
        help="Kullanılacak veri sağlayıcısı",
    )
    parser.add_argument(
        "--api-key",
        dest="api_key",
        default=None,
        help="Polygon API anahtarı (opsiyonel, ortam değişkeninden de alınır)",
    )
    return parser.parse_args(argv[1:])


def main(argv: list[str]) -> int:
    try:
        args = _parse_args(argv)
    except SystemExit:
        # argparse already printed error/help
        return 1

    symbol = args.symbol.strip().upper()
    if not symbol:
        print(json.dumps({"error": "Ticker gerekli"}))
        return 1

    try:
        quote = fetch_quote(symbol, provider=args.provider, api_key=args.api_key)
    except urllib.error.HTTPError as exc:
        message = f"HTTP hata {exc.code}"
        print(json.dumps({"error": message}))
        return 1
    except urllib.error.URLError as exc:
        message = getattr(exc, "reason", exc)
        print(json.dumps({"error": str(message)}))
        return 1
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        return 1
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"Beklenmeyen hata: {exc}"}))
        return 1

    print(json.dumps(quote))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
