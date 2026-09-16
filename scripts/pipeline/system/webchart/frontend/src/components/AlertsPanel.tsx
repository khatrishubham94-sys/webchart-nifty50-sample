import { useEffect, useState } from "react";
import { API_BASE } from "../lib";

// EOD-based for now -- /api/alerts/check compares against the last daily
// close. When the live Upstox feed lands, the backend's get_latest_price()
// is the only thing that needs to change; this panel and its polling stay
// the same.
export type Alert = {
  id: string;
  symbol: string;
  condition: "above" | "below" | "crosses_above" | "crosses_below";
  price: number;
  active: boolean;
  createdAt: string;
};

export type AlertLogEntry = {
  id: string;
  alertId: string;
  symbol: string;
  condition: string;
  target: number;
  price: number;
  message: string;
  at: string;
};

const CONDITION_LABELS: Record<Alert["condition"], string> = {
  above: "Crosses above",
  below: "Crosses below",
  crosses_above: "Crosses above (edge)",
  crosses_below: "Crosses below (edge)",
};

export function AlertsPanel({
  open,
  onClose,
  width,
  defaultSymbol,
}: {
  open: boolean;
  onClose: () => void;
  width: number;
  defaultSymbol: string;
}) {
  const [tab, setTab] = useState<"alerts" | "log">("alerts");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [log, setLog] = useState<AlertLogEntry[]>([]);
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [condition, setCondition] = useState<Alert["condition"]>("above");
  const [price, setPrice] = useState("");
  const [checking, setChecking] = useState(false);

  const refresh = () => {
    fetch(`${API_BASE}/api/alerts`).then((r) => r.json()).then(setAlerts);
    fetch(`${API_BASE}/api/alerts/log`).then((r) => r.json()).then(setLog);
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  useEffect(() => {
    setSymbol(defaultSymbol);
  }, [defaultSymbol]);

  if (!open) return null;

  const createAlert = () => {
    const p = parseFloat(price);
    if (!symbol.trim() || Number.isNaN(p)) return;
    fetch(`${API_BASE}/api/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: symbol.trim(), condition, price: p }),
    })
      .then((r) => r.json())
      .then((created: Alert) => {
        setAlerts((prev) => [...prev, created]);
        setPrice("");
      });
  };

  const deleteAlert = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    fetch(`${API_BASE}/api/alerts/${id}`, { method: "DELETE" });
  };

  const toggleActive = (a: Alert) => {
    const active = !a.active;
    setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, active } : x)));
    fetch(`${API_BASE}/api/alerts/${a.id}?active=${active}`, { method: "PATCH" });
  };

  const runCheck = () => {
    setChecking(true);
    fetch(`${API_BASE}/api/alerts/check`, { method: "POST" })
      .then((r) => r.json())
      .then(() => refresh())
      .finally(() => setChecking(false));
  };

  const clearLog = () => {
    setLog([]);
    fetch(`${API_BASE}/api/alerts/log`, { method: "DELETE" });
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    color: "var(--text)",
    fontSize: 12,
    padding: "5px 7px",
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
        }}
      >
        <span>Alerts</span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer" }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["alerts", "log"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "7px 0",
              background: "none",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === t ? "var(--text)" : "var(--text-dim)",
              fontSize: 12,
              fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {t === "alerts" ? "Alerts" : `Log${log.length ? ` (${log.length})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "alerts" && (
        <>
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="Symbol"
              style={inputStyle}
            />
            <select value={condition} onChange={(e) => setCondition(e.target.value as Alert["condition"])} style={inputStyle}>
              {(Object.keys(CONDITION_LABELS) as Alert["condition"][]).map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Price"
              inputMode="decimal"
              style={inputStyle}
              onKeyDown={(e) => e.key === "Enter" && createAlert()}
            />
            <button
              onClick={createAlert}
              style={{
                background: "var(--accent)",
                color: "var(--accent-text)",
                border: "none",
                borderRadius: 4,
                padding: "6px 0",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Create alert
            </button>
            <button
              onClick={runCheck}
              disabled={checking}
              title="EOD-only for now — checks the latest daily close. Will run automatically once live data is wired up."
              style={{
                background: "var(--bg)",
                color: "var(--text-dim)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "5px 0",
                fontSize: 11,
                cursor: checking ? "default" : "pointer",
              }}
            >
              {checking ? "Checking..." : "Check now (EOD)"}
            </button>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {alerts.length === 0 && (
              <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>No alerts set.</div>
            )}
            {alerts.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 8px",
                  fontSize: 12,
                  borderBottom: "1px solid var(--border)",
                  opacity: a.active ? 1 : 0.5,
                }}
              >
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ fontWeight: 600 }}>{a.symbol}</div>
                  <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
                    {CONDITION_LABELS[a.condition]} {a.price}
                  </div>
                </div>
                <button
                  onClick={() => toggleActive(a)}
                  title={a.active ? "Disable" : "Enable"}
                  style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 13 }}
                >
                  {a.active ? "🔔" : "🔕"}
                </button>
                <button
                  onClick={() => deleteAlert(a.id)}
                  title="Remove"
                  style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 13 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "log" && (
        <>
          <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={clearLog}
              disabled={log.length === 0}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-dim)",
                fontSize: 11,
                cursor: log.length === 0 ? "default" : "pointer",
              }}
            >
              Clear log
            </button>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {log.length === 0 && (
              <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>No alerts have fired yet.</div>
            )}
            {log.map((entry) => (
              <div key={entry.id} style={{ padding: "7px 8px", fontSize: 12, borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 600 }}>{entry.message}</div>
                <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
                  {new Date(entry.at).toLocaleString()} · closed at {entry.price}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
