// File: api/cmc.js
export default async function handler(req, res) {
  // 1. Mở cửa CORS cho Frontend React của bạn
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 2. Gọi Keyless Public API từ môi trường Server (Vercel) để lách luật CORS của Browser
    const [globalRes, fgiRes] = await Promise.all([
      fetch('https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD'),
      fetch('https://pro-api.coinmarketcap.com/public-api/v3/fear-and-greed/latest')
    ]);

    if (!globalRes.ok || !fgiRes.ok) {
       throw new Error(`CMC API Error: Global(${globalRes.status}) FGI(${fgiRes.status})`);
    }

    const globalData = await globalRes.json();
    const fgiData = await fgiRes.json();

    // 3. Trả dữ liệu đã được gọt dũa sạch sẽ về cho App.jsx
    res.status(200).json({
      btcDominance: globalData.data?.btc_dominance || 55.0,
      totalMarketCap: globalData.data?.quote?.USD?.total_market_cap || 0,
      fgiValue: fgiData.data?.value || 50,
      fgiClassification: fgiData.data?.value_classification || "Neutral"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}