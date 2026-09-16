import type { RefObject } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Anchor, DrawingManager, IDrawing } from "lightweight-charts-drawing";

// The third-party drawing library's own hit-testing only covers a drawing's literal
// anchor point(s), which is wrong for H/V/Cross line and H-Ray (single anchor, rendered as
// a full-width/height/extended line) — clicking almost anywhere on the actual visible line
// missed it entirely. This hook builds our own hit-testing against what's really drawn on
// screen, reused for both click-to-select and drag-to-move-anywhere-on-the-line.
export function useDrawingHitTest(
  chartRef: RefObject<IChartApi | null>,
  seriesRef: RefObject<ISeriesApi<"Candlestick"> | null>,
  drawingManagerRef: RefObject<DrawingManager | null>,
  setHandlePositions: (positions: { x: number; y: number }[]) => void
) {
  function anchorToPixel(a: Anchor): { x: number; y: number } | null {
    if (!chartRef.current || !seriesRef.current) return null;
    const x = chartRef.current.timeScale().timeToCoordinate(a.time);
    const y = seriesRef.current.priceToCoordinate(a.price);
    if (x === null || y === null) return null;
    return { x, y };
  }

  // H/V/Cross line and H-Ray render well beyond their literal anchor point — a full-width
  // horizontal line, a full-height vertical line, or a ray extending past the chart edge —
  // so hit-testing only the anchor point itself misses almost the whole visible line. This
  // tests against what's actually drawn on screen for those types.
  function hitTestDrawingLine(
    type: string,
    pixels: { x: number; y: number }[],
    clickPx: { x: number; y: number },
    threshold: number
  ): boolean {
    if (pixels.length === 0) return false;
    if (type === "horizontal-line") return Math.abs(clickPx.y - pixels[0].y) <= threshold;
    if (type === "vertical-line") return Math.abs(clickPx.x - pixels[0].x) <= threshold;
    if (type === "cross-line") {
      return Math.abs(clickPx.y - pixels[0].y) <= threshold || Math.abs(clickPx.x - pixels[0].x) <= threshold;
    }
    if (type === "horizontal-ray") {
      return Math.abs(clickPx.y - pixels[0].y) <= threshold && clickPx.x >= pixels[0].x - threshold;
    }
    return false;
  }

  function hitTestOwn(clickPx: { x: number; y: number }): IDrawing | null {
    if (!drawingManagerRef.current) return null;
    // The library's own testHit() is real per-shape geometry — a filled rectangle hits
    // anywhere inside it, an unfilled one hits near any of its 4 edges, circles/ellipses/
    // channels/fib tools/position tools all get their actual rendered shape tested, not an
    // approximation. Only H/V/Cross-line and H-Ray render well past their literal anchor (a
    // full-width/height line, or a ray extending past the chart edge), which the library's
    // own hit test doesn't account for — those alone get our manual extended-line check.
    const libHit = drawingManagerRef.current.hitTest(clickPx);
    if (libHit) return libHit;

    const threshold = 16;
    const all = drawingManagerRef.current.getAllDrawings();
    const EXTENDED_LINE_TYPES = ["horizontal-line", "vertical-line", "cross-line", "horizontal-ray"];
    for (let i = all.length - 1; i >= 0; i--) {
      const d = all[i];
      if (!EXTENDED_LINE_TYPES.includes(d.type)) continue;
      const pixels = d.anchors.map(anchorToPixel).filter((p): p is { x: number; y: number } => p !== null);
      if (pixels.length === 0) continue;
      if (hitTestDrawingLine(d.type, pixels, clickPx, threshold)) return d;
    }
    return null;
  }

  // Drag handles for a drawing: which real anchor's TIME and/or PRICE a given on-screen
  // handle controls. Most tools just get one handle per anchor (dragging it replaces that
  // anchor wholesale, timeAnchorIdx === priceAnchorIdx). A box (Rectangle) gets all 8
  // TradingView-style handles — its 2 real corners plus the other 2 derived corners and the
  // 4 edge midpoints — where a midpoint handle only ever touches ONE coordinate (e.g. the
  // top-mid handle drags just the top edge's price, leaving both anchors' times alone).
  function getHandles(
    d: IDrawing
  ): { x: number; y: number; timeAnchorIdx: number | null; priceAnchorIdx: number | null }[] {
    if (d.type === "rectangle" && d.anchors.length >= 2) {
      const p0 = anchorToPixel(d.anchors[0]);
      const p1 = anchorToPixel(d.anchors[1]);
      if (p0 && p1) {
        const leftIdx = p0.x <= p1.x ? 0 : 1;
        const rightIdx = leftIdx === 0 ? 1 : 0;
        const topIdx = p0.y <= p1.y ? 0 : 1; // smaller pixel y = higher price = visually "top"
        const bottomIdx = topIdx === 0 ? 1 : 0;
        const px = [p0, p1];
        const leftX = px[leftIdx].x;
        const rightX = px[rightIdx].x;
        const topY = px[topIdx].y;
        const bottomY = px[bottomIdx].y;
        const midX = (leftX + rightX) / 2;
        const midY = (topY + bottomY) / 2;
        return [
          { x: leftX, y: topY, timeAnchorIdx: leftIdx, priceAnchorIdx: topIdx },
          { x: rightX, y: topY, timeAnchorIdx: rightIdx, priceAnchorIdx: topIdx },
          { x: rightX, y: bottomY, timeAnchorIdx: rightIdx, priceAnchorIdx: bottomIdx },
          { x: leftX, y: bottomY, timeAnchorIdx: leftIdx, priceAnchorIdx: bottomIdx },
          { x: midX, y: topY, timeAnchorIdx: null, priceAnchorIdx: topIdx },
          { x: rightX, y: midY, timeAnchorIdx: rightIdx, priceAnchorIdx: null },
          { x: midX, y: bottomY, timeAnchorIdx: null, priceAnchorIdx: bottomIdx },
          { x: leftX, y: midY, timeAnchorIdx: leftIdx, priceAnchorIdx: null },
        ];
      }
    }
    return d.anchors
      .map((a, idx) => {
        const p = anchorToPixel(a);
        return p ? { x: p.x, y: p.y, timeAnchorIdx: idx, priceAnchorIdx: idx } : null;
      })
      .filter((h): h is { x: number; y: number; timeAnchorIdx: number; priceAnchorIdx: number } => h !== null);
  }

  function refreshHandlePositions(id: string | null) {
    if (!id || !drawingManagerRef.current) {
      setHandlePositions([]);
      return;
    }
    const d = drawingManagerRef.current.getDrawing(id);
    if (!d) {
      setHandlePositions([]);
      return;
    }
    setHandlePositions(getHandles(d).map(({ x, y }) => ({ x, y })));
  }

  return { anchorToPixel, hitTestDrawingLine, hitTestOwn, getHandles, refreshHandlePositions };
}
