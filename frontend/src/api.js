import axios from "axios";

const http = axios.create({ baseURL: "/api", timeout: 120000 });

function clean(params) {
  const out = {};
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "" || v === false) return;
    out[k] = Array.isArray(v) ? v.join(",") : v;
  });
  return out;
}

export function errorMessage(err) {
  return err?.response?.data?.detail || err?.message || "Request failed";
}

export const api = {
  meta: () => http.get("/meta").then((r) => r.data),
  dimensions: (p) => http.get("/dimensions", { params: clean(p) }).then((r) => r.data),
  overview: (p) => http.get("/overview", { params: clean(p) }).then((r) => r.data),
  conversations: (p) => http.get("/conversations", { params: clean(p) }).then((r) => r.data),
  conversation: (p) => http.get("/conversation", { params: clean(p) }).then((r) => r.data),
  users: (p) => http.get("/users", { params: clean(p) }).then((r) => r.data),
  agents: (p) => http.get("/agents", { params: clean(p) }).then((r) => r.data),
  csvUrl: (p) => `/api/conversations.csv?${new URLSearchParams(clean(p)).toString()}`,
};
