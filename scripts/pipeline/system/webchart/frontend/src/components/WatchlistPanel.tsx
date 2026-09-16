import { useEffect, useRef, useState } from "react";
import { API_BASE, FLAG_COLORS, type Watchlist } from "../lib";

// TradingView's own flag glyph is a pennant/pointer shape, not a circle — path lifted
// from their live DOM (viewBox 0 0 14 12): "M14 12l-4-6 4-6H0v12z".
export function FlagDot({ color, onClick }: { color: string | undefined; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      title="Flag"
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0, lineHeight: 0 }}
    >
      <svg width="12" height="10" viewBox="0 0 14 12">
        <path
          d="M14 12l-4-6 4-6H0v12z"
          fill={color || "none"}
          stroke={color ? "none" : "var(--text-dim)"}
          strokeWidth={color ? 0 : 1.2}
        />
      </svg>
    </button>
  );
}

export function FlagPalette({ onPick, onClear }: { onPick: (color: string) => void; onClear: () => void }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        zIndex: 40,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 8,
        display: "flex",
        gap: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
    >
      {FLAG_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          style={{ width: 16, height: 16, borderRadius: "50%", background: c, border: "none", cursor: "pointer" }}
        />
      ))}
      <button
        onClick={onClear}
        title="Clear flag"
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "transparent",
          border: "1.5px solid var(--text-dim)",
          cursor: "pointer",
          fontSize: 9,
          lineHeight: "12px",
          color: "var(--text-dim)",
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

type Quote = { last: number; prevClose: number | null; change: number | null; changePercent: number | null };
type SymbolDetails = {
  broadSector: string | null;
  sector: string | null;
  broadIndustry: string | null;
  industry: string | null;
  marketCapCr: number | null;
};

export function WatchlistPanel({
  open,
  onClose,
  watchlists,
  activeId,
  onSelectWatchlist,
  onCreate,
  onRename,
  onDelete,
  symbols,
  onOpenAdd,
  onRemoveSymbol,
  currentSymbol,
  onSelectSymbol,
  symbolFlags,
  onSetFlag,
  width,
  onWidthChange,
}: {
  open: boolean;
  onClose: () => void;
  watchlists: Watchlist[];
  activeId: string | null;
  onSelectWatchlist: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  symbols: string[];
  onOpenAdd: () => void;
  onRemoveSymbol: (symbol: string) => void;
  currentSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  symbolFlags: Record<string, string>;
  onSetFlag: (symbol: string, color: string | null) => void;
  width: number;
  onWidthChange: (width: number) => void;
}) {
  const [flagFor, setFlagFor] = useState<string | null>(null);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showListMenu, setShowListMenu] = useState(false);
  const [hoverSymbol, setHoverSymbol] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [details, setDetails] = useState<SymbolDetails | null>(null);
  const [detailsHeight, setDetailsHeight] = useState(
    () => Number(localStorage.getItem("webchart:watchlistDetailsHeight")) || 180
  );
  const detailsHeightRef = useRef(detailsHeight);
  detailsHeightRef.current = detailsHeight;

  const active = watchlists.find((w) => w.id === activeId) ?? null;

  useEffect(() => {
    if (!open || symbols.length === 0) return;
    fetch(`${API_BASE}/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`)
      .then((r) => r.json())
      .then(setQuotes)
      .catch(() => {});
  }, [open, symbols.join(",")]);

  // Details strip at the bottom — sector/industry/market cap for whatever symbol is
  // currently on the chart, sourced from our own screener mapping, TV's "Details" tab.
  useEffect(() => {
    if (!open || !currentSymbol) {
      setDetails(null);
      return;
    }
    fetch(`${API_BASE}/api/symbol_details?symbol=${encodeURIComponent(currentSymbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetails)
      .catch(() => setDetails(null));
  }, [open, currentSymbol]);

  if (!open) return null;

  // Drag-to-resize from the left edge, TradingView-style — width is owned by the parent
  // (App.tsx) so it can persist across reloads the same way priceFitMode/theme do.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => {
      const next = startWidth + (startX - ev.clientX);
      onWidthChange(Math.min(560, Math.max(220, next)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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
        fontSize: 12,
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: -3,
          width: 6,
          cursor: "ew-resize",
          zIndex: 5,
        }}
      />
      {/* Header: watchlist-name dropdown + add/settings/close icons — matches TV's widget header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 8px",
          borderBottom: "1px solid var(--border)",
          position: "relative",
        }}
      >
        <button
          onClick={() => setShowSwitcher((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            color: "var(--text)",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            padding: "4px 4px",
            flex: 1,
            textAlign: "left",
          }}
        >
          {active ? active.name : "Watchlist"}
          <span style={{ fontSize: 9, color: "var(--text-dim)" }}>▾</span>
        </button>
        <button onClick={onOpenAdd} title="Add symbol" style={iconBtn}>
          +
        </button>
        <button
          onClick={() => setShowListMenu((v) => !v)}
          title="Manage this watchlist"
          style={iconBtn}
        >
          ⚙
        </button>
        <button onClick={onClose} title="Close watchlist" style={{ ...iconBtn, color: "var(--text-dim)" }}>
          ✕
        </button>

        {showSwitcher && (
          <div
            onMouseLeave={() => setShowSwitcher(false)}
            style={{
              position: "absolute",
              top: "110%",
              left: 8,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              zIndex: 30,
              minWidth: 200,
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              overflow: "hidden",
            }}
          >
            {watchlists.map((w) => (
              <div
                key={w.id}
                onClick={() => {
                  onSelectWatchlist(w.id);
                  setShowSwitcher(false);
                }}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: w.id === activeId ? 600 : 400,
                  background: w.id === activeId ? "var(--bg)" : "transparent",
                  display: "flex",
                  justifyContent: "space-between",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg)")}
                onMouseLeave={(e) => {
                  if (w.id !== activeId) e.currentTarget.style.background = "transparent";
                }}
              >
                <span>{w.name}</span>
                <span style={{ color: "var(--text-dim)" }}>{w.symbols.length}</span>
              </div>
            ))}
            <div
              onClick={() => {
                const name = window.prompt("New watchlist name:", `Watchlist ${watchlists.length + 1}`);
                if (name) onCreate(name);
                setShowSwitcher(false);
              }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: 13,
                color: "var(--accent)",
                borderTop: "1px solid var(--border)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              + New list
            </div>
          </div>
        )}

        {showListMenu && active && (
          <div
            style={{
              position: "absolute",
              top: "110%",
              right: 30,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 6,
              zIndex: 30,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minWidth: 140,
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            }}
          >
            <button
              onClick={() => {
                const name = window.prompt("Rename watchlist:", active.name);
                if (name) onRename(active.id, name);
                setShowListMenu(false);
              }}
              style={menuBtn}
            >
              Rename
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Delete "${active.name}"?`)) onDelete(active.id);
                setShowListMenu(false);
              }}
              style={{ ...menuBtn, color: "#ef5350" }}
            >
              Delete list
            </button>
          </div>
        )}
      </div>

      {active ? (
        <>
          {/* Table header — flag/Symbol/Last/Chg/Chg%, matching TV's column layout */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "4px 10px",
              borderBottom: "1px solid var(--border)",
              color: "var(--text-dim)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.3,
            }}
          >
            <div style={{ width: 18 }} />
            <div style={{ flex: 1 }}>Symbol</div>
            <div style={{ width: 60, textAlign: "right" }}>Last</div>
            <div style={{ width: 50, textAlign: "right" }}>Chg%</div>
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {symbols.length === 0 && (
              <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>
                Empty — click + to add symbols (comma/space/newline separated).
              </div>
            )}
            {symbols.map((s) => {
              const q = quotes[s];
              const up = q?.change != null && q.change >= 0;
              return (
                <div
                  key={s}
                  onClick={() => onSelectSymbol(s)}
                  onMouseEnter={() => setHoverSymbol(s)}
                  onMouseLeave={() => setHoverSymbol((h) => (h === s ? null : h))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: 30,
                    padding: "0 10px",
                    cursor: "pointer",
                    background: s === currentSymbol ? "var(--bg)" : "transparent",
                    position: "relative",
                    gap: 6,
                  }}
                >
                  <div style={{ width: 18, display: "flex" }}>
                    <FlagDot
                      color={symbolFlags[s]}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFlagFor((f) => (f === s ? null : s));
                      }}
                    />
                  </div>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: s === currentSymbol ? 600 : 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s}
                  </span>
                  {hoverSymbol === s ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSymbol(s);
                      }}
                      title="Remove from list"
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-dim)",
                        cursor: "pointer",
                        fontSize: 12,
                        padding: 0,
                        width: 110,
                        textAlign: "right",
                      }}
                    >
                      Remove ✕
                    </button>
                  ) : (
                    <>
                      <span style={{ width: 60, textAlign: "right", fontSize: 12 }}>
                        {q ? q.last.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                      </span>
                      <span
                        style={{
                          width: 50,
                          textAlign: "right",
                          fontSize: 12,
                          color: q?.changePercent == null ? "var(--text-dim)" : up ? "var(--up)" : "var(--down)",
                        }}
                      >
                        {q?.changePercent != null ? `${up ? "+" : ""}${q.changePercent.toFixed(2)}%` : "—"}
                      </span>
                    </>
                  )}
                  {flagFor === s && (
                    <div style={{ position: "absolute", top: "100%", left: 10 }}>
                      <FlagPalette
                        onPick={(color) => {
                          onSetFlag(s, color);
                          setFlagFor(null);
                        }}
                        onClear={() => {
                          onSetFlag(s, null);
                          setFlagFor(null);
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Details strip — sector/industry/market cap for the chart's current symbol,
              matching TV's "Watchlist, details, and news" combined widget. */}
          {currentSymbol && (
            <div style={{ flexShrink: 0, position: "relative", borderTop: "1px solid var(--border)" }}>
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startY = e.clientY;
                  const startHeight = detailsHeight;
                  const onMove = (ev: MouseEvent) => {
                    const next = startHeight + (startY - ev.clientY);
                    setDetailsHeight(Math.min(500, Math.max(60, next)));
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    try {
                      localStorage.setItem("webchart:watchlistDetailsHeight", String(detailsHeightRef.current));
                    } catch {
                      /* ignore quota errors */
                    }
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
                title="Drag to resize"
                style={{
                  position: "absolute",
                  top: -3,
                  left: 0,
                  right: 0,
                  height: 6,
                  cursor: "ns-resize",
                  zIndex: 5,
                }}
              />
              <div style={{ padding: "8px 10px", height: detailsHeight, overflowY: "auto" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{currentSymbol}</div>
              {details ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {[
                    ["Sector", details.sector],
                    ["Industry", details.industry],
                    ["Broad sector", details.broadSector],
                    ["Broad industry", details.broadIndustry],
                  ].map(([label, value]) =>
                    value ? (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                        <span style={{ color: "var(--text-dim)" }}>{label}</span>
                        <span style={{ textAlign: "right", maxWidth: "60%" }}>{value}</span>
                      </div>
                    ) : null
                  )}
                  {details.marketCapCr != null && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: "var(--text-dim)" }}>Market cap</span>
                      <span>₹{details.marketCapCr.toLocaleString(undefined, { maximumFractionDigits: 0 })} Cr</span>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>No sector/industry data for this symbol.</div>
              )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: 14, fontSize: 13, color: "var(--text-dim)" }}>
          <button
            onClick={() => {
              const name = window.prompt("New watchlist name:", "Watchlist 1");
              if (name) onCreate(name);
            }}
            style={{
              background: "var(--accent)",
              color: "var(--accent-text)",
              border: "none",
              borderRadius: 4,
              padding: "6px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            + Create a watchlist
          </button>
        </div>
      )}
    </div>
  );
}

const menuBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text)",
  textAlign: "left",
  padding: "6px 8px",
  fontSize: 12,
  cursor: "pointer",
  borderRadius: 4,
};

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 15,
  padding: "2px 6px",
  lineHeight: 1,
};
