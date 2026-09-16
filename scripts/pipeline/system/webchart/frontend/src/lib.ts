import {
  DrawingManager,
  TrendLine,
  Rectangle,
  Brush,
  HorizontalLine,
  HorizontalRay,
  VerticalLine,
  CrossLine,
  ParallelChannel,
  FibRetracement,
  FibExtension,
  FibChannel,
  FibCircles,
  FibSpeedFan,
  FibTimeZone,
  LongPosition,
  ShortPosition,
  TextAnnotation,
  Note,
  type Anchor,
  type Drawing,
  type IDrawing,
  type SerializedDrawing,
} from "lightweight-charts-drawing";
import type { Time } from "lightweight-charts";
import { computeVolumeProfile, type VPBlock } from "./volumeProfile";

export type DrawingCtor = new (id: string, anchors: Anchor[]) => Drawing;

export type ThemeName = "dark" | "light";

// mirrors the CSS custom properties in index.css — the chart canvas needs literal
// hex (lightweight-charts doesn't reliably resolve var() in every browser), while
// the rest of the UI reads the CSS variables directly for live theme switching.
export function chartColors(theme: ThemeName) {
  return theme === "light"
    ? { bg: "#f7f8fa", grid: "#818aa2", border: "#7a818f", text: "#131722" }
    : { bg: "#131722", grid: "#5c6884", border: "#2a2e39", text: "#d1d4dc" };
}

// --- WCAG-aware indicator/plot coloring -------------------------------------
// MA_COLORS is picked assuming a dark background. ensureContrast() adapts it
// (and re-colors already-rendered MA lines) when switching to light theme —
// see the [activeIndicators, theme] effect in Chart.tsx.
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// sRGB -> HSL, standard formulas.
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

// WCAG relative luminance + contrast ratio (same formula DMA WMA Master's own
// f_lum uses server-side for its dashboard palette).
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(...hexToRgb(hexA));
  const lb = relativeLuminance(...hexToRgb(hexB));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Nudges `hex`'s lightness toward whichever end (brighter/darker) increases
// contrast against `bgHex`, stopping once it clears `minRatio` (WCAG 1.4.11's
// 3:1 minimum for graphical objects) or hitting a sane lightness bound --
// hue/saturation are preserved, so a color still reads as "the same color",
// just light or dark enough to actually be visible on the current theme.
export function ensureContrast(hex: string, bgHex: string, minRatio = 3): string {
  if (!/^#[0-9a-fA-F]{3,6}$/.test(hex)) return hex;
  if (contrastRatio(hex, bgHex) >= minRatio) return hex;
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const bgLum = relativeLuminance(...hexToRgb(bgHex));
  const lighten = bgLum < 0.5; // dark background -> brighten the color, and vice versa
  let bestHex = hex;
  let bestRatio = contrastRatio(hex, bgHex);
  for (let step = 1; step <= 18; step++) {
    const dl = (lighten ? 1 : -1) * step * 0.05;
    const nl = Math.max(0.04, Math.min(0.96, l + dl));
    const candidate = rgbToHex(...hslToRgb(h, s, nl));
    const ratio = contrastRatio(candidate, bgHex);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestHex = candidate;
    }
    if (ratio >= minRatio) return candidate;
  }
  return bestHex;
}

export const CLICK_TOOLS: Record<
  string,
  {
    ToolClass: DrawingCtor;
    anchors: number;
    label: string;
    group: string;
    needsText?: boolean;
    instantPlace?: "long" | "short";
  }
> = {
  "trend-line": { ToolClass: TrendLine, anchors: 2, label: "Line", group: "Lines" },
  "horizontal-line": { ToolClass: HorizontalLine, anchors: 1, label: "H-Line", group: "Lines" },
  "horizontal-ray": { ToolClass: HorizontalRay, anchors: 1, label: "H-Ray", group: "Lines" },
  "vertical-line": { ToolClass: VerticalLine, anchors: 1, label: "V-Line", group: "Lines" },
  "cross-line": { ToolClass: CrossLine, anchors: 1, label: "Cross", group: "Lines" },
  rectangle: { ToolClass: Rectangle, anchors: 2, label: "Box", group: "Shapes" },
  "parallel-channel": { ToolClass: ParallelChannel, anchors: 3, label: "Channel", group: "Shapes" },
  "fib-retracement": { ToolClass: FibRetracement, anchors: 2, label: "Fib Retr.", group: "Fibonacci" },
  "fib-extension": { ToolClass: FibExtension, anchors: 3, label: "Fib Ext.", group: "Fibonacci" },
  "fib-channel": { ToolClass: FibChannel, anchors: 3, label: "Fib Channel", group: "Fibonacci" },
  "fib-circles": { ToolClass: FibCircles, anchors: 2, label: "Fib Circles", group: "Fibonacci" },
  "fib-speed-fan": { ToolClass: FibSpeedFan, anchors: 2, label: "Fib Speed Fan", group: "Fibonacci" },
  "fib-time-zone": { ToolClass: FibTimeZone, anchors: 2, label: "Fib Time Zone", group: "Fibonacci" },
  // TradingView's "Long position"/"Short position" — one click drops a default 1:2 R:R
  // box (entry/stop/target anchors computed in useDrawingToolCreation), then all three
  // knobs drag-adjust independently via the normal anchor-handle system.
  "long-position": {
    ToolClass: LongPosition,
    anchors: 3,
    label: "Long Position",
    group: "Trading",
    instantPlace: "long",
  },
  "short-position": {
    ToolClass: ShortPosition,
    anchors: 3,
    label: "Short Position",
    group: "Trading",
    instantPlace: "short",
  },
  // Text/Note — single anchor, but need a text value at creation time; needsText tells
  // useDrawingToolCreation to prompt for it before arming.
  text: { ToolClass: TextAnnotation, anchors: 1, label: "Text", group: "Text", needsText: true },
  note: { ToolClass: Note, anchors: 1, label: "Note", group: "Text", needsText: true },
};

export const DRAWING_GROUPS = ["Lines", "Shapes", "Fibonacci", "Trading", "Text"] as const;

export const VP_COLORS = {
  vrvp: { bar: "rgba(0,188,212,0.35)", poc: "rgba(0,188,212,0.85)" },
  periodic: { bar: "rgba(156,39,176,0.30)", poc: "rgba(156,39,176,0.8)" },
  frvp: { bar: "rgba(255,152,0,0.35)", poc: "rgba(255,152,0,0.85)" },
  avp: { bar: "rgba(76,175,80,0.30)", poc: "rgba(76,175,80,0.8)" },
};

export type PeriodicMode = "off" | "D" | "W" | "M";

export function periodKey(dateStr: string, mode: PeriodicMode): string {
  const d = new Date(dateStr + "T00:00:00Z");
  if (mode === "D") return dateStr;
  if (mode === "M") return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  // week bucket: Monday-start ISO week key
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day);
  return monday.toISOString().slice(0, 10);
}

export function buildPeriodicBlocks(candles: Candle[], mode: PeriodicMode): VPBlock[] {
  if (mode === "off" || candles.length === 0) return [];
  const groups = new Map<string, Candle[]>();
  for (const c of candles) {
    const key = periodKey(String(c.time), mode);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const blocks: VPBlock[] = [];
  for (const [key, group] of groups) {
    blocks.push({
      id: `periodic-${key}`,
      startTime: group[0].time as Time,
      endTime: group[group.length - 1].time as Time,
      profile: computeVolumeProfile(group, 12),
      color: VP_COLORS.periodic.bar,
      pocColor: VP_COLORS.periodic.poc,
    });
  }
  return blocks;
}

export const ALL_TOOL_CLASSES: Record<string, DrawingCtor> = {
  ...Object.fromEntries(Object.entries(CLICK_TOOLS).map(([id, t]) => [id, t.ToolClass])),
  brush: Brush as unknown as DrawingCtor,
};

export function drawingsStorageKey(symbol: string) {
  return `webchart:drawings:${symbol}`;
}

export function loadDrawings(symbol: string): SerializedDrawing[] {
  try {
    const raw = localStorage.getItem(drawingsStorageKey(symbol));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveDrawings(symbol: string, manager: DrawingManager) {
  try {
    localStorage.setItem(drawingsStorageKey(symbol), JSON.stringify(manager.exportDrawings()));
  } catch {
    /* ignore quota errors */
  }
}

export function drawingFactory(type: string, data: SerializedDrawing): IDrawing | null {
  const Ctor = ALL_TOOL_CLASSES[type];
  if (!Ctor) return null;
  const d = new Ctor(data.id, data.anchors);
  d.updateStyle(data.style);
  d.updateOptions(data.options);
  return d;
}

export type AppState = {
  symbol: string;
  tf: Timeframe;
  activeIndicators: number[];
  showVWAP: boolean;
  showVolume: boolean;
  magnetMode: boolean;
};

export function loadTheme(): ThemeName {
  try {
    const saved = localStorage.getItem("webchart:theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function loadAppState(): Partial<AppState> {
  try {
    const raw = localStorage.getItem("webchart:appState");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveAppState(state: AppState) {
  try {
    localStorage.setItem("webchart:appState", JSON.stringify(state));
  } catch {
    /* ignore quota errors */
  }
}

export const API_BASE = "http://localhost:8512";

// "D"/"W"/"M", or any digit string ("1", "5", "15", "75", "240"...) meaning that many
// minutes — TradingView-style numeric-typing shortcut resolves to one of these.
export type Timeframe = string;

// TradingView-style watchlists: named lists of symbols, plus a global color "flag" per
// symbol (independent of which list it's in — flagging a symbol in one watchlist shows
// the same colored dot everywhere it appears, matching TV's own behavior).
export type Watchlist = { id: string; name: string; symbols: string[] };

export function loadWatchlists(): Watchlist[] {
  try {
    const raw = localStorage.getItem("webchart:watchlists");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveWatchlists(list: Watchlist[]) {
  try {
    localStorage.setItem("webchart:watchlists", JSON.stringify(list));
  } catch {
    /* ignore quota errors */
  }
}

export function loadActiveWatchlistId(): string | null {
  try {
    return localStorage.getItem("webchart:activeWatchlistId");
  } catch {
    return null;
  }
}

export function saveActiveWatchlistId(id: string) {
  try {
    localStorage.setItem("webchart:activeWatchlistId", id);
  } catch {
    /* ignore quota errors */
  }
}

export type SymbolFlags = Record<string, string>;

export function loadSymbolFlags(): SymbolFlags {
  try {
    const raw = localStorage.getItem("webchart:symbolFlags");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveSymbolFlags(flags: SymbolFlags) {
  try {
    localStorage.setItem("webchart:symbolFlags", JSON.stringify(flags));
  } catch {
    /* ignore quota errors */
  }
}

// TradingView's own watchlist flag palette (red/orange/yellow/green/cyan/blue/purple/gray).
export const FLAG_COLORS = [
  "#ef5350",
  "#ff9800",
  "#ffd600",
  "#66bb6a",
  "#26c6da",
  "#5c6bc0",
  "#ab47bc",
  "#9e9e9e",
];

export type LiveTrade = { time: string; action: string; price: number; quantity: number; notes: string };
export type CaEvent = {
  time: string;
  purpose: string;
  eventRatio: string;
  ratioMatch: string; // "YES" | "NO" | ""
  decision: string; // "" | "confirmed_missed" | "already_adjusted" | "unclear"
};
export type BacktestTrade = {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  rMultiple: number | null;
  exitReason: string;
};

// The single "jump the chart to a symbol+date" contract -- CA review, backtest
// trade drill-down, and research study results all resolve to this same shape
// via /api/poi/sources + /api/poi/rows, so one panel (PoiPanel) browses all
// three instead of each having its own bespoke picker.
export type PoiSource = { id: string; label: string; kind: "ca" | "backtest" | "poi" };
export function poiSourceKind(sourceId: string): PoiSource["kind"] {
  if (sourceId.startsWith("ca:")) return "ca";
  if (sourceId.startsWith("backtest:")) return "backtest";
  return "poi";
}
export type PoiRow = {
  id: string;
  symbol: string;
  date: string;
  endDate: string | null;
  label: string | null;
  side: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  pnl: number | null;
  rMultiple: number | null;
  tag: string | null;
  notes: string | null;
};
// A row as returned by /api/poi/search -- same shape plus which source it
// came from, since one search spans every CSV at once.
export type PoiSearchRow = PoiRow & { sourceId: string; sourceLabel: string };

export type Candle = {
  time: string | number; // number (UNIX seconds) for intraday tf="1", ISO date string otherwise
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// Magnet mode: latch a drawing anchor onto the nearest OHLC value of its bar,
// TradingView-style, instead of the free cursor price.
export function snapAnchorToOHLC(anchor: Anchor, candles: Candle[]): Anchor {
  const candle = candles.find((c) => c.time === anchor.time);
  if (!candle) return anchor;
  const options = [candle.open, candle.high, candle.low, candle.close];
  let best = options[0];
  let bestDist = Math.abs(anchor.price - best);
  for (const v of options) {
    const d = Math.abs(anchor.price - v);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return { time: anchor.time, price: best };
}

export const MA_PERIODS = [50, 200] as const;
export const MA_COLORS: Record<number, string> = { 50: "#2196f3", 200: "#9c27b0" };

export function movingAverage(candles: Candle[], period: number) {
  const out: { time: Time; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time as Time, value: sum / period });
  }
  return out;
}

export function volumeBars(candles: Candle[]) {
  return candles.map((c) => ({
    time: c.time as Time,
    value: c.volume,
    color: c.close >= c.open ? "rgba(38, 166, 154, 0.5)" : "rgba(239, 83, 80, 0.5)",
  }));
}

export function vwapFrom(candles: Candle[], startIdx: number) {
  const out: { time: Time; value: number }[] = [];
  let cumPV = 0;
  let cumVol = 0;
  for (let i = startIdx; i < candles.length; i++) {
    const c = candles[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPV += typicalPrice * c.volume;
    cumVol += c.volume;
    if (cumVol > 0) out.push({ time: c.time as Time, value: cumPV / cumVol });
  }
  return out;
}
