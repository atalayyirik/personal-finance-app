# GUI backend kapalı ve thread-safe
import os
os.environ["MPLBACKEND"] = "Agg"

import matplotlib as mpl
mpl.use("Agg")

from threading import Lock
PLOT_LOCK = Lock()

import numpy as np
import mplfinance as mpf
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
from matplotlib.lines import Line2D
import traceback
from datetime import datetime

from .utils import ensure_dir, _netlog
from .indicators import ta_sma, stochrsi

def _fmt_millions(x, pos):
    if x >= 1_000_000: return f"{x/1_000_000:.0f}M"
    if x >= 1_000:     return f"{x/1_000:.0f}K"
    return f"{x:.0f}"

def _log_plot_error(chart_dir: str, ticker: str, err: Exception):
    """Her durumda bir log dosyasına yaz (quiet olsa bile)."""
    try:
        ensure_dir(chart_dir)
        log_path = os.path.join(chart_dir, "plot_errors.log")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().isoformat(timespec='seconds')}] {ticker}: {repr(err)}\n")
            f.write(traceback.format_exc() + "\n")
    except Exception:
        pass

def plot_ticker_stockcharts(df, cfg, out_dir: str, fail_reason: str = None):
    """
    fail_reason verilirse grafiğin sağ-alt köşesine kırmızı 'FAIL: reason' filigranı basar.
    """
    ensure_dir(out_dir)

    # çok az bar varsa mpf bazen sıkıntı çıkarabiliyor
    if len(df) < 10:
        return  # sessiz atla

    with PLOT_LOCK:
        tkr = str(df["Ticker"].iloc[-1])
        try:
            # ---- güvenli config okuma ----
            trn = (cfg.get("trend") or {}) if isinstance(cfg, dict) else {}
            mom = (cfg.get("momentum") or {}) if isinstance(cfg, dict) else {}

            ma_mid  = int(trn.get("ma_mid", 50))
            ma_slow = int(trn.get("ma_slow", 200))

            # rsi_len -> stochrsi_len geriye dönük uyum
            rsi_len = int(mom.get("rsi_len", mom.get("stochrsi_len", 14)))
            st_k    = int(mom.get("stochrsi_k", mom.get("k", 3)))
            st_d    = int(mom.get("stochrsi_d", mom.get("d", 3)))

            ma50  = ta_sma(df["Close"], ma_mid)
            ma200 = ta_sma(df["Close"], ma_slow)
            _rsi, k_line, d_line = stochrsi(df["Close"], rsi_len=rsi_len, k=st_k, d=st_d)

            base = df.set_index("Date")[["Open","High","Low","Close","Volume"]]
            opts = (cfg.get("options") or {}) if isinstance(cfg, dict) else {}
            style_cfg = opts.get("style") or {}
            base_style = "classic"
            if isinstance(style_cfg, dict) and style_cfg.get("base_mpf_style"):
                base_style = style_cfg["base_mpf_style"]

            mc = mpf.make_marketcolors(
                up="g", down="r", edge="inherit", wick="inherit", volume="inherit"
            )

            style_kwargs = {"marketcolors": mc, "gridstyle": ":", "y_on_right": True}
            if isinstance(style_cfg, dict):
                style_kwargs.update({k: v for k, v in style_cfg.items() if k != "base_mpf_style"})

            style = mpf.make_mpf_style(
                base_mpf_style=base_style,
                **style_kwargs,
            )
            aps = [
                mpf.make_addplot(ma50.values,  panel=0, color="#1f77b4", width=1.2),
                mpf.make_addplot(ma200.values, panel=0, color="#d62728", width=1.2),
                mpf.make_addplot(k_line.values,  panel=2, color="#1f77b4", width=1.0),
                mpf.make_addplot(d_line.values,  panel=2, color="#7f7f7f", width=1.0),
            ]

            fig, axes = mpf.plot(
                base,
                type="candle",
                addplot=aps,
                volume=True,
                panel_ratios=(6, 2, 2),
                figratio=(16, 9),
                figscale=1.05,
                style=style,
                tight_layout=True,
                returnfig=True,
                show_nontrading=False,
            )

            target_face = opts.get("facecolor")
            if target_face:
                try:
                    fig.set_facecolor(target_face)
                    for ax in fig.axes:
                        ax.set_facecolor(target_face)
                except Exception:
                    pass

            # ---- axes eşlemesi (sürüm bağımsız) ----
            if isinstance(axes, (list, tuple)):
                axes_list = list(axes)
            else:
                try:
                    axes_list = list(axes)
                except Exception:
                    axes_list = [axes]

            if len(axes_list) >= 3:
                ax_price = axes_list[0]
                ax_stoch = axes_list[-1]
                if len(axes_list) == 3:
                    ax_vol = axes_list[1]
                elif len(axes_list) >= 5:
                    ax_vol = axes_list[2]
                else:
                    ax_vol = None
            else:
                ax_price = axes_list[0]
                ax_vol = None
                ax_stoch = None

            # legend
            handles = [
                Line2D([0],[0], color="#1f77b4", lw=2, label=f"MA({ma_mid})"),
                Line2D([0],[0], color="#d62728", lw=2, label=f"MA({ma_slow})"),
            ]
            ax_price.legend(handles=handles, loc="upper left", frameon=False)

            # StochRSI yardımcı çizimler
            if ax_stoch is not None:
                k_vals = np.asarray(k_line)
                x_idx = np.arange(len(k_vals))
                ax_stoch.axhline(0.2, linestyle="--", linewidth=1, color="#ccc")
                ax_stoch.axhline(0.8, linestyle="--", linewidth=1, color="#ccc")
                ax_stoch.fill_between(x_idx, 0.8, k_vals, where=(k_vals >= 0.8), color="green", alpha=0.18)
                ax_stoch.fill_between(x_idx, 0.0, k_vals, where=(k_vals <= 0.2), color="green", alpha=0.18)
                ax_stoch.set_ylim(-0.05, 1.05)
                ax_stoch.set_ylabel("StochRSI")

            # Volume biçimlendirme
            if ax_vol is not None:
                ax_vol.yaxis.set_major_formatter(FuncFormatter(_fmt_millions))
                for p in ax_vol.patches:
                    try:
                        p.set_alpha(0.35)
                    except Exception:
                        pass

            # Başlık
            fig.suptitle(f"{tkr}", fontsize=11, y=0.98)

            # === FAIL watermark (sadece fail_reason varsa) ===
            if fail_reason:
                fig.text(
                    0.985, 0.015, f"FAIL: {fail_reason}",
                    fontsize=10, color="red", ha="right", va="bottom",
                    alpha=0.9, fontweight="bold",
                    bbox=dict(facecolor="white", alpha=0.6, edgecolor="none", pad=2.5),
                )

            outp = os.path.join(out_dir, f"{tkr}.png")
            fig.savefig(outp, dpi=140, bbox_inches="tight")
            plt.close(fig)

        except Exception as e:
            _log_plot_error(out_dir, tkr, e)
            _netlog(f"[plot warn] {tkr}: {e}")
            try:
                plt.close('all')
            except Exception:
                pass
