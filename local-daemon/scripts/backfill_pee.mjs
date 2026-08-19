// One-off PEE backfill for ALL closed trades (owner directive 2026-08-19).
//
// Uses the same production engine (postTradeEvaluationService) with a larger
// batch so historical WIN/LOSS rows without a current PEE policy version are
// analyzed in a few rounds instead of one batch of 10 per 5-minute scheduler
// tick. Only writes pee_* columns — never touches status/SL/exit_reason.
//
// Run on the VPS (where .env points at the local PostgREST):
//   cd /root/quant-bot/local-daemon
//   node scripts/backfill_pee.mjs
//   PEE_BACKFILL_BATCH=500 PEE_BACKFILL_MAX_ROUNDS=20 node scripts/backfill_pee.mjs
import {
  createDaemonSupabaseClient
} from '../src/infrastructure/supabase/supabaseClient.js';
import { daemonEnvironment } from '../src/config/environment.js';
import {
  createBinanceGateway
} from '../src/infrastructure/binance/binanceGateway.js';
import {
  getSharedBinanceRateCoordinator
} from '../src/infrastructure/binance/binanceRateCoordinator.js';
import {
  createPostTradeEvaluationService,
  PEE_POLICY_VERSION
} from '../src/application/analytics/postTradeEvaluationService.js';

const {
  binance: {
    readApiKey,
    readApiSecret,
    tradeApiKey,
    tradeApiSecret
  },
  supabase: supabaseConfig
} = daemonEnvironment;

const supabase = createDaemonSupabaseClient(supabaseConfig);
const rateCoordinator = getSharedBinanceRateCoordinator();
const { safeFetch } = createBinanceGateway({
  readApiKey,
  readApiSecret,
  tradeApiKey,
  tradeApiSecret,
  getTimeOffset: async () => 0,
  rateCoordinator
});

async function countRipe() {
  const { count, error } = await supabase
    .from('trade_logs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['WIN', 'LOSS'])
    .or(
      `pee_analyzed.eq.false,pee_analyzed.is.null,` +
      `pee_policy_version.is.null,` +
      `pee_policy_version.neq.${PEE_POLICY_VERSION}`
    )
    .not('close_time', 'is', null);
  if (error) throw new Error(`count ripe failed: ${error.message}`);
  return count;
}

const batchSize = Number.parseInt(process.env.PEE_BACKFILL_BATCH || '200', 10);
const maxRounds = Number.parseInt(process.env.PEE_BACKFILL_MAX_ROUNDS || '50', 10);

// Cold-start probe: coordinator bắt đầu ở RATE_STATE_WARMING và chỉ cho phép
// một request reconciliation (weight-1) đi qua để lấy response headers làm
// mốc "initialObservationReady" (giống bootstrap.js:87-90). Thiếu bước này thì
// mọi klines đều bị deny RATE_STATE_WARMING.
await safeFetch(
  'https://fapi.binance.com/fapi/v1/time',
  { maxRetries: 0, priority: 'reconciliation', ttlMs: 0 }
);

const service = createPostTradeEvaluationService({ batchSize, safeFetch, supabase });

const before = await countRipe();
console.log(`[PEE BACKFILL] ripe before: ${before} (batch=${batchSize}, maxRounds=${maxRounds})`);

let lastAfter = before;
let rounds = 0;
for (let i = 0; i < maxRounds; i++) {
  rounds += 1;
  let result;
  try {
    result = await service.runPostTradeEvaluation();
  } catch (error) {
    console.error(`[PEE BACKFILL] round ${rounds} threw: ${error.message}`);
    break;
  }
  const after = await countRipe();
  console.log(`[PEE BACKFILL] round ${rounds}: status=${result.status}, ripe now=${after}`);
  if (after === 0) break;
  if (after >= lastAfter) {
    console.log('[PEE BACKFILL] no progress — remaining rows likely have windows not yet mature (waiting for future candles). Stopping.');
    break;
  }
  lastAfter = after;
}

const final = await countRipe();
console.log(`[PEE BACKFILL] done. rounds=${rounds}, ripe remaining=${final}`);
process.exit(0);
