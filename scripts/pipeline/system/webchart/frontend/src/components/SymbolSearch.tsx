import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib";
import type { OptionsSelection } from "./OptionsPicker";


// TradingView's own symbol button: a 28px-tall pill (border-radius 14 == height/2),
// not a bordered rectangle — matched from their live computed styles.
export function SymbolButton({ symbol, onClick }: { symbol: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        minWidth: 120,
        maxWidth: 260,
        textAlign: "left",
        background: "var(--bg-panel)",
        border: "none",
        borderRadius: 14,
        color: symbol ? "var(--text)" : "var(--text-dim)",
        padding: "0 16px",
        height: 28,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {symbol || "Type a symbol..."}
    </button>
  );
}

const SEARCH_TABS = [
  { id: "all", label: "All" },
  { id: "equity", label: "Stocks" },
  { id: "index", label: "Indices" },
  { id: "options", label: "Options" },
] as const;
type SearchTab = (typeof SEARCH_TABS)[number]["id"];

export function SymbolSearchModal({
  open,
  initialQuery,
  onPick,
  onPickOptions,
  onClose,
  mode = "navigate",
  onAdd,
}: {
  open: boolean;
  initialQuery: string;
  onPick: (symbol: string) => void;
  onPickOptions: (sel: OptionsSelection) => void;
  onClose: () => void;
  // "add" mode (used by the watchlist's + button): picking a row adds it and keeps the
  // dialog open for adding more, and a comma/newline-separated paste bulk-adds on Enter —
  // same search UI as the main symbol switcher, TradingView's own "Add symbol" dialog reuses
  // its search dialog the same way.
  mode?: "navigate" | "add";
  onAdd?: (symbols: string[]) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<{ symbol: string; type: string; name: string }[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [tab, setTab] = useState<SearchTab>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  // when set, the modal shows the contract-picker step for this underlying instead of the result list
  const [optionsUnderlying, setOptionsUnderlying] = useState<string>("");
  const [optInstrument, setOptInstrument] = useState<OptionsSelection["instrument"]>("STO");
  const [optExpiries, setOptExpiries] = useState<string[]>([]);
  const [optExpiry, setOptExpiry] = useState("");
  const [optStrikes, setOptStrikes] = useState<number[]>([]);
  const [optStrike, setOptStrike] = useState<number | null>(null);
  const [optType, setOptType] = useState<"CE" | "PE">("CE");
  const isOptionInstrument = optInstrument === "STO" || optInstrument === "IDO";

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setTab("all");
    setOptionsUnderlying("");
    const t = setTimeout(() => {
      inputRef.current?.focus();
      // caret at the end, not selecting the seeded character, so fast typing after
      // opening the modal (e.g. via the global "type anywhere" handler) isn't overwritten
      const len = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(len, len);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`${API_BASE}/api/symbols?q=${encodeURIComponent(query)}&limit=300`)
        .then((r) => r.json())
        .then((data: { symbol: string; type: string; name: string }[]) => {
          setResults(data);
          setActiveIdx(0);
        });
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!optionsUnderlying) return;
    setOptExpiry("");
    setOptExpiries([]);
    fetch(`${API_BASE}/api/options/expiries?symbol=${encodeURIComponent(optionsUnderlying)}&instrument=${optInstrument}`)
      .then((r) => r.json())
      .then(setOptExpiries);
  }, [optionsUnderlying, optInstrument]);

  useEffect(() => {
    if (!optionsUnderlying || !optExpiry || !isOptionInstrument) {
      setOptStrikes([]);
      return;
    }
    fetch(
      `${API_BASE}/api/options/strikes?symbol=${encodeURIComponent(optionsUnderlying)}&expiry=${optExpiry}&instrument=${optInstrument}`
    )
      .then((r) => r.json())
      .then(setOptStrikes);
  }, [optionsUnderlying, optExpiry, optInstrument, isOptionInstrument]);

  if (!open) return null;

  const pick = (r: { symbol: string; type: string }) => {
    if (r.type === "options") {
      setOptionsUnderlying(r.symbol);
      // index underlyings (NIFTY, BANKNIFTY, SENSEX...) only trade as index options/futures
      setOptInstrument(/NIFTY|SENSEX|BANKEX/.test(r.symbol) ? "IDO" : "STO");
      return;
    }
    if (mode === "add") {
      onAdd?.([r.symbol]);
      setQuery("");
      setResults([]);
      inputRef.current?.focus();
      return;
    }
    onPick(r.symbol);
    onClose();
  };

  // "Reliance, ITC, ..." style bulk paste — splits on commas/newlines/whitespace and adds
  // every token at once instead of requiring one search-and-click per symbol.
  const submitBulk = () => {
    const tokens = query
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length < 2) return false;
    onAdd?.(tokens);
    setQuery("");
    setResults([]);
    return true;
  };

  const filtered = tab === "all" ? results.slice(0, 20) : results.filter((r) => r.type === tab).slice(0, 40);
  const btn: React.CSSProperties = {
    background: "var(--bg-panel)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "5px 8px",
    fontSize: 12,
    cursor: "pointer",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          width: 480,
          maxHeight: "65vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {optionsUnderlying ? (
          <>
            <div
              style={{
                padding: "12px 14px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <button onClick={() => setOptionsUnderlying("")} style={{ ...btn, padding: "4px 8px" }}>
                ← back
              </button>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{optionsUnderlying}</span>
            </div>
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 4 }}>
                {(["STO", "STF", "IDO", "IDF"] as const).map((i) => (
                  <button
                    key={i}
                    onClick={() => setOptInstrument(i)}
                    style={{ ...btn, background: optInstrument === i ? "var(--accent)" : "var(--bg-panel)" }}
                  >
                    {i}
                  </button>
                ))}
              </div>
              <select value={optExpiry} onChange={(e) => setOptExpiry(e.target.value)} style={btn}>
                <option value="">Expiry...</option>
                {optExpiries.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              {isOptionInstrument && (
                <>
                  <select value={optStrike ?? ""} onChange={(e) => setOptStrike(Number(e.target.value))} style={btn}>
                    <option value="">Strike...</option>
                    {optStrikes.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["CE", "PE"] as const).map((t) => (
                      <button key={t} onClick={() => setOptType(t)} style={{ ...btn, background: optType === t ? "var(--accent)" : "var(--bg-panel)" }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button
                disabled={!optExpiry || (isOptionInstrument && optStrike === null)}
                onClick={() => {
                  onPickOptions({
                    symbol: optionsUnderlying,
                    instrument: optInstrument,
                    expiry: optExpiry,
                    strike: isOptionInstrument ? optStrike : null,
                    optionType: isOptionInstrument ? optType : null,
                  });
                  onClose();
                }}
                style={{ ...btn, background: "var(--accent)", color: "var(--accent-text)", marginTop: 4 }}
              >
                Load chart
              </button>
            </div>
          </>
        ) : (
          <>
            {mode === "add" && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 14px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 12,
                  color: "var(--text-dim)",
                }}
              >
                <span>Add symbols — paste a comma-separated list to add several at once</span>
                <button
                  onClick={onClose}
                  style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer" }}
                >
                  Done
                </button>
              </div>
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && mode === "add" && submitBulk()) {
                  // handled — bulk-added
                } else if (e.key === "Enter" && filtered[activeIdx]) {
                  pick(filtered[activeIdx]);
                } else if (e.key === "Escape") {
                  onClose();
                }
              }}
              placeholder="Symbol or company name..."
              style={{
                background: "var(--bg)",
                color: "var(--text)",
                border: "none",
                borderBottom: "1px solid var(--border)",
                padding: "12px 14px",
                fontSize: 15,
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 4, padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
              {SEARCH_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTab(t.id);
                    setActiveIdx(0);
                  }}
                  style={{ ...btn, background: tab === t.id ? "var(--accent)" : "var(--bg-panel)" }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div style={{ overflowY: "auto" }}>
              {filtered.length === 0 && (
                <div style={{ padding: "10px 14px", fontSize: 13, color: "var(--text-dim)" }}>
                  {tab === "all" || results.length === 0
                    ? "No matches"
                    : `No ${SEARCH_TABS.find((t) => t.id === tab)?.label.toLowerCase()} match "${query}" — ${results.length} result${results.length === 1 ? "" : "s"} on the All tab`}
                </div>
              )}
              {filtered.map((r, i) => (
                <div
                  key={`${r.type}-${r.symbol}`}
                  onClick={() => pick(r)}
                  onMouseEnter={() => setActiveIdx(i)}
                  style={{
                    padding: "8px 14px",
                    cursor: "pointer",
                    fontSize: 13,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: i === activeIdx ? "var(--border)" : "transparent",
                  }}
                >
                  <span>
                    <span style={{ fontWeight: 600 }}>{r.symbol}</span>
                    {r.name && r.name !== r.symbol && (
                      <span style={{ color: "var(--text-dim)" }}> — {r.name}</span>
                    )}
                  </span>
                  {r.type === "index" && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>INDEX</span>}
                  {r.type === "options" && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>OPTIONS</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

