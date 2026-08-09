import { useState, useEffect } from 'react';

export default function useMatrixScanner({ showToast, tradeLogs }) {
  const [scannedTopSetups, setScannedTopSetups] = useState([]);
  const [isScanningBackground, setIsScanningBackground] = useState(true);
  const [sonarEnabled, setSonarEnabled] = useState(false); 

  useEffect(() => {
    let isMounted = true;
    let ws;
    let reconnectTimeout;

    const connectWS = () => {
        const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
        ws = new WebSocket(`ws://${host}:1338`);

        ws.onopen = () => {
            if (isMounted) console.log("🟢 Matrix Radar Connected to Local Daemon");
        };

        ws.onmessage = (event) => {
            if (!isMounted) return;
            try {
                const payload = JSON.parse(event.data);
                
                if (payload.type === 'SCAN_RESULTS') {
                    if (payload.data && payload.data.length > 0) {
                        // VÁ LỖ HỔNG AMNESIA: Dùng tradeLogs của Frontend để lọc lại tín hiệu từ Daemon
                        const validatedSetups = payload.data.filter(setup => {
                             const recentLoss = tradeLogs && tradeLogs.some(log => 
                                 log.symbol === setup.symbol && 
                                 log.direction === setup.direction && 
                                 log.status === 'LOSS' &&
                                 (Date.now() - new Date(log.close_time).getTime()) < 2 * 60 * 60 * 1000 
                             );
                             return !recentLoss; // Chỉ giữ lại các setup KHÔNG bị dính Cooldown
                        });

                        if (validatedSetups.length > 0) {
                            setScannedTopSetups(validatedSetups);
                        } else {
                            setScannedTopSetups([{ isEmpty: true, reason: 'ALL_FILTERED_BY_COOLDOWN' }]);
                        }
                    } else {
                        setScannedTopSetups([{ isEmpty: true }]);
                    }
                    
                    setIsScanningBackground(false);

                    if (sonarEnabled && showToast && payload.isNewSignal) {
                         try {
                            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
                            audio.volume = 0.6; audio.play().catch(() => {});
                         } catch (error) {
                            console.warn('[SONAR AUDIO]', error.message);
                         }
                         showToast("🎯 RADAR PING: Lõi Local vừa phê duyệt tín hiệu mới!");
                    }
                }
            } catch(e) {
                console.error("Lỗi parse dữ liệu Matrix WS:", e);
            }
        };

        ws.onclose = () => {
            if (isMounted) {
                console.log("🔴 Matrix Radar ngắt kết nối. Đang thử lại sau 5s...");
                reconnectTimeout = setTimeout(connectWS, 5000);
            }
        };
    };

    connectWS();

    return () => { 
        isMounted = false; 
        if (reconnectTimeout) clearTimeout(reconnectTimeout); 
        
        if (ws) {
            if (ws.readyState === 1) { 
                ws.close();
            } else if (ws.readyState === 0) { 
                ws.onopen = () => ws.close();
            }
        }
    };
  }, [sonarEnabled, showToast, tradeLogs]); // Thêm tradeLogs vào dependency array

  return { scannedTopSetups, isScanningBackground, sonarEnabled, setSonarEnabled };
}
