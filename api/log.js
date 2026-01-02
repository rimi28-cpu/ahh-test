// /pages/api/ip-logger.js - WITH DEBUGGING AND FIXES
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

    console.log('DEBUG [1]: Starting for IP:', clientIP);
    console.log('DEBUG [2]: User-Agent:', userAgent.substring(0, 50));

    // --- API Key Check ---
    const KEY = process.env.BIGDATACLOUD_API_KEY;
    if (!KEY) {
      console.error('DEBUG [3]: Missing BIGDATACLOUD_API_KEY');
      return res.status(500).json({ success: false, error: 'Missing BIGDATACLOUD_API_KEY' });
    }
    console.log('DEBUG [4]: API Key available (first 8 chars):', KEY.substring(0, 8), '...');

    const BASE = 'https://api-bdc.net/data';
    
    // --- 1. Fetch Main Geolocation Data ---
    const GEO_URL = `${BASE}/ip-geolocation-full?ip=${encodeURIComponent(clientIP)}&localityLanguage=en&key=${KEY}`;
    
    console.log('DEBUG [5]: Fetching from GEO_URL:', GEO_URL);
    
    let ipData = {};
    try {
      const response = await fetch(GEO_URL);
      console.log('DEBUG [6]: Geolocation API response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`DEBUG [7]: Geolocation API error ${response.status}:`, errorText.substring(0, 200));
        return res.status(502).json({ success: false, error: `API error: ${response.status}` });
      }
      
      const rawText = await response.text();
      console.log('DEBUG [8]: Raw response length:', rawText.length, 'chars');
      
      ipData = JSON.parse(rawText);
      console.log('DEBUG [9]: JSON parsed successfully');
      
      // Log the structure of the response for debugging
      console.log('DEBUG [10]: Top-level keys in ipData:', Object.keys(ipData));
      console.log('DEBUG [11]: ipData.network object exists?', !!ipData.network);
      if (ipData.network) {
        console.log('DEBUG [12]: ipData.network keys:', Object.keys(ipData.network));
        console.log('DEBUG [13]: ipData.network content:', JSON.stringify(ipData.network, null, 2));
      }
      console.log('DEBUG [14]: ipData.location keys:', ipData.location ? Object.keys(ipData.location) : 'No location');
      console.log('DEBUG [15]: ipData.confidenceArea exists?', !!ipData.confidenceArea);
      console.log('DEBUG [16]: ipData.confidenceArea type:', typeof ipData.confidenceArea);
      if (ipData.confidenceArea) {
        console.log('DEBUG [17]: ipData.confidenceArea is array?', Array.isArray(ipData.confidenceArea));
        if (Array.isArray(ipData.confidenceArea)) {
          console.log('DEBUG [18]: ipData.confidenceArea length:', ipData.confidenceArea.length);
          if (ipData.confidenceArea.length > 0) {
            console.log('DEBUG [19]: First point of confidenceArea:', ipData.confidenceArea[0]);
          }
        }
      }
      
    } catch (fetchError) {
      console.error('DEBUG [20]: Geolocation fetch failed:', fetchError.message);
      return res.status(500).json({ success: false, error: 'Failed to fetch geolocation data' });
    }

    // --- 2. Extract ASN Number from Main Response (Check multiple possible fields) ---
    let asnNumber = null;
    
    // Try multiple possible fields for ASN
    const possibleAsnFields = [
      'autonomousSystemNumber',
      'asn',
      'asnNumeric',
      'network.autonomousSystemNumber',
      'network.asn',
      'network.asnNumeric'
    ];
    
    console.log('DEBUG [21]: Looking for ASN in possible fields...');
    
    for (const field of possibleAsnFields) {
      if (field.includes('.')) {
        // Handle nested fields
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
          console.log(`DEBUG [22]: Found ASN in nested field '${field}':`, asnNumber);
          break;
        }
      } else {
        // Handle top-level fields
        if (ipData[field]) {
          asnNumber = ipData[field];
          console.log(`DEBUG [23]: Found ASN in top-level field '${field}':`, asnNumber);
          break;
        }
      }
    }
    
    // Also check if network object exists and has ASN
    if (!asnNumber && ipData.network) {
      console.log('DEBUG [24]: Checking ipData.network object for ASN:');
      console.log('DEBUG [25]: ipData.network =', JSON.stringify(ipData.network, null, 2));
    }
    
    if (!asnNumber) {
      console.warn('DEBUG [26]: No ASN number found in any expected field');
    } else {
      console.log('DEBUG [27]: Using ASN number:', asnNumber);
    }

    // --- 3. Fetch ASN Data if Available ---
    let asnData = {};
    
    if (asnNumber) {
      // Ensure ASN number is properly formatted (remove 'AS' prefix if present)
      const cleanAsnNumber = String(asnNumber).replace(/^AS/i, '');
      const ASN_URL = `${BASE}/asn-info-full?asn=AS${cleanAsnNumber}&localityLanguage=en&key=${KEY}`;
      
      console.log('DEBUG [28]: Fetching ASN data from:', ASN_URL);
      
      try {
        const asnResponse = await fetch(ASN_URL);
        console.log('DEBUG [29]: ASN API response status:', asnResponse.status);
        
        if (asnResponse.ok) {
          const asnText = await asnResponse.text();
          console.log('DEBUG [30]: ASN response length:', asnText.length, 'chars');
          
          asnData = JSON.parse(asnText);
          console.log('DEBUG [31]: ASN data parsed successfully, keys:', Object.keys(asnData));
          console.log('DEBUG [32]: ASN data organization:', asnData.organisation || 'Not found');
        } else {
          const errorText = await asnResponse.text();
          console.warn('DEBUG [33]: ASN API failed with status:', asnResponse.status, 'Error:', errorText.substring(0, 200));
        }
      } catch (asnError) {
        console.warn('DEBUG [34]: ASN fetch error:', asnError.message);
      }
    }

    // --- 4. Extract Main Location Data ---
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
    const isp = asnData?.organisation || ipData?.network?.organisation || ipData?.network?.carrier?.name || 'Unknown';
    
    // Format ASN properly
    let asn = 'Unknown';
    if (asnData?.asn) {
      asn = asnData.asn;
    } else if (asnNumber) {
      // Ensure ASN has 'AS' prefix
      const cleanAsn = String(asnNumber).replace(/^AS/i, '');
      asn = `AS${cleanAsn}`;
    }
    
    const connectionType = ipData?.network?.connectionType || 'Unknown';
    const confidence = ipData?.confidence || 'unknown';
    const confidenceArea = ipData?.confidenceArea || null;
    const accuracyRadius = ipData?.location?.accuracyRadius || null;
    const timezone = ipData?.location?.timeZone?.ianaTimeId || 'Unknown';

    console.log('DEBUG [35]: Extracted main data:');
    console.log('DEBUG [36]: - Latitude:', latitude);
    console.log('DEBUG [37]: - Longitude:', longitude);
    console.log('DEBUG [38]: - ISP:', isp);
    console.log('DEBUG [39]: - ASN:', asn);
    console.log('DEBUG [40]: - Connection Type:', connectionType);
    console.log('DEBUG [41]: - Confidence:', confidence);
    console.log('DEBUG [42]: - Confidence Area exists?', !!confidenceArea);
    console.log('DEBUG [43]: - Timezone:', timezone);

    // --- 5. Process Confidence Area Data ---
    let confidenceInfo = {
      hasData: false,
      rawCoordinates: [],
      pointCount: 0,
      validPointCount: 0,
      bounds: null,
      statistics: null,
      error: null
    };

    console.log('DEBUG [44]: Processing confidence area...');
    
    if (confidenceArea && Array.isArray(confidenceArea)) {
      try {
        console.log('DEBUG [45]: Confidence area is array, length:', confidenceArea.length);
        confidenceInfo.hasData = true;
        confidenceInfo.pointCount = confidenceArea.length;
        
        // Process all coordinate points
        confidenceInfo.rawCoordinates = confidenceArea.map((point, index) => {
          if (Array.isArray(point) && point.length >= 2) {
            const lon = point[0];
            const lat = point[1];
            
            // Validate that both are numbers
            if (typeof lon === 'number' && typeof lat === 'number' && 
                !isNaN(lon) && !isNaN(lat)) {
              confidenceInfo.validPointCount++;
              return {
                index: index + 1,
                longitude: lon,
                latitude: lat,
                formatted: `[${lon.toFixed(6)}, ${lat.toFixed(6)}]`
              };
            } else {
              console.log(`DEBUG [46]: Point ${index} invalid: lon=${typeof lon}, lat=${typeof lat}`);
            }
          } else {
            console.log(`DEBUG [47]: Point ${index} is not a valid array:`, point);
          }
          return null;
        }).filter(point => point !== null);

        console.log('DEBUG [48]: Valid points found:', confidenceInfo.validPointCount, 'out of', confidenceInfo.pointCount);

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
          
          console.log('DEBUG [49]: Confidence area bounds calculated:', confidenceInfo.bounds);
        } else {
          confidenceInfo.error = 'No valid coordinate points found in confidence area';
          console.warn('DEBUG [50]:', confidenceInfo.error);
        }
      } catch (error) {
        confidenceInfo.error = error.message;
        console.error('DEBUG [51]: Error processing confidence area:', error.message);
        console.error('DEBUG [52]: Error stack:', error.stack);
      }
    } else {
      console.log('DEBUG [53]: No confidence area data or not an array');
      if (confidenceArea) {
        console.log('DEBUG [54]: Confidence area type:', typeof confidenceArea);
        console.log('DEBUG [55]: Confidence area value:', confidenceArea);
      }
    }

    // --- 6. Build Data Objects ---
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
        validPoints: confidenceInfo.validPointCount,
        error: confidenceInfo.error
      }
    };

    console.log('DEBUG [56]: Main data ready, ASN:', mainData.network.asn);
    console.log('DEBUG [57]: Confidence info ready, hasData:', confidenceInfo.hasData);

    // --- 7. Send Discord Webhooks ---
    const webhookResults = {
      main: { sent: false, error: null },
      confidence: { sent: false, error: null },
      asnDetails: { sent: false, error: null }
    };

    const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
    console.log('DEBUG [58]: Discord webhook URL available?', !!DISCORD_WEBHOOK);
    
    if (DISCORD_WEBHOOK) {
      try {
        console.log('DEBUG [59]: Starting to send webhooks...');
        
        // 1. Send MAIN webhook with location and basic ASN
        console.log('DEBUG [60]: Sending main webhook...');
        try {
          await sendMainWebhook(mainData, DISCORD_WEBHOOK);
          webhookResults.main.sent = true;
          console.log('DEBUG [61]: Main webhook sent successfully');
        } catch (mainError) {
          webhookResults.main.error = mainError.message;
          console.error('DEBUG [62]: Main webhook failed:', mainError.message);
        }
        
        // 2. Send ASN DETAILS webhook if we have ASN data
        if (asnData && Object.keys(asnData).length > 0) {
          console.log('DEBUG [63]: Sending ASN details webhook...');
          try {
            await sendAsnDetailsWebhook(mainData, asnData, DISCORD_WEBHOOK);
            webhookResults.asnDetails.sent = true;
            console.log('DEBUG [64]: ASN details webhook sent successfully');
          } catch (asnError) {
            webhookResults.asnDetails.error = asnError.message;
            console.error('DEBUG [65]: ASN webhook failed:', asnError.message);
          }
        } else {
          console.log('DEBUG [66]: No ASN data to send details webhook');
        }
        
        // 3. Send CONFIDENCE AREA webhook if we have confidence data
        console.log('DEBUG [67]: Checking if we should send confidence webhook...');
        console.log('DEBUG [68]: confidenceInfo.hasData:', confidenceInfo.hasData);
        console.log('DEBUG [69]: confidenceInfo.validPointCount:', confidenceInfo.validPointCount);
        
        if (confidenceInfo.hasData && confidenceInfo.validPointCount > 0) {
          console.log('DEBUG [70]: Sending confidence area webhooks...');
          try {
            await sendConfidenceAreaWebhooks(mainData, confidenceInfo, DISCORD_WEBHOOK);
            webhookResults.confidence.sent = true;
            console.log('DEBUG [71]: Confidence area webhooks sent successfully');
          } catch (confError) {
            webhookResults.confidence.error = confError.message;
            console.error('DEBUG [72]: Confidence webhook failed:', confError.message);
            console.error('DEBUG [73]: Confidence error stack:', confError.stack);
          }
        } else {
          console.log('DEBUG [74]: Not sending confidence webhook because:');
          console.log('DEBUG [75]: - hasData:', confidenceInfo.hasData);
          console.log('DEBUG [76]: - validPointCount:', confidenceInfo.validPointCount);
          console.log('DEBUG [77]: - error:', confidenceInfo.error);
        }
        
      } catch (globalError) {
        console.error('DEBUG [78]: Global webhook error:', globalError.message);
      }
    } else {
      console.warn('DEBUG [79]: No DISCORD_WEBHOOK_URL set');
    }

    // --- 8. Return Response ---
    console.log('DEBUG [80]: Returning final response');
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
        },
        debug: {
          asnFoundInMain: !!asnNumber,
          asnNumber: asnNumber,
          asnDataKeys: asnData ? Object.keys(asnData) : [],
          confidenceAreaType: typeof confidenceArea,
          confidenceAreaIsArray: Array.isArray(confidenceArea)
        }
      },
      webhooks: webhookResults
    });

  } catch (err) {
    console.error('DEBUG [ERROR]: Handler error:', err.message);
    console.error('DEBUG [ERROR]: Stack:', err.stack);
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
  console.log('DEBUG [WEBHOOK1]: Creating main webhook embed...');
  
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

  console.log('DEBUG [WEBHOOK1]: Sending to Discord...');
  
  const response = await fetch(webhookUrl, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(embed)
  });
  
  console.log('DEBUG [WEBHOOK1]: Discord response status:', response.status);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('DEBUG [WEBHOOK1]: Discord error response:', errorText.substring(0, 200));
    throw new Error(`Discord API: ${response.status}`);
  }
}

// --- Webhook 2: ASN DETAILS (from asn-info-full API) ---
async function sendAsnDetailsWebhook(mainData, asnData, webhookUrl) {
  console.log('DEBUG [WEBHOOK2]: Creating ASN details webhook...');
  
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

  console.log('DEBUG [WEBHOOK2]: Sending to Discord...');
  
  const response = await fetch(webhookUrl, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(embed)
  });
  
  console.log('DEBUG [WEBHOOK2]: Discord response status:', response.status);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('DEBUG [WEBHOOK2]: Discord error response:', errorText.substring(0, 200));
    throw new Error(`Discord API: ${response.status}`);
  }
}

// --- Webhook 3: CONFIDENCE AREA DATA (multiple messages if needed) ---
async function sendConfidenceAreaWebhooks(mainData, confidenceInfo, webhookUrl) {
  const totalPoints = confidenceInfo.rawCoordinates.length;
  
  console.log(`DEBUG [WEBHOOK3]: Starting confidence area webhooks with ${totalPoints} points`);
  
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
  console.log('DEBUG [WEBHOOK3-P1]: Sending Part 1 (Statistics)...');
  const response1 = await fetch(webhookUrl, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(statsEmbed)
  });
  console.log('DEBUG [WEBHOOK3-P1]: Discord response status:', response1.status);

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
    console.log('DEBUG [WEBHOOK3-P2]: Sending Part 2 (Coordinates 1-15)...');
    const response2 = await fetch(webhookUrl, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(coordEmbed1)
    });
    console.log('DEBUG [WEBHOOK3-P2]: Discord response status:', response2.status);

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
      console.log('DEBUG [WEBHOOK3-P3]: Sending Part 3 (Coordinates 16-30)...');
      const response3 = await fetch(webhookUrl, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(coordEmbed2)
      });
      console.log('DEBUG [WEBHOOK3-P3]: Discord response status:', response3.status);
    }
        }
}
