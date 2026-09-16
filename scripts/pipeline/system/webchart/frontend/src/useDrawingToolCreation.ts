import { useEffect } from "react";
import type { RefObject } from "react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { Brush, type Anchor, type Drawing, type DrawingManager, type DrawingOptions } from "lightweight-charts-drawing";
import { saveDrawings, snapAnchorToOHLC, CLICK_TOOLS, type Candle } from "./lib";

// Everything involved in actually PLACING a new drawing: arming/disarming the chart's own
// scroll/scale while a tool is active, the (now-disabled) library anchor-drag scroll guard,
// the 1-anchor tools (H/V/Cross line, Ray immediate-drop + hover-preview), the 2-/3-anchor
// tools (click-drag-release AND click-then-click, TradingView's two real gestures), and
// freehand brush. All of it is scoped to "a drawing tool is currently armed" — selecting,
// moving, and editing an already-placed drawing lives in useDrawingSelection instead.
export function useDrawingToolCreation(
  containerRef: RefObject<HTMLDivElement | null>,
  chartRef: RefObject<IChartApi | null>,
  seriesRef: RefObject<ISeriesApi<"Candlestick"> | null>,
  drawingManagerRef: RefObject<DrawingManager | null>,
  activeDrawingTool: string | null,
  onToolConsumed: () => void,
  magnetModeRef: RefObject<boolean>,
  candlesRef: RefObject<Candle[]>,
  drawIdRef: RefObject<number>,
  symbolRef: RefObject<string>,
  lastCursorPxRef: RefObject<{ x: number; y: number } | null>,
  pendingAnchorsRef: RefObject<Anchor[]>,
  brushPointsRef: RefObject<Anchor[] | null>,
  pushUndoSnapshot: () => void
) {
  useEffect(() => {
    drawingManagerRef.current?.setActiveTool(activeDrawingTool);
    pendingAnchorsRef.current = [];
    brushPointsRef.current = null;
    chartRef.current?.applyOptions({
      handleScroll: !activeDrawingTool,
      handleScale: { mouseWheel: false, pinch: !activeDrawingTool, axisPressedMouseMove: !activeDrawingTool },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrawingTool]);

  useEffect(() => {
    if (!containerRef.current || !chartRef.current || activeDrawingTool) return;
    const container = containerRef.current;
    const chart = chartRef.current;

    const onDown = (e: MouseEvent) => {
      if (!drawingManagerRef.current) return;
      const rect = container.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const hitDrawing = drawingManagerRef.current.hitTest(point);
      const hitAnchor =
        hitDrawing && drawingManagerRef.current.getSelectedDrawing()
          ? drawingManagerRef.current.hitTestAnchor(point)
          : null;
      if (hitAnchor !== null) {
        chart.applyOptions({
          handleScroll: false,
          handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: false },
        });
      }
    };
    const onUp = () => {
      chart.applyOptions({
        handleScroll: true,
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
      });
    };

    container.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      container.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrawingTool]);

  useEffect(() => {
    if (!containerRef.current || !chartRef.current || !activeDrawingTool || !(activeDrawingTool in CLICK_TOOLS))
      return;
    const tool = CLICK_TOOLS[activeDrawingTool];
    const container = containerRef.current;
    const chart = chartRef.current;

    const anchorAtPx = (px: { x: number; y: number }): Anchor | null => {
      if (!seriesRef.current) return null;
      const time = chart.timeScale().coordinateToTime(px.x);
      const price = seriesRef.current.coordinateToPrice(px.y);
      if (time === null || price === null) return null;
      const a = { time, price };
      return magnetModeRef.current ? snapAnchorToOHLC(a, candlesRef.current) : a;
    };
    const toAnchor = (e: MouseEvent): Anchor | null => {
      const rect = container.getBoundingClientRect();
      return anchorAtPx({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    if (tool.instantPlace) {
      // TradingView's own Long/Short position tool: one click drops a complete default
      // 1:2 risk:reward box at that price, not a 3-click sequence — entry/stop/target are
      // then each independently drag-adjustable via the normal anchor-handle system. The
      // library's box geometry only uses anchors[1]/[2] for their price (time is cosmetic,
      // the box is a fixed 200px pixel width from the entry anchor), so giving stop/target
      // the same time as entry keeps their drag handles stacked directly under it.
      const isLong = tool.instantPlace === "long";
      const place = (entry: Anchor) => {
        pushUndoSnapshot();
        const riskAmount = entry.price * 0.02;
        const rewardAmount = riskAmount * 2;
        const stopLoss: Anchor = {
          time: entry.time,
          price: isLong ? entry.price - riskAmount : entry.price + riskAmount,
        };
        const takeProfit: Anchor = {
          time: entry.time,
          price: isLong ? entry.price + rewardAmount : entry.price - rewardAmount,
        };
        const id = `drawing-${Date.now()}-${drawIdRef.current++}`;
        const drawing = new tool.ToolClass(id, [entry, stopLoss, takeProfit]);
        drawingManagerRef.current?.addDrawing(drawing);
        if (drawingManagerRef.current) saveDrawings(symbolRef.current, drawingManagerRef.current);
        chart.applyOptions({});
        onToolConsumed();
      };
      const handler = (param: { point?: { x: number; y: number }; time?: Time }) => {
        if (!param.point || !param.time || !seriesRef.current) return;
        const price = seriesRef.current.coordinateToPrice(param.point.y);
        if (price === null) return;
        const raw = { time: param.time, price };
        place(magnetModeRef.current ? snapAnchorToOHLC(raw, candlesRef.current) : raw);
      };
      chart.subscribeClick(handler);
      return () => chart.unsubscribeClick(handler);
    }

    if (tool.anchors === 1) {
      // Text/Note need a text value that doesn't come from an anchor click — prompt for it
      // up front, same window.prompt convention used elsewhere in this app (watchlist
      // rename). Cancelling the prompt aborts arming the tool entirely.
      let pendingText: string | undefined;
      if (tool.needsText) {
        const entered = window.prompt(`${tool.label}:`, "");
        if (!entered) {
          onToolConsumed();
          return;
        }
        pendingText = entered;
      }
      const applyText = (d: Drawing) => {
        if (pendingText === undefined) return;
        const opts: Record<string, unknown> = { text: pendingText };
        d.updateOptions(opts as Partial<DrawingOptions>);
      };

      // TradingView-style: pressing the shortcut (Alt+H/V/C/J) while the cursor is already
      // over the chart drops the line right there immediately, no click needed. Falls back
      // to a hover-preview-then-click flow only if the cursor isn't over the chart yet
      // (e.g. the tool was armed from the toolbar button instead of the keyboard).
      let preview: Drawing | null = null;
      let finalized = false;

      const dropAt = (a: Anchor) => {
        pushUndoSnapshot();
        const id = `drawing-${Date.now()}-${drawIdRef.current++}`;
        const drawing = new tool.ToolClass(id, [a]);
        applyText(drawing);
        drawingManagerRef.current?.addDrawing(drawing);
        finalized = true;
        if (drawingManagerRef.current) saveDrawings(symbolRef.current, drawingManagerRef.current);
        chart.applyOptions({});
        onToolConsumed();
      };

      if (lastCursorPxRef.current) {
        const a = anchorAtPx(lastCursorPxRef.current);
        if (a) dropAt(a);
      }

      const onMove = (e: MouseEvent) => {
        if (finalized) return;
        const a = toAnchor(e);
        if (!a) return;
        if (!preview) {
          pushUndoSnapshot();
          const id = `drawing-${Date.now()}-${drawIdRef.current++}`;
          preview = new tool.ToolClass(id, [a]);
          applyText(preview);
          drawingManagerRef.current?.addDrawing(preview);
        } else {
          preview.updateAnchor(0, a);
        }
        chart.applyOptions({});
      };

      const handler = (param: { point?: { x: number; y: number }; time?: Time }) => {
        if (finalized || !param.point || !param.time || !seriesRef.current) return;
        const price = seriesRef.current.coordinateToPrice(param.point.y);
        if (price === null) return;
        const raw = { time: param.time, price };
        const a = magnetModeRef.current ? snapAnchorToOHLC(raw, candlesRef.current) : raw;
        if (!preview) {
          pushUndoSnapshot();
          const id = `drawing-${Date.now()}-${drawIdRef.current++}`;
          preview = new tool.ToolClass(id, [a]);
          applyText(preview);
          drawingManagerRef.current?.addDrawing(preview);
        } else {
          preview.updateAnchor(0, a);
        }
        finalized = true;
        if (drawingManagerRef.current) saveDrawings(symbolRef.current, drawingManagerRef.current);
        chart.applyOptions({});
        onToolConsumed();
      };

      container.addEventListener("mousemove", onMove);
      chart.subscribeClick(handler);
      return () => {
        container.removeEventListener("mousemove", onMove);
        chart.unsubscribeClick(handler);
        // if the tool was switched away before a click landed, drop the unfinished ghost line
        if (preview && !finalized && drawingManagerRef.current) {
          drawingManagerRef.current.removeDrawing(preview.id);
          chart.applyOptions({});
        }
      };
    }

    // 2- and 3-anchor tools support both TradingView gestures:
    //  - click-drag-release: mousedown places anchor 0, dragging live-updates anchor 1,
    //    mouseup with real movement locks it in immediately.
    //  - click-then-click: a mousedown/mouseup pair with ~no movement (a plain click, not
    //    a drag) does NOT finalize a zero-length "dot" — instead anchor 1 keeps live-
    //    following the cursor until the next click locks it in.
    // 3-anchor tools then live-follow the cursor for the third anchor until one more click.
    const CLICK_VS_DRAG_PX = 5;
    let dragging = false;
    let awaitingSecond = false;
    let awaitingThird = false;
    let preview: Drawing | null = null;
    let firstTwo: Anchor[] = [];
    let downPx: { x: number; y: number } | null = null;

    const onDown = (e: MouseEvent) => {
      if (awaitingSecond || awaitingThird) return;
      const start = toAnchor(e);
      if (!start) return;
      pushUndoSnapshot();
      dragging = true;
      const rect = container.getBoundingClientRect();
      downPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const id = `drawing-${Date.now()}-${drawIdRef.current++}`;
      preview = new tool.ToolClass(id, [start, start]);
      drawingManagerRef.current?.addDrawing(preview);
      chart.applyOptions({});
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging || !preview) return;
      const a = toAnchor(e);
      if (!a) return;
      preview.updateAnchor(1, a);
      chart.applyOptions({});
    };
    const finalizeSecond = (end: Anchor) => {
      if (!preview) return;
      preview.updateAnchor(1, end);
      firstTwo = [preview.anchors[0], end];
      chart.applyOptions({});
      awaitingSecond = false;
      if (tool.anchors === 2) {
        if (drawingManagerRef.current) saveDrawings(symbolRef.current, drawingManagerRef.current);
        onToolConsumed();
        preview = null;
      } else {
        awaitingThird = true;
      }
    };
    const onUp = (e: MouseEvent) => {
      if (!dragging || !preview) return;
      dragging = false;
      const upRect = container.getBoundingClientRect();
      const upPx = { x: e.clientX - upRect.left, y: e.clientY - upRect.top };
      const moved = downPx ? Math.hypot(upPx.x - downPx.x, upPx.y - downPx.y) : Infinity;
      if (moved < CLICK_VS_DRAG_PX) {
        // a plain click, not a drag: keep anchor 1 live-following until the NEXT click.
        // The browser fires mousedown -> mouseup -> click for this SAME physical click, and
        // that trailing native 'click' event (which chart.subscribeClick relays to
        // secondClickHandler) hasn't fired yet — arming awaitingSecond synchronously here
        // would let it consume that same-gesture click as if it were the second one,
        // instantly finalizing a zero-length line at the same spot. Deferring past the
        // current synchronous event dispatch (mousedown/mouseup/click are all flushed
        // before timers run) lets that trailing click pass through as a no-op first.
        setTimeout(() => {
          awaitingSecond = true;
        }, 0);
        return;
      }
      const end = toAnchor(e) ?? preview.anchors[1];
      finalizeSecond(end);
    };
    container.addEventListener("mousedown", onDown);
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseup", onUp);

    // window-level, not container-level: after a real click completes, the canvas appears
    // to capture the pointer for its own internal handling, and container-level mousemove
    // listeners silently stop receiving events afterward even though window-level ones don't
    const onSecondMove = (e: MouseEvent) => {
      if (!awaitingSecond || !preview) return;
      const a = toAnchor(e);
      if (!a) return;
      preview.updateAnchor(1, a);
      chart.applyOptions({});
    };
    window.addEventListener("mousemove", onSecondMove);
    const secondClickHandler = (param: { point?: { x: number; y: number }; time?: Time }) => {
      if (!awaitingSecond || !param.point || !param.time || !seriesRef.current || !preview) return;
      const price = seriesRef.current.coordinateToPrice(param.point.y);
      if (price === null) return;
      const raw = { time: param.time, price };
      const end = magnetModeRef.current ? snapAnchorToOHLC(raw, candlesRef.current) : raw;
      finalizeSecond(end);
    };
    chart.subscribeClick(secondClickHandler);

    const onThirdMove = (e: MouseEvent) => {
      if (!awaitingThird || !preview) return;
      const a = toAnchor(e);
      if (!a) return;
      preview.setAnchors([...firstTwo, a]);
      chart.applyOptions({});
    };
    let thirdClickHandler: ((param: { point?: { x: number; y: number }; time?: Time }) => void) | null = null;
    if (tool.anchors === 3) {
      window.addEventListener("mousemove", onThirdMove);
      thirdClickHandler = (param) => {
        if (!awaitingThird || !param.point || !param.time || !seriesRef.current || !preview) return;
        const price = seriesRef.current.coordinateToPrice(param.point.y);
        if (price === null) return;
        const raw = { time: param.time, price };
        const third = magnetModeRef.current ? snapAnchorToOHLC(raw, candlesRef.current) : raw;
        preview.setAnchors([...firstTwo, third]);
        chart.applyOptions({});
        if (drawingManagerRef.current) saveDrawings(symbolRef.current, drawingManagerRef.current);
        onToolConsumed();
        awaitingThird = false;
        preview = null;
      };
      chart.subscribeClick(thirdClickHandler);
    }

    return () => {
      container.removeEventListener("mousedown", onDown);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onSecondMove);
      chart.unsubscribeClick(secondClickHandler);
      window.removeEventListener("mousemove", onThirdMove);
      if (thirdClickHandler) chart.unsubscribeClick(thirdClickHandler);
      // if the tool was switched away mid-drag/mid-click-click/mid-third-click, drop the
      // unfinished preview
      if (preview && drawingManagerRef.current) {
        drawingManagerRef.current.removeDrawing(preview.id);
        chart.applyOptions({});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrawingTool, onToolConsumed]);

  useEffect(() => {
    if (!containerRef.current || activeDrawingTool !== "brush") return;
    const container = containerRef.current;

    const toAnchor = (e: MouseEvent): Anchor | null => {
      if (!chartRef.current || !seriesRef.current) return null;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const time = chartRef.current.timeScale().coordinateToTime(x);
      const price = seriesRef.current.coordinateToPrice(y);
      if (time === null || price === null) return null;
      return { time, price };
    };

    let preview: InstanceType<typeof Brush> | null = null;

    const onDown = (e: MouseEvent) => {
      const a = toAnchor(e);
      if (!a) return;
      pushUndoSnapshot();
      brushPointsRef.current = [a];
      const id = `drawing-${Date.now()}-${drawIdRef.current++}`;
      preview = Brush.create(id, [a, a]);
      drawingManagerRef.current?.addDrawing(preview);
      chartRef.current?.applyOptions({});
    };
    const onMove = (e: MouseEvent) => {
      if (!brushPointsRef.current || !preview) return;
      const a = toAnchor(e);
      if (!a) return;
      brushPointsRef.current.push(a);
      preview.addPoint(a);
      chartRef.current?.applyOptions({});
    };
    const onUp = () => {
      if (preview && drawingManagerRef.current) {
        saveDrawings(symbolRef.current, drawingManagerRef.current);
      }
      brushPointsRef.current = null;
      preview = null;
      onToolConsumed();
    };

    container.addEventListener("mousedown", onDown);
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseup", onUp);
    return () => {
      container.removeEventListener("mousedown", onDown);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseup", onUp);
      if (preview && drawingManagerRef.current) {
        drawingManagerRef.current.removeDrawing(preview.id);
        chartRef.current?.applyOptions({});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrawingTool, onToolConsumed]);
}
