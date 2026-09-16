import { useState } from "react";
import { MA_PERIODS, MA_COLORS } from "../lib";

export function IndicatorMenu({
  active,
  onToggle,
  showVolume,
  onToggleVolume,
  showVWAP,
  onToggleVWAP,
}: {
  active: Set<number>;
  onToggle: (period: number) => void;
  // Volume/VWAP live here, not as separate toolstrip buttons — on real TradingView
  // they're both just entries you add from the Indicators dialog, not dedicated buttons.
  showVolume: boolean;
  onToggleVolume: () => void;
  showVWAP: boolean;
  onToggleVWAP: () => void;
}) {
  const [open, setOpen] = useState(false);
  const count = active.size;

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
        Indicators {(count > 0 || showVolume || showVWAP) && `(${count + (showVolume ? 1 : 0) + (showVWAP ? 1 : 0)})`}
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
            padding: 8,
            zIndex: 10,
            minWidth: 220,
          }}
        >
          {MA_PERIODS.map((p) => (
            <label
              key={p}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 4px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <input type="checkbox" checked={active.has(p)} onChange={() => onToggle(p)} />
              <span style={{ color: MA_COLORS[p] }}>MA {p}</span>
            </label>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 4px", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={showVolume} onChange={onToggleVolume} />
            <span>Volume</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 4px", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={showVWAP} onChange={onToggleVWAP} />
            <span>VWAP</span>
          </label>
        </div>
      )}
    </div>
  );
}
