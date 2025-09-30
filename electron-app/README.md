# Stock Agents Electron UI

This desktop UI wraps the Python tooling that lives in the repository and makes each workflow accessible through Electron.

## Prerequisites

- Node.js 18 or newer
- A reachable Python 3 interpreter on your PATH (`python3` is used by default)
- Python dependencies for the scripts (`pip install -r requirements.txt`)

## Setup

```bash
cd electron-app
npm install
```

## Run

```bash
npm run start
```

The window includes two tabs:

- **Position Calculator** allows you to type a ticker, fetch its live price (via the **Test** button or automatically on *Hesapla*) and shows the 5R ladder in the UI without falling back to terminal output.
- **Market Scanner** lets you tune every value from `filters.yaml`, shows a live progress bar, and streams scanner output while results land under `scanner-agent/results` (Polygon.io verileri kullanılır).

Every launch appears as a run card that displays the exact command and a live log feed. Use the stop button to terminate looping processes such as the hourly monitor.

## Notes

- The UI only orchestrates the existing scripts; it does not modify their behaviour or outputs.
- `python3` is used automatically; ensure it resolves to the interpreter where dependencies are installed.
- Scanner runs still create CSVs and charts in the filesystem just like the CLI version.
- Scanner tab writes a temporary filters file per run before launching the CLI.
- Live prices in the calculator are fetched through `amount_calculator/get_quote.py` (yfinance), so network access is required for that tab.
