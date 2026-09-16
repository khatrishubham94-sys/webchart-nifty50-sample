import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ThemeName,
  loadTheme,
  loadAppState,
  saveAppState,
  type Timeframe,
  API_BASE,
  type PeriodicMode,
  type Watchlist,
  loadWatchlists,
  saveWatchlists,
  loadActiveWatchlistId,
  saveActiveWatchlistId,
  type SymbolFlags,
  loadSymbolFlags,
  saveSymbolFlags,
  type PoiRow,
  type PoiSource,
} from "./lib";
import {
  SymbolButton,
  SymbolSearchModal,
  IndicatorMenu,
  TradesPanel,
  DrawingToolbar,
  DrawingToolRail,
  PoiSidePanel,
  type PoiSidePanelHandle,
  WatchlistPanel,
  FlagDot,
  FlagPalette,
  AlertsPanel,
  ScreenerPanel,
  type OptionsSelection,
} from "./components";
import Chart from "./Chart";

// TradingView's own toolbar-group divider: 1px wide, 22px tall — matched from live
// computed styles rather than guessed.
function Divider() {
  return <div style={{ width: 1, height: 22, background: "var(--border)", flexShrink: 0 }} />;
}

export default function App() {
  const [theme, setTheme] = useState<ThemeName>(loadTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("webchart:theme", theme);
    } catch {
      /* ignore quota errors */
    }
  }, [theme]);

  const savedState = useRef(loadAppState()).current;
  const initialUrlParams = useRef(new URLSearchParams(window.location.search)).current;
  const [symbol, setSymbol] = useState(
    initialUrlParams.get("symbol")?.toUpperCase() || savedState.symbol || ""
  );
  const [tf, setTf] = useState<Timeframe>(savedState.tf ?? "D");
  const [activeIndicators, setActiveIndicators] = useState<Set<number>>(
    new Set(savedState.activeIndicators ?? [])
  );
  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null);
  // stable identity across renders — this is a Chart-side useEffect dependency, and a fresh
  // arrow function on every App render was tearing down and rebuilding the whole in-progress
  // drawing gesture (losing click-then-click state) whenever App re-rendered for any other
  // reason (e.g. the live-trades poll) mid-interaction
  const onToolConsumed = useCallback(() => setActiveDrawingTool(null), []);
  const [showVWAP, setShowVWAP] = useState(savedState.showVWAP ?? false);
  const [showVolume, setShowVolume] = useState(savedState.showVolume ?? true);
  const [magnetMode, setMagnetMode] = useState(savedState.magnetMode ?? false);
  const [avwapArmed, setAvwapArmed] = useState(false);
  const [avwapAnchorTime, setAvwapAnchorTime] = useState<string | null>(null);
  const [showLiveTrades, setShowLiveTrades] = useState(false);
  const [showBacktestTrades, setShowBacktestTrades] = useState(false);
  const [showCaEvents, setShowCaEvents] = useState(initialUrlParams.get("ca") === "1");
  // Which checklist's markers show on the chart — independent of which source
  // the Points-of-interest panel is currently browsing. "nse2" is the round-2
  // batch (classify()'s mild-ratio bug, fixed 2026-09-06 after PFC's
  // 2023-09-21 Bonus 1:4 turned up still-unadjusted despite an "ADJUSTED"
  // verdict) — keep this union and CA_LIST_CYCLE in sync with the backend's
  // CA_CHECKLISTS dict if another batch gets added later.
  const parseCaListId = (id: string): "nse" | "bse" | "nse2" => {
    const key = id.startsWith("ca:") ? id.slice(3) : id;
    return key === "bse" || key === "nse2" ? key : "nse";
  };
  const [caList, setCaList] = useState<"nse" | "bse" | "nse2">(
    parseCaListId(initialUrlParams.get("list") ?? "")
  );
  const [gotoTime, setGotoTime] = useState<string | null>(null);

  // Every "jump the chart to a symbol+date" flow — CA review, backtest
  // experiment->WF->trade drill-down, research study results — goes through
  // this one handler, fed by PoiSidePanel's single /api/poi/sources+rows contract.
  const onPoiJump = useCallback((row: PoiRow, source: PoiSource) => {
    setSymbol(row.symbol);
    setGotoTime(row.date);
    if (source.kind === "ca") {
      setCaList(parseCaListId(source.id));
      setShowCaEvents(true);
    } else if (source.kind === "backtest") {
      setBacktestExperiment(source.id.slice("backtest:".length));
      setShowBacktestTrades(true);
    }
  }, []);

  // Deep link (?ca=1&list=nse&n=12) — land on that CA row once on mount,
  // same /api/poi/rows path PoiSidePanel itself uses.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current) return;
    deepLinkedRef.current = true;
    if (initialUrlParams.get("ca") !== "1" && !initialUrlParams.get("n")) return;
    const list = parseCaListId(initialUrlParams.get("list") ?? "");
    const n = parseInt(initialUrlParams.get("n") ?? "", 10);
    const idx = Number.isFinite(n) && n > 0 ? n - 1 : 0;
    fetch(`${API_BASE}/api/poi/rows?source=ca:${list}`)
      .then((r) => r.json())
      .then((rows: PoiRow[]) => {
        const row = rows[idx];
        if (row) onPoiJump(row, { id: `ca:${list}`, label: "", kind: "ca" });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [backtestExperiment, setBacktestExperiment] = useState("");
  const [showVRVP, setShowVRVP] = useState(false);
  const [periodicMode, setPeriodicMode] = useState<PeriodicMode>("off");
  const [avpArmed, setAvpArmed] = useState(false);
  const [avpAnchorTime, setAvpAnchorTime] = useState<string | null>(null);
  const [frvpArmed, setFrvpArmed] = useState(false);
  const [frvpRanges, setFrvpRanges] = useState<[string, string][]>([]);
  const [replayArmed, setReplayArmed] = useState(false);
  const [replayActive, setReplayActive] = useState(false);
  // stable identities — see the onToolConsumed comment above; each of these is a Chart-side
  // useEffect dependency, and a fresh arrow function per App render would silently drop an
  // in-progress click-to-arm gesture whenever App re-rendered for an unrelated reason
  const onAvwapAnchorSet = useCallback((t: string) => {
    setAvwapAnchorTime(t);
    setAvwapArmed(false);
  }, []);
  const onAvpAnchorSet = useCallback((t: string) => {
    setAvpAnchorTime(t);
    setAvpArmed(false);
  }, []);
  const onFrvpRangeAdd = useCallback((r: [string, string]) => {
    setFrvpRanges((prev) => [...prev, r]);
    setFrvpArmed(false);
  }, []);
  const onReplayArmedConsumed = useCallback(() => setReplayArmed(false), []);
  const [optionsSelection, setOptionsSelection] = useState<OptionsSelection | null>(null);
  const [showSymbolSearch, setShowSymbolSearch] = useState(false);
  const [symbolSearchSeed, setSymbolSearchSeed] = useState("");
  const [symbolSearchMode, setSymbolSearchMode] = useState<"navigate" | "add">("navigate");
  const [resetViewToken, setResetViewToken] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const [watchlists, setWatchlists] = useState<Watchlist[]>(loadWatchlists);
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(() => {
    const saved = loadActiveWatchlistId();
    const lists = loadWatchlists();
    return saved && lists.some((w) => w.id === saved) ? saved : lists[0]?.id ?? null;
  });
  const [symbolFlags, setSymbolFlags] = useState<SymbolFlags>(loadSymbolFlags);
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [showObjectTree, setShowObjectTree] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showScreener, setShowScreener] = useState(false);
  const [showPoi, setShowPoi] = useState(false);
  const poiPanelRef = useRef<PoiSidePanelHandle>(null);
  const [watchlistWidth, setWatchlistWidth] = useState(
    () => Number(localStorage.getItem("webchart:watchlistWidth")) || 300
  );
  const [showCurrentSymbolFlag, setShowCurrentSymbolFlag] = useState(false);

  useEffect(() => {
    saveWatchlists(watchlists);
  }, [watchlists]);

  useEffect(() => {
    if (activeWatchlistId) saveActiveWatchlistId(activeWatchlistId);
  }, [activeWatchlistId]);

  useEffect(() => {
    saveSymbolFlags(symbolFlags);
  }, [symbolFlags]);

  // Live auto-refresh. The 1-min Upstox candle store is updated continuously
  // during market hours (watch_and_run.py), but the chart otherwise only
  // fetches on symbol/tf change -- without this it looks frozen even while
  // fresh bars are landing on disk. This covers intraday tfs directly and
  // D/W/M too: the backend rolls up today's still-forming daily candle from
  // the same 1-min store (see _live_today_daily_candle in main.py), so the
  // daily/weekly/monthly views need refreshing right up to close as well,
  // not just the intraday ones.
  useEffect(() => {
    const id = setInterval(() => setRefreshToken((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [tf]);

  const activeWatchlist = watchlists.find((w) => w.id === activeWatchlistId) ?? null;

  const addSymbolsToActiveWatchlist = (syms: string[]) => {
    if (!activeWatchlistId) return;
    const additions = syms.map((s) => s.trim().toUpperCase()).filter(Boolean);
    setWatchlists((prev) =>
      prev.map((w) =>
        w.id === activeWatchlistId
          ? { ...w, symbols: [...w.symbols, ...additions.filter((s) => !w.symbols.includes(s))] }
          : w
      )
    );
  };

  const setFlag = (sym: string, color: string | null) => {
    setSymbolFlags((prev) => {
      if (!color) {
        if (!(sym in prev)) return prev;
        const next = { ...prev };
        delete next[sym];
        return next;
      }
      return { ...prev, [sym]: color };
    });
  };

  useEffect(() => {
    saveAppState({ symbol, tf, activeIndicators: [...activeIndicators], showVWAP, showVolume, magnetMode });
  }, [symbol, tf, activeIndicators, showVWAP, showVolume, magnetMode]);

  // TradingView's numeric-timeframe hotkey: typing digits (not in a text field) buffers
  // them and shows TradingView's own "Change interval" dialog — a bare number is minutes
  // ("125" -> 125m), a number plus one of D/W/M is that many days/weeks/months ("12D",
  // "3M"). Enter confirms; Escape or a few seconds of inactivity cancels without applying.
  const tfBufferRef = useRef("");
  const tfCancelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [intervalDialog, setIntervalDialog] = useState<{ buffer: string } | null>(null);

  const applyIntervalBuffer = useCallback(() => {
    const buf = tfBufferRef.current;
    tfBufferRef.current = "";
    setIntervalDialog(null);
    if (tfCancelTimeoutRef.current) clearTimeout(tfCancelTimeoutRef.current);
    const m = buf.match(/^(\d+)([A-Z]?)$/);
    if (!m) return;
    const [, numStr, suffix] = m;
    const num = parseInt(numStr, 10);
    if (!num) return;
    if (suffix === "D" || suffix === "W" || suffix === "M") {
      setTf(num === 1 ? suffix : `${num}${suffix}`);
    } else if (!suffix) {
      setTf(String(num));
    }
  }, []);

  const cancelIntervalBuffer = useCallback(() => {
    tfBufferRef.current = "";
    setIntervalDialog(null);
    if (tfCancelTimeoutRef.current) clearTimeout(tfCancelTimeoutRef.current);
  }, []);

  const armIntervalCancelTimeout = useCallback(() => {
    if (tfCancelTimeoutRef.current) clearTimeout(tfCancelTimeoutRef.current);
    tfCancelTimeoutRef.current = setTimeout(cancelIntervalBuffer, 4000);
  }, [cancelIntervalBuffer]);

  // The keydown handler below is bound once (empty dep array, so the global
  // listener isn't torn down and rebuilt on every render) — anything reactive
  // it needs has to come through a ref kept current every render, not a
  // closed-over variable, or it'd only ever see the value from first mount.
  const spacebarStateRef = useRef({ showPoi: false, symbol: "", watchlistSymbols: [] as string[] });
  spacebarStateRef.current = { showPoi, symbol, watchlistSymbols: activeWatchlist?.symbols ?? [] };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      // Whichever side panel is open owns spacebar: Points of interest steps to
      // the next trade/row, otherwise the active watchlist steps to the next
      // symbol in it. Plain Space with no modifier only, so it never eats a
      // shortcut that happens to also use it as part of a combo.
      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const { showPoi: poiOpen, symbol: curSymbol, watchlistSymbols } = spacebarStateRef.current;
        if (poiOpen) {
          e.preventDefault();
          poiPanelRef.current?.next();
          return;
        }
        if (watchlistSymbols.length > 0) {
          e.preventDefault();
          const idx = watchlistSymbols.indexOf(curSymbol);
          const next = watchlistSymbols[(idx + 1) % watchlistSymbols.length];
          setOptionsSelection(null);
          setSymbol(next);
          return;
        }
      }

      const bufferIsDigitsOnly = /^\d+$/.test(tfBufferRef.current);
      const isDigit = /^[0-9]$/.test(e.key);
      // A D/W/M suffix only completes an ALREADY-open, digits-only session — a bare
      // letter with no preceding digit is just normal symbol-search typing.
      const isIntervalSuffix =
        tfBufferRef.current.length > 0 &&
        bufferIsDigitsOnly &&
        /^[dwmDWM]$/.test(e.key);

      if ((isDigit || isIntervalSuffix) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        tfBufferRef.current += isDigit ? e.key : e.key.toUpperCase();
        setIntervalDialog({ buffer: tfBufferRef.current });
        armIntervalCancelTimeout();
        return;
      }
      if (tfBufferRef.current) {
        if (e.key === "Enter") {
          e.preventDefault();
          applyIntervalBuffer();
          return;
        }
        if (e.key === "Escape") {
          cancelIntervalBuffer();
          return;
        }
      }

      // TradingView's own drawing-tool shortcuts (verified against their published list)
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const toolKey = e.key.toLowerCase();
        if (toolKey === "r") {
          e.preventDefault();
          setResetViewToken((t) => t + 1);
          return;
        }
        const map: Record<string, string> = {
          t: "trend-line",
          h: "horizontal-line",
          v: "vertical-line",
          f: "fib-retracement",
          c: "cross-line",
        };
        if (map[toolKey]) {
          e.preventDefault();
          setActiveDrawingTool(map[toolKey]);
          return;
        }
      }
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setRefreshToken((t) => t + 1);
        return;
      }
      if (e.key === "Escape") {
        setActiveDrawingTool(null);
        setShowSymbolSearch(false);
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setSymbolSearchSeed(e.key);
        setShowSymbolSearch(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function describeIntervalBuffer(buf: string): string {
    const m = buf.match(/^(\d+)([A-Z]?)$/);
    if (!m) return "";
    const [, numStr, suffix] = m;
    const num = parseInt(numStr, 10);
    if (suffix === "D") return num === 1 ? "1 day" : `${num} days`;
    if (suffix === "W") return num === 1 ? "1 week" : `${num} weeks`;
    if (suffix === "M") return num === 1 ? "1 month" : `${num} months`;
    return num === 1 ? "1 minute" : `${num} minutes`;
  }

  const toggleIndicator = (period: number) => {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(period)) next.delete(period);
      else next.add(period);
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div
        className="toolbar-scroll"
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          minHeight: 38,
          padding: "4px 10px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
          <SymbolButton
            symbol={symbol}
            onClick={() => {
              setSymbolSearchSeed("");
              setShowSymbolSearch(true);
            }}
          />
          {symbol && (
            <FlagDot
              color={symbolFlags[symbol]}
              onClick={(e) => {
                e.stopPropagation();
                setShowCurrentSymbolFlag((v) => !v);
              }}
            />
          )}
          {showCurrentSymbolFlag && (
            <div style={{ position: "absolute", top: "110%", left: 0, zIndex: 30 }}>
              <FlagPalette
                onPick={(color) => {
                  setFlag(symbol, color);
                  setShowCurrentSymbolFlag(false);
                }}
                onClear={() => {
                  setFlag(symbol, null);
                  setShowCurrentSymbolFlag(false);
                }}
              />
            </div>
          )}
        </div>
        <div
          style={{
            background: "var(--bg-panel)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "5px 12px",
            fontSize: 13,
          }}
        >
          {tf === "1" ? "1m" : tf}
        </div>
        <Divider />
        <IndicatorMenu
          active={activeIndicators}
          onToggle={toggleIndicator}
          showVolume={showVolume}
          onToggleVolume={() => setShowVolume((v) => !v)}
          showVWAP={showVWAP}
          onToggleVWAP={() => setShowVWAP((v) => !v)}
        />
        <Divider />
        <DrawingToolbar
          replayArmed={replayArmed}
          onToggleReplayArm={() => setReplayArmed((v) => !v)}
          replayActive={replayActive}
        />
        <Divider />
        <TradesPanel
          showLive={showLiveTrades}
          onToggleLive={() => setShowLiveTrades((v) => !v)}
          showBacktest={showBacktestTrades}
          onToggleBacktest={() => setShowBacktestTrades((v) => !v)}
          experiment={backtestExperiment}
          showCaEvents={showCaEvents}
          onToggleCaEvents={() => setShowCaEvents((v) => !v)}
        />
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          <button
            onClick={() => setShowWatchlist((v) => !v)}
            title="Watchlists"
            style={{
              background: showWatchlist ? "var(--accent)" : "var(--bg-panel)",
              color: showWatchlist ? "var(--accent-text)" : "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "5px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            ☆ Watchlist
          </button>
          <button
            onClick={() => setShowAlerts((v) => !v)}
            title="Price alerts (EOD)"
            style={{
              background: showAlerts ? "var(--accent)" : "var(--bg-panel)",
              color: showAlerts ? "var(--accent-text)" : "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "5px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            🔔 Alerts
          </button>
          <button
            onClick={() => setShowScreener((v) => !v)}
            title="Momentum screener — coupled with the top-movers radar (port 8504)"
            style={{
              background: showScreener ? "var(--accent)" : "var(--bg-panel)",
              color: showScreener ? "var(--accent-text)" : "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "5px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            📡 Screener
          </button>
          <button
            onClick={() => setShowPoi((v) => !v)}
            title="Points of interest — browse CA review, backtest trades, or research results by file"
            style={{
              background: showPoi ? "var(--accent)" : "var(--bg-panel)",
              color: showPoi ? "var(--accent-text)" : "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "5px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            📌 Points of interest
          </button>
          <button
            onClick={() => setShowObjectTree((v) => !v)}
            title="Object tree — every drawing on this chart in one list"
            style={{
              background: showObjectTree ? "var(--accent)" : "var(--bg-panel)",
              color: showObjectTree ? "var(--accent-text)" : "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "5px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            🗂 Object tree
          </button>
        </div>
        <button
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          title="Toggle dark/light theme"
          style={{
            background: "var(--bg-panel)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "5px 12px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
      <div style={{ flex: 1, position: "relative", display: "flex", minHeight: 0, overflow: "hidden" }}>
      <DrawingToolRail
        activeTool={activeDrawingTool}
        onSelect={setActiveDrawingTool}
        magnetMode={magnetMode}
        onToggleMagnet={() => setMagnetMode((v) => !v)}
        avwapArmed={avwapArmed}
        onToggleAvwapArm={() => setAvwapArmed((v) => !v)}
        avwapActive={!!avwapAnchorTime}
        onClearAvwap={() => setAvwapAnchorTime(null)}
        showVRVP={showVRVP}
        onToggleVRVP={() => setShowVRVP((v) => !v)}
        periodicMode={periodicMode}
        onPeriodicModeChange={setPeriodicMode}
        avpArmed={avpArmed}
        onToggleAvpArm={() => setAvpArmed((v) => !v)}
        avpActive={!!avpAnchorTime}
        onClearAvp={() => setAvpAnchorTime(null)}
        frvpArmed={frvpArmed}
        onToggleFrvpArm={() => setFrvpArmed((v) => !v)}
        frvpCount={frvpRanges.length}
        onClearFrvp={() => setFrvpRanges([])}
      />
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        {symbol ? (
          <Chart
            symbol={symbol}
            tf={tf}
            activeIndicators={activeIndicators}
            showObjectTree={showObjectTree}
            activeDrawingTool={activeDrawingTool}
            onToolConsumed={onToolConsumed}
            showVWAP={showVWAP}
            showVolume={showVolume}
            avwapArmed={avwapArmed}
            avwapAnchorTime={avwapAnchorTime}
            onAvwapAnchorSet={onAvwapAnchorSet}
            onAvwapClear={() => setAvwapAnchorTime(null)}
            showLiveTrades={showLiveTrades}
            showBacktestTrades={showBacktestTrades}
            backtestExperiment={backtestExperiment}
            showCaEvents={showCaEvents}
            caList={caList}
            gotoTime={gotoTime}
            showVRVP={showVRVP}
            periodicMode={periodicMode}
            avpArmed={avpArmed}
            avpAnchorTime={avpAnchorTime}
            onAvpAnchorSet={onAvpAnchorSet}
            frvpArmed={frvpArmed}
            frvpRanges={frvpRanges}
            onFrvpRangeAdd={onFrvpRangeAdd}
            replayArmed={replayArmed}
            onReplayArmedConsumed={onReplayArmedConsumed}
            onReplayActiveChange={setReplayActive}
            optionsSelection={optionsSelection}
            resetViewToken={resetViewToken}
            refreshToken={refreshToken}
            theme={theme}
            magnetMode={magnetMode}
          />
        ) : (
          <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "var(--text-dim)" }}>
            Start typing a symbol...
          </div>
        )}
      </div>
      <WatchlistPanel
        open={showWatchlist}
        onClose={() => setShowWatchlist(false)}
        width={watchlistWidth}
        onWidthChange={(w) => {
          setWatchlistWidth(w);
          try {
            localStorage.setItem("webchart:watchlistWidth", String(w));
          } catch {
            /* ignore quota errors */
          }
        }}
        watchlists={watchlists}
        activeId={activeWatchlistId}
        onSelectWatchlist={setActiveWatchlistId}
        onCreate={(name) => {
          const wl: Watchlist = { id: `wl-${Date.now()}`, name, symbols: [] };
          setWatchlists((prev) => [...prev, wl]);
          setActiveWatchlistId(wl.id);
        }}
        onRename={(id, name) =>
          setWatchlists((prev) => prev.map((w) => (w.id === id ? { ...w, name } : w)))
        }
        onDelete={(id) => {
          setWatchlists((prev) => {
            const next = prev.filter((w) => w.id !== id);
            if (activeWatchlistId === id) setActiveWatchlistId(next[0]?.id ?? null);
            return next;
          });
        }}
        symbols={activeWatchlist?.symbols ?? []}
        onRemoveSymbol={(sym) =>
          setWatchlists((prev) =>
            prev.map((w) =>
              w.id === activeWatchlistId ? { ...w, symbols: w.symbols.filter((s) => s !== sym) } : w
            )
          )
        }
        currentSymbol={symbol}
        onSelectSymbol={(sym) => {
          setOptionsSelection(null);
          setSymbol(sym);
        }}
        symbolFlags={symbolFlags}
        onSetFlag={setFlag}
        onOpenAdd={() => {
          setSymbolSearchMode("add");
          setSymbolSearchSeed("");
          setShowSymbolSearch(true);
        }}
      />
      <AlertsPanel
        open={showAlerts}
        onClose={() => setShowAlerts(false)}
        width={280}
        defaultSymbol={symbol ?? ""}
      />
      <ScreenerPanel
        open={showScreener}
        onClose={() => setShowScreener(false)}
        width={420}
        onSelectSymbol={(sym) => {
          setOptionsSelection(null);
          setSymbol(sym);
        }}
        onAddToWatchlist={addSymbolsToActiveWatchlist}
      />
      <PoiSidePanel ref={poiPanelRef} open={showPoi} onClose={() => setShowPoi(false)} width={420} onJump={onPoiJump} />
      </div>
      <SymbolSearchModal
        open={showSymbolSearch}
        initialQuery={symbolSearchSeed}
        mode={symbolSearchMode}
        onClose={() => {
          setShowSymbolSearch(false);
          setSymbolSearchMode("navigate");
        }}
        onPick={(s) => {
          setOptionsSelection(null);
          setSymbol(s);
        }}
        onAdd={addSymbolsToActiveWatchlist}
        onPickOptions={(sel) => {
          setOptionsSelection(sel);
          setSymbol(
            `${sel.symbol} ${sel.expiry} ${sel.instrument}${sel.strike ? ` ${sel.strike}${sel.optionType}` : ""}`
          );
        }}
      />
      {intervalDialog && (
        <div
          style={{
            position: "fixed",
            top: "35%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 200,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 16,
            minWidth: 240,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Change interval</div>
            <span
              title={
                'Type the interval number for minute charts (e.g. 5 for a 5-minute chart). ' +
                "Or a number plus a letter for other intervals: D (days), W (weeks), M (months) " +
                "— e.g. D, 12D, W, or 3M."
              }
              style={{ cursor: "help", color: "var(--text-dim)", fontSize: 13 }}
            >
              ⓘ
            </span>
          </div>
          <input
            readOnly
            value={intervalDialog.buffer}
            style={{
              width: "100%",
              fontSize: 20,
              padding: "6px 8px",
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              boxSizing: "border-box",
            }}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-dim)" }}>
            {describeIntervalBuffer(intervalDialog.buffer)} — press Enter
          </div>
        </div>
      )}
    </div>
  );
}
