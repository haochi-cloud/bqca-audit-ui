import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, Copy, Inbox, Loader2, Moon, Sun, X,
} from "lucide-react";
import { fmtNum } from "../lib/format";

export function Card({ title, subtitle, actions, children, className = "", bodyClass = "p-5" }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            {title && <h3 className="text-sm font-semibold tracking-tight">{title}</h3>}
            {subtitle && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Kpi({ icon: Icon, label, value, sub, delta, invert = false, loading }) {
  const good = delta === null || delta === undefined ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <div className="card p-5 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-zinc-400" />}
      </div>
      {loading ? (
        <div className="mt-3 h-8 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      ) : (
        <div className="mt-2 flex items-end gap-2">
          <span className="text-2xl font-semibold tracking-tight">{value}</span>
          {delta !== null && delta !== undefined && isFinite(delta) && (
            <span
              className={`mb-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                good
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
              }`}
              title="vs. previous period of equal length"
            >
              {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(delta * 100).toFixed(0)}%
            </span>
          )}
        </div>
      )}
      {sub && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}

export const FLAG_META = {
  ERROR: { cls: "rose", desc: "An event reported status ERROR or an error_message." },
  TRUNCATED: { cls: "rose", desc: "Payload exceeded the plugin max length and was truncated." },
  TOOL_DENIED: { cls: "rose", desc: "A tool-call security check returned a non-ALLOW verdict." },
  UNGROUNDED_TABLE: { cls: "amber", desc: "Answer contains a numeric markdown table while skip_data_queries=true (no query backing it)." },
  EMPTY_ANSWER: { cls: "amber", desc: "No AGENT_RESPONSE or an empty answer." },
  SLOW: { cls: "amber", desc: "Turn latency exceeded the SLOW_MS threshold." },
  HIGH_TOKENS: { cls: "amber", desc: "Turn token usage exceeded the HIGH_TOKENS threshold." },
  CLARIFYING_Q: { cls: "blue", desc: "Agent asked a clarifying question instead of answering." },
};

const TONE = {
  rose: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800/40",
  amber: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/40",
  blue: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/40",
  green: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/40",
  zinc: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
};

export function Badge({ tone = "zinc", children, title, className = "" }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function FlagBadge({ flag }) {
  const m = FLAG_META[flag] || { cls: "zinc", desc: flag };
  return <Badge tone={m.cls} title={m.desc}>{flag.replace(/_/g, " ").toLowerCase()}</Badge>;
}

export function Spinner({ className = "h-4 w-4" }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function Skeleton({ className = "h-4 w-full" }) {
  return <div className={`animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 ${className}`} />;
}

export function ErrorAlert({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-800/30 dark:bg-rose-900/20 dark:text-rose-300">
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <div className="flex-1 break-words">{String(error)}</div>
      {onRetry && <button className="btn-secondary !py-1" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Alert({ tone = "amber", icon: Icon = AlertTriangle, title, children }) {
  const c = {
    amber: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/30 dark:bg-amber-900/20 dark:text-amber-200",
    blue: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800/30 dark:bg-blue-900/20 dark:text-blue-200",
  }[tone];
  return (
    <div className={`flex gap-3 rounded-lg border p-4 text-sm ${c}`}>
      <Icon className="h-5 w-5 shrink-0 mt-0.5" />
      <div>
        {title && <div className="font-semibold mb-0.5">{title}</div>}
        <div className="opacity-90">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ title = "No data", children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-zinc-500 dark:text-zinc-400">
      <Inbox className="h-8 w-8 opacity-60" />
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="text-xs max-w-sm">{children}</div>}
    </div>
  );
}

export function Select({ label, value, onChange, options, placeholder = "All", disabled, className = "" }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      <div className="relative">
        <select
          className="input appearance-none pr-8 cursor-pointer"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {placeholder !== null && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label ?? o.value}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      </div>
    </div>
  );
}

export function Segmented({ value, onChange, options, disabled }) {
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-1 dark:bg-[#18181b]">
      {options.map((o) => (
        <button
          key={o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          title={o.title}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-all disabled:opacity-50 ${
            value === o.value
              ? "bg-white text-blue-600 shadow-sm dark:bg-zinc-800 dark:text-blue-400"
              : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Multi-select dropdown with checkboxes. */
export function MultiSelect({ label, values, onChange, options, renderOption, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = (v) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <div className="relative z-30" ref={ref}>
      <button className="btn-secondary" disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {label}
        {values.length > 0 && (
          <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">{values.length}</span>
        )}
        <ChevronDown className="h-4 w-4 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-72 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-[#0c0c0f]">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => toggle(o)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                values.includes(o) ? "border-blue-500 bg-blue-500 text-white" : "border-zinc-300 dark:border-zinc-600"}`}>
                {values.includes(o) && <Check className="h-3 w-3" />}
              </span>
              {renderOption ? renderOption(o) : o}
            </button>
          ))}
          {values.length > 0 && (
            <div className="border-t border-zinc-200 px-3 pt-1 dark:border-zinc-800">
              <button className="btn-ghost !px-0 !py-1 text-xs" onClick={() => onChange([])}>Clear selection</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Pagination({ offset, limit, total, onChange, loading }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const btn = "rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed";
  return (
    <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-2.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <span>
        {total === 0 ? "0 results" : `${fmtNum(offset + 1)}–${fmtNum(Math.min(offset + limit, total))} of ${fmtNum(total)}`}
      </span>
      <div className="flex items-center gap-1">
        <button className={btn} disabled={loading || page <= 1} onClick={() => onChange(0)} aria-label="First page"><ChevronsLeft className="h-4 w-4" /></button>
        <button className={btn} disabled={loading || page <= 1} onClick={() => onChange(offset - limit)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        <span className="px-2">Page {page} / {pages}</span>
        <button className={btn} disabled={loading || page >= pages} onClick={() => onChange(offset + limit)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
        <button className={btn} disabled={loading || page >= pages} onClick={() => onChange((pages - 1) * limit)} aria-label="Last page"><ChevronsRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (e) { /* ignore */ }
    window.dispatchEvent(new Event("themechange"));
  }, [dark]);
  return (
    <button className="btn-secondary !p-2" onClick={() => setDark((d) => !d)} aria-label="Toggle theme" title="Toggle theme">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function CopyButton({ text, className = "" }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className={`rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 ${className}`}
      title="Copy"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(typeof text === "string" ? text : JSON.stringify(text, null, 2));
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
    >
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function IconButton({ icon: Icon = X, onClick, title }) {
  return (
    <button onClick={onClick} title={title} className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800">
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function BarList({ items, valueKey = "n", labelKey = "label", onClick, format = fmtNum, tone = "bg-blue-500" }) {
  const max = Math.max(1, ...items.map((i) => i[valueKey] || 0));
  return (
    <ul className="space-y-2">
      {items.map((it, idx) => (
        <li
          key={idx}
          onClick={onClick ? () => onClick(it) : undefined}
          className={`group ${onClick ? "cursor-pointer" : ""}`}
        >
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="truncate text-zinc-700 group-hover:text-blue-600 dark:text-zinc-300 dark:group-hover:text-blue-400 transition-colors">
              {it[labelKey]}
            </span>
            <span className="font-mono text-zinc-500">{format(it[valueKey])}</span>
          </div>
          <div className="h-1.5 rounded-sm bg-zinc-100 dark:bg-zinc-800">
            <div className={`h-1.5 rounded-sm ${it.tone || tone} transition-all`} style={{ width: `${((it[valueKey] || 0) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
