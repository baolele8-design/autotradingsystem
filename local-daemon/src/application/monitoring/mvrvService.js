import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MVRV_ENDPOINT =
  'https://bitcoin-data.com/v1/mvrv-zscore/last';
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STALE_AFTER_MS = 72 * 60 * 60 * 1000;
const CACHE_FILE = fileURLToPath(
  new URL('../../../data/mvrv-cache.json', import.meta.url)
);

function normalizePayload(payload) {
  const value = Number.parseFloat(payload?.mvrvZscore);
  const observedAt = payload?.d
    ? new Date(`${payload.d}T00:00:00.000Z`).toISOString()
    : null;
  if (!Number.isFinite(value) || value < -10 || value > 20) return null;
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) return null;
  return { observedAt, value };
}

async function readCache() {
  try {
    return JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function persistCache(state) {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function createMvrvService({
  safeFetch,
  setGlobalMvrvZScore
}) {
  let syncInFlight = null;

  async function syncMvrv({ force = false } = {}) {
    if (syncInFlight) return syncInFlight;

    syncInFlight = (async () => {
      const cached = await readCache();
      const cacheAge = cached?.fetchedAt
        ? Date.now() - Date.parse(cached.fetchedAt)
        : Number.POSITIVE_INFINITY;

      if (
        cached &&
        Number.isFinite(Number(cached.value)) &&
        !force &&
        cacheAge < CACHE_MAX_AGE_MS
      ) {
        setGlobalMvrvZScore(cached.value, {
          ...cached,
          stale:
            Date.now() - Date.parse(cached.observedAt) >
            STALE_AFTER_MS
        });
        return cached;
      }

      const payload = await safeFetch(MVRV_ENDPOINT);
      const normalized = normalizePayload(payload);
      if (normalized) {
        const state = {
          ...normalized,
          fetchedAt: new Date().toISOString(),
          source: 'bitcoin-data.com',
          stale:
            Date.now() - Date.parse(normalized.observedAt) >
            STALE_AFTER_MS
        };
        setGlobalMvrvZScore(state.value, state);
        try {
          await persistCache(state);
        } catch (error) {
          console.warn(
            '[MVRV] Đã nhận dữ liệu mới nhưng không thể ghi cache:',
            error.message
          );
        }
        console.log(
          `[MVRV] Đã cập nhật MVRV Z-Score: ${state.value} (${state.observedAt.slice(0, 10)}).`
        );
        return state;
      }

      if (cached && Number.isFinite(Number(cached.value))) {
        const staleState = {
          ...cached,
          stale:
            Date.now() - Date.parse(cached.observedAt) >
            STALE_AFTER_MS
        };
        setGlobalMvrvZScore(staleState.value, staleState);
        console.warn('[MVRV] API lỗi, đang dùng dữ liệu đã lưu gần nhất.');
        return staleState;
      }

      console.warn('[MVRV] Chưa có dữ liệu hợp lệ; giữ giá trị dự phòng.');
      return null;
    })();

    try {
      return await syncInFlight;
    } finally {
      syncInFlight = null;
    }
  }

  return { syncMvrv };
}
