import { useEffect } from "react";
import type { RefObject } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Anchor, DrawingManager, IDrawing } from "lightweight-charts-drawing";
import { saveDrawings, snapAnchorToOHLC, type Candle } from "./lib";

// Click-to-select, click-anywhere-to-drag-move (including grabbing an infinite H/V/Cross
// line or a Ray's extended tail, not just its tiny anchor handle), and double-click to open
// the position/color edit dialog. This is the "cursor mode" companion to the drawing-tool
// creation effects — active only when no drawing tool is armed.
export function useDrawingSelection(
  containerRef: RefObject<HTMLDivElement | null>,
  chartRef: RefObject<IChartApi | null>,
  seriesRef: RefObject<ISeriesApi<"Candlestick"> | null>,
  drawingManagerRef: RefObject<DrawingManager | null>,
  activeDrawingTool: string | null,
  selectedDrawingId: string | null,
  setSelectedDrawingId: (id: string | null) => void,
  setHandlePositions: (positions: { x: number; y: number }[]) => void,
  setEditingDrawingId: (id: string | null) => void,
  dragAnchorIndexRef: RefObject<number | null>,
  magnetModeRef: RefObject<boolean>,
  candlesRef: RefObject<Candle[]>,
  symbolRef: RefObject<string>,
  hitTestOwn: (clickPx: { x: number; y: number }) => IDrawing | null,
  hitTestDrawingLine: (
    type: string,
    pixels: { x: number; y: number }[],
    clickPx: { x: number; y: number },
    threshold: number
  ) => boolean,
  anchorToPixel: (a: Anchor) => { x: number; y: number } | null,
  getHandles: (
    d: IDrawing
  ) => { x: number; y: number; timeAnchorIdx: number | null; priceAnchorIdx: number | null }[],
  refreshHandlePositions: (id: string | null) => void,
  pushUndoSnapshot: () => void,
  symbol: string,
  tf: string
) {
  useEffect(() => {
    if (!containerRef.current || !chartRef.current || activeDrawingTool) return;
    const container = containerRef.current;
    const chart = chartRef.current;

    const toPixel = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onClick = (e: MouseEvent) => {
      if (dragAnchorIndexRef.current !== null) return; // was a drag, not a click
      const px = toPixel(e);
      const hit = hitTestOwn(px);
      if (hit) {
        drawingManagerRef.current?.selectDrawing(hit.id);
        setSelectedDrawingId(hit.id);
        refreshHandlePositions(hit.id);
      } else {
        drawingManagerRef.current?.deselectAll();
        setSelectedDrawingId(null);
        setHandlePositions([]);
      }
    };

    let mouseDownPx: { x: number; y: number } | null = null;
    // The handle grabbed at drag start, frozen for the whole drag — recomputing which
    // anchor is "left"/"top" etc. on every mousemove would let the role assignment flip
    // mid-drag as the box crosses over itself, which is confusing; freezing it is stable
    // and matches how every other drawing tool already behaves.
    let draggedHandle: { timeAnchorIdx: number | null; priceAnchorIdx: number | null } | null = null;
    // Grabbing the shape's body (not a handle) translates every anchor by the same pixel
    // delta — captured once at drag start so the whole shape moves rigidly together instead
    // of each anchor separately re-snapping to the cursor.
    let moveOriginalPixels: { x: number; y: number }[] | null = null;
    const onDown = (e: MouseEvent) => {
      mouseDownPx = toPixel(e);
      if (!selectedDrawingId || !drawingManagerRef.current) return;
      const d = drawingManagerRef.current.getDrawing(selectedDrawingId);
      if (!d || d.options.locked) return;
      const handles = getHandles(d);
      let bestIdx = -1;
      let bestDist = 10;
      handles.forEach((h, idx) => {
        const dist = Math.hypot(h.x - mouseDownPx!.x, h.y - mouseDownPx!.y);
        if (dist <= bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      });
      // H/V/Cross line and H-Ray are defined by a single anchor but render across the whole
      // chart — grabbing anywhere along that rendered line (not just the tiny anchor
      // handle) should still start a move of that one anchor. (Ray is excluded: it has two
      // anchors, and grabbing its extended tail should translate the whole ray, not pivot
      // it around anchor 1 — a different drag mode this doesn't implement yet.)
      const ONE_ANCHOR_LINE_TYPES = ["horizontal-line", "vertical-line", "cross-line", "horizontal-ray"];
      if (bestIdx < 0 && ONE_ANCHOR_LINE_TYPES.includes(d.type)) {
        const validPixels = d.anchors.map(anchorToPixel).filter((p): p is { x: number; y: number } => p !== null);
        if (hitTestDrawingLine(d.type, validPixels, mouseDownPx, 10)) bestIdx = 0;
      }
      draggedHandle = bestIdx >= 0 ? handles[bestIdx] ?? { timeAnchorIdx: 0, priceAnchorIdx: 0 } : null;

      // No handle grabbed, but the click still landed on the shape itself (its filled
      // interior, its outline, whatever the library's own testHit considers "on it") —
      // that's a plain grab-and-move of the whole drawing, TradingView-style, not a resize.
      moveOriginalPixels = null;
      if (!draggedHandle) {
        const hit = hitTestOwn(mouseDownPx);
        if (hit?.id === selectedDrawingId) {
          const pixels = d.anchors.map(anchorToPixel).filter((p): p is { x: number; y: number } => p !== null);
          if (pixels.length === d.anchors.length) moveOriginalPixels = pixels;
        }
      }

      if (draggedHandle || moveOriginalPixels) {
        pushUndoSnapshot();
        e.preventDefault();
        // Without this, the chart's own native click-drag-to-scroll/scale (enabled
        // whenever no drawing tool is armed, i.e. exactly this cursor/selection mode) fires
        // on the SAME mousedown+mousemove alongside our own anchor drag below — the chart
        // pans/scales while the anchor's own on-screen position lags behind, looking like
        // the whole canvas is shaking while the anchor itself barely moves.
        chart.applyOptions({
          handleScroll: false,
          handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: false },
        });
      }
      dragAnchorIndexRef.current = bestIdx >= 0 ? bestIdx : moveOriginalPixels ? -2 : null;
    };
    const onMove = (e: MouseEvent) => {
      if (!selectedDrawingId || !drawingManagerRef.current || !mouseDownPx) return;
      const rect = container.getBoundingClientRect();
      const curPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const d = drawingManagerRef.current.getDrawing(selectedDrawingId);
      if (!d) return;

      if (moveOriginalPixels) {
        // Rigid translate: same pixel delta applied to every anchor, no magnet snapping
        // (snapping each anchor independently would distort the shape's size/proportions).
        const dx = curPx.x - mouseDownPx.x;
        const dy = curPx.y - mouseDownPx.y;
        moveOriginalPixels.forEach((origPx, idx) => {
          const time = chart.timeScale().coordinateToTime(origPx.x + dx);
          const price = seriesRef.current?.coordinateToPrice(origPx.y + dy);
          if (time === null || price == null) return;
          d.updateAnchor(idx, { time, price });
        });
        chart.applyOptions({});
        refreshHandlePositions(selectedDrawingId);
        return;
      }

      if (!draggedHandle) return;
      const time = chart.timeScale().coordinateToTime(curPx.x);
      const price = seriesRef.current?.coordinateToPrice(curPx.y);
      if (time === null || price == null) return;
      const raw = { time, price };
      const a = magnetModeRef.current ? snapAnchorToOHLC(raw, candlesRef.current) : raw;
      // A corner handle updates both coordinates (possibly on two different real anchors,
      // for the two "derived" corners of a box); a midpoint handle updates only the one
      // coordinate it owns, leaving the anchor's other value untouched.
      if (draggedHandle.timeAnchorIdx !== null) {
        const idx = draggedHandle.timeAnchorIdx;
        const cur = d.anchors[idx];
        if (cur) d.updateAnchor(idx, { time: a.time, price: cur.price });
      }
      if (draggedHandle.priceAnchorIdx !== null) {
        const idx = draggedHandle.priceAnchorIdx;
        const cur = d.anchors[idx];
        if (cur) d.updateAnchor(idx, { time: cur.time, price: a.price });
      }
      chart.applyOptions({});
      refreshHandlePositions(selectedDrawingId);
    };
    const onUp = () => {
      if (dragAnchorIndexRef.current !== null && drawingManagerRef.current) {
        saveDrawings(symbolRef.current, drawingManagerRef.current);
        chart.applyOptions({
          handleScroll: true,
          handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
        });
      }
      dragAnchorIndexRef.current = null;
      draggedHandle = null;
      moveOriginalPixels = null;
      mouseDownPx = null;
    };

    const onDblClick = (e: MouseEvent) => {
      const hit = hitTestOwn(toPixel(e));
      if (!hit) return;
      drawingManagerRef.current?.selectDrawing(hit.id);
      setSelectedDrawingId(hit.id);
      refreshHandlePositions(hit.id);
      setEditingDrawingId(hit.id);
    };

    container.addEventListener("click", onClick);
    container.addEventListener("dblclick", onDblClick);
    container.addEventListener("mousedown", onDown);
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseup", onUp);
    return () => {
      container.removeEventListener("click", onClick);
      container.removeEventListener("dblclick", onDblClick);
      container.removeEventListener("mousedown", onDown);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrawingTool, selectedDrawingId]);

  useEffect(() => {
    if (!chartRef.current || !selectedDrawingId) return;
    const chart = chartRef.current;
    const sync = () => refreshHandlePositions(selectedDrawingId);
    chart.timeScale().subscribeVisibleTimeRangeChange(sync);
    return () => chart.timeScale().unsubscribeVisibleTimeRangeChange(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDrawingId]);

  useEffect(() => {
    setSelectedDrawingId(null);
    setHandlePositions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf]);
}
