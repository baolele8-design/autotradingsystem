// FILE: src/hooks/useExchangeConfig.js
import { useState, useEffect } from 'react';
import { POOL_SYMBOLS, MIN_NOTIONALS } from '../../../shared/config/trading.js';
import {
  isNewEntrySymbolAllowed
} from '../../../domain/trading/symbolEntryPolicy.js';

export default function useExchangeConfig() {
  const [dynamicMinNotionals, setDynamicMinNotionals] = useState(MIN_NOTIONALS);
  const [dynamicPool, setDynamicPool] = useState(POOL_SYMBOLS);
  const [stepSizes, setStepSizes] = useState({});
  const [tickSizes, setTickSizes] = useState({});

  useEffect(() => {
    let isMounted = true;
    const fetchExchangeData = async () => {
      try {
        const ts = Date.now();
        // TD-005 (2026-08-12): route through the daemon proxy (same-origin
        // /api -> localhost:1338 via vite proxy locally) instead of direct
        // Binance fetches; rate-limit contract §7 stays enforced in the daemon.
        const exRes = await fetch(`/api/binance?path=/fapi/v1/exchangeInfo&t=${ts}`);
        const exData = await exRes.json();

        const tickerRes = await fetch(`/api/binance?path=/fapi/v1/ticker/24hr&t=${ts}`);
        const tickerData = await tickerRes.json();

        if (!isMounted || !exData.symbols || !Array.isArray(tickerData)) return;

        const newNotionals = { ...MIN_NOTIONALS };
        const newStepSizes = {};
        const newTickSizes = {};
        
        // BỘ LỌC TUỔI ĐỜI UI
        const matureSymbols = new Set();
        const legacySymbols = new Set();
        const MATURE_AGE_MS = 730 * 24 * 60 * 60 * 1000;
        const LEGACY_AGE_MS = 1460 * 24 * 60 * 60 * 1000;
        const nowMs = Date.now();

        exData.symbols.forEach(sym => {
          const notionalFilter = sym.filters.find(f => f.filterType === 'MIN_NOTIONAL');
          if (notionalFilter) {
              const baseVal = parseFloat(notionalFilter.notional || 5);
              let bufferedVal = baseVal;
              if (baseVal === 5) bufferedVal = 5.3;
              else if (baseVal === 10) bufferedVal = 11.0;
              else if (baseVal === 20) bufferedVal = 22.0;
              else if (baseVal === 50) bufferedVal = 55.0;
              else bufferedVal = baseVal * 1.05; 

              newNotionals[sym.symbol] = bufferedVal;
          }
          
          const lotSize = sym.filters.find(f => f.filterType === 'LOT_SIZE');
          if (lotSize) newStepSizes[sym.symbol] = parseFloat(lotSize.stepSize);
          
          const priceFilter = sym.filters.find(f => f.filterType === 'PRICE_FILTER');
          if (priceFilter) newTickSizes[sym.symbol] = parseFloat(priceFilter.tickSize);

          // Cập nhật mảng trưởng thành
          if (sym.onboardDate) {
                    if ((nowMs - sym.onboardDate) > MATURE_AGE_MS) matureSymbols.add(sym.symbol);
                    if ((nowMs - sym.onboardDate) > LEGACY_AGE_MS) legacySymbols.add(sym.symbol);
                }
        });

        // 1. TẠO DANH SÁCH ĐEN CÁC ĐỒNG MEME (Giống hệt server)
        // 2. TẠO BỘ LỌC GỐC (Bỏ Meme, Bỏ râu nến dài, Bỏ coin rác)
        const baseTickers = tickerData.filter(t => 
            t.symbol.endsWith('USDT') && 
            !POOL_SYMBOLS.includes(t.symbol) && 
            isNewEntrySymbolAllowed(t.symbol) &&
            Math.abs(parseFloat(t.priceChangePercent)) < 15 && 
            ((parseFloat(t.highPrice) - parseFloat(t.lowPrice)) / parseFloat(t.lowPrice) * 100) < 25
        );

        // 3. NGÁCH TRENDING (30 Slot): > 2 năm tuổi, Volume > 30 Triệu USD
        const trendingTickers = baseTickers
            .filter(t => matureSymbols.has(t.symbol) && parseFloat(t.quoteVolume) > 30000000)
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, 30)
            .map(t => t.symbol);

        // 4. NGÁCH LEGACY TECH (10 Slot): > 4 năm tuổi, Volume > 5 Triệu USD
        const legacyTickers = baseTickers
            .filter(t => legacySymbols.has(t.symbol) && 
                         !trendingTickers.includes(t.symbol) && // Tránh trùng lặp
                         parseFloat(t.quoteVolume) > 5000000)
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, 10)
            .map(t => t.symbol);

        // 5. GỘP TOÀN BỘ (Đồng bộ UI với Scanner)
        const mergedPool = [...new Set([
          ...POOL_SYMBOLS.filter(isNewEntrySymbolAllowed),
          ...trendingTickers,
          ...legacyTickers
        ])];

        setDynamicMinNotionals(newNotionals);
        setStepSizes(newStepSizes);
        setTickSizes(newTickSizes);
        setDynamicPool(mergedPool);
      } catch (e) {
        console.error("⚠️ Lỗi Đồng bộ Dữ liệu Exchange Info:", e);
      }
    };

    fetchExchangeData();
    const timer = setInterval(fetchExchangeData, 300000); 
    return () => { isMounted = false; clearInterval(timer); };
  }, []);

  return { dynamicMinNotionals, dynamicPool, stepSizes, tickSizes };
}
