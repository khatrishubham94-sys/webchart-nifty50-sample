import { CLICK_TOOLS } from "../lib";

// TradingView's own Object Tree: every drawing on the chart in one list, each with
// hide/lock/remove — consolidates click-to-select drawings into one management surface.
export type DrawingRow = { id: string; type: string; locked: boolean; visible: boolean };

export function ObjectTreePanel({
  symbol,
  tf,
  drawings,
  onSelectDrawing,
  onToggleDrawingLock,
  onToggleDrawingVisible,
  onRemoveDrawing,
}: {
  symbol: string;
  tf: string;
  drawings: DrawingRow[];
  onSelectDrawing: (id: string) => void;
  onToggleDrawingLock: (id: string) => void;
  onToggleDrawingVisible: (id: string) => void;
  onRemoveDrawing: (id: string) => void;
}) {
  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 8px",
    fontSize: 13,
    borderBottom: "1px solid var(--border)",
  };
  const iconBtn: React.CSSProperties = {
    background: "none",
    border: "none",
    color: "var(--text-dim)",
    cursor: "pointer",
    fontSize: 13,
    padding: "0 3px",
  };

  return (
    <div
      style={{
        width: 260,
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-panel)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          fontWeight: 600,
          fontSize: 13,
          borderBottom: "1px solid var(--border)",
        }}
      >
        Object tree
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        <div style={{ ...rowStyle, color: "var(--text-dim)", fontStyle: "italic" }}>
          {symbol} · {tf}
        </div>
        {drawings.length === 0 && (
          <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>
            No drawings on this chart yet.
          </div>
        )}
        {drawings.map((d) => (
          <div key={d.id} onClick={() => onSelectDrawing(d.id)} style={{ ...rowStyle, cursor: "pointer" }}>
            <span
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                opacity: d.visible ? 1 : 0.5,
              }}
            >
              {CLICK_TOOLS[d.type]?.label ?? d.type}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleDrawingLock(d.id);
              }}
              title={d.locked ? "Unlock" : "Lock"}
              style={{ ...iconBtn, color: d.locked ? "var(--accent)" : "var(--text-dim)" }}
            >
              {d.locked ? "🔒" : "🔓"}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleDrawingVisible(d.id);
              }}
              title={d.visible ? "Hide" : "Show"}
              style={iconBtn}
            >
              {d.visible ? "👁" : "🚫"}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveDrawing(d.id);
              }}
              title="Remove"
              style={iconBtn}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
