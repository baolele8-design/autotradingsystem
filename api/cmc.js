// File: api/cmc.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [globalRes, fgiRes, trendingRes] = await Promise.all([
      fetch('https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD'),
      fetch('https://pro-api.coinmarketcap.com/public-api/v3/fear-and-greed/latest'),
      // [MỚI] Bổ sung Keyless API lấy dữ liệu Trending Tìm kiếm của CMC
      fetch('https://api.coinmarketcap.com/data-api/v3/topsearch/rank') 
    ]);

    const globalData = await globalRes.json();
    const fgiData = await fgiRes.json();
    
    let trendingSymbols = [];
    if (trendingRes.ok) {
        const trendingData = await trendingRes.json();
        if (trendingData?.data?.cryptoTopSearchRanks) {
            // Mapping lấy mã token và ghép với USDT
            trendingSymbols = trendingData.data.cryptoTopSearchRanks
                .map(coin => `${coin.symbol}USDT`)
                .filter(sym => !sym.includes('USDC') && !sym.includes('TUSD'));
        }
    }

    res.status(200).json({
      btcDominance: globalData.data?.btc_dominance || 55.0,
      totalMarketCap: globalData.data?.quote?.USD?.total_market_cap || 0,
      fgiValue: fgiData.data?.value || 50,
      fgiClassification: fgiData.data?.value_classification || "Neutral",
      trendingSymbols // [MỚI] Trả về danh sách Trending
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}