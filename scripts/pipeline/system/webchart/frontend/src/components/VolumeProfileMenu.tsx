import { useState } from "react";
import { VP_COLORS, type PeriodicMode } from "../lib";

export function VolumeProfileMenu({
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
  const [open, setOpen] = useState(false);
  const activeCount = (showVRVP ? 1 : 0) + (periodicMode !== "off" ? 1 : 0) + (avpActive ? 1 : 0) + frvpCount;
  const rowBtn = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--accent)" : "var(--bg-panel)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "5px 10px",
    fontSize: 12,
    cursor: "pointer",
  });
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
        Volume Profile {activeCount > 0 && `(${activeCount})`}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "110%",
            right: 0,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 10,
            zIndex: 10,
            minWidth: 280,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: VP_COLORS.vrvp.poc }}>Visible Range VP</span>
            <button onClick={onToggleVRVP} style={rowBtn(showVRVP)}>
              {showVRVP ? "On" : "Off"}
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: VP_COLORS.periodic.poc }}>Periodic VP</span>
            <div style={{ display: "flex", gap: 3 }}>
              {(["off", "D", "W", "M"] as PeriodicMode[]).map((m) => (
                <button key={m} onClick={() => onPeriodicModeChange(m)} style={rowBtn(periodicMode === m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: VP_COLORS.avp.poc }}>Anchored VP</span>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={onToggleAvpArm} style={rowBtn(avpArmed)}>
                {avpArmed ? "Click chart..." : "Set anchor"}
              </button>
              {avpActive && (
                <button onClick={onClearAvp} style={rowBtn(false)}>
                  ✕
                </button>
              )}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: VP_COLORS.frvp.poc }}>Fixed Range VP</span>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={onToggleFrvpArm} style={rowBtn(frvpArmed)}>
                {frvpArmed ? "Drag on chart..." : "Add range"}
              </button>
              {frvpCount > 0 && (
                <button onClick={onClearFrvp} style={rowBtn(false)}>
                  ✕ ({frvpCount})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

