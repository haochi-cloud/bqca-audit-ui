import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { Bot, Database, LayoutDashboard, MessagesSquare, ShieldCheck, Users as UsersIcon } from "lucide-react";
import { api } from "./api";
import { resolveRange, shortAgent } from "./lib/format";
import { Select, ThemeToggle } from "./components/ui";
import Overview from "./pages/Overview";
import Conversations from "./pages/Conversations";
import ConversationPage from "./pages/ConversationPage";
import Users from "./pages/Users";
import Agents from "./pages/Agents";

const FilterCtx = createContext(null);
export const useFilters = () => useContext(FilterCtx);

const RANGES = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "365d", label: "Last 365 days" },
  { value: "custom", label: "Custom range" },
];

/** Global filter state lives in the URL so every view is shareable. */
function FilterProvider({ children }) {
  const [sp, setSp] = useSearchParams();
  const [meta, setMeta] = useState(null);
  const [dims, setDims] = useState({ user: [], agent: [], table: [] });
  const [refreshKey, setRefreshKey] = useState(0);

  const get = (k, d = "") => sp.get(k) ?? d;
  const range = get("range", "7d");
  const from = get("from");
  const to = get("to");
  const { start, end } = useMemo(() => resolveRange(range, from, to), [range, from, to, refreshKey]); // eslint-disable-line

  const set = useCallback(
    (patch) => {
      const next = new URLSearchParams(sp);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === "" || v === null || v === undefined || (Array.isArray(v) && !v.length)) next.delete(k);
        else next.set(k, Array.isArray(v) ? v.join(",") : String(v));
      });
      setSp(next, { replace: true });
    },
    [sp, setSp],
  );

  useEffect(() => { api.meta().then(setMeta).catch(() => {}); }, []);
  useEffect(() => { api.dimensions({ start, end }).then(setDims).catch(() => {}); }, [start, end]);

  const value = {
    sp, get, set, meta, dims, start, end, range, from, to,
    table: get("table"), agent: get("agent"), user: get("user"),
    refresh: () => setRefreshKey((k) => k + 1), refreshKey,
  };
  return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
}

function GlobalFilters() {
  const f = useFilters();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select
        className="w-44"
        label="Time range"
        value={f.range}
        placeholder={null}
        options={RANGES}
        onChange={(v) => f.set({ range: v === "7d" ? "" : v })}
      />
      {f.range === "custom" && (
        <>
          <div>
            <label className="label">From</label>
            <input type="datetime-local" className="input w-52" value={f.from} onChange={(e) => f.set({ from: e.target.value })} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="datetime-local" className="input w-52" value={f.to} onChange={(e) => f.set({ to: e.target.value })} />
          </div>
        </>
      )}
      <Select
        className="w-48"
        label="Agent table"
        value={f.table}
        options={f.dims.table.map((d) => ({ value: d.value, label: `${d.value} (${d.n})` }))}
        onChange={(v) => f.set({ table: v, offset: "" })}
      />
      <Select
        className="w-52"
        label="Data agent"
        value={f.agent}
        options={f.dims.agent.map((d) => ({ value: d.value, label: `${shortAgent(d.value)}… (${d.n})` }))}
        onChange={(v) => f.set({ agent: v, offset: "" })}
      />
      <Select
        className="w-56"
        label="User"
        value={f.user}
        options={f.dims.user.map((d) => ({ value: d.value, label: `${d.value} (${d.n})` }))}
        onChange={(v) => f.set({ user: v, offset: "" })}
      />
    </div>
  );
}

function Nav() {
  const { search } = useLocation();
  const keep = new URLSearchParams(search);
  ["sel", "offset", "q", "flags", "sort", "dir"].forEach((k) => keep.delete(k));
  const qs = keep.toString() ? `?${keep}` : "";
  const items = [
    { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/conversations", label: "Conversations", icon: MessagesSquare },
    { to: "/users", label: "Users", icon: UsersIcon },
    { to: "/agents", label: "Agents", icon: Bot },
  ];
  return (
    <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={`${to}${qs}`}
          end={end}
          className={({ isActive }) =>
            `flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
              isActive
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-500 hover:border-blue-500/50 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`
          }
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Shell() {
  const f = useFilters();
  const { pathname } = useLocation();
  const isDetail = pathname.startsWith("/conversation/");
  return (
    <div className="mx-auto max-w-[1600px] p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">BQCA Conversation Audit</h1>
            <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <Database className="h-3.5 w-3.5" />
              <span className="font-mono">{f.meta ? `${f.meta.project}.${f.meta.dataset}` : "…"}</span>
              {f.meta && <span>· {f.meta.tables.length} agent table{f.meta.tables.length === 1 ? "" : "s"}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {f.meta?.viewer && (
            <span className="hidden sm:inline text-xs text-zinc-500 dark:text-zinc-400" title="Signed in via IAP. Views are audit-logged.">
              {f.meta.viewer}
            </span>
          )}
          <ThemeToggle />
        </div>
      </header>
      {!isDetail && (
        <>
          <Nav />
          <GlobalFilters />
        </>
      )}
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/conversations" element={<Conversations />} />
        <Route path="/conversation/view" element={<ConversationPage />} />
        <Route path="/users" element={<Users />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <FilterProvider>
      <Shell />
    </FilterProvider>
  );
}
