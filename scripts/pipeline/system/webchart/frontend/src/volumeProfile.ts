import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

export type Candle = { time: string | number; open: number; high: number; low: number; close: number; volume: number };

export type PriceBin = { priceLow: number; priceHigh: number; volume: number };
export type Profile = { bins: PriceBin[]; maxVolume: number; pocIndex: number };

export function computeVolumeProfile(candles: Candle[], bins = 24): Profile {
  if (candles.length === 0) return { bins: [], maxVolume: 0, pocIndex: -1 };

  let priceLow = Infinity;
  let priceHigh = -Infinity;
  for (const c of candles) {
    if (c.low < priceLow) priceLow = c.low;
    if (c.high > priceHigh) priceHigh = c.high;
  }
  if (priceHigh <= priceLow) priceHigh = priceLow + 1;

  const bucketSize = (priceHigh - priceLow) / bins;
  const volumes = new Array(bins).fill(0);
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    let idx = Math.floor((typical - priceLow) / bucketSize);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    volumes[idx] += c.volume;
  }

  let maxVolume = 0;
  let pocIndex = 0;
  const outBins: PriceBin[] = volumes.map((v: number, i: number) => {
    if (v > maxVolume) {
      maxVolume = v;
      pocIndex = i;
    }
    return { priceLow: priceLow + i * bucketSize, priceHigh: priceLow + (i + 1) * bucketSize, volume: v };
  });

  return { bins: outBins, maxVolume, pocIndex };
}

export type VPBlock = {
  id: string;
  startTime: Time;
  endTime: Time | null; // null = extend to right edge of visible area (e.g. anchored-to-now)
  profile: Profile;
  color: string;
  pocColor: string;
};

export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private _blocks: VPBlock[] = [];
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<"Candlestick", Time> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _view = new VPPaneView(this);

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series as ISeriesApi<"Candlestick", Time>;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._chart = null;
    this._series = null;
  }

  updateAllViews(): void {}

  paneViews(): IPrimitivePaneView[] {
    return [this._view];
  }

  setBlocks(blocks: VPBlock[]): void {
    this._blocks = blocks;
    this._requestUpdate?.();
  }

  getBlocks(): VPBlock[] {
    return this._blocks;
  }

  getChart(): IChartApi | null {
    return this._chart;
  }

  getSeries(): ISeriesApi<"Candlestick", Time> | null {
    return this._series;
  }
}

class VPPaneView implements IPrimitivePaneView {
  private _source: VolumeProfilePrimitive;
  constructor(_source: VolumeProfilePrimitive) {
    this._source = _source;
  }
  renderer(): IPrimitivePaneRenderer {
    return new VPRenderer(this._source);
  }
}

class VPRenderer implements IPrimitivePaneRenderer {
  private _source: VolumeProfilePrimitive;
  constructor(_source: VolumeProfilePrimitive) {
    this._source = _source;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const chart = this._source.getChart();
      const series = this._source.getSeries();
      if (!chart || !series) return;

      const ctx = scope.context;
      const hRatio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;
      const timeScale = chart.timeScale();
      const rightEdgePx = scope.mediaSize.width;

      for (const block of this._source.getBlocks()) {
        const x1 = timeScale.timeToCoordinate(block.startTime);
        const x2 = block.endTime !== null ? timeScale.timeToCoordinate(block.endTime) : rightEdgePx;
        if (x1 === null || x2 === null) continue;

        const blockWidthPx = Math.max(4, x2 - x1);
        const maxBarPx = Math.min(blockWidthPx * 0.85, 160);
        const { bins, maxVolume, pocIndex } = block.profile;
        if (maxVolume <= 0) continue;

        bins.forEach((bin, i) => {
          const yTop = series.priceToCoordinate(bin.priceHigh);
          const yBottom = series.priceToCoordinate(bin.priceLow);
          if (yTop === null || yBottom === null) return;
          const barLen = (bin.volume / maxVolume) * maxBarPx;
          if (barLen <= 0) return;
          const isPoc = i === pocIndex;
          ctx.fillStyle = isPoc ? block.pocColor : block.color;
          const xStart = (x2 - barLen) * hRatio;
          const yStartPx = Math.min(yTop, yBottom) * vRatio;
          const heightPx = Math.max(1, Math.abs(yBottom - yTop) * vRatio);
          ctx.fillRect(xStart, yStartPx, Math.max(1, barLen * hRatio), heightPx);
        });
      }
    });
  }
}
