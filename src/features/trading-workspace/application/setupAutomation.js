import QuantMath from '../../../domain/analytics/QuantMath.js';
import { TradeValidator } from '../../../domain/trading/TradeValidator.js';
import {
  resolveStrategyTierModel,
  routeStrategy
} from '../../../domain/trading/strategyRouter.js';

export function applyMasterAuto(context) {
  const {
    autoData,
    vectorRegime,
    apiMacro,
    aiModel,
    activeTierClass,
    mvrvZScore,
    symbol,
    tickSizes,
    setTradeSetup,
    showToast
  } = context; 
    if (!autoData || !vectorRegime) return;

    let bestSetup = null;
    let highestScore = -999;

    // Test cả 2 hướng hệt như Matrix Scanner
    const directions = ['LONG', 'SHORT'];
    
    for (const dir of directions) {
        
        const routedStrategy = routeStrategy({
            autoData,
            apiMacro,
            vectorDetails: vectorRegime.details,
            direction: dir,
            symbol,
            assetTier: activeTierClass
        });
        const matrixModel = resolveStrategyTierModel(
            aiModel,
            routedStrategy.strategyId,
            activeTierClass
        );
        const setupInfo = QuantMath.dynamicAsymmetricTargets(
            autoData, 
            apiMacro, 
            vectorRegime.details, 
            dir, 
            matrixModel,
            activeTierClass,
            routedStrategy,
            { symbol }
        );

        const tmpScore = TradeValidator.evaluateScore(
            autoData,
            apiMacro,
            vectorRegime.details,
            dir,
            mvrvZScore,
            symbol,
            null
        );

        // 3. Chọn hướng có điểm số cao nhất
        if (tmpScore.score > highestScore) {
            highestScore = tmpScore.score;
            bestSetup = { ...setupInfo, direction: dir };
        }
    }

    if (bestSetup) {
        const sl = bestSetup.direction === 'LONG' 
            ? bestSetup.suggestedEntry - (bestSetup.slMult * autoData.atr14) 
            : bestSetup.suggestedEntry + (bestSetup.slMult * autoData.atr14);
            
        const tp1 = bestSetup.direction === 'LONG' 
            ? bestSetup.suggestedEntry + (bestSetup.tpMult * autoData.atr14) 
            : bestSetup.suggestedEntry - (bestSetup.tpMult * autoData.atr14);

        const tick = tickSizes[symbol] || 0.0001;
        const tickStr = parseFloat(tick).toString();
        const precision = tickStr.includes('e-') ? parseInt(tickStr.split('e-')[1]) : (tickStr.includes('.') ? tickStr.split('.')[1].length : 4);

        setTradeSetup(prev => ({ 
          ...prev, 
          direction: bestSetup.direction, 
          execution: bestSetup.execType, 
          entry: Number(bestSetup.suggestedEntry.toFixed(precision)), 
          slTech: Number(sl.toFixed(precision)), 
          tp1: Number(tp1.toFixed(precision)),
          activeStrategy: bestSetup.strategyId,
          activeStrategyId: bestSetup.strategyId,
          activeStrategyLabel: bestSetup.strategyDisplayName,
          strategyFamily: bestSetup.family,
          strategyRolloutMode: bestSetup.rolloutMode,
          tHoldModifier: bestSetup.tHoldModifier,
          holdingCycles: undefined
        }));
        
        const paperLabel = bestSetup.rolloutMode === 'PAPER_ONLY'
          ? ' | PAPER/SHADOW'
          : '';
        showToast(`⚡ KÍCH HOẠT: ${bestSetup.strategyDisplayName}${paperLabel} | ${bestSetup.execType} | SL: ${bestSetup.slMult.toFixed(2)} ATR | TP: ${bestSetup.tpMult.toFixed(1)} ATR`);
    }
  };

export function injectScannedSetup(context, setup) {
  const {
    setSymbol,
    setIntervalTime,
    setTradeSetup,
    showToast
  } = context;
    setSymbol(setup.symbol); setIntervalTime(setup.interval);
    setTradeSetup(prev => ({ 
        ...prev, direction: setup.direction, entry: setup.entry, 
        slTech: setup.slTech, tp1: setup.tp1,
        execution: setup.execType || prev.execution,
        tradeType: setup.tradeType || prev.tradeType,
        activeStrategy: setup.strategyId || "ADAPTIVE_LONG_FALLBACK",
        activeStrategyId: setup.strategyId || "ADAPTIVE_LONG_FALLBACK",
        activeStrategyLabel: setup.strategyDisplayName || setup.overrideTag || "Adaptive Fallback",
        strategyFamily: setup.strategyFamily || 'ADAPTIVE',
        strategyRolloutMode: setup.rolloutMode || setup.executionMode || 'LIVE',
        tHoldModifier: setup.tHoldModifier || 1,
        holdingCycles: setup.tHold,
        // O4: BTC regime 4h/1d chuẩn từ daemon (btcRegimeFrame) — prior sizing phụ thuộc.
        btcRegime: setup.btc_regime_at_entry || prev.btcRegime || null
    }));
    showToast(`🚀 Đã nạp cấu trúc ${setup.symbol} [${setup.interval}] lên tổng đài chỉ huy!`);
  };
