import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(__dirname, '..', '..', '..', '.env');

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
} else {
  dotenv.config(); // Fallback to process.cwd() if not found
}

const numberFromEnv = (name, fallback) => {
  const value = Number.parseFloat(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const integerFromEnv = (name, fallback) => {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isInteger(value) ? value : fallback;
};

const jsonFromEnv = (name, fallback) => {
  if (!process.env[name]) return fallback;
  try {
    return JSON.parse(process.env[name]);
  } catch {
    throw new Error(`${name} phải là JSON hợp lệ`);
  }
};


export const daemonEnvironment = Object.freeze({
  port: process.env.PORT || 1338,
  binance: Object.freeze({
    readApiKey: process.env.BINANCE_READ_API_KEY,
    readApiSecret: process.env.BINANCE_READ_API_SECRET,
    tradeApiKey: process.env.BINANCE_TRADE_API_KEY,
    tradeApiSecret: process.env.BINANCE_TRADE_API_SECRET
  }),
  scalpBinance: Object.freeze({
    tradeApiKey: process.env.SCALP_BINANCE_TRADE_API_KEY || process.env.BINANCE_TRADE_API_KEY,
    tradeApiSecret: process.env.SCALP_BINANCE_TRADE_API_SECRET || process.env.BINANCE_TRADE_API_SECRET
  }),
  scalp: Object.freeze({
    coins: process.env.SCALP_SYMBOLS
      ? process.env.SCALP_SYMBOLS.split(',')
      : undefined,
    maxCapital: numberFromEnv('SCALP_MAX_CAPITAL_USD', undefined),
    marginPerTrade: numberFromEnv(
      'SCALP_MARGIN_PER_TRADE_USD',
      undefined
    ),
    maxPositions: integerFromEnv('SCALP_MAX_POSITIONS', undefined),
    scanIntervalMs: integerFromEnv(
      'SCALP_SCAN_INTERVAL_MS',
      undefined
    ),
    intervals: jsonFromEnv(
      'SCALP_INTERVAL_CONFIG_JSON',
      undefined
    ),
    safety: jsonFromEnv('SCALP_SAFETY_CONFIG_JSON', undefined)
  }),
  geminiApiKey: process.env.GEMINI_API_KEY,
  supabase: Object.freeze({
    url: process.env.VITE_SUPABASE_URL,
    anonKey: process.env.VITE_SUPABASE_ANON_KEY
  })
});
