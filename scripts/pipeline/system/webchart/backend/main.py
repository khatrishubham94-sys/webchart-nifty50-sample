"""
API backing the WebChart frontend: symbol search + D/W/M candle data, sourced
from Database/master/master.parquet (full-history OHLCV, all symbols).

Run:
    uvicorn scripts.pipeline.system.webchart.backend.main:app --reload --port 8512
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

REPO_ROOT = Path(__file__).resolve().parents[5]

# NOTE (sample-share build): the full workspace also wires this endpoint to
# top_movers_screener.py for /api/screener/momentum, and to a verified zigzag
# and hand-written Pine-ported indicators (RS, DMA WMA Master, ADR/ATR) for
# /api/indicators/*. Those encode the actual trading system's rules and are
# left out of this sample entirely -- the endpoints below return 404 instead.
# Everything else (charts, MA50/MA200, alerts, CA/POI panels) degrades
# gracefully when its optional data is absent.
MASTER_PARQUET = REPO_ROOT / "Database" / "master" / "master.parquet"
PORTFOLIO_TRANSACTIONS = REPO_ROOT / "Portfolio" / "inputs" / "portfolio_transactions.csv"
CA_VERIFY_CHECKLIST = REPO_ROOT / "Review" / "ca_verify_checklist.csv"
BSE_CA_REVIEW_CHECKLIST = REPO_ROOT / "Review" / "bse_ca_review_checklist.csv"
NSE_CA_CHECKLIST_ROUND2 = REPO_ROOT / "Review" / "ca_verify_checklist_round2.csv"
CA_CHECKLISTS = {
    "nse": CA_VERIFY_CHECKLIST,
    "bse": BSE_CA_REVIEW_CHECKLIST,
    # Round 2: classify()'s sane-band-first bug hid any "mild" bonus/split
    # (event_ratio itself inside [0.75, 1.33] — Bonus 1:3, 1:4, 1:5, 1:10 etc.)
    # from the original 121-event pass. Fixed 2026-09-06 after PFC's 2023-09-21
    # Bonus 1:4 turned up still-unadjusted despite an "ADJUSTED" verdict.
    "nse2": NSE_CA_CHECKLIST_ROUND2,
}
EXPERIMENTS_DIR = REPO_ROOT / "Backtest" / "experiments"
INDEX_SCRIPTWISE_DIR = REPO_ROOT / "Database" / "index_scriptwise"
FNO_BY_SYMBOL_DIR = REPO_ROOT / "Database" / "fno_by_symbol"
BSE_SCRIPTWISE_DIR = REPO_ROOT / "Database" / "bse_scriptwise"
INTRADAY_1MIN_DIR = REPO_ROOT / "Database" / "upstox_1min" / "NSE"
INTRADAY_1MIN_INDEX_DIR = REPO_ROOT / "Database" / "upstox_1min" / "INDEX"
SCREENER_PEER_MAPPING = REPO_ROOT / "config" / "screener_peer_mapping.csv"

# Points of Interest: the one navigation contract every "jump the chart to a
# symbol+date" flow (CA review, backtest trade drill-down, research study
# results) is read through. Anything under these roots named poi_*.csv is
# auto-discovered as long as it carries the required columns (see
# _normalize_poi_df) -- CA checklists and backtest trades.csv are older
# formats mapped onto the same shape rather than renamed, everything new
# should just emit poi_*.csv directly.
POI_ROOTS = [REPO_ROOT / "Research", REPO_ROOT / "Backtest" / "experiments", REPO_ROOT / "Review"]
POI_REQUIRED_COLS = {"symbol", "date"}

app = FastAPI(title="WebChart API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def symbol_list() -> list[str]:
    df = pd.read_parquet(MASTER_PARQUET, columns=["Symbol"])
    return sorted(df["Symbol"].dropna().unique().tolist())


@lru_cache(maxsize=1)
def equity_names() -> dict[str, str]:
    df = pd.read_parquet(MASTER_PARQUET, columns=["Symbol", "Name"]).drop_duplicates("Symbol")
    return {
        row.Symbol: row.Name.title()
        for row in df.itertuples()
        if isinstance(row.Name, str) and row.Name.strip()
    }


@lru_cache(maxsize=1)
def bse_registry() -> dict[str, dict]:
    """BSE-only equities with no NSE listing (e.g. NSDL) — absent from master.parquet,
    which is built NSE-primary. Files are named by BSE scrip code, so this maps
    the ticker Symbol found inside each file back to its path."""
    registry: dict[str, dict] = {}
    if not BSE_SCRIPTWISE_DIR.exists():
        return registry
    nse_equity = set(symbol_list())
    for csv_path in BSE_SCRIPTWISE_DIR.glob("*.csv"):
        try:
            with csv_path.open("r", encoding="utf-8") as f:
                next(f)
                line = f.readline()
            if not line:
                continue
            parts = line.rstrip("\n").split(",")
            symbol, name = parts[3].strip(), parts[4].strip()
        except Exception:
            continue
        if not symbol or symbol in nse_equity or symbol in registry:
            continue
        registry[symbol] = {"path": csv_path, "name": name.title()}
    return registry


@lru_cache(maxsize=1)
def screener_details() -> dict[str, dict]:
    """Symbol -> sector/industry classification, sourced from the same peer-mapping
    file the screener/research pipeline maintains (config/screener_peer_mapping.csv) —
    not re-derived, just re-served for the watchlist details panel."""
    if not SCREENER_PEER_MAPPING.exists():
        return {}
    df = pd.read_csv(SCREENER_PEER_MAPPING)
    registry: dict[str, dict] = {}
    for row in df.itertuples():
        registry[row.Symbol] = {
            "broadSector": _safe_str(row.BroadSector),
            "sector": _safe_str(row.Sector),
            "broadIndustry": _safe_str(row.BroadIndustry),
            "industry": _safe_str(row.Industry),
            "marketCapCr": _safe_float(row.MarketCap_Cr),
        }
    return registry


@lru_cache(maxsize=1)
def index_registry() -> dict[str, dict]:
    """Maps UPPERCASE index name -> {path, exchange, category, display}."""
    registry: dict[str, dict] = {}
    if not INDEX_SCRIPTWISE_DIR.exists():
        return registry
    for exchange_dir in INDEX_SCRIPTWISE_DIR.iterdir():
        if not exchange_dir.is_dir() or exchange_dir.name not in ("NSE", "BSE"):
            continue
        for csv_path in exchange_dir.glob("**/*.csv"):
            name = csv_path.stem
            key = name.upper()
            if key not in registry:
                registry[key] = {
                    "path": csv_path,
                    "exchange": exchange_dir.name,
                    "category": csv_path.parent.name,
                    "display": name,
                }
    return registry


@app.get("/api/symbols")
def search_symbols(q: str = Query("", min_length=0), limit: int = 20) -> list[dict]:
    q_upper = q.upper()
    bse_only = bse_registry()
    equity = symbol_list() + list(bse_only.keys())
    indices = index_registry()
    names = {**equity_names(), **{s: v["name"] for s, v in bse_only.items()}}
    options = options_underlyings()

    def build(symbol: str, kind: str, name: str = "") -> dict:
        return {"symbol": symbol, "type": kind, "name": name}

    if not q:
        return [build(s, "equity", names.get(s, "")) for s in equity[:limit]]

    # also match by company name, not just ticker (e.g. "reliance industries")
    name_matches = [
        s for s, n in names.items() if q_upper in n.upper() and not s.startswith(q_upper) and q_upper not in s
    ]

    eq_starts = [s for s in equity if s.startswith(q_upper)]
    eq_contains = [s for s in equity if q_upper in s and s not in eq_starts]
    idx_starts = [v["display"] for k, v in indices.items() if k.startswith(q_upper)]
    idx_contains = [v["display"] for k, v in indices.items() if q_upper in k and v["display"] not in idx_starts]
    opt_starts = [s for s in options if s.startswith(q_upper)]
    opt_contains = [s for s in options if q_upper in s and s not in opt_starts]

    results = (
        [build(s, "index", s) for s in idx_starts]
        + [build(s, "equity", names.get(s, "")) for s in eq_starts]
        + [build(s, "options", s) for s in opt_starts]
        + [build(s, "index", s) for s in idx_contains]
        + [build(s, "equity", names.get(s, "")) for s in eq_contains]
        + [build(s, "options", s) for s in opt_contains]
        + [build(s, "equity", names.get(s, "")) for s in name_matches]
    )
    return results[:limit]


CALENDAR_TF = re.compile(r"^(\d*)([DWM])$")
CALENDAR_UNIT_ALIAS = {"D": "D", "W": "W-FRI", "M": "ME"}
INDEX_COLUMN_MAP = {
    "Index Date": "Date",
    "Open Index Value": "Open",
    "High Index Value": "High",
    "Low Index Value": "Low",
    "Closing Index Value": "Close",
    "Volume": "Volume",
}


def _parse_calendar_tf(tf: str) -> tuple[int, str]:
    """"D"/"W"/"M" or a multiple like "12D"/"3M" (TradingView's own interval-typing
    syntax: bare digits are minutes, digits + one of D/W/M are that many days/weeks/
    months) -> (multiplier, unit)."""
    m = CALENDAR_TF.match(tf.upper())
    if not m:
        raise HTTPException(400, "tf must be minutes, or <n>D/W/M (e.g. D, 12D, W, 3M)")
    return int(m.group(1)) if m.group(1) else 1, m.group(2)


def _resample_ohlcv(df: pd.DataFrame, tf: str, vol_col: str) -> pd.DataFrame:
    multiplier, unit = _parse_calendar_tf(tf)
    if multiplier <= 1 and unit == "D":
        return df
    rule = f"{multiplier}{CALENDAR_UNIT_ALIAS[unit]}"
    return df.set_index("Date").resample(rule).agg({
        "Open": "first", "High": "max", "Low": "min", "Close": "last", vol_col: "sum",
    }).dropna(subset=["Open"]).reset_index()


def _safe_float(v) -> float:
    return float(v) if pd.notna(v) else 0.0


def _safe_str(v) -> str | None:
    return str(v) if pd.notna(v) else None


def _candles_response(df: pd.DataFrame, vol_col: str, limit: int) -> list[dict]:
    df = df.tail(limit)
    return [
        {
            "time": row.Date.strftime("%Y-%m-%d"),
            # F&O no-trade rows store Open/High/Low as NaN (real trades never
            # touched them) -- render those as a flat doji at Close rather
            # than falling back to 0.0, which would draw a fake wick to zero.
            "open": _safe_float(row.Open) if pd.notna(row.Open) else _safe_float(row.Close),
            "high": _safe_float(row.High) if pd.notna(row.High) else _safe_float(row.Close),
            "low": _safe_float(row.Low) if pd.notna(row.Low) else _safe_float(row.Close),
            "close": _safe_float(row.Close),
            "volume": _safe_float(getattr(row, vol_col, 0)),
        }
        for row in df.itertuples()
    ]


def _resample_intraday(df: pd.DataFrame, minutes: int) -> pd.DataFrame:
    if minutes <= 1:
        return df
    return df.set_index("timestamp").resample(f"{minutes}min").agg({
        "open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum",
    }).dropna(subset=["open"]).reset_index()


def _intraday_candles_response(df: pd.DataFrame, limit: int) -> list[dict]:
    df = df.tail(limit)
    return [
        {
            "time": int(row.timestamp.timestamp()),
            "open": _safe_float(row.open), "high": _safe_float(row.high),
            "low": _safe_float(row.low), "close": _safe_float(row.close),
            "volume": _safe_float(row.volume),
        }
        for row in df.itertuples()
    ]


def _live_today_daily_candle(intraday_dir: Path, symbol_upper: str) -> dict | None:
    """Rolls up today's 1-min Upstox bars (updated live during market hours)
    into a single still-forming daily candle. Without this, the D/W/M views
    stay stuck on the last officially-closed day -- the master parquet only
    gets today's row once the bhavcopy is out and the daily pipeline runs
    after close, hours behind what the 1-min chart already shows live. Same
    underlying database either way, just aggregated differently."""
    path = intraday_dir / f"{symbol_upper}.parquet"
    if not path.exists():
        return None
    df = pd.read_parquet(path)
    if df.empty:
        return None
    # The 1-min store's timestamp column can be tz-aware (IST) depending on how
    # it was written; normalize to naive for the date comparison either way.
    ts = df["timestamp"]
    if ts.dt.tz is not None:
        ts = ts.dt.tz_localize(None)
    today = pd.Timestamp.now().normalize()
    today_df = df[(ts >= today).to_numpy()].sort_values("timestamp")
    if today_df.empty:
        return None
    return {
        "Date": today,
        "Open": today_df["open"].iloc[0],
        "High": today_df["high"].max(),
        "Low": today_df["low"].min(),
        "Close": today_df["close"].iloc[-1],
        "Volume": today_df["volume"].sum(),
    }


def _append_live_today(df: pd.DataFrame, intraday_dir: Path, symbol_upper: str, vol_col: str) -> pd.DataFrame:
    live = _live_today_daily_candle(intraday_dir, symbol_upper)
    if live is None:
        return df
    last_date = pd.Timestamp(df["Date"].max()).normalize() if not df.empty else None
    if last_date is not None and last_date >= live["Date"]:
        return df  # today's official EOD row already landed -- don't duplicate/shadow it
    row = {"Date": live["Date"], "Open": live["Open"], "High": live["High"],
           "Low": live["Low"], "Close": live["Close"], vol_col: live["Volume"]}
    return pd.concat([df, pd.DataFrame([row])], ignore_index=True)


def _load_daily_df(symbol_upper: str) -> pd.DataFrame | None:
    """Raw (un-resampled) daily Date/Open/High/Low/Close/Volume for a symbol,
    across the same three sources (master parquet / BSE / index) get_candles
    resolves against -- factored out so server-computed indicators (RS's
    benchmark, DMA WMA Master's broad index) can load a symbol's candles
    in-process without an HTTP round-trip, sharing one resolver instead of
    duplicating this branching."""
    if symbol_upper in symbol_list():
        df = pd.read_parquet(
            MASTER_PARQUET,
            columns=["Date", "Symbol", "Open", "High", "Low", "Close", "NSETotalTradedVolume"],
            filters=[("Symbol", "==", symbol_upper)],
        ).sort_values("Date")
        df = df.rename(columns={"NSETotalTradedVolume": "Volume"})
        return _append_live_today(df, INTRADAY_1MIN_DIR, symbol_upper, "Volume")

    bse = bse_registry().get(symbol_upper)
    if bse:
        df = pd.read_csv(bse["path"], parse_dates=["Date"]).sort_values("Date")
        df["Volume"] = df["TotalTradedVolume"].fillna(0) if "TotalTradedVolume" in df.columns else 0
        return df

    idx = index_registry().get(symbol_upper)
    if idx:
        df = pd.read_csv(idx["path"], parse_dates=["Index Date"])
        df = df.rename(columns=INDEX_COLUMN_MAP)
        df = df.dropna(subset=["Open"]).sort_values("Date")
        if "Volume" not in df.columns:
            df["Volume"] = 0
        df["Volume"] = df["Volume"].fillna(0)
        return _append_live_today(df, INTRADAY_1MIN_INDEX_DIR, symbol_upper, "Volume")

    return None


@app.get("/api/candles")
def get_candles(symbol: str, tf: str = "D", limit: int = 100_000):
    symbol = symbol.strip()
    if tf.isdigit():
        # Any numeric tf ("1", "5", "15", "75", ...) is minutes — TradingView-style, you
        # type a number and get that intraday granularity. All resampled from the same
        # 1-minute base data, not separately backfilled per interval.
        path = INTRADAY_1MIN_DIR / f"{symbol.upper()}.parquet"
        if not path.exists():
            path = INTRADAY_1MIN_INDEX_DIR / f"{symbol.upper()}.parquet"
        if not path.exists():
            raise HTTPException(404, f"No 1-minute data backfilled for {symbol}")
        df = pd.read_parquet(path).sort_values("timestamp")
        df = _resample_intraday(df, int(tf))
        return _intraday_candles_response(df, limit)

    _parse_calendar_tf(tf)  # raises 400 on an invalid tf before touching any data

    symbol_upper = symbol.upper()
    df = _load_daily_df(symbol_upper)
    if df is None:
        raise HTTPException(404, f"No data for symbol {symbol}")
    df = _resample_ohlcv(df, tf, "Volume")
    return _candles_response(df, "Volume", limit)


@app.get("/api/symbol_details")
def get_symbol_details(symbol: str):
    details = screener_details().get(symbol.strip().upper())
    if not details:
        raise HTTPException(404, f"No sector/industry data for {symbol}")
    return details


# NOTE (sample-share build): /api/indicators/zigzag_verified and
# /api/indicators/custom (RS, DMA WMA Master, ADR/ATR) are intentionally not
# implemented here -- see the module docstring note near REPO_ROOT above.


@app.get("/api/quotes")
def get_quotes(symbols: str):
    # EOD-only workspace, no live tick feed: "last" is the most recent daily close,
    # "change" is against the prior day's close (watchlist rows, not a live ticker).
    result: dict[str, dict] = {}
    for sym in {s.strip().upper() for s in symbols.split(",") if s.strip()}:
        try:
            candles = get_candles(sym, tf="D", limit=2)
        except HTTPException:
            continue
        if not candles:
            continue
        last = candles[-1]
        prev = candles[-2] if len(candles) > 1 else None
        change = last["close"] - prev["close"] if prev else None
        change_pct = (change / prev["close"] * 100) if prev and prev["close"] else None
        result[sym] = {
            "last": last["close"],
            "prevClose": prev["close"] if prev else None,
            "change": change,
            "changePercent": change_pct,
        }
    return result


@app.get("/api/trades/live")
def get_live_trades(symbol: str):
    symbol = symbol.upper().strip()
    if not PORTFOLIO_TRANSACTIONS.exists():
        raise HTTPException(404, "portfolio_transactions.csv not found")
    df = pd.read_csv(PORTFOLIO_TRANSACTIONS, parse_dates=["Date"])
    df = df[df["Symbol"].str.upper() == symbol].sort_values("Date")
    return [
        {
            "time": row.Date.strftime("%Y-%m-%d"),
            "action": row.Action,
            "price": row.Price,
            "quantity": row.Quantity,
            "notes": row.Notes if isinstance(row.Notes, str) else "",
        }
        for row in df.itertuples()
    ]


@app.get("/api/ca_checklist")
def get_ca_checklist(list: str = "nse"):
    """Full CA-verify checklist, in file order, for the chart's Prev/Next navigator.

    `list=nse` (default) is the original 121-event NSE checklist; `list=bse` is
    the BSE-only high-error batch (`Review/bse_ca_review_checklist.csv`, from
    verify_bse_ca_adjustment.py's UNADJUSTED rows with >10% ratio error) —
    same column shape, so this endpoint and the frontend nav don't care which
    one they're pointed at."""
    path = CA_CHECKLISTS.get(list, CA_VERIFY_CHECKLIST)
    if not path.exists():
        return []
    df = pd.read_csv(path, dtype=str).fillna("")
    return [
        {
            "n": row["n"],
            "symbol": row["symbol"],
            "exDate": row["ex_date"],
            "purpose": row["purpose"],
            "eventRatio": row["event_ratio"],
            "ratioMatch": row["ratio_match"],
            "decision": row["decision"],
        }
        for _, row in df.iterrows()
    ]


@app.get("/api/ca_events")
def get_ca_events(symbol: str, list: str = "nse"):
    """Corporate-action candidates for one symbol, from whichever CA checklist
    `list` selects (see /api/ca_checklist) — plotted as chart markers so a
    missed split/bonus can be eyeballed against the price series directly."""
    path = CA_CHECKLISTS.get(list, CA_VERIFY_CHECKLIST)
    if not path.exists():
        return []
    df = pd.read_csv(path, dtype=str).fillna("")
    df = df[df["symbol"].str.upper() == symbol.upper()]
    return [
        {
            "time": row["ex_date"],
            "purpose": row["purpose"],
            "eventRatio": row["event_ratio"],
            "ratioMatch": row["ratio_match"],
            "decision": row["decision"],
        }
        for _, row in df.iterrows()
    ]


def _ttl_cache(seconds: float):
    """lru_cache(maxsize=1) never sees a file dropped in after the process
    started -- that's what made a fresh sim's trades.csv invisible until a
    backend restart. This re-globs at most once per `seconds` instead of
    once ever, so a new file shows up on its own shortly after."""
    def decorator(fn):
        state = {"t": 0.0, "value": None}

        def wrapper():
            now = time.time()
            if now - state["t"] > seconds or state["value"] is None:
                state["value"] = fn()
                state["t"] = now
            return state["value"]

        return wrapper

    return decorator


@_ttl_cache(seconds=10)
def _experiment_list() -> list[str]:
    if not EXPERIMENTS_DIR.exists():
        return []
    return sorted(
        str(p.parent.relative_to(EXPERIMENTS_DIR)).replace("\\", "/")
        for p in EXPERIMENTS_DIR.glob("**/trades.csv")
    )


@app.get("/api/trades/experiments")
def list_experiments() -> list[str]:
    return _experiment_list()


@_ttl_cache(seconds=10)
def _poi_glob_sources() -> list[Path]:
    found: list[Path] = []
    for root in POI_ROOTS:
        if root.exists():
            found.extend(root.glob("**/poi_*.csv"))
    return sorted(found)


@app.get("/api/poi/sources")
def list_poi_sources() -> list[dict]:
    ca_labels = {
        "nse": "CA checklist (NSE)",
        "bse": "CA checklist (BSE)",
        "nse2": "CA checklist (NSE round 2 — mild-ratio fix)",
    }
    sources = [
        {"id": f"ca:{key}", "label": ca_labels.get(key, f"CA checklist ({key})"), "kind": "ca"}
        for key in CA_CHECKLISTS
    ]
    for exp in _experiment_list():
        sources.append({"id": f"backtest:{exp}", "label": f"Backtest trades — {exp}", "kind": "backtest"})
    for path in _poi_glob_sources():
        rel = str(path.relative_to(REPO_ROOT)).replace("\\", "/")
        sources.append({"id": f"poi:{rel}", "label": rel, "kind": "poi"})
    return sources


def _poi_get(row: "pd.Series", col: str):
    if col not in row:
        return None
    v = row[col]
    if v is None or (isinstance(v, float) and pd.isna(v)) or v == "":
        return None
    return v


def _normalize_poi_df(df: pd.DataFrame, source_id: str) -> list[dict]:
    missing = POI_REQUIRED_COLS - set(df.columns)
    if missing:
        raise HTTPException(400, f"{source_id} missing required POI columns: {sorted(missing)}")
    df = df.reset_index(drop=True)
    rows = []
    for i, row in df.iterrows():
        rid = _poi_get(row, "id")
        if rid is None:
            rid = hashlib.md5(f"{source_id}:{i}".encode()).hexdigest()[:12]
        rows.append(
            {
                "id": str(rid),
                "symbol": str(_poi_get(row, "symbol")).upper(),
                "date": _poi_get(row, "date"),
                "endDate": _poi_get(row, "end_date"),
                "label": _poi_get(row, "label"),
                "side": _poi_get(row, "side"),
                "entryPrice": _poi_get(row, "entry_price"),
                "exitPrice": _poi_get(row, "exit_price"),
                "pnl": _poi_get(row, "pnl"),
                "rMultiple": _poi_get(row, "r_multiple"),
                "tag": _poi_get(row, "tag"),
                "notes": _poi_get(row, "notes"),
            }
        )
    return rows


@lru_cache(maxsize=256)
def _poi_rows_for_source(source: str) -> tuple[dict, ...]:
    """The actual per-source CSV read + normalize, cached so the merged
    cross-source search (see /api/poi/search) doesn't re-parse a multi-MB
    trades.csv on every keystroke -- only the first hit on a given source is
    slow. Returns a tuple (not list) so it's hashable-safe as an lru_cache
    value and callers can't accidentally mutate the cached rows."""
    if source.startswith("ca:"):
        list_key = source.split(":", 1)[1]
        path = CA_CHECKLISTS.get(list_key, CA_VERIFY_CHECKLIST)
        if not path.exists():
            return ()
        df = pd.read_csv(path, dtype=str).fillna("")
        df = df.rename(columns={"ex_date": "date", "decision": "label"})
        df["tag"] = f"CA {list_key.upper()}"
        df["notes"] = (df.get("purpose", "") + " " + df.get("event_ratio", "")).str.strip()
        return tuple(_normalize_poi_df(df, source))

    if source.startswith("backtest:"):
        exp = source.split(":", 1)[1]
        exp_path = (EXPERIMENTS_DIR / exp / "trades.csv").resolve()
        if EXPERIMENTS_DIR.resolve() not in exp_path.parents or not exp_path.exists():
            raise HTTPException(404, "experiment not found")
        df = pd.read_csv(
            exp_path,
            usecols=["Symbol", "entry_date", "exit_date", "entry_px", "exit_px", "R_multiple", "exit_reason"],
        )
        df = df.rename(
            columns={
                "Symbol": "symbol",
                "entry_date": "date",
                "exit_date": "end_date",
                "entry_px": "entry_price",
                "exit_px": "exit_price",
                "R_multiple": "r_multiple",
                "exit_reason": "label",
            }
        )
        df["tag"] = exp
        return tuple(_normalize_poi_df(df, source))

    if source.startswith("poi:"):
        rel = source.split(":", 1)[1]
        path = (REPO_ROOT / rel).resolve()
        if not any(root.resolve() in path.parents for root in POI_ROOTS) or not path.exists():
            raise HTTPException(404, "poi source not found")
        df = pd.read_csv(path)
        return tuple(_normalize_poi_df(df, source))

    raise HTTPException(404, "unknown source")


@app.get("/api/poi/rows")
def get_poi_rows(source: str) -> list[dict]:
    return list(_poi_rows_for_source(source))


@app.post("/api/poi/import")
async def import_poi_csv(file: UploadFile = File(...)) -> dict:
    """One-off CSV import, bypassing filesystem discovery entirely -- for a
    sim/study result that isn't under Research/, Backtest/experiments/, or
    Review/ (or is, but named something other than poi_*.csv and you don't
    want to rename/move it). Reads whatever you hand it, checks it against
    the same schema _normalize_poi_df enforces everywhere else, and returns
    the rows to browse immediately -- nothing is written to disk."""
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Could not parse '{file.filename}' as CSV: {e}")
    source_id = f"import:{file.filename}"
    rows = _normalize_poi_df(df, source_id)
    return {"sourceId": source_id, "sourceLabel": file.filename or "Imported CSV", "rows": rows}


def _poi_row_text(row: dict) -> str:
    return " ".join(str(v) for v in row.values() if v is not None).lower()


@app.get("/api/poi/search")
def poi_search(q: str = Query(""), limit: int = 300, max_sources: int = 25) -> dict:
    """The merged cross-CSV search behind the search box: 'reliance adr
    threshold 30 is 22' shouldn't require picking a source first. Tokens that
    match a source's label (experiment/WF name, "CA checklist") narrow which
    CSVs get read at all -- without at least one such token, a backtest
    experiment can't be reached this way (there are ~3000 trades.csv files,
    some tens of MB; scanning all of them per keystroke isn't viable), so CA
    and poi_*.csv sources (small, always cheap) are searched unconditionally
    while backtest sources only join in once a label token narrows them down.
    """
    tokens = [t for t in q.lower().split() if t]
    if not tokens:
        return {"rows": [], "truncatedSources": 0}

    sources = list_poi_sources()
    scored = []
    for s in sources:
        if s["kind"] == "backtest":
            label = s["label"].lower()
            score = sum(1 for t in tokens if t in label)
            if score > 0:
                scored.append((score, s))
        else:
            scored.append((0, s))  # CA/poi sources always participate
    scored.sort(key=lambda x: -x[0])

    backtest_matches = [s for score, s in scored if s["kind"] == "backtest" and score > 0]
    truncated = max(0, len(backtest_matches) - max_sources)
    always_on = [s for _, s in scored if s["kind"] != "backtest"]
    candidates = always_on + backtest_matches[:max_sources]

    results: list[dict] = []
    for s in candidates:
        leftover = [t for t in tokens if t not in s["label"].lower()]
        try:
            rows = _poi_rows_for_source(s["id"])
        except HTTPException:
            continue
        for row in rows:
            if all(t in _poi_row_text(row) for t in leftover):
                results.append({**row, "sourceId": s["id"], "sourceLabel": s["label"]})
                if len(results) >= limit:
                    break
        if len(results) >= limit:
            break

    return {"rows": results, "truncatedSources": truncated}


@app.get("/api/trades/backtest")
def get_backtest_trades(symbol: str, experiment: str):
    symbol = symbol.upper().strip()
    exp_path = (EXPERIMENTS_DIR / experiment / "trades.csv").resolve()
    if EXPERIMENTS_DIR.resolve() not in exp_path.parents or not exp_path.exists():
        raise HTTPException(404, "experiment not found")

    df = pd.read_csv(exp_path)
    df = df[df["Symbol"].str.upper() == symbol]
    return [
        {
            "entryTime": row.entry_date,
            "exitTime": row.exit_date,
            "entryPrice": row.entry_px,
            "exitPrice": row.exit_px,
            "pnl": row.pnl,
            "rMultiple": row.R_multiple if pd.notna(row.R_multiple) else None,
            "exitReason": row.exit_reason,
        }
        for row in df.itertuples()
    ]


@lru_cache(maxsize=1)
def options_underlyings() -> list[str]:
    if not FNO_BY_SYMBOL_DIR.exists():
        return []
    return sorted(p.stem for p in FNO_BY_SYMBOL_DIR.glob("*.parquet"))


@app.get("/api/options/underlyings")
def list_options_underlyings(q: str = Query("", min_length=0), limit: int = 20) -> list[str]:
    all_syms = options_underlyings()
    if not q:
        return all_syms[:limit]
    q_upper = q.upper()
    starts = [s for s in all_syms if s.startswith(q_upper)]
    contains = [s for s in all_syms if q_upper in s and s not in starts]
    return (starts + contains)[:limit]


def _load_fno(symbol: str) -> pd.DataFrame:
    path = FNO_BY_SYMBOL_DIR / f"{symbol.upper()}.parquet"
    if not path.exists():
        raise HTTPException(404, f"No options/futures data for {symbol}")
    return pd.read_parquet(path)


# NSE swapped instrument codes on 2024-07-08 (OPTSTK/FUTSTK/OPTIDX/FUTIDX ->
# STO/STF/IDO/IDF). Per-symbol parquet files span both eras, so any of the
# four "families" below must match both its legacy and current code.
INSTRUMENT_FAMILY = {
    "OPTSTK": {"OPTSTK", "STO"}, "STO": {"OPTSTK", "STO"},
    "FUTSTK": {"FUTSTK", "STF"}, "STF": {"FUTSTK", "STF"},
    "OPTIDX": {"OPTIDX", "IDO"}, "IDO": {"OPTIDX", "IDO"},
    "FUTIDX": {"FUTIDX", "IDF"}, "IDF": {"FUTIDX", "IDF"},
}


def _instrument_family(instrument: str) -> set[str]:
    return INSTRUMENT_FAMILY.get(instrument, {instrument})


@app.get("/api/options/expiries")
def list_expiries(symbol: str, instrument: str = "STO"):
    df = _load_fno(symbol)
    df = df[df["INSTRUMENT"].isin(_instrument_family(instrument))]
    expiries = sorted(df["EXPIRY_DT"].dropna().unique().tolist())
    return [pd.Timestamp(e).strftime("%Y-%m-%d") for e in expiries]


@app.get("/api/options/strikes")
def list_strikes(symbol: str, expiry: str, instrument: str = "STO"):
    df = _load_fno(symbol)
    df = df[df["INSTRUMENT"].isin(_instrument_family(instrument)) & (df["EXPIRY_DT"] == pd.Timestamp(expiry))]
    return sorted(df["STRIKE_PR"].dropna().unique().tolist())


@app.get("/api/options/candles")
def get_options_candles(
    symbol: str,
    expiry: str,
    instrument: str = "STO",
    strike: float | None = None,
    option_type: str | None = None,
    tf: str = "D",
    limit: int = 100_000,
):
    _parse_calendar_tf(tf)  # raises 400 on an invalid tf before touching any data
    df = _load_fno(symbol)
    df = df[df["INSTRUMENT"].isin(_instrument_family(instrument)) & (df["EXPIRY_DT"] == pd.Timestamp(expiry))]
    if strike is not None:
        df = df[df["STRIKE_PR"] == strike]
    if option_type:
        df = df[df["OPTION_TYP"] == option_type]
    if df.empty:
        raise HTTPException(404, "No matching contract data")

    df = df.rename(columns={"TIMESTAMP": "Date", "OPEN": "Open", "HIGH": "High", "LOW": "Low", "CLOSE": "Close", "CONTRACTS": "Volume"})
    df = df.sort_values("Date")
    df = _resample_ohlcv(df, tf, "Volume")
    return _candles_response(df, "Volume", limit)


# --- Screener -----------------------------------------------------------------
# Thin wrapper over top_movers_screener.build_movement_universe (see the import
# above) -- the ranking/eligibility logic itself lives in exactly one place.

_SCREENER_COLUMNS = [
    "Rank", "Symbol", "Close", "OneMonthStrength", "Setup", "ADR20_Pct",
    "AvgTradedValue22_Cr", "BaseAge", "NewToday", "ATRZoneReady", "BreakoutToday",
]


@app.get("/api/screener/momentum")
def get_momentum_screener(as_of: str | None = None) -> dict:
    # Not wired up in this sample-share build -- see NOTE near the top of the file.
    raise HTTPException(404, "momentum screener not available in this sample build")


# --- Alerts -----------------------------------------------------------------
# EOD-only for now: checks run on demand against the last daily close via
# get_candles(). get_latest_price() is the one seam to swap for a live quote
# once the Upstox feed lands -- the condition-evaluation logic doesn't change,
# only how fresh the price passed into it is.

ALERTS_DIR = Path(__file__).resolve().parent / "data"
ALERTS_FILE = ALERTS_DIR / "alerts.json"
ALERTS_LOG_FILE = ALERTS_DIR / "alerts_log.json"


def _load_json_list(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _save_json_list(path: Path, data: list[dict]) -> None:
    ALERTS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


class AlertIn(BaseModel):
    symbol: str
    condition: str  # "above" | "below" | "crosses_above" | "crosses_below"
    price: float


def get_latest_price(symbol: str) -> float | None:
    """Swappable price source. Today: last EOD daily close. Swap this body for
    a live Upstox quote call once that feed is ready -- callers don't change."""
    try:
        candles = get_candles(symbol, tf="D", limit=2)
    except HTTPException:
        return None
    return candles[-1]["close"] if candles else None


@app.get("/api/alerts")
def list_alerts() -> list[dict]:
    return _load_json_list(ALERTS_FILE)


@app.post("/api/alerts")
def create_alert(alert: AlertIn) -> dict:
    alerts = _load_json_list(ALERTS_FILE)
    new_alert = {
        "id": f"alert-{int(time.time() * 1000)}",
        "symbol": alert.symbol.strip().upper(),
        "condition": alert.condition,
        "price": alert.price,
        "active": True,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    alerts.append(new_alert)
    _save_json_list(ALERTS_FILE, alerts)
    return new_alert


@app.get("/api/alerts/log")
def get_alerts_log() -> list[dict]:
    return list(reversed(_load_json_list(ALERTS_LOG_FILE)))


@app.delete("/api/alerts/log")
def clear_alerts_log() -> dict:
    _save_json_list(ALERTS_LOG_FILE, [])
    return {"ok": True}


# NOTE: these {alert_id} routes must stay below the /api/alerts/log routes
# above -- FastAPI matches path routes in definition order, so "log" would
# otherwise be captured as an alert_id.
@app.patch("/api/alerts/{alert_id}")
def update_alert(alert_id: str, active: bool) -> dict:
    alerts = _load_json_list(ALERTS_FILE)
    for a in alerts:
        if a["id"] == alert_id:
            a["active"] = active
            _save_json_list(ALERTS_FILE, alerts)
            return a
    raise HTTPException(404, "alert not found")


@app.delete("/api/alerts/{alert_id}")
def delete_alert(alert_id: str) -> dict:
    alerts = [a for a in _load_json_list(ALERTS_FILE) if a["id"] != alert_id]
    _save_json_list(ALERTS_FILE, alerts)
    return {"ok": True}


@app.post("/api/alerts/check")
def check_alerts() -> dict:
    """Evaluate every active alert against the latest close and log hits.
    Triggered on demand from the UI now; once live data lands this same
    function can be called from a scheduler instead -- no logic changes."""
    alerts = _load_json_list(ALERTS_FILE)
    log = _load_json_list(ALERTS_LOG_FILE)
    triggered: list[dict] = []
    dirty = False

    for a in alerts:
        if not a.get("active", True):
            continue
        try:
            candles = get_candles(a["symbol"], tf="D", limit=2)
        except HTTPException:
            continue
        if not candles:
            continue
        price = candles[-1]["close"]
        prev_price = candles[-2]["close"] if len(candles) == 2 else None
        target = a["price"]
        condition = a["condition"]

        hit = False
        if condition == "above" and price > target:
            hit = True
        elif condition == "below" and price < target:
            hit = True
        elif condition == "crosses_above" and prev_price is not None and prev_price <= target < price:
            hit = True
        elif condition == "crosses_below" and prev_price is not None and prev_price >= target > price:
            hit = True

        if hit:
            entry = {
                "id": f"log-{int(time.time() * 1000)}-{a['id']}",
                "alertId": a["id"],
                "symbol": a["symbol"],
                "condition": condition,
                "target": target,
                "price": price,
                "message": f"{a['symbol']} {condition.replace('_', ' ')} {target}",
                "at": datetime.now(timezone.utc).isoformat(),
            }
            log.append(entry)
            triggered.append(entry)
            a["active"] = False  # one-shot, matches TV's default "fire once" behavior
            dirty = True

    if dirty:
        _save_json_list(ALERTS_FILE, alerts)
        _save_json_list(ALERTS_LOG_FILE, log)
    return {"triggered": triggered}
