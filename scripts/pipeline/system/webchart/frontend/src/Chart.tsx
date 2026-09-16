import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";
import { DrawingManager, type Anchor } from "lightweight-charts-drawing";
import { VolumeProfilePrimitive } from "./volumeProfile";
import {
  type ThemeName,
  chartColors,
  type PeriodicMode,
  loadDrawings,
  saveDrawings,
  drawingFactory,
  API_BASE,
  type Timeframe,
  type LiveTrade,
  type BacktestTrade,
  type CaEvent,
  type Candle,
  MA_PERIODS,
  MA_COLORS,
  ensureContrast,
  movingAverage,
  volumeBars,
  vwapFrom,
} from "./lib";
import { ObjectTreePanel, type OptionsSelection, type DrawingRow } from "./components";
import { useDrawingHitTest } from "./useDrawingHitTest";
import { useDrawingHistory } from "./useDrawingHistory";
import { useDrawingSelection } from "./useDrawingSelection";
import { useVolumeProfile } from "./useVolumeProfile";
import { useTradeMarkers } from "./useTradeMarkers";
import { useDrawingToolCreation } from "./useDrawingToolCreation";

const IST_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const IST_DATETIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const IST_DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatIstTime(epochSeconds: number, withDate = false): string {
  const date = new Date(epochSeconds * 1000);
  return withDate ? IST_DATETIME_FMT.format(date) : IST_TIME_FMT.format(date);
}

// D/W/M candles carry an ISO date string (no intraday clock component), so
// they're formatted as a plain calendar date rather than routed through the
// IST hour:minute formatters above.
function formatDateLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return IST_DATE_FMT.format(date);
}

// The Alt+R "reset view" window: trailing ~9 months of candles with a small
// right-hand offset, same as the Alt+R shortcut in App.tsx -- used both there
// and as the default view on first load, instead of fit-to-all-history.
function applyDefaultView(chart: IChartApi, candles: Candle[], tf: Timeframe) {
  if (!candles.length) return;
  const lastDate = new Date(candles[candles.length - 1].time);
  const cutoff = new Date(lastDate);
  cutoff.setMonth(cutoff.getMonth() - 9);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const from = candles.find((c) => c.time >= cutoffStr)?.time ?? candles[0].time;
  const to = candles[candles.length - 1].time;
  const rightOffset = tf === "D" ? 15 : tf === "W" ? 3 : 1;
  chart.timeScale().applyOptions({ rightOffset });
  chart.timeScale().setVisibleRange({ from, to } as { from: Time; to: Time });
}

export default function Chart({
  symbol,
  tf,
  activeIndicators,
  showObjectTree,
  activeDrawingTool,
  onToolConsumed,
  showVWAP,
  showVolume,
  avwapArmed,
  onAvwapAnchorSet,
  avwapAnchorTime,
  onAvwapClear,
  showLiveTrades,
  showBacktestTrades,
  backtestExperiment,
  showCaEvents,
  caList,
  gotoTime,
  showVRVP,
  periodicMode,
  avpArmed,
  avpAnchorTime,
  onAvpAnchorSet,
  frvpArmed,
  frvpRanges,
  onFrvpRangeAdd,
  replayArmed,
  onReplayArmedConsumed,
  onReplayActiveChange,
  optionsSelection,
  resetViewToken,
  refreshToken,
  theme,
  magnetMode,
}: {
  symbol: string;
  tf: Timeframe;
  activeIndicators: Set<number>;
  showObjectTree: boolean;
  activeDrawingTool: string | null;
  onToolConsumed: () => void;
  showVWAP: boolean;
  showVolume: boolean;
  avwapArmed: boolean;
  onAvwapAnchorSet: (time: string) => void;
  avwapAnchorTime: string | null;
  onAvwapClear: () => void;
  showLiveTrades: boolean;
  showBacktestTrades: boolean;
  backtestExperiment: string;
  showCaEvents: boolean;
  caList: "nse" | "bse" | "nse2";
  gotoTime: string | null;
  showVRVP: boolean;
  periodicMode: PeriodicMode;
  avpArmed: boolean;
  avpAnchorTime: string | null;
  onAvpAnchorSet: (time: string) => void;
  frvpArmed: boolean;
  frvpRanges: [string, string][];
  onFrvpRangeAdd: (range: [string, string]) => void;
  replayArmed: boolean;
  onReplayArmedConsumed: () => void;
  onReplayActiveChange: (active: boolean) => void;
  optionsSelection: OptionsSelection | null;
  resetViewToken: number;
  refreshToken: number;
  theme: ThemeName;
  magnetMode: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const maSeriesRef = useRef<Map<number, ISeriesApi<"Line">>>(new Map());
  const symbolRef = useRef(symbol);
  const prevSymbolRef = useRef<string | null>(null);
  const prevTfRef = useRef<string | null>(null);
  const prevOptionsKeyRef = useRef<string | null>(null);
  const prevGotoTimeRef = useRef<string | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const drawingManagerRef = useRef<DrawingManager | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const avwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const avwapAnchorSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const pendingAnchorsRef = useRef<Anchor[]>([]);
  const brushPointsRef = useRef<Anchor[] | null>(null);
  const drawIdRef = useRef(0);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const liveTradesRef = useRef<LiveTrade[]>([]);
  const backtestTradesRef = useRef<BacktestTrade[]>([]);
  const caEventsRef = useRef<CaEvent[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);
  // The header legend's OHLC readout — hoverInfo tracks the crosshair, lastInfo is the
  // fallback shown at rest (most recent bar), matching TradingView's own legend behavior.
  const [hoverInfo, setHoverInfo] = useState<{ candle: Candle; prevClose: number | null } | null>(null);
  const [lastInfo, setLastInfo] = useState<{ candle: Candle; prevClose: number | null } | null>(null);

  // Object tree needs a live view of `drawingManagerRef`'s imperative state (add/remove/
  // lock/select all happen outside React state) — poll while the panel's open rather than
  // threading a refresh callback through every mutation site in the drawing hooks.
  const [objTreeVersion, setObjTreeVersion] = useState(0);
  useEffect(() => {
    if (!showObjectTree) return;
    const id = setInterval(() => setObjTreeVersion((v) => v + 1), 500);
    return () => clearInterval(id);
  }, [showObjectTree]);
  const drawingRows: DrawingRow[] = useMemo(
    () =>
      showObjectTree
        ? (drawingManagerRef.current?.getAllDrawings() ?? []).map((d) => ({
            id: d.id,
            type: d.type,
            locked: !!d.options.locked,
            visible: d.options.visible !== false,
          }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showObjectTree, objTreeVersion]
  );

  function selectDrawingById(id: string) {
    drawingManagerRef.current?.selectDrawing(id);
    setSelectedDrawingId(id);
    refreshHandlePositions(id);
  }
  function toggleDrawingLock(id: string) {
    const d = drawingManagerRef.current?.getDrawing(id);
    if (!d) return;
    d.updateOptions({ locked: !d.options.locked });
    if (drawingManagerRef.current) saveDrawings(symbolRef.current, drawingManagerRef.current);
    chartRef.current?.applyOptions({});
    setObjTreeVersion((v) => v + 1);
  }
  function toggleDrawingVisible(id: string) {
    const d = drawingManagerRef.current?.getDrawing(id);
    if (!d) return;
    d.updateOptions({ visible: d.options.visible === false });
    if (drawingManagerRef.current) saveDrawings(symbolRef.current, drawingManagerRef.current);
    chartRef.current?.applyOptions({});
    setObjTreeVersion((v) => v + 1);
  }
  function removeDrawingById(id: string) {
    drawingManagerRef.current?.removeDrawing(id);
    if (drawingManagerRef.current) saveDrawings(symbolRef.current, drawingManagerRef.current);
    if (selectedDrawingId === id) {
      setSelectedDrawingId(null);
      setHandlePositions([]);
    }
    chartRef.current?.applyOptions({});
    setObjTreeVersion((v) => v + 1);
  }
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  // Mirrors replayIndex for the live-refresh tick effect below, which reads it from inside
  // an async .then() (via a fetch not in its own dependency array) -- a ref avoids a stale
  // closure grabbing whatever replayIndex was at effect-setup time instead of the current one.
  const replayIndexRef = useRef<number | null>(null);
  useEffect(() => {
    replayIndexRef.current = replayIndex;
  }, [replayIndex]);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [editingDrawingId, setEditingDrawingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ anchors: { time: string; price: string }[]; color: string } | null>(
    null
  );
  const [handlePositions, setHandlePositions] = useState<{ x: number; y: number }[]>([]);
  const dragAnchorIndexRef = useRef<number | null>(null);
  const vpPrimitiveRef = useRef<VolumeProfilePrimitive | null>(null);
  const lastCursorPxRef = useRef<{ x: number; y: number } | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const magnetModeRef = useRef(magnetMode);
  magnetModeRef.current = magnetMode;
  const displayedCandlesRef = useRef<Candle[]>([]);

  const { anchorToPixel, hitTestDrawingLine, hitTestOwn, getHandles, refreshHandlePositions } = useDrawingHitTest(
    chartRef,
    seriesRef,
    drawingManagerRef,
    setHandlePositions
  );
  const { pushUndoSnapshot } = useDrawingHistory(
    drawingManagerRef,
    chartRef,
    symbolRef,
    candlesRef,
    drawIdRef,
    selectedDrawingId,
    setSelectedDrawingId,
    setHandlePositions,
    refreshHandlePositions
  );

  useEffect(() => {
    if (!editingDrawingId || !drawingManagerRef.current) {
      setEditForm(null);
      return;
    }
    const d = drawingManagerRef.current.getDrawing(editingDrawingId);
    if (!d) {
      setEditForm(null);
      return;
    }
    setEditForm({
      anchors: d.anchors.map((a) => ({ time: String(a.time), price: String(a.price) })),
      color: d.style.lineColor || "#2962ff",
    });
  }, [editingDrawingId]);

  function applyEditForm() {
    if (!editingDrawingId || !editForm || !drawingManagerRef.current || !chartRef.current) return;
    const d = drawingManagerRef.current.getDrawing(editingDrawingId);
    if (!d) return;
    const parsed = editForm.anchors.map((a) => ({ time: a.time, price: Number(a.price) }));
    if (parsed.some((a) => !a.time || Number.isNaN(a.price))) return;
    pushUndoSnapshot();
    parsed.forEach((a, i) => d.updateAnchor(i, a));
    d.updateStyle({ lineColor: editForm.color });
    saveDrawings(symbolRef.current, drawingManagerRef.current);
    chartRef.current.applyOptions({});
    refreshHandlePositions(editingDrawingId);
    setEditingDrawingId(null);
  }

  // Fit-to-data is the only mode now: autoscale the price axis to only the visible
  // candles' high/low, ignoring drawings entirely (unlike the drawing library's default
  // combined autoscale, which stretches the price axis to fit far-off horizontal
  // lines/fib levels too) — the user only ever wants data-based fit, never drawings.
  function fitPriceToVisibleData() {
    if (!chartRef.current || !seriesRef.current) return;
    const range = chartRef.current.timeScale().getVisibleRange();
    const candles = displayedCandlesRef.current;
    if (!candles.length) return;
    const visible = range
      ? candles.filter((c) => c.time >= (range.from as string) && c.time <= (range.to as string))
      : candles;
    const pool = visible.length ? visible : candles;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of pool) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    const pad = (hi - lo) * 0.08 || hi * 0.01 || 1;
    seriesRef.current.priceScale().setAutoScale(false);
    seriesRef.current.priceScale().setVisibleRange({ from: lo - pad, to: hi + pad });
  }

  function fitPriceToDataIfNeeded() {
    fitPriceToVisibleData();
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const c = chartColors(themeRef.current);
    const chart = createChart(containerRef.current, {
      layout: { background: { color: c.bg }, textColor: c.text },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: { mode: CrosshairMode.Normal },
      // Intraday candle time is a real UTC unix timestamp (the 1-min store is IST-aware,
      // e.g. market open 09:15 IST -> 03:45 UTC). Lightweight Charts renders numeric Time
      // values in UTC by default, so without these formatters the axis showed the session
      // starting around 03:45/04:00 instead of 09:15 -- convert to Asia/Kolkata for display.
      timeScale: {
        borderColor: c.border,
        timeVisible: true,
        secondsVisible: false,
        // Every 15s live-refresh tick calls setData() with a freshly appended intraday bar
        // (see the [symbol, tf, ...refreshToken] effect below). LWC's default here snaps the
        // view back toward the latest bar whenever that happens and the last bar is already
        // visible -- exactly the case right after zooming into recent price action -- which is
        // the "resets to default view every ~15s" behavior this file's own comments already
        // say to avoid for the symbol/tf path. Disable it so a new bar landing never moves the
        // user's pan/zoom.
        shiftVisibleRangeOnNewBar: false,
        tickMarkFormatter: (time: Time) =>
          typeof time === "number" ? formatIstTime(time) : formatDateLabel(String(time)),
      },
      localization: {
        timeFormatter: (time: Time) =>
          typeof time === "number" ? formatIstTime(time, true) : formatDateLabel(String(time)),
      },
      rightPriceScale: { borderColor: c.border },
      autoSize: true,
      // mouse-wheel zoom is handled ourselves below (right edge pinned, TradingView-style,
      // instead of the library's default cursor-centered zoom which feels like a map pan/zoom)
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const manager = new DrawingManager();
    manager.attach(chart, series, containerRef.current);
    drawingManagerRef.current = manager;
    markersPluginRef.current = createSeriesMarkers(series, []);
    const vp = new VolumeProfilePrimitive();
    series.attachPrimitive(vp);
    vpPrimitiveRef.current = vp;
    const onVisibleRangeChange = () => {
      // applyOptions({}) fires on every mousemove while dragging a drawing anchor (to
      // repaint it), and that in turn re-fires this "visible range changed" callback even
      // though the actual time range hasn't moved — recomputing the price fit on every one
      // of those made the whole chart jitter/shake while resizing a shape. Skip it mid-drag;
      // the drag's own onMove already repaints, and the fit still runs once the drag ends.
      if (dragAnchorIndexRef.current !== null) return;
      recomputeVP();
      fitPriceToVisibleData();
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(onVisibleRangeChange);

    // TradingView's own legend OHLC readout: tracks the crosshair, falls back to the most
    // recent bar when the cursor leaves the chart (handled by the lastInfo fallback below,
    // not here — subscribeCrosshairMove fires with an empty param on mouse-leave too).
    const onCrosshairMove = (param: { time?: Time }) => {
      if (!param.time) {
        setHoverInfo(null);
        return;
      }
      const all = displayedCandlesRef.current;
      const idx = all.findIndex((c) => c.time === param.time);
      setHoverInfo(idx >= 0 ? { candle: all[idx], prevClose: idx > 0 ? all[idx - 1].close : null } : null);
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    // TradingView-style wheel zoom: right edge stays pinned and more history reveals on
    // the left, instead of the library's default zoom-toward-cursor ("map" feel).
    const onWheel = (e: WheelEvent) => {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      e.preventDefault();
      const width = range.to - range.from;
      const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
      const newWidth = Math.max(2, width * factor);
      chart.timeScale().setVisibleLogicalRange({ from: range.to - newWidth, to: range.to });
    };
    containerRef.current.addEventListener("wheel", onWheel, { passive: false });

    // always-on cursor tracking (independent of any active drawing tool) so a keyboard
    // shortcut like Alt+H can drop the line at wherever the mouse already is, TradingView-
    // style, instead of requiring a click after the shortcut arms the tool.
    const onCursorMove = (e: MouseEvent) => {
      const rect = containerRef.current!.getBoundingClientRect();
      lastCursorPxRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onCursorLeave = () => {
      lastCursorPxRef.current = null;
    };
    containerRef.current.addEventListener("mousemove", onCursorMove);
    containerRef.current.addEventListener("mouseleave", onCursorLeave);

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onVisibleRangeChange);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      containerRef.current?.removeEventListener("wheel", onWheel);
      containerRef.current?.removeEventListener("mousemove", onCursorMove);
      containerRef.current?.removeEventListener("mouseleave", onCursorLeave);
      series.detachPrimitive(vp);
      manager.detach();
      chart.remove();
      // clear every ref to a series/pane that belonged to this now-disposed chart, so a
      // toggle effect (e.g. Volume, which defaults on) doesn't see a stale non-null ref
      // after React StrictMode's mount->unmount->remount and skip creating a fresh one —
      // that left the series permanently orphaned on the dead chart (invisible), and a
      // later toggle-off tried to remove it from the live chart and crashed.
      volumeSeriesRef.current = null;
      vwapSeriesRef.current = null;
      avwapSeriesRef.current = null;
      avwapAnchorSeriesRef.current = null;
      maSeriesRef.current.clear();
    };
  }, []);

  useDrawingSelection(
    containerRef,
    chartRef,
    seriesRef,
    drawingManagerRef,
    activeDrawingTool,
    selectedDrawingId,
    setSelectedDrawingId,
    setHandlePositions,
    setEditingDrawingId,
    dragAnchorIndexRef,
    magnetModeRef,
    candlesRef,
    symbolRef,
    hitTestOwn,
    hitTestDrawingLine,
    anchorToPixel,
    getHandles,
    refreshHandlePositions,
    pushUndoSnapshot,
    symbol,
    tf
  );

  const { recomputeVP } = useVolumeProfile(
    vpPrimitiveRef,
    chartRef,
    displayedCandlesRef,
    showVRVP,
    periodicMode,
    frvpRanges,
    avpAnchorTime
  );

  useTradeMarkers(
    markersPluginRef,
    liveTradesRef,
    backtestTradesRef,
    caEventsRef,
    symbol,
    showLiveTrades,
    showBacktestTrades,
    backtestExperiment,
    showCaEvents,
    caList
  );

  useEffect(() => {
    if (!symbol || !seriesRef.current) return;
    const isFreshSymbol = prevSymbolRef.current !== symbol;
    // A pure live-refresh tick (same symbol, same tf, only refreshToken bumped)
    // must not fit-to-content -- that would yank the user's zoom/pan back to
    // full history every 15s while they're watching a live intraday chart.
    const isFreshView = isFreshSymbol || prevTfRef.current !== tf;
    // Replay must survive a pure live-refresh tick (refreshToken bump every 15s, see
    // App.tsx) the same way pan/zoom already does -- otherwise a step or a Play session
    // gets silently kicked back to the live/latest candle mid-replay every 15 seconds,
    // regardless of what the user is doing. Only an ACTUAL change of what's on screen
    // (symbol, timeframe, options contract, or an explicit gotoTime jump) should reset it.
    const optionsKey = optionsSelection ? JSON.stringify(optionsSelection) : null;
    const isFreshOptions = prevOptionsKeyRef.current !== optionsKey;
    const isFreshGoto = !!gotoTime && gotoTime !== prevGotoTimeRef.current;
    const shouldResetReplay = isFreshView || isFreshOptions || isFreshGoto;
    if (isFreshSymbol && prevSymbolRef.current !== null && drawingManagerRef.current) {
      saveDrawings(prevSymbolRef.current, drawingManagerRef.current);
      drawingManagerRef.current.clearAll();
    }
    symbolRef.current = symbol;
    prevSymbolRef.current = symbol;
    prevTfRef.current = tf;
    prevOptionsKeyRef.current = optionsKey;
    prevGotoTimeRef.current = gotoTime ?? null;
    const candlesUrl = optionsSelection
      ? `${API_BASE}/api/options/candles?symbol=${encodeURIComponent(optionsSelection.symbol)}&expiry=${optionsSelection.expiry}&instrument=${optionsSelection.instrument}&tf=${tf}` +
        (optionsSelection.strike !== null ? `&strike=${optionsSelection.strike}` : "") +
        (optionsSelection.optionType ? `&option_type=${optionsSelection.optionType}` : "")
      : `${API_BASE}/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`;
    setDataError(null);
    fetch(candlesUrl)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.detail || `No data for ${symbol}`);
        }
        const candles: Candle[] = await r.json();
        if (candles.length === 0) throw new Error(`No candles for ${symbol} at this timeframe`);
        return candles;
      })
      .then((candles: Candle[]) => {
        candlesRef.current = candles;
        // A pure live-refresh tick landing mid-replay must keep showing the same truncated
        // slice it was showing before -- otherwise the full/latest candle set momentarily
        // flashes onto the chart every 15s (see shouldResetReplay above) even though
        // replayIndex itself isn't being reset. Re-derive the same slice the [replayIndex]
        // effect below would produce, from the (possibly just-updated) live data.
        const stillReplaying = !shouldResetReplay && replayIndexRef.current !== null;
        const slice = stillReplaying ? candles.slice(0, replayIndexRef.current! + 1) : candles;
        displayedCandlesRef.current = slice;
        const n = slice.length;
        setLastInfo(n > 0 ? { candle: slice[n - 1], prevClose: n > 1 ? slice[n - 2].close : null } : null);
        setHoverInfo(null);
        seriesRef.current?.setData(
          slice.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close }))
        );
        for (const [period, series] of maSeriesRef.current) {
          series.setData(movingAverage(slice, period));
        }
        if (vwapSeriesRef.current) vwapSeriesRef.current.setData(vwapFrom(slice, 0));
        if (volumeSeriesRef.current) volumeSeriesRef.current.setData(volumeBars(slice));
        onAvwapClear();
        if (shouldResetReplay) {
          setReplayIndex(null);
          setIsReplayPlaying(false);
        }
        if (isFreshSymbol && drawingManagerRef.current) {
          drawingManagerRef.current.importDrawings(loadDrawings(symbol), drawingFactory);
        }
        if (isFreshView && chartRef.current) applyDefaultView(chartRef.current, slice, tf);
        // A CA-review jump: center the view on the ex-date instead of the usual
        // fit-to-all-history, so the split/bonus gap is what's on screen.
        if (gotoTime && typeof candles[0]?.time === "string") {
          const target = new Date(gotoTime + "T00:00:00Z");
          const from = new Date(target);
          from.setUTCDate(from.getUTCDate() - 150);
          const to = new Date(target);
          to.setUTCDate(to.getUTCDate() + 60);
          chartRef.current?.timeScale().setVisibleRange({
            from: from.toISOString().slice(0, 10),
            to: to.toISOString().slice(0, 10),
          } as { from: Time; to: Time });
        }
        recomputeVP();
        chartRef.current?.applyOptions({});
        fitPriceToDataIfNeeded();
      })
      .catch((err) => {
        console.error(err);
        setDataError("Data missing at this timeframe — try a higher timeframe.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf, optionsSelection, refreshToken, gotoTime]);

  const didMountResetRef = useRef(false);
  useEffect(() => {
    if (!didMountResetRef.current) {
      didMountResetRef.current = true;
      return;
    }
    const chart = chartRef.current;
    const candles = candlesRef.current;
    if (!chart || !candles.length) return;
    applyDefaultView(chart, candles, tf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetViewToken]);

  useEffect(() => {
    if (!chartRef.current) return;
    const c = chartColors(theme);
    chartRef.current.applyOptions({
      layout: { background: { color: c.bg }, textColor: c.text },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      timeScale: { borderColor: c.border },
      rightPriceScale: { borderColor: c.border },
    });
  }, [theme]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (showVWAP && !vwapSeriesRef.current) {
      const series = chartRef.current.addSeries(LineSeries, { color: "#00bcd4", lineWidth: 2 });
      if (displayedCandlesRef.current.length) series.setData(vwapFrom(displayedCandlesRef.current, 0));
      vwapSeriesRef.current = series;
    } else if (!showVWAP && vwapSeriesRef.current) {
      chartRef.current.removeSeries(vwapSeriesRef.current);
      vwapSeriesRef.current = null;
    }
  }, [showVWAP]);

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    if (showVolume && !volumeSeriesRef.current) {
      const series = chartRef.current.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      series.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      seriesRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.3 } });
      if (displayedCandlesRef.current.length) series.setData(volumeBars(displayedCandlesRef.current));
      volumeSeriesRef.current = series;
    } else if (!showVolume && volumeSeriesRef.current) {
      chartRef.current.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
      seriesRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
    }
  }, [showVolume]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!avwapAnchorTime) {
      if (avwapSeriesRef.current) {
        chartRef.current.removeSeries(avwapSeriesRef.current);
        avwapSeriesRef.current = null;
      }
      if (avwapAnchorSeriesRef.current) {
        chartRef.current.removeSeries(avwapAnchorSeriesRef.current);
        avwapAnchorSeriesRef.current = null;
      }
      return;
    }
    const startIdx = displayedCandlesRef.current.findIndex((c) => c.time === avwapAnchorTime);
    if (startIdx < 0) return;
    const data = vwapFrom(displayedCandlesRef.current, startIdx);
    if (!avwapSeriesRef.current) {
      avwapSeriesRef.current = chartRef.current.addSeries(LineSeries, {
        color: "#e91e63",
        lineWidth: 2,
        lineStyle: 2,
        title: "AVWAP",
      });
    }
    avwapSeriesRef.current.setData(data);
  }, [avwapAnchorTime]);

  useEffect(() => {
    if (!chartRef.current || !avwapArmed) return;
    const handler = (param: { time?: Time }) => {
      if (!param.time) return;
      onAvwapAnchorSet(String(param.time));
    };
    chartRef.current.subscribeClick(handler);
    return () => chartRef.current?.unsubscribeClick(handler);
  }, [avwapArmed, onAvwapAnchorSet]);

  useEffect(() => {
    if (!chartRef.current || !avpArmed) return;
    const handler = (param: { time?: Time }) => {
      if (!param.time) return;
      onAvpAnchorSet(String(param.time));
    };
    chartRef.current.subscribeClick(handler);
    return () => chartRef.current?.unsubscribeClick(handler);
  }, [avpArmed, onAvpAnchorSet]);

  useEffect(() => {
    if (!chartRef.current || !replayArmed) return;
    const handler = (param: { time?: Time }) => {
      if (!param.time) return;
      const idx = candlesRef.current.findIndex((c) => c.time === String(param.time));
      if (idx < 0) return;
      setReplayIndex(idx);
      onReplayArmedConsumed();
    };
    chartRef.current.subscribeClick(handler);
    return () => chartRef.current?.unsubscribeClick(handler);
  }, [replayArmed, onReplayArmedConsumed]);

  useEffect(() => {
    onReplayActiveChange(replayIndex !== null);
  }, [replayIndex, onReplayActiveChange]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    const all = candlesRef.current;
    const slice = replayIndex === null ? all : all.slice(0, replayIndex + 1);
    displayedCandlesRef.current = slice;
    const n = slice.length;
    setLastInfo(n > 0 ? { candle: slice[n - 1], prevClose: n > 1 ? slice[n - 2].close : null } : null);
    seriesRef.current.setData(
      slice.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close }))
    );
    for (const [period, series] of maSeriesRef.current) {
      series.setData(movingAverage(slice, period));
    }
    if (vwapSeriesRef.current) vwapSeriesRef.current.setData(vwapFrom(slice, 0));
    if (volumeSeriesRef.current) volumeSeriesRef.current.setData(volumeBars(slice));
    chartRef.current.applyOptions({});
    fitPriceToDataIfNeeded();
    recomputeVP();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayIndex]);

  useEffect(() => {
    if (!isReplayPlaying) return;
    const id = setInterval(() => {
      setReplayIndex((i) => {
        const all = candlesRef.current;
        if (i === null) return i;
        const next = i + 1;
        if (next >= all.length - 1) {
          setIsReplayPlaying(false);
          return all.length - 1;
        }
        return next;
      });
    }, 1000 / replaySpeed);
    return () => clearInterval(id);
  }, [isReplayPlaying, replaySpeed]);

  useEffect(() => {
    if (!containerRef.current || !chartRef.current || !frvpArmed) return;
    const container = containerRef.current;
    const chart = chartRef.current;
    let startTime: string | null = null;

    const timeAt = (e: MouseEvent): string | null => {
      const rect = container.getBoundingClientRect();
      const t = chart.timeScale().coordinateToTime(e.clientX - rect.left);
      return t !== null ? String(t) : null;
    };

    const onDown = (e: MouseEvent) => {
      startTime = timeAt(e);
    };
    const onUp = (e: MouseEvent) => {
      if (!startTime) return;
      const endTime = timeAt(e) ?? startTime;
      const [a, b] = startTime <= endTime ? [startTime, endTime] : [endTime, startTime];
      startTime = null;
      onFrvpRangeAdd([a, b]);
      onToolConsumed();
    };
    container.addEventListener("mousedown", onDown);
    container.addEventListener("mouseup", onUp);
    return () => {
      container.removeEventListener("mousedown", onDown);
      container.removeEventListener("mouseup", onUp);
    };
  }, [frvpArmed, onFrvpRangeAdd, onToolConsumed]);

  useDrawingToolCreation(
    containerRef,
    chartRef,
    seriesRef,
    drawingManagerRef,
    activeDrawingTool,
    onToolConsumed,
    magnetModeRef,
    candlesRef,
    drawIdRef,
    symbolRef,
    lastCursorPxRef,
    pendingAnchorsRef,
    brushPointsRef,
    pushUndoSnapshot
  );

  useEffect(() => {
    if (!chartRef.current) return;
    const bgHex = chartColors(theme).bg;
    for (const period of MA_PERIODS) {
      const want = activeIndicators.has(period);
      const have = maSeriesRef.current.has(period);
      if (want && !have) {
        const series = chartRef.current.addSeries(LineSeries, {
          color: ensureContrast(MA_COLORS[period], bgHex),
          lineWidth: 2,
        });
        if (displayedCandlesRef.current.length) series.setData(movingAverage(displayedCandlesRef.current, period));
        maSeriesRef.current.set(period, series);
      } else if (want && have) {
        // Already on screen -- just recolor for the new theme rather than tearing
        // down and re-adding (which would also needlessly re-set its data).
        maSeriesRef.current.get(period)!.applyOptions({ color: ensureContrast(MA_COLORS[period], bgHex) });
      } else if (!want && have) {
        chartRef.current.removeSeries(maSeriesRef.current.get(period)!);
        maSeriesRef.current.delete(period);
      }
    }
  }, [activeIndicators, theme]);

  const replayBtn: React.CSSProperties = {
    background: "var(--bg-panel)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "6px 12px",
    fontSize: 13,
    cursor: "pointer",
  };

  const selectedDrawing = selectedDrawingId ? drawingManagerRef.current?.getDrawing(selectedDrawingId) : null;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex" }}>
    <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {dataError && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 4,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "10px 18px",
            color: "var(--text-dim)",
            fontSize: 13,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {dataError}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 3,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          pointerEvents: "none",
        }}
      >
        {symbol &&
          (() => {
            const info = hoverInfo ?? lastInfo;
            const up = info ? info.candle.close >= info.candle.open : true;
            const color = info ? (up ? "var(--up)" : "var(--down)") : "var(--text)";
            const change = info && info.prevClose != null ? info.candle.close - info.prevClose : null;
            const changePct = change != null && info!.prevClose ? (change / info!.prevClose) * 100 : null;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, color: "var(--text)" }}>{symbol}</span>
                <span style={{ color: "var(--text-dim)" }}>{tf}</span>
                {info && (
                  <>
                    <span style={{ color }}>
                      O <b>{info.candle.open.toFixed(2)}</b>
                    </span>
                    <span style={{ color }}>
                      H <b>{info.candle.high.toFixed(2)}</b>
                    </span>
                    <span style={{ color }}>
                      L <b>{info.candle.low.toFixed(2)}</b>
                    </span>
                    <span style={{ color }}>
                      C <b>{info.candle.close.toFixed(2)}</b>
                    </span>
                    {change != null && (
                      <span style={{ color }}>
                        {change >= 0 ? "+" : ""}
                        {change.toFixed(2)} ({changePct!.toFixed(2)}%)
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })()}
      </div>
      {handlePositions.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: p.x - 5,
            top: p.y - 5,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--bg)",
            border: "2px solid var(--accent)",
            pointerEvents: "none",
            zIndex: 4,
          }}
        />
      ))}
      {selectedDrawing && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "flex",
            gap: 4,
            zIndex: 5,
          }}
        >
          <button
            onClick={() => {
              const locked = !selectedDrawing.options.locked;
              selectedDrawing.updateOptions({ locked });
              if (drawingManagerRef.current) saveDrawings(symbolRef.current, drawingManagerRef.current);
              chartRef.current?.applyOptions({});
            }}
            style={{
              background: selectedDrawing.options.locked ? "var(--accent)" : "var(--bg-panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {selectedDrawing.options.locked ? "🔒 Locked" : "🔓 Lock"}
          </button>
        </div>
      )}
      {replayIndex !== null && (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--bg-panel)ee",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "6px 10px",
            zIndex: 5,
          }}
        >
          <button
            style={replayBtn}
            onClick={() => setReplayIndex((i) => (i === null ? i : Math.max(0, i - 1)))}
            title="Step back"
          >
            |◀
          </button>
          <button
            style={{ ...replayBtn, background: "var(--accent)" }}
            onClick={() => setIsReplayPlaying((p) => !p)}
          >
            {isReplayPlaying ? "Pause" : "Play"}
          </button>
          <button
            style={replayBtn}
            onClick={() =>
              setReplayIndex((i) => (i === null ? i : Math.min(candlesRef.current.length - 1, i + 1)))
            }
            title="Step forward"
          >
            ▶|
          </button>
          <select
            value={replaySpeed}
            onChange={(e) => setReplaySpeed(Number(e.target.value))}
            style={{ ...replayBtn, padding: "6px 6px" }}
          >
            {[0.5, 1, 2, 4, 8].map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
            {replayIndex + 1} / {candlesRef.current.length}
          </span>
          <button
            style={replayBtn}
            onClick={() => {
              setIsReplayPlaying(false);
              setReplayIndex(null);
            }}
            title="Exit replay"
          >
            ✕
          </button>
        </div>
      )}
      {editingDrawingId && editForm && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setEditingDrawingId(null)} />
          <div
            style={{
              position: "relative",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 16,
              minWidth: 280,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Edit drawing</div>
            {editForm.anchors.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-dim)", width: 50 }}>
                  {editForm.anchors.length > 1 ? `Point ${i + 1}` : "Position"}
                </span>
                <input
                  type="date"
                  value={a.time}
                  onChange={(e) => {
                    const anchors = editForm.anchors.slice();
                    anchors[i] = { ...anchors[i], time: e.target.value };
                    setEditForm({ ...editForm, anchors });
                  }}
                  style={{
                    background: "var(--bg)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "4px 6px",
                    fontSize: 12,
                  }}
                />
                <input
                  type="number"
                  step="any"
                  value={a.price}
                  onChange={(e) => {
                    const anchors = editForm.anchors.slice();
                    anchors[i] = { ...anchors[i], price: e.target.value };
                    setEditForm({ ...editForm, anchors });
                  }}
                  style={{
                    background: "var(--bg)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "4px 6px",
                    fontSize: 12,
                    width: 100,
                  }}
                />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--text-dim)", width: 50 }}>Color</span>
              <input
                type="color"
                value={editForm.color}
                onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                style={{ width: 40, height: 26, padding: 0, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button
                onClick={() => setEditingDrawingId(null)}
                style={{
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  padding: "5px 12px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={applyEditForm}
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  border: "none",
                  borderRadius: 4,
                  padding: "5px 12px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
      {showObjectTree && (
        <ObjectTreePanel
          symbol={symbol}
          tf={tf}
          drawings={drawingRows}
          onSelectDrawing={selectDrawingById}
          onToggleDrawingLock={toggleDrawingLock}
          onToggleDrawingVisible={toggleDrawingVisible}
          onRemoveDrawing={removeDrawingById}
        />
      )}
    </div>
  );
}
