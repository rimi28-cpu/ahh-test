// /pages/api/ip-logger.js
// Next.js / Vercel route — single-file IP logger using only BigDataCloud

export default async function handler(req, res) {
  // CORS (adjust for production security)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 1) Get client IP & UA (Vercel-friendly)
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

    // 2) API key check
    const KEY = process.env.BIGDATACLOUD_API_KEY;
    if (!KEY) {
      return res.status(500).json({ success: false, error: 'Missing BIGDATACLOUD_API_KEY' });
    }

    const BASE = 'https://api-bdc.net/data';
    const GEO_URL = `${BASE}/ip-geolocation-full?ip=${encodeURIComponent(clientIP)}&localityLanguage=en&key=${KEY}`;

    // 3) Fetch BigDataCloud ip-geolocation-full
    let ipData = {};
    try {
      const r = await fetch(GEO_URL);
      const txt = await r.text();
      if (!r.ok) {
        console.warn('BigDataCloud returned non-OK:', r.status, txt);
        // still attempt to parse JSON if present
        try { ipData = JSON.parse(txt || '{}'); } catch(e) { ipData = {}; }
      } else {
        ipData = JSON.parse(txt || '{}');
      }
    } catch (err) {
      console.error('Failed to fetch BigDataCloud:', err.message);
      // continue with empty ipData
      ipData = {};
    }

    // 4) Simple bot & datacenter detection
    const isBot = /bot|crawler|spider|preview|screenshot|vercel|uptime|monitor/i.test(userAgent);
    const orgCandidate = String(
      ipData?.network?.organisation ??
      ipData?.organisation ??
      ipData?.asnOrganisation ??
      ipData?.network?.name ??
      ipData?.operator ??
      ipData?.isp ??
      ''
    );
    const isDatacenter = /vercel|digitalocean|amazon|google|cloudflare|azure|linode|ovh|hetzner|rackspace|alibaba|microsoft/i.test(orgCandidate.toLowerCase());

    // 5) Extract coordinates (many responses use ipData.location)
    const latitude = numberOrNull(ipData?.location?.latitude ?? ipData?.latitude);
    const longitude = numberOrNull(ipData?.location?.longitude ?? ipData?.longitude);

    // 6) Extract region/state robustly (prefer principalSubdivision, then localityInfo administrative entries)
    const regionFromPrincipal = ipData?.principalSubdivision ?? ipData?.location?.region ?? ipData?.region;
    const regionFromLocalityInfo = extractRegionFromLocalityInfo(ipData?.localityInfo);
    const region = regionFromPrincipal || regionFromLocalityInfo || 'Unknown';

    // 7) City extraction (city, locality, localityInfo administrative adminLevel 8)
    const city = ipData?.city ?? ipData?.locality ?? extractCityFromLocalityInfo(ipData?.localityInfo) ?? 'Unknown';

    // 8) Country / continent / postal
    const country = ipData?.countryName ?? ipData?.country?.name ?? ipData?.country ?? 'Unknown';
    const countryCode = ipData?.countryCode ?? ipData?.country?.isoAlpha2 ?? ipData?.country?.isoCode ?? (ipData?.country?.iso ?? 'Unknown');
    const continent = ipData?.continent ?? ipData?.continent?.name ?? 'Unknown';
    const postalCode = ipData?.postcode ?? ipData?.location?.postalCode ?? ipData?.postalCode ?? 'Unknown';

    // 9) Confidence / accuracy fields
    let reportedConfidence = ipData?.confidence ?? ipData?.location?.confidence ?? null; // may be 'high','moderate','low' or numeric
    reportedConfidence = typeof reportedConfidence === 'string' ? reportedConfidence.toLowerCase() : reportedConfidence;

    // BigDataCloud may include a numeric accuracyRadius, or a confidenceArea polygon
    const reportedAccuracyRadius = numberOrNull(ipData?.location?.accuracyRadius ?? ipData?.accuracyRadius ?? null);
    const confidenceArea = ipData?.confidenceArea ?? ipData?.location?.confidenceArea ?? null;

    // compute radius from polygon if numeric radius missing
    let computedAccuracyRadius = null;
    if (reportedAccuracyRadius == null && confidenceArea) {
      try {
        computedAccuracyRadius = computeRadiusFromPolygon(confidenceArea); // in km
      } catch (e) {
        console.warn('computeRadiusFromPolygon error:', e.message);
      }
    }

    // Final accuracy reporting logic:
    // - prefer provider numeric radius if present
    // - else use computed from polygon
    // - if datacenter, hide accuracyRadius (to avoid false precision)
    let finalAccuracyRadius = reportedAccuracyRadius ?? computedAccuracyRadius ?? null;

    if (isDatacenter) {
      // datacenter IPs often produce coarse/meaningless radii — hide to avoid confusion
      finalAccuracyRadius = null;
    }

    // add an explanatory note if the radius is very large
    let accuracyNote = null;
    if (finalAccuracyRadius != null && finalAccuracyRadius > 1000) {
      accuracyNote = 'Very large radius — likely coarse geolocation (cloud provider, anycast, or low-resolution mapping).';
    } else if (finalAccuracyRadius == null && (reportedConfidence || confidenceArea)) {
      accuracyNote = 'Accuracy radius not available; confidence metadata present.';
    }

    // 10) Network / ISP / ASN extraction with many fallbacks
    const isp =
      ipData?.network?.carrier?.name ??
      ipData?.isp ??
      ipData?.network?.name ??
      ipData?.carrier ??
      ipData?.connection?.isp ??
      null;

    const asn =
      ipData?.network?.autonomousSystemNumber ??
      ipData?.asn ??
      (ipData?.asnNumeric ? `AS${ipData.asnNumeric}` : null) ??
      ipData?.network?.asn ??
      null;

    // 11) Build structured response containing everything BigDataCloud could provide
    const structuredData = {
      ip: clientIP || 'Unknown',
      timestamp: new Date().toISOString(),
      userAgent,
      // Location
      location: {
        country,
        countryCode,
        continent,
        region,                // region/state (robust)
        city,                  // city (robust)
        postalCode,
        latitude: latitude != null ? Number(latitude) : null,
        longitude: longitude != null ? Number(longitude) : null,
        reportedAccuracyRadius: reportedAccuracyRadius != null ? Number(reportedAccuracyRadius) : null, // km (provider)
        computedAccuracyRadius: computedAccuracyRadius != null ? Number(computedAccuracyRadius) : null, // km (derived from polygon)
        accuracyRadius: finalAccuracyRadius != null ? Number(finalAccuracyRadius) : null,
        accuracyNote,
        confidence: reportedConfidence ?? 'unknown',
        confidenceArea: confidenceArea ?? null,
        localityInfo: ipData?.localityInfo ?? null
      },

      // Timezone (if present in ipData)
      timezone: {
        name: ipData?.timeZone ?? ipData?.timezone ?? ipData?.ianaTimeZone ?? ipData?.localityInfo?.informative?.find(x => typeof x.name === 'string' && x.name.includes('America/'))?.name ?? null,
        rawTimezoneObject: ipData?.timeZoneData ?? ipData?.timezoneData ?? null
      },

      // Network
      network: {
        isp: isp ?? 'Unknown',
        organization: orgCandidate || 'Unknown',
        asn: asn ?? 'Unknown',
        connectionType: ipData?.network?.connectionType ?? ipData?.connectionType ?? 'Unknown',
      },

      // Device (light UA parse)
      device: parseUserAgent(userAgent),

      // metadata
      metadata: {
        trafficType: isDatacenter ? 'cloud / proxy' : 'residential',
        isDatacenter,
        isBot,
        // include raw response for debugging in development only
        rawResponse: process.env.NODE_ENV === 'development' ? ipData : undefined
      }
    };

    // 12) Optional: send to Discord (non-blocking)
    if (process.env.DISCORD_WEBHOOK_URL) {
      sendToDiscord(structuredData).catch(err => {
        console.warn('Discord webhook failed:', err.message);
      });
    }

    // 13) Return JSON with all fields
    return res.status(200).json({
      success: true,
      message: 'IP data (from BigDataCloud) — best-effort extraction',
      data: structuredData
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ success: false, error: String(err) });
  }
}

/* ------------------- HELPERS ------------------- */

function numberOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Prefer principalSubdivision; otherwise scan localityInfo.administrative for adminLevel 4 (state) or adminLevel near 4.
// localityInfo format example: { administrative: [ { name, adminLevel, order, ... }, ... ], informative: [...] }
function extractRegionFromLocalityInfo(localityInfo) {
  if (!localityInfo || !Array.isArray(localityInfo.administrative)) return null;
  const admin = localityInfo.administrative;

  // 1) exact adminLevel 4 (many BigDataCloud examples use adminLevel 4 for state)
  let candidate = admin.find(a => a.adminLevel === 4 || a.order === 5);
  if (candidate && candidate.name) return candidate.name;

  // 2) fallback: look for common keywords in description or name (state, province, region)
  candidate = admin.find(a => /state|province|region|division|oblast/i.test(String(a.description ?? a.name ?? '')));
  if (candidate && candidate.name) return candidate.name;

  // 3) fallback: take the highest-order administrative whose adminLevel > 2 and < 8 (likely state)
  candidate = admin
    .filter(a => typeof a.adminLevel === 'number' && a.adminLevel > 2 && a.adminLevel < 8)
    .sort((x, y) => x.adminLevel - y.adminLevel)[0];
  if (candidate && candidate.name) return candidate.name;

  // 4) no match
  return null;
}

function extractCityFromLocalityInfo(localityInfo) {
  if (!localityInfo || !Array.isArray(localityInfo.administrative)) return null;
  const admin = localityInfo.administrative;
  // many responses use adminLevel 8 or order 7/9 for city/locality
  let candidate = admin.find(a => a.adminLevel === 8 || a.adminLevel === 7 || a.order === 7 || a.order === 9);
  if (candidate && candidate.name) return candidate.name;

  // fallback: look for an entry with description containing 'city'
  candidate = admin.find(a => /city|town|municipality/i.test(String(a.description ?? a.name ?? '')));
  if (candidate && candidate.name) return candidate.name;

  return null;
}

function parseUserAgent(uaString) {
  const ua = (uaString || '').toString();
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  if (/OPR|Opera/.test(ua)) browser = 'Opera';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\/\d+/i.test(ua) && !/Edge\/|Edg\//i.test(ua) && !/OPR/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\/\d+/i.test(ua)) browser = 'Firefox';
  else if (/Safari\/\d+/i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

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
 * Accepts:
 *  - array of [lat, lon]
 *  - array of [lon, lat]
 *  - array of { latitude, longitude } or { lat, lon }
 * Returns estimated radius in kilometers (max distance from centroid to vertices).
 */
function computeRadiusFromPolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) throw new Error('Invalid polygon');

  const pts = polygon.map(p => {
    if (Array.isArray(p) && p.length >= 2) {
      // detect lat/lon ordering (lat range -90..90)
      const a = Number(p[0]), b = Number(p[1]);
      if (!Number.isNaN(a) && Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
      return { lat: Number(p[1]), lon: Number(p[0]) };
    } else if (p && typeof p === 'object') {
      const lat = numberOrNull(p.latitude ?? p.lat ?? p[1]);
      const lon = numberOrNull(p.longitude ?? p.lon ?? p.lng ?? p[0]);
      if (lat == null || lon == null) throw new Error('Unrecognized polygon point');
      return { lat, lon };
    } else {
      throw new Error('Unrecognized polygon point');
    }
  });

  // centroid by arithmetic mean (ok for small areas)
  const centroid = pts.reduce((acc, pt) => {
    acc.lat += pt.lat; acc.lon += pt.lon; return acc;
  }, { lat: 0, lon: 0 });
  centroid.lat /= pts.length;
  centroid.lon /= pts.length;

  // max haversine distance
  let maxKm = 0;
  for (const pt of pts) {
    const d = haversineKm(centroid.lat, centroid.lon, pt.lat, pt.lon);
    if (d > maxKm) maxKm = d;
  }
  return Number(maxKm.toFixed(2));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Minimal Discord sender (optional) — small embed
async function sendToDiscord(data) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  const embed = {
    embeds: [
      {
        title: '🌐 Visitor IP Logged',
        color: 3447003,
        timestamp: data.timestamp,
        fields: [
          { name: 'IP', value: `\`${data.ip}\`` },
          { name: 'Country / Region / City', value: `${data.location.country} / ${data.location.region} / ${data.location.city}` },
          { name: 'Coords', value: data.location.latitude != null && data.location.longitude != null ? `${data.location.latitude}, ${data.location.longitude}` : 'N/A' },
          { name: 'Accuracy (km)', value: data.location.accuracyRadius != null ? `${data.location.accuracyRadius}` : (data.location.computedAccuracyRadius != null ? `${data.location.computedAccuracyRadius} (computed)` : 'N/A') },
          { name: 'Confidence', value: String(data.location.confidence ?? 'unknown').toUpperCase() },
          { name: 'Network', value: `Org: ${data.network.organization}\nISP: ${data.network.isp}\nASN: ${data.network.asn}` },
          { name: 'Device', value: `${data.device.browser} / ${data.device.os} (${data.device.device})` }
        ]
      }
    ]
  };
  await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(embed) });
          }
