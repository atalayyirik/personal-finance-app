import os
import argparse, csv
import pandas as pd
from concurrent.futures import ThreadPoolExecutor

try:
    from rich.progress import (
        Progress,
        SpinnerColumn,
        BarColumn,
        TextColumn,
        TimeElapsedColumn,
        TimeRemainingColumn,
    )

    def make_progress():
        return Progress(
            SpinnerColumn(),
            TextColumn("[bold blue]Fetching & Filtering[/bold blue]"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TextColumn("• {task.completed}/{task.total}"),
            TimeElapsedColumn(),
            TextColumn("• ETA:"),
            TimeRemainingColumn(),
            transient=False,
        )

except ImportError:  # pragma: no cover - fallback for minimal envs

    class _NullProgress:
        def __init__(self):
            self._tasks = {}
            self._seq = 0

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):  # noqa: D401 - match context protocol
            return False

        def add_task(self, *_args, total=0, **_kwargs):
            task_id = self._seq
            self._seq += 1
            self._tasks[task_id] = {"completed": 0, "total": total}
            return task_id

        def advance(self, task_id, advance=1):
            task = self._tasks.get(task_id)
            if not task:
                return
            task["completed"] += advance

    def make_progress():
        print("rich modülü bulunamadı; basit ilerleme modu kullanılıyor.", flush=True)
        return _NullProgress()

from .config import load_cfg
from .tickers import load_tickers
from .utils import ensure_dir, set_quiet, _netlog
from .net import set_http
from .worker import process_ticker

def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--max", type=int, default=None, help="İşlenecek maksimum ticker sayısı (default: tüm liste)")
    parser.add_argument("--lookback", type=int, default=270)
    parser.add_argument("--from", dest="date_from", type=str, default=None)
    parser.add_argument("--to",   dest="date_to",   type=str, default=None)
    parser.add_argument("--quiet", action="store_true", help="Non-critical network uyarılarını sustur")
    parser.add_argument("--http-timeout", type=float, default=8.0, help="HTTP timeout (s)")
    parser.add_argument("--max-retries", type=int, default=2, help="HTTP retry sayısı")
    parser.add_argument("--workers", type=int, default=16, help="Paralel iş parçacığı sayısı")

    # output kontrolü
    parser.add_argument("--out-dir", type=str, default="results", help="Çıktıların kök klasörü (default: results)")
    parser.add_argument("--no-charts", action="store_true", help="Grafik üretimini kapat")
    parser.add_argument("--keep-delisted", action="store_true", help="Polygon boşsa yine de devam et (yavaş)")

    # veri sağlayıcı opsiyonları
    parser.add_argument("--no-earnings", action="store_true", help="Earnings çekmeyi kapat (Yahoo)")
    parser.add_argument("--no-analyst", action="store_true", help="Analyst rating çekmeyi kapat (Yahoo)")

    # CSV & plotting davranışı
    # --write-all kaldırıldı; tüm komutlar artık "write-all" davranışında çalışır.

    args = parser.parse_args()

    # global io/net flags
    set_http(args.http_timeout, args.max_retries)
    set_quiet(args.quiet)

    cfg = load_cfg()
    opts = cfg.get("options", {}) or {}
    if bool(opts.get("quiet_warnings", False)) or args.quiet:
        set_quiet(True)

    include_earnings = (not args.no_earnings) and bool(opts.get("include_earnings", True))
    include_analyst  = (not args.no_analyst) and (str(opts.get("analyst_ratings_provider", "yahoo")).lower() == "yahoo")

    # DEFAULT: tüm ticker'lar; --max verilirse ilk N
    tickers = load_tickers(max_n=args.max)

    # tarih aralığı (fiyat çekimi için)
    if args.date_from and args.date_to:
        _from, _to = args.date_from, args.date_to
    else:
        end = pd.Timestamp.today().normalize()
        start = end - pd.Timedelta(days=int(args.lookback))
        _from, _to = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

    # === OUTPUT LAYOUT ===
    ts = pd.Timestamp.now().strftime("%Y%m%d_%H%M")
    run_dir = os.path.join(args.out_dir, f"run_{ts}")
    accepted_dir = os.path.join(run_dir, "accepted")
    rejected_dir = os.path.join(run_dir, "rejected")
    out_csv = os.path.join(run_dir, "scan.csv")
    ensure_dir(accepted_dir)
    ensure_dir(rejected_dir)

    print(f"Toplam {len(tickers)} sembol için veri çekiliyor...")

    columns = [
        "Ticker","Date","Close","ChangePct",
        "Market Cap","YTDpct","Beta","AnalystRating",
        "RecentEarnings","UpcomingEarnings","Sector",
        "FailReason"   # elendiyse sebep(ler)
    ]

    total = len(tickers)
    # Tüm komutlar write-all gibi çalışsın
    write_all = True
    # write-all iken grafikler her zaman üretilir; --no-charts bunu override edilemezdi
    make_charts = (not args.no_charts) or write_all
    skip_if_empty = not args.keep_delisted

    with make_progress() as progress, open(out_csv, "w", newline="") as f:

        writer = csv.DictWriter(f, fieldnames=columns); writer.writeheader()
        task = progress.add_task("run", total=total)

        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=int(args.workers)) as ex:
            futures = [ex.submit(
                process_ticker, t, _from, _to, cfg,
                include_earnings, include_analyst,
                accepted_dir, rejected_dir, make_charts, skip_if_empty,
                write_all
            ) for t in tickers]

            processed = 0
            skipped = 0
            skipped_tickers = []
            try:
                print(f"[0/{total}] Scan started", flush=True)
            except Exception:
                pass
            for ticker, fut in zip(tickers, futures):
                row = None
                try:
                    row = fut.result()
                except Exception as e:
                    _netlog(f"[cli warn] worker error: {e}")
                    row = None
                if row is not None:
                    writer.writerow(row)
                else:
                    skipped += 1
                    if len(skipped_tickers) < 10:
                        skipped_tickers.append(ticker)
                processed += 1
                try:
                    status = "OK" if row is not None else "FAIL"
                    print(f"[{processed}/{total}] {ticker} {status}", flush=True)
                except Exception:
                    pass
                progress.advance(task)

    print(f"\nSaved CSV -> {out_csv}")
    if make_charts:
        print(f"Accepted   -> {accepted_dir}")
        print(f"Rejected   -> {rejected_dir}")
    if skipped:
        note = ", ".join(skipped_tickers)
        if skipped > len(skipped_tickers):
            note += ", ..."
        print(f"Skipped {skipped} ticker (no data / processing error): {note}")
