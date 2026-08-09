// FILE: scripts/sanitize-env.mjs
// Blank out Binance TRADE keys so the daemon can run READ-ONLY (no real orders).
// Does NOT print any secret value — only key names + a count.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
const backupPath = envPath + '.bak-verify';

const SECRET_KEYS = [
  'BINANCE_TRADE_API_KEY',
  'BINANCE_TRADE_API_SECRET',
  'SCALP_BINANCE_TRADE_API_KEY',
  'SCALP_BINANCE_TRADE_API_SECRET'
];

if (!fs.existsSync(envPath)) {
  console.error('NO_ENV');
  process.exit(1);
}

if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(envPath, backupPath);
  console.log(`BACKUP_CREATED: ${path.basename(backupPath)}`);
}

const raw = fs.readFileSync(envPath, 'utf8');
let blanked = 0;
const lines = raw.split(/\r?\n/).map(line => {
  const eq = line.indexOf('=');
  if (eq <= 0) return line;
  const key = line.slice(0, eq).trim();
  if (SECRET_KEYS.includes(key)) {
    blanked += 1;
    return `${key}=`;
  }
  return line;
});
fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
console.log(`SANITIZED: ${blanked} trade-key line(s) blanked. READ keys untouched.`);
