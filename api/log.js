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
    // Get client IP
    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    
    // BigDataCloud API to get detailed IP information
    const ipInfoResponse = await fetch(
      `https://api.bigdatacloud.net/data/ip-geolocation?ip=${clientIP}&key=${process.env.BIGDATACLOUD_API_KEY || 'demo'}`
    );
    
    const ipInfo = await ipInfoResponse.json();
    
    // Get timezone information
    const timezoneResponse = await fetch(
      `https://api.bigdatacloud.net/data/timezone-by-location?latitude=${ipInfo.location.latitude}&longitude=${ipInfo.location.longitude}&key=${process.env.BIGDATACLOUD_API_KEY || 'demo'}`
    );
    
    const timezoneInfo = await timezoneResponse.json();
    
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
            value: `**Country:** ${ipInfo.country.name}\n**Region:** ${ipInfo.location.region}\n**City:** ${ipInfo.location.city}\n**Postal Code:** ${ipInfo.location.postalCode}`,
            inline: true
          },
          {
            name: "Coordinates",
            value: `**Lat:** ${ipInfo.location.latitude}\n**Long:** ${ipInfo.location.longitude}`,
            inline: true
          },
          {
            name: "Network",
            value: `**ISP:** ${ipInfo.network.carrier.name}\n**Organization:** ${ipInfo.network.organisation || 'N/A'}`,
            inline: true
          },
          {
            name: "Timezone",
            value: `**Name:** ${timezoneInfo.timeZoneName}\n**Offset:** ${timezoneInfo.gmtOffsetString}`,
            inline: true
          },
          {
            name: "Device Info",
            value: `**User Agent:** \`${userAgent || 'Unknown'}\``,
            inline: false
          }
        ],
        footer: {
          text: `Logged at ${new Date().toISOString()}`
        }
      }]
    };

    // Send to Discord webhook
    if (process.env.DISCORD_WEBHOOK_URL) {
      await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(discordEmbed)
      });
    }

    // Return data to client (optional)
    res.status(200).json({
      success: true,
      message: "Information logged successfully",
      data: {
        ip: clientIP,
        location: ipInfo.location,
        country: ipInfo.country,
        network: ipInfo.network,
        timezone: timezoneInfo
      }
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
