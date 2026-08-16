// FILE: src/shared/ledgerClient.js
// HTTP bridge client — thay thế truy cập Supabase trực tiếp từ frontend.
// Base tuyệt đối http://<host>:1338 (daemon) — relative /api từ :3000 trả HTML SPA.

const DAEMON_BASE = (() => {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    return `http://${window.location.hostname}:1338`;
  }
  return 'http://localhost:1338';
})();

export async function apiFetch(path, options = {}) {
  const response = await fetch(`${DAEMON_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    throw new Error(`Bridge ${path} HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchTradeLogs(limit = 300) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 300;
  const { data, error } = await apiFetch(`/api/ledger/trade-logs?limit=${safeLimit}`);
  return { data, error };
}

export async function fetchLatestModel() {
  const { data, error } = await apiFetch('/api/ledger/system-models/latest');
  return { data: data?.model_data ?? null, error };
}

export async function insertTradeLog(payload) {
  const { data, error } = await apiFetch('/api/ledger/trade-logs', {
    method: 'POST',
    body: JSON.stringify({ payload })
  });
  return { data, error };
}

export async function updateTradeLog(id, values, orFilter = null) {
  const orQuery = orFilter ? `?or=${encodeURIComponent(orFilter)}` : '';
  const { data, error } = await apiFetch(`/api/ledger/trade-logs/${id}${orQuery}`, {
    method: 'PATCH',
    body: JSON.stringify(values)
  });
  return { data, error };
}

export async function deleteTradeLog(id) {
  const { data, error } = await apiFetch(`/api/ledger/trade-logs/${id}`, {
    method: 'DELETE'
  });
  return { data, error };
}

export async function insertPaperLogs(paperLogs) {
  const { data, error } = await apiFetch('/api/ledger/paper-logs', {
    method: 'POST',
    body: JSON.stringify({ payload: paperLogs })
  });
  return { data, error };
}
