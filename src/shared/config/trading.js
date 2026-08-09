// File: src/config/constants.js

export const MIN_NOTIONALS = {
  BTCUSDT: 50, 
  ETHUSDT: 20, 
  SOLUSDT: 5, 
  BNBUSDT: 5,   
  LINKUSDT: 20, 
  XRPUSDT: 5, 
  ADAUSDT: 5, 
  DASHUSDT: 5,  
  AVAXUSDT: 5   
};

export const getMinNotional = (sym) => MIN_NOTIONALS[sym] || 10;

export const POOL_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 
  'LINKUSDT', 'XRPUSDT', 'ADAUSDT', 'DASHUSDT', 'AVAXUSDT'
];

export const POOL_INTERVALS = ['5m', '15m', '1h', '4h', '1d'];