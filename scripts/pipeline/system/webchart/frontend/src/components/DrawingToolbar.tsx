import { useState } from "react";
import { CLICK_TOOLS, DRAWING_GROUPS } from "../lib";

export function ToolGroupMenu({
  group,
  activeTool,
  onSelect,
  btn,
}: {
  group: (typeof DRAWING_GROUPS)[number];
  activeTool: string | null;
  onSelect: (tool: string | null) => void;
  btn: (active: boolean) => React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(CLICK_TOOLS).filter(([, t]) => t.group === group);
  const activeInGroup = activeTool !== null && entries.some(([id]) => id === activeTool);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={btn(activeInGroup)}>
        {group} {activeInGroup && `· ${CLICK_TOOLS[activeTool!].label}`}
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
            padding: 4,
            zIndex: 10,
            minWidth: 140,
          }}
        >
          {entries.map(([id, t]) => (
            <div
              key={id}
              onClick={() => {
                onSelect(activeTool === id ? null : id);
                setOpen(false);
              }}
              style={{
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 13,
                borderRadius: 3,
                background: activeTool === id ? "var(--accent)" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (activeTool !== id) e.currentTarget.style.background = "var(--border)";
              }}
              onMouseLeave={(e) => {
                if (activeTool !== id) e.currentTarget.style.background = "transparent";
              }}
            >
              {t.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Replay is a real TradingView toolstrip button (paired with Alert); Volume/VWAP moved
// into IndicatorMenu and AVWAP/Volume-Profile moved into the left rail's "More" overflow —
// on TV those are indicators/drawing-tools, not toolstrip buttons.
export function DrawingToolbar({
  replayArmed,
  onToggleReplayArm,
  replayActive,
}: {
  replayArmed: boolean;
  onToggleReplayArm: () => void;
  replayActive: boolean;
}) {
  const btn = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--accent)" : "var(--bg-panel)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "5px 10px",
    fontSize: 13,
    cursor: "pointer",
  });
  return (
    <button
      onClick={onToggleReplayArm}
      style={btn(replayArmed || replayActive)}
      title="Click a bar to start replay from there"
    >
      {replayArmed ? "Click chart..." : "Replay"}
    </button>
  );
}

