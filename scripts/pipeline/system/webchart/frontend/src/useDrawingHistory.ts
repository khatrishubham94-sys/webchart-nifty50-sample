import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { IChartApi, Time } from "lightweight-charts";
import type { DrawingManager, SerializedDrawing } from "lightweight-charts-drawing";
import { saveDrawings, drawingFactory, type Candle } from "./lib";

// Undo/redo (snapshot-based, since the drawing library has no native history API) and
// clipboard (copy/cut/paste) for drawings — the drawing-library-level counterpart to
// browser undo, all keyed off the manager's own export/import round-trip.
export function useDrawingHistory(
  drawingManagerRef: RefObject<DrawingManager | null>,
  chartRef: RefObject<IChartApi | null>,
  symbolRef: RefObject<string>,
  candlesRef: RefObject<Candle[]>,
  drawIdRef: RefObject<number>,
  selectedDrawingId: string | null,
  setSelectedDrawingId: (id: string | null) => void,
  setHandlePositions: (positions: { x: number; y: number }[]) => void,
  refreshHandlePositions: (id: string | null) => void
) {
  const undoStackRef = useRef<SerializedDrawing[][]>([]);
  const redoStackRef = useRef<SerializedDrawing[][]>([]);
  const clipboardRef = useRef<SerializedDrawing | null>(null);

  function pushUndoSnapshot() {
    const manager = drawingManagerRef.current;
    if (!manager) return;
    undoStackRef.current.push(manager.exportDrawings());
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
  }

  function applyDrawingSnapshot(snapshot: SerializedDrawing[]) {
    const manager = drawingManagerRef.current;
    if (!manager) return;
    manager.clearAll();
    manager.importDrawings(snapshot, drawingFactory);
    setSelectedDrawingId(null);
    setHandlePositions([]);
    chartRef.current?.applyOptions({});
    saveDrawings(symbolRef.current, manager);
  }

  function undoDrawing() {
    const manager = drawingManagerRef.current;
    if (!manager || undoStackRef.current.length === 0) return;
    redoStackRef.current.push(manager.exportDrawings());
    applyDrawingSnapshot(undoStackRef.current.pop()!);
  }

  function redoDrawing() {
    const manager = drawingManagerRef.current;
    if (!manager || redoStackRef.current.length === 0) return;
    undoStackRef.current.push(manager.exportDrawings());
    applyDrawingSnapshot(redoStackRef.current.pop()!);
  }

  function copySelectedDrawing() {
    const manager = drawingManagerRef.current;
    if (!manager || !selectedDrawingId) return;
    const d = manager.getDrawing(selectedDrawingId);
    if (d) clipboardRef.current = d.toJSON();
  }

  function cutSelectedDrawing() {
    const manager = drawingManagerRef.current;
    if (!manager || !selectedDrawingId) return;
    copySelectedDrawing();
    pushUndoSnapshot();
    manager.removeDrawing(selectedDrawingId);
    saveDrawings(symbolRef.current, manager);
    setSelectedDrawingId(null);
    setHandlePositions([]);
    chartRef.current?.applyOptions({});
  }

  function pasteClipboardDrawing() {
    const manager = drawingManagerRef.current;
    const clip = clipboardRef.current;
    if (!manager || !clip) return;
    // offset the pasted copy a few bars to the right so it doesn't land exactly on the original
    const candles = candlesRef.current;
    const shiftBars = 5;
    const anchors = clip.anchors.map((a) => {
      const idx = candles.findIndex((c) => c.time === a.time);
      const shifted = idx >= 0 ? candles[Math.min(idx + shiftBars, candles.length - 1)] : null;
      return shifted ? { ...a, time: shifted.time as Time } : a;
    });
    const id = `drawing-${Date.now()}-${drawIdRef.current++}`;
    const pasted = drawingFactory(clip.type, { ...clip, id, anchors });
    if (!pasted) return;
    pushUndoSnapshot();
    manager.addDrawing(pasted);
    saveDrawings(symbolRef.current, manager);
    manager.selectDrawing(id);
    setSelectedDrawingId(id);
    refreshHandlePositions(id);
    chartRef.current?.applyOptions({});
  }

  // Ctrl+Z/Y (undo/redo), Ctrl+C/X/V (copy/cut/paste), Delete/Backspace — all wired here
  // since they're just keyboard entry points onto the functions above.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.ctrlKey && !e.altKey && !e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          e.preventDefault();
          undoDrawing();
          return;
        }
        if (k === "y") {
          e.preventDefault();
          redoDrawing();
          return;
        }
        if (k === "c") {
          e.preventDefault();
          copySelectedDrawing();
          return;
        }
        if (k === "x") {
          e.preventDefault();
          cutSelectedDrawing();
          return;
        }
        if (k === "v") {
          e.preventDefault();
          pasteClipboardDrawing();
          return;
        }
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const manager = drawingManagerRef.current;
      if (!manager || !selectedDrawingId) return;
      e.preventDefault();
      pushUndoSnapshot();
      manager.removeDrawing(selectedDrawingId);
      saveDrawings(symbolRef.current, manager);
      setSelectedDrawingId(null);
      setHandlePositions([]);
      chartRef.current?.applyOptions({});
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDrawingId]);

  return { pushUndoSnapshot, undoDrawing, redoDrawing, copySelectedDrawing, cutSelectedDrawing, pasteClipboardDrawing };
}
