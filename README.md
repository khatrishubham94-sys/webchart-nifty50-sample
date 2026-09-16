# WebChart

A TradingView-style charting app: FastAPI backend + React/Vite frontend, with a
custom zigzag indicator, RS/DMA-WMA indicators, watchlists, alerts, and a
trade-marker panel.

This is a sample build: **Nifty50 stocks only, last 1 year of 1-minute data**
(plus full daily history for those 50 symbols), so the repo stays small enough
to share over git. Daily/weekly/monthly candles, intraday (any minute
interval, resampled from the 1-min base), indicators, watchlists and alerts
all work out of the box on this sample data.

## Requirements

- Python 3.11+ with `pip install -r scripts/pipeline/system/webchart/backend/requirements.txt`
- Node.js 18+ (for the frontend dev server)

## Run it

**Windows, one-click:**

```
scripts/pipeline/system/webchart/launch_webchart.ps1
```

Starts the backend on port 8512 and the frontend dev server on port 5173, then
opens the chart in your browser. Run `npm install` once yourself inside
`scripts/pipeline/system/webchart/frontend` before the first launch, and make
sure backend deps are installed (see below).

**Manual (any OS):**

```bash
# terminal 1
pip install -r scripts/pipeline/system/webchart/backend/requirements.txt
python -m uvicorn scripts.pipeline.system.webchart.backend.main:app --port 8512

# terminal 2
cd scripts/pipeline/system/webchart/frontend
npm install
npm run dev
```

Then open http://localhost:5173.

## What's not in this sample

A few endpoints degrade gracefully to "no data" rather than erroring, since
their source files aren't included:

- **Momentum screener** (`/api/screener/momentum`) — depends on Streamlit/Plotly
  and a separate stock-master file from the full workspace, left out entirely.
- **Corporate-action checklists, backtest trade markers, portfolio trade
  markers, options chains** — all read from files (`Review/*.csv`,
  `Backtest/experiments/*/trades.csv`, `Portfolio/inputs/portfolio_transactions.csv`,
  `Database/fno_by_symbol/*.parquet`) that don't exist in this sample. The
  panels just show empty rather than crashing.

## Data layout

```
Database/master/master.parquet          daily OHLCV, Nifty50, full history
Database/upstox_1min/NSE/<SYMBOL>.parquet   1-min bars, last 1 year, per Nifty50 stock
Database/upstox_1min/INDEX/NIFTY 50.parquet    1-min index bars (benchmark)
Database/upstox_1min/INDEX/NIFTY 500.parquet   1-min index bars (RS default benchmark)
config/screener_peer_mapping.csv         sector/industry for the watchlist detail panel
```

To add more symbols or a longer history, drop matching parquet files into the
same layout — the backend just reads whatever's there.
