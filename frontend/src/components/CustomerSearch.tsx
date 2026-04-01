import { useEffect, useState } from "react";
import { api } from "../api";
import type { CustomerResult } from "../api";
import { RiskBadge } from "./RiskBadge";

const PIPELINE_STEPS = [
  { key: "orchestrator", label: "Orchestrator — fetching profile & scoring risk" },
  { key: "analyst", label: "Risk Analyst — identifying churn factors" },
  { key: "strategist", label: "Retention Strategist — crafting strategy" },
  { key: "validator", label: "Validator — quality checking strategy" },
];

function urgencyColor(u: string) {
  if (u === "immediate") return "text-red-600 font-semibold";
  if (u === "within_week") return "text-amber-600 font-semibold";
  return "text-emerald-600 font-semibold";
}

interface Props {
  initialCustomerId?: string;
}

export function CustomerSearch({ initialCustomerId = "" }: Props) {
  const [inputId, setInputId] = useState(initialCustomerId);
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [result, setResult] = useState<CustomerResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On mount with an initialCustomerId: try GET first, fall back to full pipeline
  useEffect(() => {
    if (!initialCustomerId) return;
    api.getCustomerResult(initialCustomerId)
      .then((data) => setResult(data))
      .catch(() => handleAnalyze()); // handleAnalyze owns loading state
  }, [initialCustomerId]);

  async function handleAnalyze() {
    const id = inputId.trim();
    if (!id) return;
    setError(null);
    setResult(null);
    setLoading(true);

    // Simulate pipeline progress — cancelled flag prevents timers firing after response arrives
    let cancelled = false;
    setActiveStep("orchestrator");
    const timer1 = setTimeout(() => { if (!cancelled) setActiveStep("analyst"); }, 2000);
    const timer2 = setTimeout(() => { if (!cancelled) setActiveStep("strategist"); }, 6000);
    const timer3 = setTimeout(() => { if (!cancelled) setActiveStep("validator"); }, 11000);

    try {
      const data = await api.analyzeCustomer(id);
      cancelled = true;
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActiveStep(null);
      setLoading(false);
    }
  }

  const visibleSteps = result
    ? PIPELINE_STEPS.filter((s) => {
        if (s.key === "analyst" && !result.analyst_output) return false;
        if (
          (s.key === "strategist" || s.key === "validator") &&
          !result.retention_strategy
        )
          return false;
        return true;
      })
    : [];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Search bar */}
      <div className="flex gap-2">
        <input
          className="border rounded-xl px-4 py-2.5 flex-1 text-sm focus:outline-none focus:ring-2 transition-shadow"
          style={{
            borderColor: "#e5e1da",
            backgroundColor: "#ffffff",
          }}
          placeholder="Enter Customer ID (e.g. 7590-VHVEG)"
          value={inputId}
          onChange={(e) => setInputId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
          disabled={loading}
        />
        <button
          className="text-white px-6 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
          style={{ backgroundColor: loading ? "#5eead4" : "#0d9488" }}
          onClick={handleAnalyze}
          disabled={loading || !inputId.trim()}
        >
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      {/* Pipeline steps */}
      {(loading || result) && (
        <div
          className="rounded-2xl p-5 space-y-2"
          style={{ backgroundColor: "#ffffff", border: "1px solid #ede9e2", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "#9ca3af" }}>
            Pipeline
          </p>
          {(loading ? PIPELINE_STEPS : visibleSteps).map((step) => {
            const isActive = activeStep === step.key;
            const isDone = result !== null;
            return (
              <div key={step.key} className="flex items-center gap-3 text-sm">
                <span
                  className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold
                    ${isActive ? "animate-pulse text-white" : isDone ? "text-white" : "text-gray-400"}`}
                  style={{
                    backgroundColor: isActive ? "#0d9488" : isDone ? "#10b981" : "#e5e7eb",
                    fontSize: 10,
                  }}
                >
                  {isDone ? "✓" : isActive ? "●" : "○"}
                </span>
                <span
                  style={{
                    color: isActive ? "#0d9488" : isDone ? "#374151" : "#9ca3af",
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div
          className="rounded-xl p-4 text-sm"
          style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}
        >
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Customer card */}
          <div
            className="rounded-2xl p-5"
            style={{ backgroundColor: "#ffffff", border: "1px solid #ede9e2", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-widest mb-1" style={{ color: "#9ca3af" }}>Customer</p>
                <p className="font-mono font-bold text-base" style={{ color: "#111827" }}>{result.customer_id}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-widest mb-1" style={{ color: "#9ca3af" }}>Risk Level</p>
                <RiskBadge level={result.risk_level} />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { label: "Contract", value: result.profile_summary.contract },
                { label: "Tenure", value: `${result.profile_summary.tenure} months` },
                { label: "Monthly", value: `$${result.profile_summary.monthly_charges}` },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-xl p-3"
                  style={{ backgroundColor: "#f7f6f3" }}
                >
                  <span className="text-xs block mb-1" style={{ color: "#9ca3af" }}>{label}</span>
                  <span className="text-sm font-medium" style={{ color: "#374151" }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Risk factors */}
          {result.analyst_output && (
            <div
              className="rounded-2xl p-5"
              style={{ backgroundColor: "#ffffff", border: "1px solid #ede9e2", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
            >
              <p className="text-sm font-semibold mb-1" style={{ color: "#111827" }}>Top 3 Churn Risk Factors</p>
              <p className="text-sm mb-4" style={{ color: "#6b7280" }}>{result.analyst_output.summary}</p>
              <div className="space-y-3">
                {result.analyst_output.risk_factors.map((rf, i) => (
                  <div key={i} className="flex gap-3">
                    <span
                      className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: "#fff7ed", color: "#ea580c" }}
                    >
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "#111827" }}>{rf.factor}</p>
                      <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>{rf.explanation}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Retention strategy */}
          {result.retention_strategy && (
            <div
              className="rounded-2xl p-5"
              style={{ backgroundColor: "#ffffff", border: "1px solid #ede9e2", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
            >
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold" style={{ color: "#111827" }}>
                  {result.retention_strategy.strategy_title}
                </p>
                {result.validation && (
                  <span
                    className="text-xs px-2.5 py-0.5 rounded-full font-semibold"
                    style={{
                      backgroundColor: result.validation.result === "PASS" ? "#dcfce7" : "#fee2e2",
                      color: result.validation.result === "PASS" ? "#16a34a" : "#dc2626",
                    }}
                  >
                    {result.validation.result}
                  </span>
                )}
              </div>

              <div className="space-y-3 mb-4">
                {result.retention_strategy.actions.map((a, i) => (
                  <div
                    key={i}
                    className="pl-4"
                    style={{ borderLeft: "2px solid #99f6e4" }}
                  >
                    <p className="text-sm font-medium" style={{ color: "#111827" }}>{a.action}</p>
                    <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>{a.rationale}</p>
                    <p className={`text-xs mt-1 ${urgencyColor(a.urgency)}`}>
                      {a.urgency.replace(/_/g, " ")}
                    </p>
                  </div>
                ))}
              </div>

              <div
                className="rounded-xl p-4 mb-3"
                style={{ backgroundColor: "#f0fdfa", border: "1px solid #99f6e4" }}
              >
                <p className="text-xs font-semibold mb-1" style={{ color: "#0f766e" }}>Personalized Offer</p>
                <p className="text-sm" style={{ color: "#134e4a" }}>{result.retention_strategy.personalized_offer}</p>
              </div>

              <div
                className="rounded-xl p-4"
                style={{ backgroundColor: "#f7f6f3" }}
              >
                <p className="text-xs font-semibold mb-1" style={{ color: "#9ca3af" }}>Success Metric</p>
                <p className="text-sm" style={{ color: "#374151" }}>{result.retention_strategy.success_metric}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
