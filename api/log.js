// /pages/api/ip-logger.js
// Robust IP logger with DEBUG logging to diagnose missing fields.

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // --- Get Client IP ---
    let clientIP = (
      req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      req.socket?.remoteAddress ||
      ''
    ).toString();
    if (!clientIP) clientIP = '0.0.0.0';
    if (clientIP.includes(',')) clientIP = clientIP.split(',')[0].trim();
    clientIP = clientIP.replace(/^::ffff:/, '');
    const userAgent = (req.headers['user-agent'] || 'Unknown').toString();

    console.log('DEBUG: Client IP:', clientIP);

    // --- API Key Check ---
    const KEY = process.env.BIGDATACLOUD_API_KEY;
    if (!KEY) {
      console.error('DEBUG: Missing BIGDATACLOUD_API_KEY environment variable.');
      return res.status(500).json({ success: false, error: 'Missing BIGDATACLOUD_API_KEY' });
    }
    console.log('DEBUG: API Key present (first 5 chars):', KEY.substring(0, 5), '...');

    // --- Fetch from BigDataCloud ---
    const BASE = 'https://api-bdc.net/data';
    const GEO_URL = `${BASE}/ip-geolocation-full?ip=${encodeURIComponent(clientIP)}&localityLanguage=en&key=${KEY}`;
    console.log('DEBUG: Fetching from URL:', GEO_URL);

    let ipData = {};
    let rawResponseText = '';
    try {
      const response = await fetch(GEO_URL);
      const status = response.status;
      rawResponseText = await response.text(); // Get raw text first

      // ===== CRITICAL DEBUG LOGS =====
      console.log('DEBUG: API HTTP Status:', status);
      console.log('DEBUG: Raw API Response (first 1500 chars):', rawResponseText.substring(0, 1500));
      // ===============================

      if (response.ok && rawResponseText) {
        try {
          ipData = JSON.parse(rawResponseText);
          console.log('DEBUG: Successfully parsed JSON. Top-level keys:', Object.keys(ipData));
        } catch (parseError) {
          console.error('DEBUG: Failed to parse JSON:', parseError.message);
          ipData = {};
        }
      } else {
        console.warn('DEBUG: API request not OK or empty. Status:', status);
        // If it's a 403, the key is likely invalid or quota is exceeded.
        if (status === 403) {
          console.error('DEBUG: BigDataCloud returned 403 Forbidden. Check API key validity and quota.');
        }
      }
    } catch (fetchError) {
      console.error('DEBUG: Network fetch error:', fetchError.message);
      ipData = {};
    }

    // --- Test with a known IP (Google DNS) if the initial fetch failed or returned empty ---
    if (!ipData || Object.keys(ipData).length < 3) {
      console.warn('DEBUG: Initial response poor. Testing with IP 8.8.8.8 for comparison.');
      const TEST_URL = `${BASE}/ip-geolocation-full?ip=8.8.8.8&localityLanguage=en&key=${KEY}`;
      try {
        const testResponse = await fetch(TEST_URL);
        if (testResponse.ok) {
          const testText = await testResponse.text();
          const testData = JSON.parse(testText);
          console.log('DEBUG: Test with 8.8.8.8 succeeded. Keys:', Object.keys(testData));
          // Optional: uncomment to see full test structure
          // console.log('DEBUG: Test data sample:', JSON.stringify(testData).substring(0, 1000));
        }
      } catch (testErr) {
        console.error('DEBUG: Test fetch also failed:', testErr.message);
      }
    }

    // --- Helper to safely extract data (your existing logic) ---
    const tryPaths = (...paths) => {
      for (const p of paths) {
        if (!p) continue;
        const parts = p.split('.');
        let cur = ipData;
        let ok = true;
        for (const part of parts) {
          if (cur == null) { ok = false; break; }
          cur = cur[part];
        }
        if (ok && cur !== undefined && cur !== null && cur !== '') {
          console.log(`DEBUG: Found value for paths [${paths}] at "${p}":`, cur);
          return cur;
        }
      }
      console.log(`DEBUG: No value found for any path:`, paths);
      return undefined;
    };

    // --- Extract Data Using Helper ---
    console.log('--- DEBUG: Starting Field Extraction ---');

    const lat = tryPaths('location.latitude', 'latitude');
    const lon = tryPaths('location.longitude', 'longitude');
    const region = tryPaths('location.principalSubdivision', 'location.region', 'principalSubdivision');
    const city = tryPaths('location.city', 'locality', 'city');
    const country = tryPaths('country.name', 'countryName', 'country');
    const countryCode = tryPaths('country.isoAlpha2', 'countryCode');
    const isp = tryPaths('network.carrier.name', 'isp', 'network.name');
    const asnRaw = tryPaths('network.autonomousSystemNumber', 'asn');
    const asn = asnRaw ? `AS${asnRaw}` : null;
    const org = tryPaths('network.organisation', 'organisation');
    const confidence = tryPaths('location.confidence', 'confidence');
    const accuracyRadius = tryPaths('location.accuracyRadius', 'accuracyRadius');

    // --- Build Final Structured Object ---
    const structuredData = {
      ip: clientIP,
      timestamp: new Date().toISOString(),
      userAgent,
      location: {
        country: country || 'Unknown',
        countryCode: countryCode || 'Unknown',
        region: region || 'Unknown',
        city: city || 'Unknown',
        latitude: lat,
        longitude: lon,
        confidence: confidence || 'unknown',
        accuracyRadius: accuracyRadius
      },
      network: {
        isp: isp || 'Unknown',
        organization: org || 'Unknown',
        asn: asn || 'Unknown'
      },
      device: parseUserAgent(userAgent),
      // Include raw response in development for deep inspection
      _debug: process.env.NODE_ENV === 'development' ? {
        apiResponseSample: rawResponseText.substring(0, 500),
        parsedKeys: Object.keys(ipData)
      } : undefined
    };

    console.log('DEBUG: Final structuredData:', JSON.stringify(structuredData, null, 2));

    // --- Optional Discord Webhook (unchanged) ---
    if (process.env.DISCORD_WEBHOOK_URL) {
      sendToDiscord(structuredData).catch(e => console.warn('Discord send failed:', e.message));
    }

    // --- Return Response to Client ---
    return res.status(200).json({
      success: true,
      data: structuredData
    });

  } catch (err) {
    console.error('Unhandled error in handler:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// --- Helper Functions ---

function parseUserAgent(ua) {
    const s = (ua || '').toString();
    let browser = 'Unknown', os = 'Unknown', device = 'Desktop';
    if (/OPR|Opera/.test(s)) browser = 'Opera';
    else if (/Edg\//.test(s)) browser = 'Edge';
    else if (/Chrome\/\d+/i.test(s) && !/Edg\//i.test(s)) browser = 'Chrome';
    else if (/Firefox\/\d+/i.test(s)) browser = 'Firefox';
    else if (/Safari\/\d+/i.test(s) && !/Chrome\//i.test(s)) browser = 'Safari';

    if (/\bWindows\b/i.test(s)) os = 'Windows';
    else if (/\bMacintosh\b|\bMac OS\b/i.test(s)) os = 'Mac OS';
    else if (/\bAndroid\b/i.test(s)) os = 'Android';
    else if (/\b(iPhone|iPad|iPod)\b/i.test(s)) os = 'iOS';
    else if (/\bLinux\b/i.test(s)) os = 'Linux';

    if (/\bMobile\b/i.test(s) || (/Android/i.test(s) && /Mobile/i.test(s))) device = 'Mobile';
    else if (/\bTablet\b/i.test(s) || /iPad/i.test(s)) device = 'Tablet';
    if (/bot|crawler|spider/i.test(s)) device = 'Bot';

    return { browser, os, device, raw: s.substring(0, 200) };
}

async function sendToDiscord(data) {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook) return;
    const embed = {
      embeds: [{
        title: '🌐 Visitor IP Logged',
        color: 3447003,
        timestamp: data.timestamp,
        fields: [
          { name: 'IP', value: `\`${data.ip}\`` },
          { name: 'Location', value: `${data.location.country} / ${data.location.region} / ${data.location.city}` },
          { name: 'Accuracy', value: data.location.accuracyRadius ? `${data.location.accuracyRadius} km` : 'N/A' },
          { name: 'Confidence', value: data.location.confidence.toUpperCase() },
          { name: 'Network', value: `ISP: ${data.network.isp}\nASN: ${data.network.asn}` }
        ]
      }]
    };
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(embed) });
}
