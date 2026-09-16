import { useState } from "react";

// The experiment to overlay is picked via the Points-of-interest panel (choosing
// a "Backtest trades — <experiment>" source, or a specific trade row from one)
// — this panel just toggles which trade markers are visible on the chart.
export function TradesPanel({
  showLive,
  onToggleLive,
  showBacktest,
  onToggleBacktest,
  experiment,
  showCaEvents,
  onToggleCaEvents,
}: {
  showLive: boolean;
  onToggleLive: () => void;
  showBacktest: boolean;
  onToggleBacktest: () => void;
  experiment: string;
  showCaEvents: boolean;
  onToggleCaEvents: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
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
        Trades
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "110%",
            left: 0,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 10,
            zIndex: 10,
            minWidth: 280,
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={showLive} onChange={onToggleLive} />
            <span>Live/paper trades (Portfolio)</span>
          </label>
          <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={showBacktest} onChange={onToggleBacktest} />
            <span>Backtest experiment trades</span>
          </label>
          {experiment && (
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4, wordBreak: "break-all" }}>
              {experiment}
            </div>
          )}
          <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={showCaEvents} onChange={onToggleCaEvents} />
            <span>CA / split events (Review checklist)</span>
          </label>
        </div>
      )}
    </div>
  );
}

