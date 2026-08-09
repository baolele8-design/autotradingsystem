const BLOCKED_EXACT_SYMBOLS = new Set([
  'DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT',
  'BOMEUSDT', 'WIFUSDT', 'MEMEUSDT', 'PEOPLEUSDT', '1000PEPEUSDT',
  '1000FLOKIUSDT', '1000SHIBUSDT', '1000BONKUSDT', 'PNUTUSDT', 'NOTUSDT'
]);

const normalizeSymbol = symbol =>
  typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';

// New-entry policy only. Never use this to suppress protection, reconciliation,
// reduce-only exits, or cleanup for an already-open position.
export function evaluateNewEntrySymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) {
    return { allowed: false, code: 'INVALID_SYMBOL', symbol: '' };
  }
  if (normalized.startsWith('1000')) {
    return {
      allowed: false,
      code: 'BLOCKED_SYMBOL_PREFIX',
      symbol: normalized
    };
  }
  if (BLOCKED_EXACT_SYMBOLS.has(normalized)) {
    return {
      allowed: false,
      code: 'BLOCKED_SYMBOL_EXACT',
      symbol: normalized
    };
  }
  return { allowed: true, code: null, symbol: normalized };
}

export const isNewEntrySymbolAllowed = symbol =>
  evaluateNewEntrySymbol(symbol).allowed;
