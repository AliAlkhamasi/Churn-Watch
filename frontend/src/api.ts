export const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export interface RiskFactor {
  factor: string;
  explanation: string;
}

export interface RetentionAction {
  action: string;
  rationale: string;
  urgency: "immediate" | "within_week" | "within_month";
}

export interface RetentionStrategy {
  strategy_title: string;
  actions: RetentionAction[];
  personalized_offer: string;
  success_metric: string;
}

export interface AnalystOutput {
  risk_factors: RiskFactor[];
  summary: string;
}

export interface Validation {
  result: "PASS" | "FAIL";
  feedback: string;
}

export interface CustomerResult {
  customer_id: string;
  risk_level: "high" | "medium" | "low";
  profile_summary: {
    contract: string;
    tenure: number;
    monthly_charges: number;
  };
  analyst_output: AnalystOutput | null;
  retention_strategy: RetentionStrategy | null;
  validation: Validation | null;
}

export interface CustomerRow {
  customer_id: string;
  contract: string | null;
  tenure: number | null;
  monthly_charges: number | null;
  risk_level: "high" | "medium" | "low" | null;
}

export interface CustomersResponse {
  customers: CustomerRow[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface TopChurnFactor {
  factor: string;
  frequency: number;
}

export interface RiskSegment {
  segment: string;
  churn_rate: number;
}

export interface PopulationInsights {
  total_processed: number;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  top_churn_factors: TopChurnFactor[];
  risk_segments: RiskSegment[];
  recommended_systemic_action: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  analyzeCustomer: (id: string) =>
    request<CustomerResult>(`/api/customer/${id}/analyze`, { method: "POST" }),

  getCustomerResult: (id: string) =>
    request<CustomerResult>(`/api/customer/${id}/result`),

  listCustomers: (page = 1, pageSize = 100, riskFilter?: string, contractFilter?: string) => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (riskFilter && riskFilter !== "all" && riskFilter !== "none") {
      params.set("risk_filter", riskFilter);
    }
    if (contractFilter && contractFilter !== "all") {
      params.set("contract_filter", contractFilter);
    }
    return request<CustomersResponse>(`/api/customers?${params}`);
  },

  analyzePopulation: () =>
    request<PopulationInsights>("/api/population/analyze", { method: "POST" }),

  getPopulationInsights: () =>
    request<PopulationInsights>("/api/population/insights"),
};
