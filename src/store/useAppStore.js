// FILE: src/store/useAppStore.js
import { create } from 'zustand';

const useAppStore = create((set) => ({
  // Dữ liệu cài đặt người dùng
  symbol: 'BTCUSDT',
  setSymbol: (sym) => set({ symbol: sym }),
  
  intervalTime: '15m',
  setIntervalTime: (int) => set({ intervalTime: int }),
  
  mvrvZScore: 0.23,
  setMvrvZScore: (z) => set({ mvrvZScore: z }),

  // Cấu hình giao dịch
  tradeSetup: {
    tradeType: 'FUTURES', direction: 'LONG', execution: 'LIMIT', 
    riskPercent: 1.0, entry: 0, slTech: 0, tp1: 0, activeStrategy: "TIÊU CHUẨN" 
  },
  setTradeSetup: (updater) => set((state) => ({ 
    tradeSetup: typeof updater === 'function' ? updater(state.tradeSetup) : { ...state.tradeSetup, ...updater } 
  })),

  // Cấu hình mạng & hệ thống
  systemHealth: { weight: 0, maxWeight: 2400, latency: 0 },
  setSystemHealth: (updater) => set((state) => ({
      systemHealth: typeof updater === 'function' ? updater(state.systemHealth) : { ...state.systemHealth, ...updater }
  }))
}));

export default useAppStore;