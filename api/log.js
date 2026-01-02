// /pages/api/ip-logger.js - UPDATED with ASN fetch and confidence area mapping
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

    // --- API Key Check ---
    const KEY = process.env.BIGDATACLOUD_API_KEY;
    if (!KEY) {
      console.error('DEBUG: Missing BIGDATACLOUD_API_KEY');
      return res.status(500).json({ success: false, error: 'Missing BIGDATACLOUD_API_KEY' });
    }

    const BASE = 'https://api-bdc.net/data';
    
    // --- 1. Fetch Main Geolocation Data ---
    const GEO_URL = `${BASE}/ip-geolocation-full?ip=${encodeURIComponent(clientIP)}&localityLanguage=en&key=${KEY}`;
    
    let ipData = {};
    try {
      const response = await fetch(GEO_URL);
      if (!response.ok) {
        console.error(`DEBUG: API error ${response.status}`);
        return res.status(502).json({ success: false, error: `API error: ${response.status}` });
      }
      
      const rawText = await response.text();
      ipData = JSON.parse(rawText);
      console.log('DEBUG: Main geolocation fetch successful');
    } catch (fetchError) {
      console.error('DEBUG: Fetch failed:', fetchError.message);
      return res.status(500).json({ success: false, error: 'Failed to fetch data' });
    }

    // --- 2. Fetch ASN Data if Available ---
    let asnData = {};
    const asnNumber = ipData?.network?.autonomousSystemNumber;
    
    if (asnNumber) {
      const ASN_URL = `${BASE}/asn-info-full?asn=AS${asnNumber}&localityLanguage=en&key=${KEY}`;
      try {
        const asnResponse = await fetch(ASN_URL);
        if (asnResponse.ok) {
          const asnRawText = await asnResponse.text();
          asnData = JSON.parse(asnRawText);
          console.log('DEBUG: ASN data fetch successful');
        } else {
          console.warn('DEBUG: ASN fetch failed, status:', asnResponse.status);
        }
      } catch (asnError) {
        console.warn('DEBUG: ASN fetch error:', asnError.message);
      }
    }

    // --- Extract Data from Main Response ---
    // Location data
    const latitude = ipData?.location?.latitude || null;
    const longitude = ipData?.location?.longitude || null;
    const continent = ipData?.location?.continent || 'Unknown';
    const region = ipData?.location?.principalSubdivision || 'Unknown';
    const city = ipData?.location?.city || 'Unknown';
    const locality = ipData?.location?.localityName || city;
    const postalCode = ipData?.location?.postcode || '';
    
    // Country data
    const country = ipData?.country?.name || 'Unknown';
    const countryCode = ipData?.country?.isoAlpha2 || 'Unknown';
    const callingCode = ipData?.country?.callingCode || '';
    const currency = ipData?.country?.currency?.code || '';
    const currencyName = ipData?.country?.currency?.name || '';
    
    // Network data - PRIORITIZE ASN DATA OVER MAIN RESPONSE
    const isp = asnData?.organisation || ipData?.network?.organisation || 'Unknown';
    const asnRaw = asnData?.asn || `AS${asnNumber}` || 'Unknown';
    const asn = asnData?.asn ? asnData.asn : (asnNumber ? `AS${asnNumber}` : 'Unknown');
    const connectionType = ipData?.network?.connectionType || 'Unknown';
    const registry = asnData?.registry || 'Unknown';
    
    // Confidence/Accuracy data
    const confidence = ipData?.confidence || 'unknown';
    const confidenceArea = ipData?.confidenceArea || null;
    const accuracyRadius = ipData?.location?.accuracyRadius || computeRadiusFromPolygon(confidenceArea);
    
    // Timezone
    const timezone = ipData?.location?.timeZone?.ianaTimeId || 'Unknown';
    
    // Security
    const securityThreat = ipData?.securityThreat || null;
    const hazardReport = ipData?.hazardReport || null;
    
    // --- Generate Enhanced Map URL with Confidence Area ---
    const mapUrl = generateConfidenceAreaMap(latitude, longitude, confidenceArea, accuracyRadius);
    
    // --- Build Final Data Object ---
    const structuredData = {
      ip: clientIP,
      timestamp: new Date().toISOString(),
      userAgent,
      location: {
        continent,
        continentCode: ipData?.location?.continentCode || '',
        country,
        countryCode,
        region,
        regionCode: ipData?.location?.isoPrincipalSubdivisionCode || '',
        city,
        locality,
        postalCode,
        latitude,
        longitude,
        plusCode: ipData?.location?.plusCode || '',
        accuracyRadius,
        confidence,
        confidenceArea,
        mapUrl
      },
      countryDetails: {
        callingCode,
        currency,
        currencyName,
        isEU: ipData?.country?.isEU || false,
        flagEmoji: ipData?.country?.countryFlagEmoji || ''
      },
      network: {
        isp,
        asn,
        connectionType,
        registry,
        organisation: asnData?.organisation || ipData?.network?.organisation || '',
        name: asnData?.name || 'Unknown',
        registeredCountry: asnData?.registeredCountryName || 'Unknown',
        totalIpv4Addresses: asnData?.totalIpv4Addresses || 0,
        rank: asnData?.rank || null,
        rankText: asnData?.rankText || ''
      },
      timezone: {
        name: timezone,
        raw: ipData?.location?.timeZone || {}
      },
      security: {
        threat: securityThreat,
        hazards: hazardReport
      },
      device: parseUserAgent(userAgent),
      metadata: {
        lastUpdated: ipData?.lastUpdated || '',
        isReachable: ipData?.isReachableGlobally || false,
        rawKeys: Object.keys(ipData),
        asnDataPresent: Object.keys(asnData).length > 0
      }
    };

    // --- Send to Discord ---
    if (process.env.DISCORD_WEBHOOK_URL) {
      sendToDiscord(structuredData).catch(e => console.warn('Discord error:', e.message));
    }

    // --- Return Response ---
    return res.status(200).json({
      success: true,
      data: structuredData,
      _debug: process.env.NODE_ENV === 'development' ? { 
        rawKeys: Object.keys(ipData),
        asnKeys: Object.keys(asnData)
      } : undefined
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// --- Helper Functions ---

function generateConfidenceAreaMap(latitude, longitude, confidenceArea, radiusKm) {
  if (!latitude || !longitude) return null;
  
  // Option 1: If we have a confidence area polygon, use a service that can visualize it
  if (confidenceArea && Array.isArray(confidenceArea) && confidenceArea.length > 0) {
    // Create GeoJSON for the confidence area
    const geoJson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [longitude, latitude]
          },
          properties: {
            title: "Estimated Location",
            "marker-color": "#FF0000"
          }
        },
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [confidenceArea] // Note: confidenceArea should be array of [lon, lat] pairs
          },
          properties: {
            title: "Confidence Area",
            stroke: "#0000FF",
            "stroke-width": 2,
            "fill": "#0000FF",
            "fill-opacity": 0.1
          }
        }
      ]
    };
    
    // URL encode the GeoJSON for use with geojson.io
    const encodedGeoJson = encodeURIComponent(JSON.stringify(geoJson));
    return `http://geojson.io/#data=data:application/json,${encodedGeoJson}`;
  }
  
  // Option 2: Fallback to regular Google Maps with accuracy circle approximation
  const zoom = radiusKm > 100 ? 8 : radiusKm > 50 ? 10 : radiusKm > 10 ? 12 : 14;
  
  if (radiusKm && radiusKm > 0) {
    // Create a circle approximation using Google Maps (shows radius visually)
    const circlePoints = generateCirclePoints(latitude, longitude, radiusKm, 12);
    const polyline = encodePolyline(circlePoints);
    return `https://www.google.com/maps/@?api=1&map_action=map&center=${latitude},${longitude}&zoom=${zoom}&basemap=terrain&layer=traffic`;
  }
  
  // Option 3: Basic Google Maps link
  return `https://www.google.com/maps?q=${latitude},${longitude}&z=${zoom}`;
}

function generateCirclePoints(lat, lon, radiusKm, points = 36) {
  const pointsArray = [];
  const earthRadius = 6371; // km
  
  for (let i = 0; i <= points; i++) {
    const angle = (i * 360 / points) * (Math.PI / 180);
    const dx = (radiusKm / 111.32) * Math.cos(angle);
    const dy = (radiusKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);
    pointsArray.push([lat + dx, lon + dy]);
  }
  
  return pointsArray;
}

function encodePolyline(points) {
  // Simple polyline encoding (for visualization purposes)
  return points.map(p => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|');
}

function computeRadiusFromPolygon(confidenceArea) {
  if (!confidenceArea || !Array.isArray(confidenceArea) || confidenceArea.length === 0) {
    return null;
  }
  
  try {
    // Extract all points from the polygon
    const points = confidenceArea.map(point => {
      if (Array.isArray(point) && point.length >= 2) {
        return { lat: point[1], lon: point[0] }; // GeoJSON format: [lon, lat]
      }
      return null;
    }).filter(Boolean);
    
    if (points.length === 0) return null;
    
    // Find centroid
    const centroid = points.reduce((acc, pt) => {
      acc.lat += pt.lat;
      acc.lon += pt.lon;
      return acc;
    }, { lat: 0, lon: 0 });
    centroid.lat /= points.length;
    centroid.lon /= points.length;
    
    // Find max distance from centroid
    let maxDistance = 0;
    for (const point of points) {
      const distance = haversine(centroid.lat, centroid.lon, point.lat, point.lon);
      if (distance > maxDistance) maxDistance = distance;
    }
    
    return Math.round(maxDistance * 10) / 10; // Round to 1 decimal
  } catch (e) {
    console.warn('Radius computation failed:', e.message);
    return null;
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function parseUserAgent(ua) {
  const s = (ua || '').toString();
  let browser = 'Unknown', os = 'Unknown', device = 'Desktop';
  
  // Browser detection
  if (/OPR|Opera/.test(s)) browser = 'Opera';
  else if (/Edg\//.test(s)) browser = 'Edge';
  else if (/Chrome\/\d+/i.test(s) && !/Edg\//i.test(s)) browser = 'Chrome';
  else if (/Firefox\/\d+/i.test(s)) browser = 'Firefox';
  else if (/Safari\/\d+/i.test(s) && !/Chrome\//i.test(s)) browser = 'Safari';
  else if (/Trident\/.*rv:/i.test(s)) browser = 'Internet Explorer';
  
  // OS detection
  if (/\bWindows NT 10\b/i.test(s)) os = 'Windows 10';
  else if (/\bWindows NT 6.3\b/i.test(s)) os = 'Windows 8.1';
  else if (/\bWindows NT 6.2\b/i.test(s)) os = 'Windows 8';
  else if (/\bWindows NT 6.1\b/i.test(s)) os = 'Windows 7';
  else if (/\bWindows NT 6\b/i.test(s)) os = 'Windows Vista';
  else if (/\bWindows NT 5\b/i.test(s)) os = 'Windows XP';
  else if (/\bWindows\b/i.test(s)) os = 'Windows';
  else if (/\bMacintosh\b|\bMac OS\b/i.test(s)) os = 'Mac OS';
  else if (/\bAndroid\b/i.test(s)) os = 'Android';
  else if (/\b(iPhone|iPad|iPod)\b/i.test(s)) os = 'iOS';
  else if (/\bLinux\b/i.test(s)) os = 'Linux';
  
  // Device detection
  if (/\bMobile\b/i.test(s) || (/Android/i.test(s) && /Mobile/i.test(s))) device = 'Mobile';
  else if (/\bTablet\b/i.test(s) || /iPad/i.test(s)) device = 'Tablet';
  if (/bot|crawler|spider/i.test(s)) device = 'Bot';
  
  return { browser, os, device, raw: s.substring(0, 200) };
}

async function sendToDiscord(data) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  
  // Format ASN details
  const asnDetails = [];
  if (data.network.asn !== 'Unknown') asnDetails.push(`**ASN:** ${data.network.asn}`);
  if (data.network.registry !== 'Unknown') asnDetails.push(`**Registry:** ${data.network.registry}`);
  if (data.network.registeredCountry !== 'Unknown') asnDetails.push(`**Registered in:** ${data.network.registeredCountry}`);
  if (data.network.rankText) asnDetails.push(`**Rank:** ${data.network.rankText}`);
  
  const embed = {
    embeds: [{
      title: '🌐 Visitor IP Logged',
      color: 0x3498db,
      timestamp: data.timestamp,
      thumbnail: { url: 'https://cdn-icons-png.flaticon.com/512/535/535239.png' },
      fields: [
        { 
          name: '📍 IP Address', 
          value: `\`\`\`${data.ip}\`\`\``, 
          inline: false 
        },
        { 
          name: '🌍 Continent', 
          value: data.location.continent, 
          inline: true 
        },
        { 
          name: '🇮🇳 Country', 
          value: `${data.location.country} (${data.location.countryCode})${data.countryDetails.flagEmoji ? ' ' + data.countryDetails.flagEmoji : ''}`, 
          inline: true 
        },
        { 
          name: '🏙️ Region', 
          value: data.location.region, 
          inline: true 
        },
        { 
          name: '🏙️ City', 
          value: data.location.city, 
          inline: true 
        },
        { 
          name: '📍 Locality', 
          value: data.location.locality, 
          inline: true 
        },
        { 
          name: '📡 Network Provider', 
          value: `**ISP:** ${data.network.isp}\n**Connection:** ${data.network.connectionType}`, 
          inline: true 
        },
        { 
          name: '🔢 ASN Details', 
          value: asnDetails.length > 0 ? asnDetails.join('\n') : 'Not available',
          inline: true 
        },
        { 
          name: '🎯 Coordinates & Accuracy', 
          value: `**Lat/Lon:** ${data.location.latitude}, ${data.location.longitude}\n**Accuracy:** ${data.location.accuracyRadius ? data.location.accuracyRadius + ' km' : 'N/A'}\n**Confidence:** ${data.location.confidence.toUpperCase()}`, 
          inline: true 
        },
        { 
          name: '🕒 Timezone', 
          value: data.timezone.name, 
          inline: true 
        },
        { 
          name: '💰 Currency', 
          value: `${data.countryDetails.currency} (${data.countryDetails.currencyName})`, 
          inline: true 
        },
        { 
          name: '📞 Calling Code', 
          value: `+${data.countryDetails.callingCode}`, 
          inline: true 
        }
      ],
      footer: { 
        text: `IP Logger • ${data.location.plusCode ? 'Plus Code: ' + data.location.plusCode : 'BigDataCloud'}` 
      }
    }]
  };
  
  // Add map link if available
  if (data.location.mapUrl) {
    embed.embeds[0].fields.push({
      name: '🗺️ Confidence Area Map',
      value: `[View Confidence Area on Map](${data.location.mapUrl})`,
      inline: false
    });
  }
  
  // Add security warning if threats exist
  if (data.security.threat || data.security.hazards) {
    embed.embeds[0].color = 0xff0000;
    embed.embeds[0].fields.push({
      name: '⚠️ Security Alert',
      value: 'Potential security threats detected',
      inline: false
    });
  }
  
  try {
    await fetch(webhook, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(embed) 
    });
    console.log('Discord webhook sent successfully');
  } catch (error) {
    console.error('Failed to send Discord webhook:', error);
  }
}
