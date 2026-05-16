import { useEffect, useRef, useState } from "react";
import { api, BASE } from "../api";
import type { CustomerRow } from "../api";
import { RiskBadge } from "./RiskBadge";

type SortKey = "tenure" | "monthly_charges";
type SortDir = "asc" | "desc";

interface Props {
  onSelectCustomer: (id: string) => void;
  page: number;
  onPageChange: (p: number) => void;
  riskFilter: string;
  onRiskFilterChange: (v: string) => void;
  contractFilter: string;
  onContractFilterChange: (v: string) => void;
  sortKey: SortKey | null;
  onSortKeyChange: (k: SortKey | null) => void;
  sortDir: SortDir;
  onSortDirChange: (d: SortDir) => void;
}

const PAGE_SIZE = 100;

interface BatchProgress {
  analyzed: number;
  total: number;
  current_id: string | null;
  done: boolean;
}

function SortIndicator({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== col) return <span className="ml-1" style={{ color: "#d1d5db" }}>↕</span>;
  return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
}

export function CustomerList({
  onSelectCustomer,
  page,
  onPageChange,
  riskFilter,
  onRiskFilterChange,
  contractFilter,
  onContractFilterChange,
  sortKey,
  onSortKeyChange,
  sortDir,
  onSortDirChange,
}: Props) {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [search, setSearch] = useState("");
  const esRef = useRef<EventSource | null>(null);

  async function fetchPage(p: number, rf = riskFilter, cf = contractFilter) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listCustomers(p, PAGE_SIZE, rf, cf);
      setCustomers(res.customers);
      setTotal(res.total);
      setPages(res.pages);
      onPageChange(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchPage(page); }, []);

  // Clean up SSE on unmount
  useEffect(() => () => { esRef.current?.close(); }, []);

  function resetToPage1(fn: () => void, newRiskFilter?: string, newContractFilter?: string) {
    fn();
    const rf = newRiskFilter !== undefined ? newRiskFilter : riskFilter;
    const cf = newContractFilter !== undefined ? newContractFilter : contractFilter;
    if (newRiskFilter !== undefined || newContractFilter !== undefined) {
      fetchPage(1, rf, cf);
    }
  }

  function handleSortClick(col: SortKey) {
    if (sortKey === col) {
      onSortDirChange(sortDir === "asc" ? "desc" : "asc");
    } else {
      onSortKeyChange(col);
      onSortDirChange("asc");
    }
  }

  async function handleRowClick(id: string) {
    setAnalyzing(id);
    try {
      await api.analyzeCustomer(id);
      await fetchPage(page);
    } catch {
      // navigation still happens
    } finally {
      setAnalyzing(null);
      onSelectCustomer(id);
    }
  }

  function handleAnalyzeAll() {
    if (esRef.current) esRef.current.close();
    setBatch({ analyzed: 0, total: 0, current_id: null, done: false });

    const es = new EventSource(`${BASE}/api/customers/analyze-all/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as Partial<BatchProgress>;
      setBatch((prev) => ({
        analyzed: data.analyzed ?? prev?.analyzed ?? 0,
        total: data.total ?? prev?.total ?? 0,
        current_id: data.current_id ?? null,
        done: data.done ?? false,
      }));
      if (data.done) {
        es.close();
        esRef.current = null;
        fetchPage(1);
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setBatch((prev) => prev ? { ...prev, done: true } : null);
      fetchPage(1);
    };
  }

  // Client-side: search filter + "none" risk filter + sort (all other filters are server-side)
  let displayed = customers.filter((c) =>
    c.customer_id.toLowerCase().includes(search.toLowerCase())
  );
  if (riskFilter === "none") {
    displayed = displayed.filter((c) => c.risk_level == null);
  }
  if (sortKey) {
    displayed = [...displayed].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }

  const batchRunning = batch !== null && !batch.done;
  const batchPct = batch && batch.total > 0 ? Math.round((batch.analyzed / batch.total) * 100) : 0;

  const selectStyle: React.CSSProperties = {
    border: "1px solid #e5e1da",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 13,
    backgroundColor: "#ffffff",
    color: "#374151",
    outline: "none",
    cursor: "pointer",
  };

  const thSortStyle: React.CSSProperties = {
    padding: "12px 16px",
    textAlign: "right",
    cursor: "pointer",
    userSelect: "none",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#9ca3af",
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          style={{
            border: "1px solid #e5e1da",
            borderRadius: 10,
            padding: "8px 14px",
            fontSize: 13,
            backgroundColor: "#ffffff",
            color: "#374151",
            outline: "none",
            width: 210,
          }}
          placeholder="Filter by ID on this page…"
          value={search}
          onChange={(e) => resetToPage1(() => setSearch(e.target.value))}
        />

        <select
          style={selectStyle}
          value={riskFilter}
          onChange={(e) => {
            const val = e.target.value;
            resetToPage1(() => onRiskFilterChange(val), val);
          }}
        >
          <option value="all">All risks</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="none">Not analyzed</option>
        </select>

        <select
          style={selectStyle}
          value={contractFilter}
          onChange={(e) => {
            const val = e.target.value;
            resetToPage1(() => onContractFilterChange(val), undefined, val);
          }}
        >
          <option value="all">All contracts</option>
          <option value="Month-to-month">Month-to-month</option>
          <option value="One year">One year</option>
          <option value="Two year">Two year</option>
        </select>

        <span className="text-sm" style={{ color: "#9ca3af" }}>
          {loading ? "Loading…" : `${total} customers total`}
        </span>

        <button
          className="ml-auto text-white px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
          style={{ backgroundColor: batchRunning ? "#5eead4" : "#0d9488" }}
          onClick={handleAnalyzeAll}
          disabled={batchRunning}
        >
          {batchRunning ? "Running…" : "Analyze All"}
        </button>
      </div>

      {/* Batch progress bar */}
      {batch && (
        <div
          className="rounded-2xl p-4 space-y-2"
          style={{ backgroundColor: "#ffffff", border: "1px solid #ede9e2", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
        >
          <div className="flex justify-between text-xs" style={{ color: "#6b7280" }}>
            <span>
              {batch.done
                ? `Done — ${batch.analyzed} / ${batch.total} customers analyzed`
                : `Analyzing… ${batch.analyzed} / ${batch.total} (${batchPct}%)`}
            </span>
            {batch.current_id && !batch.done && (
              <span className="font-mono" style={{ color: "#9ca3af" }}>{batch.current_id}</span>
            )}
          </div>
          <div
            className="w-full rounded-full overflow-hidden"
            style={{ height: 6, backgroundColor: "#f0ede8" }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${batchPct}%`,
                background: batch.done
                  ? "linear-gradient(90deg, #10b981, #34d399)"
                  : "linear-gradient(90deg, #0d9488, #2dd4bf)",
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm" style={{ color: "#dc2626" }}>{error}</p>
      )}

      {/* Table */}
      <div
        className="overflow-auto"
        style={{ borderRadius: 16, border: "1px solid #ede9e2", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
      >
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead style={{ backgroundColor: "#f7f6f3" }}>
            <tr>
              <th
                style={{
                  padding: "12px 16px",
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#9ca3af",
                  borderBottom: "1px solid #ede9e2",
                }}
              >
                Customer ID
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#9ca3af",
                  borderBottom: "1px solid #ede9e2",
                }}
              >
                Contract
              </th>
              <th
                style={{ ...thSortStyle, borderBottom: "1px solid #ede9e2" }}
                onClick={() => handleSortClick("tenure")}
              >
                Tenure (mo)
                <SortIndicator col="tenure" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th
                style={{ ...thSortStyle, borderBottom: "1px solid #ede9e2" }}
                onClick={() => handleSortClick("monthly_charges")}
              >
                Monthly $
                <SortIndicator col="monthly_charges" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  textAlign: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#9ca3af",
                  borderBottom: "1px solid #ede9e2",
                }}
              >
                Risk
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  textAlign: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#9ca3af",
                  borderBottom: "1px solid #ede9e2",
                }}
              >
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((c, idx) => (
              <tr
                key={c.customer_id}
                style={{
                  backgroundColor: "#ffffff",
                  borderBottom: idx < displayed.length - 1 ? "1px solid #f5f3ef" : "none",
                  transition: "background-color 0.1s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0fdfa")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
              >
                <td className="px-4 py-2.5 font-mono text-sm" style={{ color: "#111827" }}>{c.customer_id}</td>
                <td className="px-4 py-2.5 text-sm" style={{ color: "#6b7280" }}>{c.contract ?? "—"}</td>
                <td className="px-4 py-2.5 text-sm text-right" style={{ color: "#6b7280" }}>{c.tenure ?? "—"}</td>
                <td className="px-4 py-2.5 text-sm text-right" style={{ color: "#6b7280" }}>
                  {c.monthly_charges != null ? `$${c.monthly_charges}` : "—"}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <RiskBadge level={c.risk_level} />
                </td>
                <td className="px-4 py-2.5 text-center">
                  {c.risk_level != null ? (
                    <button
                      className="text-xs font-medium underline transition-colors"
                      style={{ color: "#0d9488", background: "none", border: "none", cursor: "pointer" }}
                      onClick={() => onSelectCustomer(c.customer_id)}
                    >
                      View
                    </button>
                  ) : (
                    <button
                      className="text-xs font-medium underline disabled:opacity-50 transition-colors"
                      style={{ color: "#6b7280", background: "none", border: "none", cursor: "pointer" }}
                      onClick={() => handleRowClick(c.customer_id)}
                      disabled={analyzing === c.customer_id || batchRunning}
                    >
                      {analyzing === c.customer_id ? "Analyzing…" : "Analyze"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm" style={{ color: "#6b7280" }}>
          <button
            className="px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
            style={{
              border: "1px solid #e5e1da",
              backgroundColor: "#ffffff",
              color: "#374151",
              cursor: page <= 1 || loading ? "not-allowed" : "pointer",
            }}
            onClick={() => fetchPage(page - 1)}
            disabled={page <= 1 || loading}
          >
            ← Previous
          </button>
          <span className="text-sm" style={{ color: "#9ca3af" }}>Page {page} of {pages}</span>
          <button
            className="px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
            style={{
              border: "1px solid #e5e1da",
              backgroundColor: "#ffffff",
              color: "#374151",
              cursor: page >= pages || loading ? "not-allowed" : "pointer",
            }}
            onClick={() => fetchPage(page + 1)}
            disabled={page >= pages || loading}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
