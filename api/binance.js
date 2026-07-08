// FILE: api/binance.js
import crypto from 'crypto';

export default async function handler(req, res) {
  const API_KEY = process.env.BINANCE_API_KEY;
  const API_SECRET = process.env.BINANCE_API_SECRET;

  try {
    // =========================================================================
    // 1. LUỒNG ĐẶT LỆNH (POST) - HỖ TRỢ ĐƠN LỆNH & CỤM LỆNH (BATCH)
    // =========================================================================
    if (req.method === 'POST') {
      if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'Missing API Keys on Backend.' });
      }

      // ---------------------------------------------------------------------
      // VÁ LỖI MỚI: Bypass Ký hợp đồng TradFi (Vàng, Bạc, Ngoại hối)
      // ---------------------------------------------------------------------
      if (req.body.action === 'SIGN_TRADFI') {
        const params = new URLSearchParams();
        params.append('timestamp', Date.now().toString());
        params.append('recvWindow', '5000');
        
        const queryString = params.toString();
        const signature = crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
        
        // Endpoint chính thức của Binance cho TradFi-Perps
        const targetUrl = `https://fapi.binance.com/fapi/v1/stock/contract?${queryString}&signature=${signature}`;
        
        const binanceRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'X-MBX-APIKEY': API_KEY,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        const textRaw = await binanceRes.text();
        let data;
        try { data = JSON.parse(textRaw); } catch(e) { data = { msg: textRaw } };

        if (!binanceRes.ok) return res.status(binanceRes.status).json({ error: 'TradFi Sign Failed', details: data });
        return res.status(200).json(data);
      }

      // ---------------------------------------------------------------------
      // CÁC LOGIC BATCH ORDERS VÀ LỆNH LIMIT/MARKET GIỮ NGUYÊN
      // ---------------------------------------------------------------------
      if (req.body.batchOrders) {
        const params = new URLSearchParams();
        params.append('batchOrders', JSON.stringify(req.body.batchOrders));
        params.append('timestamp', Date.now().toString());
        params.append('recvWindow', '5000');
        
        const queryString = params.toString();
        const signature = crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
        
        const targetUrl = `https://fapi.binance.com/fapi/v1/batchOrders?${queryString}&signature=${signature}`;
        
        const binanceRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'X-MBX-APIKEY': API_KEY,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        const weight1m = binanceRes.headers.get('x-mbx-used-weight-1m');
        if (weight1m) {
            res.setHeader('x-mbx-used-weight-1m', weight1m);
            res.setHeader('Access-Control-Expose-Headers', 'x-mbx-used-weight-1m');
        }

        const textRaw = await binanceRes.text();
        let data;
        try { data = JSON.parse(textRaw); } catch(e) { data = { msg: textRaw } };

        if (!binanceRes.ok) return res.status(binanceRes.status).json({ error: 'Binance Batch Rejected', details: data });
        return res.status(200).json(data);
      }

      const { symbol, side, type, quantity, price } = req.body;
      if (!symbol || !side || !type || !quantity) {
        return res.status(400).json({ error: 'Payload thiếu tham số bắt buộc.' });
      }

      const params = new URLSearchParams({
        symbol, side, type, quantity, 
        timestamp: Date.now().toString(), 
        recvWindow: '5000'
      });

      if (type === 'LIMIT') {
        if (!price) return res.status(400).json({ error: "Lệnh LIMIT bắt buộc phải có giá (price)." });
        params.append('price', price.toString());
        params.append('timeInForce', 'GTC');
      }

      const queryString = params.toString();
      const signature = crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
      const finalQueryString = `${queryString}&signature=${signature}`;
      
      const binanceRes = await fetch(`https://fapi.binance.com/fapi/v1/order?${finalQueryString}`, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': API_KEY,
          'Content-Type': 'application/json'
        }
      });

      const weight1m = binanceRes.headers.get('x-mbx-used-weight-1m');
      if (weight1m) {
          res.setHeader('x-mbx-used-weight-1m', weight1m);
          res.setHeader('Access-Control-Expose-Headers', 'x-mbx-used-weight-1m');
      }

      const textRaw = await binanceRes.text();
      let data;
      try { data = JSON.parse(textRaw); } catch(e) { data = { msg: textRaw } };

      if (!binanceRes.ok) return res.status(binanceRes.status).json({ error: 'Binance Rejected', details: data });
      return res.status(200).json(data);
    }

    // =========================================================================
    // 2. LUỒNG LẤY DỮ LIỆU (GET) - GIỮ NGUYÊN
    // =========================================================================
    if (req.method === 'GET') {
      const queryParams = req.query || {};
      const { path, isPrivate, t, ...binanceParams } = queryParams;

      if (!path) {
        return res.status(400).json({ error: 'Missing path parameter' });
      }

      let baseUrl = 'https://api.binance.com';
      if (path.startsWith('/fapi') || path.startsWith('/futures')) {
        baseUrl = 'https://fapi.binance.com';
      }

      const params = new URLSearchParams();
      for (const key in binanceParams) {
         if (binanceParams[key] !== undefined && binanceParams[key] !== '') {
             params.append(key, binanceParams[key]);
         }
      }
      
      let queryString = params.toString();
      let headers = { 'Content-Type': 'application/json' };

      if (isPrivate === 'true') {
        if (!API_KEY || !API_SECRET) return res.status(500).json({ error: 'Missing API Keys for Private Data' });
        
        const timestamp = Date.now().toString();
        queryString += (queryString ? '&' : '') + `timestamp=${timestamp}&recvWindow=5000`;
        const signature = crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
        queryString += `&signature=${signature}`;
        
        headers['X-MBX-APIKEY'] = API_KEY;
      }

      const targetUrl = `${baseUrl}${path}${queryString ? '?' + queryString : ''}`;
      
      const binanceRes = await fetch(targetUrl, { headers });
      
      const weight1m = binanceRes.headers.get('x-mbx-used-weight-1m');
      if (weight1m) {
          res.setHeader('x-mbx-used-weight-1m', weight1m);
          res.setHeader('Access-Control-Expose-Headers', 'x-mbx-used-weight-1m');
      }

      const textRaw = await binanceRes.text();
      let data;
      try {
        data = JSON.parse(textRaw);
      } catch (err) {
        console.error("Binance returned non-JSON:", textRaw);
        return res.status(502).json({ error: 'Invalid JSON from Binance', content: textRaw.substring(0, 200) });
      }

      return res.status(binanceRes.status).json(data);
    }

    return res.status(405).json({ error: 'Method Not Allowed' });

  } catch (error) {
    console.error('🔥 Serverless Error:', error);
    return res.status(500).json({ 
      error: 'Internal Vercel Server Error', 
      message: error.message
    });
  }
}