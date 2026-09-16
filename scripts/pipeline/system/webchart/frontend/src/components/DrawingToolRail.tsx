import { useState } from "react";
import { CLICK_TOOLS, DRAWING_GROUPS, type PeriodicMode } from "../lib";
import { VolumeProfileMenu } from "./VolumeProfileMenu";

// TradingView's own left rail: a 52px vertical strip, one split-button per tool group
// (icon + small arrow), the arrow opening a flyout of every tool in that group. Icon path
// data below was pulled directly from TradingView's live DOM (their toolbar flyout SVGs) —
// generic tool-shape geometry, not their logo/trademark — redrawn here as our own <svg>
// elements rather than any lifted asset file.
function Icon({ paths, size = 18 }: { paths: string[]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="currentColor">
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

const CURSOR_PATHS = ["M18 15h8v-1h-8z", "M14 18v8h1v-8zM14 3v8h1v-8zM3 15h8v-1h-8z"];
const BRUSH_PATHS = [
  "M1.789 23l.859-.854.221-.228c.18-.19.38-.409.597-.655.619-.704 1.238-1.478 1.815-2.298.982-1.396 1.738-2.776 2.177-4.081 1.234-3.667 5.957-4.716 8.923-1.263 3.251 3.785-.037 9.38-5.379 9.38h-9.211zm9.211-1c4.544 0 7.272-4.642 4.621-7.728-2.45-2.853-6.225-2.015-7.216.931-.474 1.408-1.273 2.869-2.307 4.337-.599.852-1.241 1.653-1.882 2.383l-.068.078h6.853z",
];
const GROUP_PATHS: Record<string, string[]> = {
  Lines: [
    "M7.354 21.354l14-14-.707-.707-14 14z",
    "M22.5 7c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM5.5 24c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z",
  ],
  Shapes: [
    "M7.5 6h13v-1h-13z",
    "M7.5 23h13v-1h-13z",
    "M5 7.5v13h1v-13z",
    "M22 7.5v13h1v-13z",
    "M5.5 7c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM22.5 7c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM22.5 24c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM5.5 24c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z",
  ],
  Fibonacci: [
    "M3 5h22v-1h-22z",
    "M3 17h22v-1h-22z",
    "M3 11h19.5v-1h-19.5z",
    "M5.5 23h19.5v-1h-19.5z",
    "M3.5 24c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM24.5 12c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z",
  ],
  Trading: [
    "M5.5 20c1.2 0 2.22.86 2.45 2H25v1H7.95a2.5 2.5 0 1 1-2.45-3m0 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M25 18H5v-1h20zm-11-4h3v1h-4V9h1zM5.5 4c1.2 0 2.22.86 2.45 2H25v1H7.95A2.5 2.5 0 1 1 5.5 4m0 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3",
  ],
  Text: [
    "M8 6.5c0-.28.22-.5.5-.5H14v16h-2v1h5v-1h-2V6h5.5c.28 0 .5.22.5.5V9h1V6.5c0-.83-.67-1.5-1.5-1.5h-12C7.67 5 7 5.67 7 6.5V9h1V6.5Z",
  ],
};

export function DrawingToolRail({
  activeTool,
  onSelect,
  magnetMode,
  onToggleMagnet,
  avwapArmed,
  onToggleAvwapArm,
  avwapActive,
  onClearAvwap,
  showVRVP,
  onToggleVRVP,
  periodicMode,
  onPeriodicModeChange,
  avpArmed,
  onToggleAvpArm,
  avpActive,
  onClearAvp,
  frvpArmed,
  onToggleFrvpArm,
  frvpCount,
  onClearFrvp,
}: {
  activeTool: string | null;
  onSelect: (tool: string | null) => void;
  magnetMode: boolean;
  onToggleMagnet: () => void;
  avwapArmed: boolean;
  onToggleAvwapArm: () => void;
  avwapActive: boolean;
  onClearAvwap: () => void;
  showVRVP: boolean;
  onToggleVRVP: () => void;
  periodicMode: PeriodicMode;
  onPeriodicModeChange: (m: PeriodicMode) => void;
  avpArmed: boolean;
  onToggleAvpArm: () => void;
  avpActive: boolean;
  onClearAvp: () => void;
  frvpArmed: boolean;
  onToggleFrvpArm: () => void;
  frvpCount: number;
  onClearFrvp: () => void;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const railBtn = (active: boolean): React.CSSProperties => ({
    width: 44,
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: active ? "var(--accent)" : "transparent",
    color: active ? "var(--accent-text)" : "var(--text)",
    border: "none",
    fontSize: 18,
    cursor: "pointer",
    flexShrink: 0,
  });

  return (
    <div
      style={{
        width: 52,
        borderRight: "1px solid var(--border)",
        background: "var(--bg-panel)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 6,
        gap: 2,
        flexShrink: 0,
        position: "relative",
      }}
    >
      <button
        onClick={() => onSelect(null)}
        title="Cursor"
        style={railBtn(activeTool === null)}
      >
        <Icon paths={CURSOR_PATHS} />
      </button>
      <button
        onClick={() => onSelect(activeTool === "brush" ? null : "brush")}
        title="Brush"
        style={railBtn(activeTool === "brush")}
      >
        <Icon paths={BRUSH_PATHS} />
      </button>
      <div style={{ width: 28, height: 1, background: "var(--border)", margin: "4px 0" }} />
      {DRAWING_GROUPS.map((g) => {
        const entries = Object.entries(CLICK_TOOLS).filter(([, t]) => t.group === g);
        const activeInGroup = activeTool !== null && entries.some(([id]) => id === activeTool);
        return (
          <div key={g} style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
            <button
              onClick={() => setOpenGroup((o) => (o === g ? null : g))}
              title={g}
              style={railBtn(activeInGroup)}
            >
              <Icon paths={GROUP_PATHS[g] ?? []} />
            </button>
            {openGroup === g && (
              <>
                <div
                  style={{ position: "fixed", inset: 0, zIndex: 15 }}
                  onClick={() => setOpenGroup(null)}
                />
                <div
                  style={{
                    position: "absolute",
                    left: "100%",
                    top: 0,
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: 4,
                    zIndex: 16,
                    minWidth: 160,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                  }}
                >
                  <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--text-dim)" }}>{g}</div>
                  {entries.map(([id, t]) => (
                    <div
                      key={id}
                      onClick={() => {
                        onSelect(activeTool === id ? null : id);
                        setOpenGroup(null);
                      }}
                      style={{
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontSize: 13,
                        borderRadius: 3,
                        background: activeTool === id ? "var(--accent)" : "transparent",
                        color: activeTool === id ? "var(--accent-text)" : "var(--text)",
                      }}
                      onMouseEnter={(e) => {
                        if (activeTool !== id) e.currentTarget.style.background = "var(--bg)";
                      }}
                      onMouseLeave={(e) => {
                        if (activeTool !== id) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {t.label}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
      <div style={{ flex: 1 }} />
      <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center", paddingBottom: 6 }}>
        <button onClick={() => setMoreOpen((o) => !o)} title="More tools" style={railBtn(moreOpen)}>
          ⋯
        </button>
        {moreOpen && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 15 }} onClick={() => setMoreOpen(false)} />
            <div
              style={{
                position: "absolute",
                left: "100%",
                bottom: 0,
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: 8,
                zIndex: 16,
                minWidth: 260,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={magnetMode} onChange={onToggleMagnet} />
                <span>Magnet mode</span>
              </label>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13 }}>Anchored VWAP</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={onToggleAvwapArm}
                    style={{
                      background: avwapArmed ? "var(--accent)" : "var(--bg)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "4px 8px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {avwapArmed ? "Click chart..." : "Set anchor"}
                  </button>
                  {avwapActive && (
                    <button
                      onClick={onClearAvwap}
                      style={{
                        background: "var(--bg)",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        padding: "4px 8px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <VolumeProfileMenu
                showVRVP={showVRVP}
                onToggleVRVP={onToggleVRVP}
                periodicMode={periodicMode}
                onPeriodicModeChange={onPeriodicModeChange}
                avpArmed={avpArmed}
                onToggleAvpArm={onToggleAvpArm}
                avpActive={avpActive}
                onClearAvp={onClearAvp}
                frvpArmed={frvpArmed}
                onToggleFrvpArm={onToggleFrvpArm}
                frvpCount={frvpCount}
                onClearFrvp={onClearFrvp}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
