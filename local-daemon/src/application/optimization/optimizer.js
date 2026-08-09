import { daemonEnvironment } from '../../config/environment.js';
import { createDaemonSupabaseClient } from '../../infrastructure/supabase/supabaseClient.js';
import {
  MIN_MATRIX_SAMPLES,
  OPTIMIZATION_SOURCE,
  OPTIMIZER_VERSION,
  TARGET_SCOPE,
  buildOptimizationModel,
  normalizeOptimizationTrade,
  shouldSkipOptimizationEpoch
} from './optimizerCore.js';

const supabase = createDaemonSupabaseClient(
  daemonEnvironment.supabase
);

export async function runOptimizationEpoch({ previousModel = null } = {}) {
  console.log(
    `🧠 [OPTIMIZER ${OPTIMIZER_VERSION}] ` +
    'Khởi động tối ưu mục tiêu theo strategyId × tier...'
  );

  const resolvedStatuses = ['WIN', 'LOSS', 'win', 'loss'];
  const ninetyDaysAgo = new Date(
    Date.now() - 90 * 86_400_000
  ).toISOString();
  const [liveResult, paperResult, pathResult] = await Promise.all([
    supabase
      .from(OPTIMIZATION_SOURCE.LIVE)
      .select('*')
      .in('status', resolvedStatuses)
      .gte('created_at', ninetyDaysAgo),
    supabase
      .from(OPTIMIZATION_SOURCE.PAPER)
      .select('*')
      .in('status', resolvedStatuses)
      .gte('created_at', ninetyDaysAgo),
    supabase
      .from('trade_path_summaries')
      .select('trade_id, summary')
      .gte('updated_at', ninetyDaysAgo)
  ]);

  if (liveResult.error) {
    console.error(
      '❌ [OPTIMIZER] Không thể đọc lịch sử giao dịch:',
      liveResult.error.message
    );
    return null;
  }

  if (paperResult.error) {
    console.warn(
      '[OPTIMIZER] Khong doc duoc paper_trade_logs; ' +
      'epoch tiep tuc chi voi trade_logs:',
      paperResult.error.message
    );
  }

  if (pathResult.error) {
    console.warn(
      '[OPTIMIZER] Khong doc duoc trade_path_summaries; ' +
      'epoch tiep tuc nhung khong hoc path:',
      pathResult.error.message
    );
  }

  const pathByTradeId = new Map(
    (pathResult.data || []).map(row => [String(row.trade_id), row.summary])
  );

  const liveTrades = (liveResult.data || []).map(trade =>
    normalizeOptimizationTrade({
      ...trade,
      live_path_summary: pathByTradeId.get(String(trade.id)) || null
    }, {
      source: OPTIMIZATION_SOURCE.LIVE
    })
  );
  const paperTrades = (paperResult.data || []).map(trade =>
    normalizeOptimizationTrade(trade, {
      source: OPTIMIZATION_SOURCE.PAPER
    })
  );
  const trades = [...liveTrades, ...paperTrades];

  const generatedAt = new Date().toISOString();
  const {
    model,
    usableTrades,
    rejectedTrades
  } = buildOptimizationModel(trades || [], { generatedAt });

  const matrixCells = Object.values(model.matrix_by_id);
  const learnedCells = matrixCells.filter(cell => cell.learning_applied);
  const trailingProposals = matrixCells.flatMap(cell =>
    Object.values(cell.dynamic_trailing?.by_regime || {}).flatMap(
      proposal => [
        proposal,
        ...Object.values(proposal.by_btc_regime || {})
      ]
    )
  );
  const activeTrailingProposals = trailingProposals.filter(
    proposal => proposal.status === 'ACTIVE'
  );
  const observedTrailingProposals = trailingProposals.filter(
    proposal => proposal.status === 'OBSERVE'
  );
  const insufficientCells = matrixCells.filter(
    cell => cell.sample_size < MIN_MATRIX_SAMPLES
  );

  if (shouldSkipOptimizationEpoch(previousModel, model)) {
    console.log(
      '[OPTIMIZER] Không có dữ liệu học hợp lệ mới; bỏ qua epoch.'
    );
    return {
      skipped: true,
      sampleSize: usableTrades.length,
      rejectedSampleSize: rejectedTrades.length
    };
  }

  console.log(
    `✅ [OPTIMIZER] ${usableTrades.length}/${trades?.length || 0} ` +
    `lệnh hợp lệ; loại ${rejectedTrades.length} lệnh nhiễu hoặc chưa xác định.`
  );
  console.log(
    `   ├─ Scope: ${TARGET_SCOPE}; ` +
    `tối thiểu ${MIN_MATRIX_SAMPLES} mẫu/ô.`
  );
  console.log(
    `   ├─ ${learnedCells.length}/${matrixCells.length} ô đủ điều kiện học.`
  );
  console.log(
    `   Trailing: active=${activeTrailingProposals.length}, ` +
    `observe=${observedTrailingProposals.length}.`
  );

  console.log(
    `   Source rows: live=${liveTrades.length}, ` +
    `paper-resolved=${paperTrades.length}; read-only ledgers.`
  );

  for (const cell of learnedCells) {
    const targets = cell.dynamic_targets.optimized;
    console.log(
      `   ├─ [${cell.strategy_id}|${cell.asset_tier}] ` +
      `n=${cell.sample_size}, TP=${targets.tpMult}, ` +
      `SL=${targets.slMult}, tHold=${targets.tHold_modifier}`
    );
  }

  if (insufficientCells.length > 0) {
    console.log(
      `   └─ ${insufficientCells.length} ô chưa đủ mẫu, ` +
      'giữ deterministic baseline.'
    );
  }

  const epochId = `epoch-strategy-tier-v3-${Date.now()}`;
  const saved = await saveModelToDB(
    epochId,
    model,
    usableTrades.length
  );

  if (!saved) return null;

  console.log(
    `🚀 [OPTIMIZER] Hoàn tất Epoch ${epochId}. ` +
    'TP/SL/tHold và trailing được thích nghi theo sample guard.'
  );
  return {
    epochId,
    skipped: false,
    sampleSize: usableTrades.length,
    rejectedSampleSize: rejectedTrades.length,
    liveSampleSize: liveTrades.length,
    paperSampleSize: paperTrades.length,
    learnedCellCount: learnedCells.length,
    matrixCellCount: matrixCells.length
  };
}

async function saveModelToDB(epochId, modelData, sampleSize) {
  try {
    const { error } = await supabase
      .from('system_models')
      .insert([{
        epoch_id: epochId,
        model_data: modelData,
        trade_count_sampled: sampleSize
      }]);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error(
      '❌ [OPTIMIZER] Không thể lưu model:',
      error.message
    );
    return false;
  }
}
