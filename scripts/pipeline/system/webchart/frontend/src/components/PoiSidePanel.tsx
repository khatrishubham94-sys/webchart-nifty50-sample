import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { API_BASE, type PoiRow, type PoiSource } from "../lib";

function rowText(r: PoiRow): string {
  return [r.symbol, r.date, r.endDate, r.label, r.side, r.tag, r.notes]
    .filter((v) => v !== null && v !== undefined)
    .join(" ")
    .toLowerCase();
}

// Exposed to App so the global spacebar handler can advance the panel's
// current row without lifting all of its source/filter/row state up.
export type PoiSidePanelHandle = { next: () => void };

// The old two-step flow, brought back as a docked side panel (like Watchlist
// or Screener) instead of a toolbar dropdown: pick a source, then browse
// every trade in that file at leisure while the chart stays visible. This is
// the "sit down and page through a CSV" tool; it replaced the earlier
// toolbar spotlight-search that tried to do everything in one box.
export const PoiSidePanel = forwardRef<
  PoiSidePanelHandle,
  {
    open: boolean;
    onClose: () => void;
    width: number;
    onJump: (row: PoiRow, source: PoiSource) => void;
  }
>(function PoiSidePanel({ open, onClose, width, onJump }, ref) {
  const [sources, setSources] = useState<PoiSource[]>([]);
  const [sourceQuery, setSourceQuery] = useState("");
  const [source, setSource] = useState<PoiSource | null>(null);
  const [rows, setRows] = useState<PoiRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowFilter, setRowFilter] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-fetched every time the panel opens (not just once) so a sim/study
  // result created since the last open shows up without a page reload.
  useEffect(() => {
    if (!open) return;
    fetch(`${API_BASE}/api/poi/sources`)
      .then((r) => r.json())
      .then(setSources)
      .catch(() => setSources([]));
  }, [open]);

  const selectSource = (s: PoiSource) => {
    setImportError(null);
    setSource(s);
    setRowFilter("");
    setCurrentId(null);
    setLoadingRows(true);
    fetch(`${API_BASE}/api/poi/rows?source=${encodeURIComponent(s.id)}`)
      .then((r) => r.json())
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoadingRows(false));
  };

  const changeFile = () => {
    setSource(null);
    setRows([]);
    setImportError(null);
  };

  // Bypasses filesystem discovery entirely -- for a sim result that isn't
  // under Research/, Backtest/experiments/, or Review/, or is but isn't
  // named poi_*.csv. Reads the file, checks it against the same schema every
  // other source is held to, and shows the rows immediately if it matches.
  const importFile = (file: File) => {
    setImportError(null);
    setImporting(true);
    const form = new FormData();
    form.append("file", file);
    fetch(`${API_BASE}/api/poi/import`, { method: "POST", body: form })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.detail || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: { sourceId: string; sourceLabel: string; rows: PoiRow[] }) => {
        setSource({ id: data.sourceId, label: data.sourceLabel, kind: "poi" });
        setRows(data.rows);
        setRowFilter("");
        setCurrentId(null);
      })
      .catch((e) => setImportError(String(e.message || e)))
      .finally(() => setImporting(false));
  };

  const sourceMatches = useMemo(() => {
    const tokens = sourceQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return sources;
    return sources
      .map((s) => ({ s, score: tokens.filter((t) => s.label.toLowerCase().includes(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.s);
  }, [sources, sourceQuery]);

  const filteredRows = useMemo(() => {
    const tokens = rowFilter.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return rows;
    return rows.filter((r) => {
      const text = rowText(r);
      return tokens.every((t) => text.includes(t));
    });
  }, [rows, rowFilter]);

  const currentIdx = currentId ? filteredRows.findIndex((r) => r.id === currentId) : -1;
  const commit = (row: PoiRow) => {
    if (!source) return;
    onJump(row, source);
    setCurrentId(row.id);
  };

  // Spacebar, handled globally in App -- advances to the row after whatever's
  // current, or the first row if nothing's been jumped to yet in this file.
  useImperativeHandle(
    ref,
    () => ({
      next: () => {
        if (!source || filteredRows.length === 0) return;
        if (currentIdx < 0) commit(filteredRows[0]);
        else if (currentIdx < filteredRows.length - 1) commit(filteredRows[currentIdx + 1]);
      },
    }),
    [source, currentIdx, filteredRows, onJump]
  );

  if (!open) return null;

  const cellStyle: React.CSSProperties = { padding: "5px 6px", whiteSpace: "nowrap" };
  const inputStyle: React.CSSProperties = {
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "5px 8px",
    fontSize: 12,
    width: "100%",
  };

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
          gap: 8,
        }}
      >
        <span>Points of interest</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer" }}>
          ✕
        </button>
      </div>

      {!source ? (
        <>
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={sourceQuery}
              onChange={(e) => setSourceQuery(e.target.value)}
              placeholder="Find a file — experiment, WF, CA checklist..."
              style={inputStyle}
              autoFocus
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importFile(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              style={{ ...inputStyle, cursor: importing ? "default" : "pointer", color: "var(--text-dim)", textAlign: "left" }}
            >
              {importing ? "Importing…" : "⬆ Import CSV..."}
            </button>
            {importError && (
              <div style={{ fontSize: 11, color: "var(--down)" }}>
                {importError}
              </div>
            )}
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {sourceMatches.map((s) => (
              <div
                key={s.id}
                onClick={() => selectSource(s)}
                style={{ padding: "8px 10px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid var(--border)", wordBreak: "break-all" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover, rgba(128,128,128,0.08))")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                {s.label}
              </div>
            ))}
            {sourceMatches.length === 0 && (
              <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>No files match.</div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={changeFile} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-dim)", fontSize: 11, padding: "2px 6px", cursor: "pointer" }}>
              ← change file
            </button>
            <span style={{ fontSize: 11, color: "var(--text-dim)", wordBreak: "break-all", flex: 1 }}>{source.label}</span>
          </div>
          <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6 }}>
            <input
              value={rowFilter}
              onChange={(e) => setRowFilter(e.target.value)}
              placeholder="Filter symbol, date, label..."
              style={inputStyle}
            />
            {currentIdx >= 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>
                <button
                  onClick={() => currentIdx > 0 && commit(filteredRows[currentIdx - 1])}
                  disabled={currentIdx <= 0}
                  style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer" }}
                >
                  ◀
                </button>
                {currentIdx + 1}/{filteredRows.length}
                <button
                  onClick={() => currentIdx < filteredRows.length - 1 && commit(filteredRows[currentIdx + 1])}
                  disabled={currentIdx >= filteredRows.length - 1}
                  style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer" }}
                >
                  ▶
                </button>
              </div>
            )}
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {loadingRows && <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>Loading…</div>}
            {!loadingRows && (
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
                <thead>
                  <tr style={{ position: "sticky", top: 0, background: "var(--bg-panel)", color: "var(--text-dim)", textAlign: "left" }}>
                    <th style={cellStyle}>Symbol</th>
                    <th style={cellStyle}>Date</th>
                    <th style={cellStyle}>Label</th>
                    <th style={cellStyle}>R</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => commit(r)}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        cursor: "pointer",
                        background: r.id === currentId ? "var(--border)" : "transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (r.id !== currentId) e.currentTarget.style.background = "var(--bg-hover, rgba(128,128,128,0.08))";
                      }}
                      onMouseLeave={(e) => {
                        if (r.id !== currentId) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <td style={{ ...cellStyle, fontWeight: 600 }}>{r.symbol}</td>
                      <td style={cellStyle}>{r.date}</td>
                      <td style={cellStyle}>{r.label ?? "—"}</td>
                      <td style={{ ...cellStyle, color: r.rMultiple == null ? "var(--text-dim)" : r.rMultiple >= 0 ? "var(--up)" : "var(--down)" }}>
                        {r.rMultiple != null ? r.rMultiple.toFixed(2) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loadingRows && filteredRows.length === 0 && (
              <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>No rows match.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
});
