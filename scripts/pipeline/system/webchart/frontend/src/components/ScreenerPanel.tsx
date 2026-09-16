import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../lib";

// Tight coupling, not an iframe: /api/screener/momentum calls the exact same
// build_movement_universe() the standalone Streamlit radar (port 8504) uses,
// so ranks/setups here never drift from that dashboard.
type ScreenerRow = {
  Rank: number;
  Symbol: string;
  Close: number | null;
  OneMonthStrength: number | null;
  Setup: string;
  ADR20_Pct: number | null;
  AvgTradedValue22_Cr: number | null;
  BaseAge: number | null;
  NewToday: boolean;
  ATRZoneReady: boolean;
  BreakoutToday: boolean;
};

const SETUP_COLORS: Record<string, string> = {
  "Breakout today": "var(--up)",
  "Preferred ATR zone": "var(--accent)",
  "Base ready": "var(--text)",
  "Early / extended": "var(--text-dim)",
};

export function ScreenerPanel({
  open,
  onClose,
  width,
  onSelectSymbol,
  onAddToWatchlist,
}: {
  open: boolean;
  onClose: () => void;
  width: number;
  onSelectSymbol: (symbol: string) => void;
  onAddToWatchlist: (symbols: string[]) => void;
}) {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [asOf, setAsOf] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onlyReady, setOnlyReady] = useState(false);

  const refresh = () => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/screener/momentum`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { asOf: string; rows: ScreenerRow[] }) => {
        setRows(data.rows);
        setAsOf(data.asOf);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const visibleRows = useMemo(
    () => (onlyReady ? rows.filter((r) => r.ATRZoneReady || r.BreakoutToday) : rows),
    [rows, onlyReady]
  );

  if (!open) return null;

  const toggleSelected = (symbol: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const addSelectedToWatchlist = () => {
    if (selected.size === 0) return;
    onAddToWatchlist([...selected]);
    setSelected(new Set());
  };

  const cellStyle: React.CSSProperties = { padding: "5px 6px", whiteSpace: "nowrap" };

  return (
    <div
      style={{
        width,
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
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>Momentum screener{asOf ? ` · ${asOf}` : ""}</span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer" }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-dim)", cursor: "pointer" }}>
          <input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} />
          Ready/breakout only
        </label>
        <button
          onClick={refresh}
          disabled={loading}
          style={{ background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-dim)", fontSize: 11, padding: "2px 6px", cursor: loading ? "default" : "pointer" }}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
        <button
          onClick={addSelectedToWatchlist}
          disabled={selected.size === 0}
          style={{
            marginLeft: "auto",
            background: selected.size ? "var(--accent)" : "var(--bg)",
            color: selected.size ? "var(--accent-text)" : "var(--text-dim)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 11,
            padding: "2px 8px",
            cursor: selected.size ? "pointer" : "default",
          }}
        >
          + Watchlist ({selected.size})
        </button>
      </div>

      {error && <div style={{ padding: 10, fontSize: 12, color: "var(--down)" }}>Failed to load: {error}</div>}

      <div style={{ overflow: "auto", flex: 1 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "var(--bg-panel)", color: "var(--text-dim)", textAlign: "left" }}>
              <th style={cellStyle}></th>
              <th style={cellStyle}>#</th>
              <th style={cellStyle}>Symbol</th>
              <th style={cellStyle}>Close</th>
              <th style={cellStyle}>1M%</th>
              <th style={cellStyle}>Setup</th>
              <th style={cellStyle}>ADR%</th>
              <th style={cellStyle}>Val(Cr)</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr
                key={r.Symbol}
                onClick={() => onSelectSymbol(r.Symbol)}
                style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover, rgba(128,128,128,0.08))")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                <td style={cellStyle} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(r.Symbol)} onChange={() => toggleSelected(r.Symbol)} />
                </td>
                <td style={cellStyle}>{r.Rank}</td>
                <td style={{ ...cellStyle, fontWeight: 600 }}>
                  {r.Symbol}
                  {r.NewToday && (
                    <span title="New to leader pool today" style={{ marginLeft: 4, color: "var(--up)" }}>
                      ●
                    </span>
                  )}
                </td>
                <td style={cellStyle}>{r.Close ?? "—"}</td>
                <td style={cellStyle}>{r.OneMonthStrength ?? "—"}</td>
                <td style={{ ...cellStyle, color: SETUP_COLORS[r.Setup] ?? "var(--text)" }}>{r.Setup}</td>
                <td style={cellStyle}>{r.ADR20_Pct ?? "—"}</td>
                <td style={cellStyle}>{r.AvgTradedValue22_Cr ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && visibleRows.length === 0 && !error && (
          <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>No symbols match.</div>
        )}
      </div>
    </div>
  );
}
