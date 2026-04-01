import { useEffect, useState } from "react";
import { api } from "../api";
import type { PopulationInsights } from "../api";

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: { bg: string; text: string; border: string };
}) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        backgroundColor: accent.bg,
        border: `1px solid ${accent.border}`,
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: accent.text, opacity: 0.7 }}>
        {label}
      </p>
      <p className="text-3xl font-bold" style={{ color: accent.text }}>{value}</p>
    </div>
  );
}

export function PopulationDashboard() {
  const [insights, setInsights] = useState<PopulationInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchExisting() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getPopulationInsights();
      setInsights(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchExisting(); }, []);

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.analyzePopulation();
      setInsights(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const maxFreq = insights
    ? Math.max(...insights.top_churn_factors.map((f) => f.frequency), 1)
    : 1;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex gap-3">
        <button
          className="text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
          style={{ backgroundColor: loading ? "#5eead4" : "#0d9488" }}
          onClick={runAnalysis}
          disabled={loading}
        >
          {loading ? "Analyzing population…" : "Run Population Analysis"}
        </button>
      </div>

      {error && (
        <div
          className="rounded-xl p-4 text-sm"
          style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}
        >
          {error}
        </div>
      )}

      {loading && (
        <div
          className="rounded-2xl p-5 text-sm animate-pulse"
          style={{ backgroundColor: "#f0fdfa", border: "1px solid #99f6e4", color: "#0f766e" }}
        >
          Population Intelligence Agent is scanning all customers…
        </div>
      )}

      {insights && (
        <div className="space-y-5">
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Total Processed"
              value={insights.total_processed}
              accent={{ bg: "#f7f6f3", text: "#374151", border: "#e5e1da" }}
            />
            <StatCard
              label="High Risk"
              value={insights.high_risk_count}
              accent={{ bg: "#fef2f2", text: "#dc2626", border: "#fecaca" }}
            />
            <StatCard
              label="Medium Risk"
              value={insights.medium_risk_count}
              accent={{ bg: "#fffbeb", text: "#d97706", border: "#fde68a" }}
            />
            <StatCard
              label="Low Risk"
              value={insights.low_risk_count}
              accent={{ bg: "#f0fdf4", text: "#16a34a", border: "#bbf7d0" }}
            />
          </div>

          {/* Top Churn Factors */}
          <div
            className="rounded-2xl p-5"
            style={{ backgroundColor: "#ffffff", border: "1px solid #ede9e2", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
          >
            <p className="text-sm font-semibold mb-5" style={{ color: "#111827" }}>Top Churn Factors</p>
            <div className="space-y-3">
              {insights.top_churn_factors.map((f, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs w-4 flex-shrink-0 text-right" style={{ color: "#9ca3af" }}>{i + 1}</span>
                  <span className="text-sm w-48 flex-shrink-0 truncate" style={{ color: "#374151" }}>{f.factor}</span>
                  <div
                    className="flex-1 rounded-full overflow-hidden"
                    style={{ height: 6, backgroundColor: "#f0ede8" }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(f.frequency / maxFreq) * 100}%`,
                        background: "linear-gradient(90deg, #f97316, #fb923c)",
                      }}
                    />
                  </div>
                  <span className="text-xs w-10 text-right" style={{ color: "#9ca3af" }}>{f.frequency}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Risk Segments */}
          <div
            className="rounded-2xl p-5"
            style={{ backgroundColor: "#ffffff", border: "1px solid #ede9e2", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
          >
            <p className="text-sm font-semibold mb-5" style={{ color: "#111827" }}>Risk Segments</p>
            <div className="space-y-3">
              {insights.risk_segments.map((seg, i) => (
                <div key={i} className="flex items-center gap-4">
                  <span className="text-sm flex-1" style={{ color: "#374151" }}>{seg.segment}</span>
                  <div className="flex items-center gap-3">
                    <div
                      className="rounded-full overflow-hidden"
                      style={{ width: 96, height: 6, backgroundColor: "#f0ede8" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(seg.churn_rate * 100, 100)}%`,
                          background: "linear-gradient(90deg, #0d9488, #2dd4bf)",
                        }}
                      />
                    </div>
                    <span className="text-xs w-12 text-right" style={{ color: "#9ca3af" }}>
                      {(seg.churn_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Systemic Recommendation */}
          <div
            className="rounded-2xl p-5"
            style={{ backgroundColor: "#f0fdfa", border: "1px solid #99f6e4" }}
          >
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#0f766e" }}>
              Systemic Recommendation
            </p>
            <p className="text-sm" style={{ color: "#134e4a" }}>{insights.recommended_systemic_action}</p>
          </div>
        </div>
      )}
    </div>
  );
}
