// /pages/api/ip-logger.js  (Next.js API route / Vercel-friendly)
export default async function handler(req, res) {
  // -- CORS (allowing GET for demo; adjust for production security) --
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ---------- 1) Get client IP & UA (Vercel-friendly) ----------
    let clientIP =
      (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '')
        .toString();
    if (!clientIP) clientIP = '0.0.0.0';
    // x-forwarded-for may contain a list
    if (clientIP.includes(',')) clientIP = clientIP.split(',')[0].trim();
    clientIP = clientIP.replace(/^::ffff:/, '');

    const userAgent = req.headers['user-agent'] || 'Unknown';

    // ---------- 2) Prepare API config ----------
    const BIGDATACLOUD_API_KEY = process.env.BIGDATACLOUD_API_KEY;
    if (!BIGDATACLOUD_API_KEY) {
      return res.status(500).json({ success: false, error: 'Missing BIGDATACLOUD_API_KEY env var' });
    }

    // NOTE: BigDataCloud docs show the ip-geolocation-full endpoint at api-bdc.net
    const BASE = 'https://api-bdc.net/data';
    const geoUrl = `${BASE}/ip-geolocation-full?ip=${encodeURIComponent(clientIP)}&localityLanguage=en&key=${BIGDATACLOUD_API_KEY}`;

    let ipData = null;
    let timezoneData = null;

    // ---------- 3) Fetch geolocation (primary) ----------
    try {
      const geoResp = await fetch(geoUrl);
      const geoText = await geoResp.text();
      if (!geoResp.ok) {
        // include text for debug
        console.error('BigDataCloud geolocation error:', geoResp.status, geoText);
        throw new Error(`BigDataCloud geolocation error: ${geoResp.status}`);
      }
      // parse JSON (the API returns JSON)
      ipData = JSON.parse(geoText || '{}');
    } catch (err) {
      console.error('Error fetching ip-geolocation-full:', err.message);
      throw new Error(`Failed to fetch geolocation: ${err.message}`);
    }

    // ---------- 4) Extract confidence + coordinates (robustly) ----------
    // BigDataCloud may include confidence at top-level or under location; handle both.
    const confidence = (ipData?.confidence ?? ipData?.location?.confidence ?? null);
    const confidenceArea = ipData?.confidenceArea ?? ipData?.location?.confidenceArea ?? null;

    // Coordinates may appear under ipData.location.latitude/longitude or at top-level
    const latitude = ipData?.location?.latitude ?? ipData?.latitude ?? null;
    const longitude = ipData?.location?.longitude ?? ipData?.longitude ?? null;

    // ---------- 5) Derive an approximate accuracy radius (km) if not provided explicitly ----------
    // BigDataCloud doesn't always give an 'accuracyRadius' number; if it gives a polygon (confidenceArea),
    // compute the max distance from centroid to vertices as a conservative radius estimate.
    let accuracyRadius = ipData?.location?.accuracyRadius ?? ipData?.accuracyRadius ?? null;

    if (!accuracyRadius && Array.isArray(confidenceArea) && confidenceArea.length > 0) {
      try {
        accuracyRadius = computeRadiusFromPolygon(confidenceArea); // returns km (number)
      } catch (e) {
        console.warn('Failed to compute accuracy radius from confidenceArea:', e.message);
      }
    }

    // ---------- 6) Timezone: prefer timezone-by-location (if we have coords), else timezone-by-ip ----------
    const tzKey = BIGDATACLOUD_API_KEY;
    if (latitude != null && longitude != null) {
      const tzUrl = `${BASE}/timezone-by-location?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=en&key=${tzKey}`;
      try {
        const tResp = await fetch(tzUrl);
        if (tResp.ok) timezoneData = await tResp.json();
        else {
          console.warn('timezone-by-location returned', tResp.status);
        }
      } catch (e) {
        console.warn('timezone-by-location fetch failed:', e.message);
      }
    }

    // fallback: timezone-by-ip
    if (!timezoneData) {
      try {
        const tzIpUrl = `${BASE}/timezone-by-ip?ip=${encodeURIComponent(clientIP)}&key=${tzKey}`;
        const tResp2 = await fetch(tzIpUrl);
        if (tResp2.ok) timezoneData = await tResp2.json();
      } catch (e) {
        console.warn('timezone-by-ip fetch failed:', e.message);
      }
    }

    // ---------- 7) Normalize network / org / ASN info (robust) ----------
    const network = {
      isp:
        ipData?.network?.carrier?.name
        || (Array.isArray(ipData?.carriers) && ipData.carriers[0]?.name)
        || ipData?.network?.name
        || (ipData?.asn || ipData?.asnNumeric ? `AS${ipData.asn ?? ipData.asnNumeric}` : 'Unknown'),
      organization:
        ipData?.network?.organisation
        || ipData?.organisation
        || ipData?.asnOrganisation
        || ipData?.network?.organisation
        || ipData?.organisation_name
        || 'Unknown',
      asn:
        ipData?.network?.autonomousSystemNumber
        || ipData?.asn
        || (ipData?.asnNumeric ? `AS${ipData.asnNumeric}` : 'Unknown'),
      connectionType:
        ipData?.network?.connectionType ?? ipData?.connectionType ?? 'Unknown'
    };

    // ---------- 8) Parse device from UA (simple heuristic) ----------
    const device = parseUserAgent(userAgent);

    // ---------- 9) Build structured response ----------
    const structuredData = {
      ip: clientIP,
      userAgent,
      timestamp: new Date().toISOString(),
      location: {
        city: ipData?.location?.city ?? ipData?.city ?? 'Unknown',
        region: ipData?.location?.region ?? ipData?.principalSubdivision ?? ipData?.region ?? 'Unknown',
        country: ipData?.country?.name ?? ipData?.countryName ?? 'Unknown',
        countryCode: ipData?.country?.isoAlpha2 ?? ipData?.countryCode ?? 'Unknown',
        latitude: latitude ?? 0,
        longitude: longitude ?? 0,
        postalCode: ipData?.location?.postalCode ?? ipData?.postalCode ?? 'Unknown',
        continent: ipData?.continent?.name ?? ipData?.continent ?? 'Unknown',
        accuracyRadius: accuracyRadius, // km or null
        confidence: confidence ?? 'unknown',
        confidenceArea: confidenceArea ?? null
      },
      network,
      timezone: {
        name: timezoneData?.ianaTimeZone ?? timezoneData?.ianaTimeZoneName ?? timezoneData?.zoneName ?? 'Unknown',
        localTime: timezoneData?.localTime ?? new Date().toISOString(),
        gmtOffsetString: timezoneData?.gmtOffsetString ?? timezoneData?.utcOffset ?? '+00:00'
      },
      device,
      metadata: {
        callingCode: ipData?.country?.callingCode ?? ipData?.callingCode ?? 'Unknown',
        currency: ipData?.country?.currency?.code ?? ipData?.currency?.code ?? 'Unknown',
        isEU: ipData?.country?.isEU ?? false,
        rawApiResponse: process.env.NODE_ENV !== 'production' ? ipData : undefined // include only in non-prod for debugging
      }
    };

    // ---------- 10) Optionally send to Discord webhook (non-blocking error handled) ----------
    if (process.env.DISCORD_WEBHOOK_URL) {
      sendToDiscord(structuredData).catch(err => {
        console.error('Discord webhook failed:', err.message);
      });
    }

    // ---------- 11) Return result ----------
    return res.status(200).json({
      success: true,
      message: 'Complete IP data collected successfully',
      data: structuredData
    });
  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      note: 'Check BigDataCloud API key, request quota, and that the client IP is public (private IPs will not geolocate).'
    });
  }
}

/* -------------------------
   Helper utilities
   ------------------------- */

// simple UA parser (lightweight)
function parseUserAgent(uaString) {
  const ua = (uaString || '').toString();
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  if (/OPR|Opera/.test(ua)) browser = 'Opera';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';

  if (/\bWindows\b/.test(ua)) os = 'Windows';
  else if (/\bMacintosh\b|\bMac OS\b/.test(ua)) os = 'Mac OS';
  else if (/\bAndroid\b/.test(ua)) os = 'Android';
  else if (/\b(iPhone|iPad|iPod)\b/.test(ua)) os = 'iOS';
  else if (/\bLinux\b/.test(ua)) os = 'Linux';

  if (/\bMobile\b/.test(ua) || /Android/.test(ua) && /Mobile/.test(ua)) device = 'Mobile';
  else if (/\bTablet\b/.test(ua) || /iPad/.test(ua)) device = 'Tablet';

  return {
    browser,
    os,
    device,
    raw: ua.substring(0, 1000) // truncate to keep stable
  };
}

/**
 * computeRadiusFromPolygon(confidenceArea)
 * Accepts confidenceArea in one of the common shapes:
 * - array of [lat, lon] pairs
 * - array of { latitude: n, longitude: n }
 * - array of [lon, lat] (rare)
 *
 * Returns estimated radius in kilometers (max distance from centroid to vertices).
 */
function computeRadiusFromPolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) throw new Error('Invalid polygon');
  // normalize to [{lat, lon}, ...]
  const pts = polygon.map(p => {
    if (Array.isArray(p) && p.length >= 2) {
      // attempt to detect whether first is lat or lon: lat ranges -90..90
      const a = Number(p[0]), b = Number(p[1]);
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
      // else maybe reversed
      return { lat: Number(p[1]), lon: Number(p[0]) };
    } else if (p && typeof p === 'object') {
      // common BigDataCloud may use {latitude, longitude}
      const lat = p.latitude ?? p.lat ?? p[1];
      const lon = p.longitude ?? p.lon ?? p.lng ?? p[0];
      return { lat: Number(lat), lon: Number(lon) };
    } else {
      throw new Error('Unrecognized polygon point format');
    }
  });

  // centroid (simple arithmetic mean in lat/lon — adequate for small polygons)
  const centroid = pts.reduce(
    (acc, pt) => {
      acc.lat += pt.lat;
      acc.lon += pt.lon;
      return acc;
    },
    { lat: 0, lon: 0 }
  );
  centroid.lat /= pts.length;
  centroid.lon /= pts.length;

  // compute max haversine distance to vertices
  let maxKm = 0;
  for (const pt of pts) {
    const d = haversineKm(centroid.lat, centroid.lon, pt.lat, pt.lon);
    if (d > maxKm) maxKm = d;
  }
  // return radius = max distance (conservative)
  return Number(maxKm.toFixed(2));
}

// Haversine distance in kilometers
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371; // earth radius km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Send Discord embed (simple)
async function sendToDiscord(data) {
  const webhookURL = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookURL) return;
  const embed = {
    embeds: [
      {
        title: '🌐 Visitor IP Logged',
        color: 3447003,
        timestamp: data.timestamp,
        fields: [
          { name: 'IP', value: `\`\`\`${data.ip}\`\`\``, inline: false },
          { name: 'Location', value: `**${data.location.city}, ${data.location.region}**\n${data.location.country} (${data.location.countryCode})`, inline: true },
          { name: 'Accuracy', value: `Radius: ${data.location.accuracyRadius ? data.location.accuracyRadius + ' km' : 'N/A'}\nConfidence: ${String(data.location.confidence ?? 'unknown').toUpperCase()}`, inline: true },
          { name: 'Coords', value: `Lat: ${data.location.latitude}\nLon: ${data.location.longitude}`, inline: true },
          { name: 'Network', value: `ISP: ${data.network.isp}\nOrg: ${data.network.organization}\nASN: ${data.network.asn}`, inline: true },
          { name: 'Device', value: `Browser: ${data.device.browser}\nOS: ${data.device.os}\nType: ${data.device.device}`, inline: true },
          { name: 'User Agent', value: `\`\`\`${data.device.raw.substring(0, 1000)}\`\`\``, inline: false }
        ],
        footer: { text: `BigDataCloud • ${data.location.continent}` }
      }
    ]
  };

  const resp = await fetch(webhookURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(embed)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${resp.status} ${text}`);
  }
                                          }
  
