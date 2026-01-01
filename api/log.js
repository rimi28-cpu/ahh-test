// Use node-fetch v2 (CommonJS)
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get client IP
    let clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (clientIP.includes(',')) {
      clientIP = clientIP.split(',')[0].trim();
    }
    clientIP = clientIP.replace(/^::ffff:/, '');
    
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    console.log('Client IP:', clientIP);
    
    // Get IP information
    let ipData = {};
    try {
      const response = await fetch(`http://ip-api.com/json/${clientIP}?fields=66842623`);
      if (response.ok) {
        ipData = await response.json();
      }
    } catch (error) {
      console.log('Using fallback IP detection');
      ipData = {
        query: clientIP,
        status: 'success',
        country: 'Unknown',
        countryCode: 'XX',
        region: 'Unknown',
        regionName: 'Unknown',
        city: 'Unknown',
        zip: 'Unknown',
        lat: 0,
        lon: 0,
        timezone: 'UTC',
        isp: 'Unknown',
        org: 'Unknown',
        as: 'Unknown'
      };
    }
    
    // Prepare Discord message
    const discordEmbed = {
      embeds: [{
        title: "🌐 New Website Visitor",
        color: 0x00ff00,
        fields: [
          {
            name: "IP Address",
            value: `\`${clientIP}\``,
            inline: true
          },
          {
            name: "Location",
            value: `${ipData.city || 'Unknown'}, ${ipData.regionName || 'Unknown'}, ${ipData.country || 'Unknown'}`,
            inline: true
          },
          {
            name: "Coordinates",
            value: `${ipData.lat || 0}, ${ipData.lon || 0}`,
            inline: true
          },
          {
            name: "ISP",
            value: ipData.isp || 'Unknown',
            inline: true
          },
          {
            name: "Timezone",
            value: ipData.timezone || 'UTC',
            inline: true
          },
          {
            name: "User Agent",
            value: `\`\`\`${userAgent.substring(0, 100)}${userAgent.length > 100 ? '...' : ''}\`\`\``,
            inline: false
          }
        ],
        footer: {
          text: `Logged at ${new Date().toLocaleString()}`
        }
      }]
    };
    
    // Send to Discord if webhook is configured
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        await fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(discordEmbed)
        });
      } catch (e) {
        console.log('Note: Discord webhook failed (might not be configured)');
      }
    }
    
    // Return response
    res.status(200).json({
      success: true,
      message: "IP information logged",
      data: {
        ip: clientIP,
        location: {
          city: ipData.city,
          region: ipData.regionName,
          country: ipData.country,
          countryCode: ipData.countryCode,
          coordinates: {
            latitude: ipData.lat,
            longitude: ipData.lon
          },
          zip: ipData.zip
        },
        network: {
          isp: ipData.isp,
          organization: ipData.org
        },
        timezone: ipData.timezone,
        userAgent: userAgent
      }
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(200).json({
      success: false,
      error: error.message
    });
  }
};
