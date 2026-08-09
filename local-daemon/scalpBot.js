import { daemonEnvironment } from './src/config/environment.js';
import { createDaemonSupabaseClient } from './src/infrastructure/supabase/supabaseClient.js';
import { startScalpEngine } from './src/application/scalping/scalpEngine.js';
import { acquireProcessSingleton } from './src/application/runtime/processSingleton.js';
import {
  createRemoteBinanceRateCoordinator
} from './src/infrastructure/binance/remoteBinanceRateCoordinator.js';

const supabase = createDaemonSupabaseClient(daemonEnvironment.supabase);
const releaseSingleton = acquireProcessSingleton(
  new URL('.scalp-bot.lock', import.meta.url)
);
const rateCoordinator = createRemoteBinanceRateCoordinator({
  baseUrl: `http://127.0.0.1:${daemonEnvironment.port}`
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    releaseSingleton();
    process.exit(0);
  });
}
process.once('exit', releaseSingleton);

const engine = startScalpEngine({
  supabase,
  environment: daemonEnvironment,
  rateCoordinator,
  autoStart: false
});

try {
  await engine.init();
} catch (error) {
  console.error(
    '[SCALP FATAL] Khởi động thất bại:',
    error?.message || error
  );
  releaseSingleton();
  process.exitCode = 1;
}
