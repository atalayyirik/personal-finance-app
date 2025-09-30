#!/usr/bin/env python3

"""Generate portfolio chart image using existing scanner plotting helpers."""

from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCANNER_DIR = ROOT / "scanner-agent"

if str(SCANNER_DIR) not in sys.path:
    sys.path.insert(0, str(SCANNER_DIR))

REQUIRED_PACKAGES = (
    ("pandas", "pandas"),
    ("numpy", "numpy"),
    ("mplfinance", "mplfinance"),
    ("yfinance", "yfinance"),
    ("dotenv", "python-dotenv"),
)


def ensure_dependencies():
    missing = []
    import importlib
    import site
    import sys as _sys

    try:
        user_site = site.getusersitepackages()
        paths = [user_site] if isinstance(user_site, str) else list(user_site)
        for entry in paths:
            if entry and entry not in _sys.path:
                _sys.path.append(entry)
    except Exception:
        pass
    for module_name, package_name in REQUIRED_PACKAGES:
        try:
            importlib.import_module(module_name)
        except ModuleNotFoundError:
            missing.append((module_name, package_name))

    if not missing:
        return

    import subprocess

    pip_args = [
        _sys.executable,
        "-m",
        "pip",
        "install",
        "--user",
        "--break-system-packages",
    ]

    for _, package_name in missing:
        pip_args.append(package_name)

    try:
        subprocess.check_call(pip_args)
    except Exception as exc:  # noqa: BLE001
        missing_pkgs = [pkg for _, pkg in missing]
        raise RuntimeError(f"Bağımlılıklar yüklenemedi: {missing_pkgs} · {exc}") from exc

    # verify installation succeeded
    user_site = site.getusersitepackages()
    paths = [user_site] if isinstance(user_site, str) else list(user_site)
    for path_entry in paths:
        if path_entry and path_entry not in _sys.path:
            _sys.path.append(path_entry)

    for module_name, _ in missing:
        importlib.import_module(module_name)


ensure_dependencies()

import pandas as pd  # noqa: E402
import yfinance as yf  # noqa: E402
from scanner.plotting import plot_ticker_stockcharts  # type: ignore  # noqa: E402


def load_price_history(symbol: str) -> pd.DataFrame:
    df = yf.download(symbol, period="6mo", interval="1d", auto_adjust=False, progress=False)
    if df is None or df.empty:
        raise ValueError("Yeterli fiyat verisi alınamadı")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [col[0] if isinstance(col, tuple) and col else col for col in df.columns]
    df = df.reset_index()
    if "Date" in df.columns:
        df["Date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None)
    df["Ticker"] = symbol
    expected_cols = {"Open", "High", "Low", "Close", "Volume"}
    if not expected_cols.issubset(set(df.columns)):
        raise ValueError("Eksik sütunlar: {}".format(expected_cols - set(df.columns)))
    return df


def build_chart(symbol: str) -> dict:
    df = load_price_history(symbol)
    tmp_dir = Path(tempfile.mkdtemp(prefix="chart_"))
    try:
        dark_cfg = {
            "options": {
                "style": {
                    "base_mpf_style": "nightclouds",
                },
                "facecolor": "#0f172a",
                "edgecolor": "#0f172a",
            }
        }

        plot_ticker_stockcharts(df, dark_cfg, str(tmp_dir))
        file_path = tmp_dir / f"{symbol}.png"
        if not file_path.exists():
            raise RuntimeError("Grafik dosyası oluşturulamadı")
        data = file_path.read_bytes()
        image64 = base64.b64encode(data).decode("ascii")
        return {
            "symbol": symbol,
            "image": f"data:image/png;base64,{image64}",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        try:
            for item in tmp_dir.glob('*'):
                item.unlink(missing_ok=True)
            tmp_dir.rmdir()
        except Exception:
            pass


def main(argv: list[str]) -> int:
    if len(argv) < 2 or not argv[1].strip():
        print(json.dumps({"error": "Ticker gerekli"}))
        return 1

    symbol = argv[1].strip().upper()
    try:
        result = build_chart(symbol)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
