import React, { useState } from "react";
import { CustomerSearch } from "./components/CustomerSearch";
import { CustomerList } from "./components/CustomerList";
import { PopulationDashboard } from "./components/PopulationDashboard";

type Tab = "search" | "list" | "population";

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("search");
  const [selectedId, setSelectedId] = useState("");

  // CustomerList filter/sort/page state lifted here so it survives tab switches
  const [listPage, setListPage] = useState(1);
  const [listRiskFilter, setListRiskFilter] = useState("all");
  const [listContractFilter, setListContractFilter] = useState("all");
  const [listSortKey, setListSortKey] = useState<"tenure" | "monthly_charges" | null>(null);
  const [listSortDir, setListSortDir] = useState<"asc" | "desc">("asc");

  function handleSelectCustomer(id: string) {
    setSelectedId(id);
    setTab("search");
  }

  const navItems: { key: Tab; label: string; Icon: () => React.ReactElement }[] = [
    { key: "search", label: "Customer Search", Icon: SearchIcon },
    { key: "list", label: "Customer List", Icon: ListIcon },
    { key: "population", label: "Population Dashboard", Icon: ChartIcon },
  ];

  const pageTitle = navItems.find((n) => n.key === tab)?.label ?? "";

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "#f7f6f3" }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col flex-shrink-0 sticky top-0 h-screen"
        style={{ width: 240, backgroundColor: "#ffffff", borderRight: "1px solid #ede9e2" }}
      >
        {/* Logo */}
        <div className="flex items-center px-5 py-6" style={{ borderBottom: "1px solid #ede9e2" }}>
          <div className="font-bold text-base" style={{ color: "#111827" }}>Churn Watch</div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3">
          {navItems.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="w-full flex items-center gap-3 px-3 text-left text-sm font-medium mb-1 transition-colors"
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontWeight: tab === key ? 600 : 500,
                color: tab === key ? "#0d9488" : "#6b7280",
                backgroundColor: tab === key ? "#f0fdfa" : "transparent",
              }}
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>

        {/* Sidebar footer */}
        <div className="px-5 py-4" style={{ borderTop: "1px solid #ede9e2" }}>
          <p className="text-xs" style={{ color: "#9ca3af" }}>Analyze your customers</p>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-screen overflow-auto">
        {/* Page header */}
        <header
          className="flex-shrink-0 px-8 py-5"
          style={{ backgroundColor: "#ffffff", borderBottom: "1px solid #ede9e2" }}
        >
          <h1 className="text-lg font-bold m-0" style={{ color: "#111827" }}>{pageTitle}</h1>
        </header>

        <main className="flex-1 p-8">
          {tab === "search" && (
            <CustomerSearch key={selectedId} initialCustomerId={selectedId} />
          )}
          {tab === "list" && (
            <CustomerList
              onSelectCustomer={handleSelectCustomer}
              page={listPage}
              onPageChange={setListPage}
              riskFilter={listRiskFilter}
              onRiskFilterChange={setListRiskFilter}
              contractFilter={listContractFilter}
              onContractFilterChange={setListContractFilter}
              sortKey={listSortKey}
              onSortKeyChange={setListSortKey}
              sortDir={listSortDir}
              onSortDirChange={setListSortDir}
            />
          )}
          {tab === "population" && <PopulationDashboard />}
        </main>
      </div>
    </div>
  );
}
