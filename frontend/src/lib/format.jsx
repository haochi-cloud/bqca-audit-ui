import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

export const toDate = (v) => (v ? (v instanceof Date ? v : parseISO(v)) : null);
export const fmtDateTime = (v) => (v ? format(toDate(v), "MMM dd, yyyy HH:mm:ss") : "—");
export const fmtDate = (v) => (v ? format(toDate(v), "MMM dd, yyyy") : "—");
export const fmtTime = (v) => (v ? format(toDate(v), "HH:mm:ss") : "—");
export const fmtAgo = (v) => (v ? `${formatDistanceToNowStrict(toDate(v))} ago` : "—");

export const fmtNum = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US"));
export const fmtCompact = (n) =>
  n === null || n === undefined
    ? "—"
    : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
export const fmtMs = (ms) => {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
};
export const fmtPct = (x) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(0)}%`);

export const shortId = (id, n = 8) => (id ? (id.length > n + 2 ? `${id.slice(0, n)}…` : id) : "—");
export const shortAgent = (id) => (id ? id.replace(/^agent_/, "").slice(0, 8) : "—");

export function pctChange(cur, prev) {
  if (cur === null || cur === undefined || !prev) return null;
  return (cur - prev) / prev;
}

/** Converts a range preset or custom values to ISO start/end. */
export function resolveRange(range, customStart, customEnd) {
  const now = new Date();
  const hours = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30, "90d": 24 * 90, "365d": 24 * 365 }[range];
  if (hours) {
    return { start: new Date(now.getTime() - hours * 3600e3).toISOString(), end: now.toISOString() };
  }
  return {
    start: customStart ? new Date(customStart).toISOString() : new Date(now.getTime() - 7 * 864e5).toISOString(),
    end: customEnd ? new Date(customEnd).toISOString() : now.toISOString(),
  };
}

export function highlight(text, q) {
  if (!q || !text) return text;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = String(text).split(new RegExp(`(${esc})`, "ig"));
  return parts.map((p, i) => (p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : p));
}
