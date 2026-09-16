import { useEffect } from "react";
import type { RefObject } from "react";
import type { ISeriesMarkersPluginApi, SeriesMarker, Time } from "lightweight-charts";
import { API_BASE, type LiveTrade, type BacktestTrade, type CaEvent } from "./lib";

const CA_MARKER_COLOR: Record<string, string> = {
  confirmed_missed: "#ef5350",
  already_adjusted: "#26a69a",
  unclear: "#f6c343",
  "": "#8a8fa3",
};

// Live-trade, backtest-trade, and CA-event markers on the price series — independent
// fetches (live trades keyed on symbol, backtest trades keyed on symbol + experiment,
// CA events keyed on symbol) that all funnel into one combined marker render whenever
// any of them changes.
export function useTradeMarkers(
  markersPluginRef: RefObject<ISeriesMarkersPluginApi<Time> | null>,
  liveTradesRef: RefObject<LiveTrade[]>,
  backtestTradesRef: RefObject<BacktestTrade[]>,
  caEventsRef: RefObject<CaEvent[]>,
  symbol: string,
  showLiveTrades: boolean,
  showBacktestTrades: boolean,
  backtestExperiment: string,
  showCaEvents: boolean,
  caList: "nse" | "bse" | "nse2"
) {
  function renderTradeMarkers() {
    if (!markersPluginRef.current) return;
    const markers: SeriesMarker<Time>[] = [];
    if (showLiveTrades) {
      for (const t of liveTradesRef.current) {
        const isBuy = t.action.toUpperCase() === "BUY";
        markers.push({
          time: t.time as Time,
          position: isBuy ? "belowBar" : "aboveBar",
          color: isBuy ? "#26a69a" : "#ef5350",
          shape: isBuy ? "arrowUp" : "arrowDown",
          text: `${t.action} ${t.quantity}@${t.price}`,
        });
      }
    }
    if (showBacktestTrades) {
      for (const t of backtestTradesRef.current) {
        markers.push({
          time: t.entryTime as Time,
          position: "belowBar",
          color: "#26a69a",
          shape: "arrowUp",
          text: `BUY ${t.entryPrice}`,
        });
        markers.push({
          time: t.exitTime as Time,
          position: "aboveBar",
          color: t.pnl >= 0 ? "#26a69a" : "#ef5350",
          shape: "arrowDown",
          text: `SELL ${t.exitPrice} (${t.exitReason})`,
        });
      }
    }
    if (showCaEvents) {
      for (const e of caEventsRef.current) {
        markers.push({
          time: e.time as Time,
          position: "aboveBar",
          color: CA_MARKER_COLOR[e.decision] ?? CA_MARKER_COLOR[""],
          shape: "circle",
          text: `CA ${e.eventRatio} ${e.purpose}`.slice(0, 40),
        });
      }
    }
    markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    markersPluginRef.current.setMarkers(markers);
  }

  // Each effect below can outlive the symbol it was fetched for — flipping through
  // symbols fast (e.g. the CA-review Prev/Next) fires a new fetch before the old one
  // resolves, and with no guard a slow, stale response landed *after* the fresh one
  // silently overwrites it with the wrong symbol's data. `cancelled` makes each
  // fetch a no-op once its own effect has been superseded.
  useEffect(() => {
    if (!symbol) return;
    if (!showLiveTrades) {
      liveTradesRef.current = [];
      renderTradeMarkers();
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/api/trades/live?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((trades: LiveTrade[]) => {
        if (cancelled) return;
        liveTradesRef.current = trades;
        renderTradeMarkers();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, showLiveTrades]);

  useEffect(() => {
    if (!symbol) return;
    if (!showBacktestTrades || !backtestExperiment) {
      backtestTradesRef.current = [];
      renderTradeMarkers();
      return;
    }
    let cancelled = false;
    fetch(
      `${API_BASE}/api/trades/backtest?symbol=${encodeURIComponent(symbol)}&experiment=${encodeURIComponent(backtestExperiment)}`
    )
      .then((r) => r.json())
      .then((trades: BacktestTrade[]) => {
        if (cancelled) return;
        backtestTradesRef.current = trades;
        renderTradeMarkers();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, showBacktestTrades, backtestExperiment]);

  useEffect(() => {
    if (!symbol) return;
    if (!showCaEvents) {
      caEventsRef.current = [];
      renderTradeMarkers();
      return;
    }
    let cancelled = false;
    // Clear immediately rather than leaving the previous symbol's markers on
    // screen until the new fetch resolves — a brief empty state reads better
    // than a wrong one.
    caEventsRef.current = [];
    renderTradeMarkers();
    fetch(`${API_BASE}/api/ca_events?symbol=${encodeURIComponent(symbol)}&list=${caList}`)
      .then((r) => r.json())
      .then((events: CaEvent[]) => {
        if (cancelled) return;
        caEventsRef.current = events;
        renderTradeMarkers();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, showCaEvents, caList]);
}
