// /pages/api/debug-ip.js
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Keep response minimal
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>IP Debug - Check Server Logs</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            max-width: 800px; 
            margin: 40px auto; 
            padding: 20px; 
            line-height: 1.6;
            color: #333;
          }
          .container {
            background: #f5f5f5;
            border-radius: 10px;
            padding: 30px;
            text-align: center;
          }
          h1 { color: #2c3e50; }
          .info-box {
            background: white;
            border-left: 4px solid #3498db;
            padding: 20px;
            margin: 30px 0;
            text-align: left;
          }
          .log-box {
            background: #2c3e50;
            color: #ecf0f1;
            padding: 20px;
            border-radius: 5px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 14px;
            text-align: left;
            overflow-x: auto;
          }
          .success { color: #27ae60; }
          .warning { color: #f39c12; }
          .error { color: #e74c3c; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔍 IP Debug Endpoint</h1>
          <div class="info-box">
            <p><strong>This endpoint runs extensive debug logging.</strong></p>
            <p>Check your Vercel server logs for complete debug output.</p>
            <p>No data is sent to Discord - this is for debugging only.</p>
          </div>
          
          <div class="log-box">
            <p>📊 <strong>Debug Session Started</strong></p>
            <p>Timestamp: ${new Date().toISOString()}</p>
            <p>Endpoint: /api/debug-ip</p>
            <p>Method: ${req.method}</p>
            <p>✅ Check Vercel logs for complete debug information</p>
          </div>
          
          <p style="margin-top: 30px; color: #7f8c8d;">
            <small>This page will remain mostly empty. All debug data is logged to the server console.</small>
          </p>
        </div>
      </body>
    </html>
  `;

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
    
    // Start debug logging
    console.log('\n' + '='.repeat(80));
    console.log('🔍 DEBUG IP ENDPOINT - COMPLETE LOGS');
    console.log('='.repeat(80));
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Client IP: ${clientIP}`);
    console.log(`User-Agent: ${userAgent.substring(0, 100)}${userAgent.length > 100 ? '...' : ''}`);
    console.log(`Request Method: ${req.method}`);
    console.log(`Request Headers:`, JSON.stringify(req.headers, null, 2));
    
    // --- API Key Check ---
    const KEY = process.env.BIGDATACLOUD_API_KEY;
    console.log('\n' + '-'.repeat(80));
    console.log('🔑 API KEY CHECK');
    console.log('-'.repeat(80));
    console.log(`API Key available: ${!!KEY}`);
    if (KEY) {
      console.log(`API Key (first/last 4 chars): ${KEY.substring(0, 4)}...${KEY.substring(KEY.length - 4)}`);
    } else {
      console.error('❌ MISSING BIGDATACLOUD_API_KEY environment variable');
      return res.status(200).send(html); // Still return HTML even if API key missing
    }
    
    const BASE = 'https://api-bdc.net/data';
    
    // --- 1. Fetch Main Geolocation Data ---
    const GEO_URL = `${BASE}/ip-geolocation-full?ip=${encodeURIComponent(clientIP)}&localityLanguage=en&key=${KEY}`;
    
    console.log('\n' + '-'.repeat(80));
    console.log('🌍 GEOLOCATION API REQUEST');
    console.log('-'.repeat(80));
    console.log(`URL: ${GEO_URL}`);
    
    let ipData = {};
    try {
      const response = await fetch(GEO_URL);
      console.log(`Response Status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ API Error: ${response.status}`);
        console.error(`Error Body: ${errorText.substring(0, 500)}`);
      } else {
        const rawText = await response.text();
        console.log(`Response Size: ${rawText.length} characters`);
        
        ipData = JSON.parse(rawText);
        console.log('✅ Geolocation data parsed successfully');
        
        // Log complete structure
        console.log('\n📊 COMPLETE IP DATA STRUCTURE:');
        console.log(JSON.stringify(ipData, null, 2));
        
        // Detailed field analysis
        console.log('\n🔍 FIELD ANALYSIS:');
        console.log(`- Top-level keys: ${Object.keys(ipData).join(', ')}`);
        
        if (ipData.network) {
          console.log(`- Network keys: ${Object.keys(ipData.network).join(', ')}`);
          console.log(`- Network object:`, JSON.stringify(ipData.network, null, 2));
        }
        
        if (ipData.location) {
          console.log(`- Location keys: ${Object.keys(ipData.location).join(', ')}`);
          console.log(`- Location: ${JSON.stringify(ipData.location, null, 2)}`);
        }
        
        if (ipData.country) {
          console.log(`- Country keys: ${Object.keys(ipData.country).join(', ')}`);
        }
        
        // Check for ASN in various places
        console.log('\n🔍 ASN SEARCH IN RESPONSE:');
        const asnPaths = [
          'autonomousSystemNumber',
          'asn',
          'asnNumeric',
          'network.autonomousSystemNumber',
          'network.asn',
          'network.asnNumeric',
          'network.carriers[0].asn',
          'network.carriers[0].asnNumeric',
          'viaCarriers[0].asn',
          'viaCarriers[0].asnNumeric'
        ];
        
        for (const path of asnPaths) {
          const parts = path.split(/[\.\[\]]+/).filter(Boolean);
          let value = ipData;
          let found = true;
          
          for (const part of parts) {
            if (value && typeof value === 'object' && part in value) {
              value = value[part];
            } else {
              found = false;
              break;
            }
          }
          
          if (found && value !== undefined) {
            console.log(`✓ Found ASN at "${path}": ${value}`);
          }
        }
        
        // Confidence area analysis
        console.log('\n🔍 CONFIDENCE AREA ANALYSIS:');
        console.log(`- confidenceArea exists: ${!!ipData.confidenceArea}`);
        console.log(`- confidenceArea type: ${typeof ipData.confidenceArea}`);
        console.log(`- confidenceArea is array: ${Array.isArray(ipData.confidenceArea)}`);
        
        if (Array.isArray(ipData.confidenceArea)) {
          console.log(`- confidenceArea length: ${ipData.confidenceArea.length}`);
          if (ipData.confidenceArea.length > 0) {
            console.log(`- First point: ${JSON.stringify(ipData.confidenceArea[0])}`);
            console.log(`- Last point: ${JSON.stringify(ipData.confidenceArea[ipData.confidenceArea.length - 1])}`);
            
            // Validate points
            const validPoints = ipData.confidenceArea.filter(point => 
              Array.isArray(point) && point.length >= 2 &&
              typeof point[0] === 'number' && typeof point[1] === 'number' &&
              !isNaN(point[0]) && !isNaN(point[1])
            );
            console.log(`- Valid points: ${validPoints.length}/${ipData.confidenceArea.length}`);
          }
        }
      }
    } catch (fetchError) {
      console.error('❌ Geolocation fetch failed:');
      console.error(`Error: ${fetchError.message}`);
      console.error(`Stack: ${fetchError.stack}`);
    }
    
    // --- 2. Extract ASN Number ---
    let asnNumber = null;
    console.log('\n' + '-'.repeat(80));
    console.log('🔗 EXTRACTING ASN NUMBER');
    console.log('-'.repeat(80));
    
    // Try all possible ASN locations
    if (ipData.autonomousSystemNumber) {
      asnNumber = ipData.autonomousSystemNumber;
      console.log(`✓ Found in ipData.autonomousSystemNumber: ${asnNumber}`);
    } else if (ipData.asn) {
      asnNumber = ipData.asn;
      console.log(`✓ Found in ipData.asn: ${asnNumber}`);
    } else if (ipData.network?.autonomousSystemNumber) {
      asnNumber = ipData.network.autonomousSystemNumber;
      console.log(`✓ Found in ipData.network.autonomousSystemNumber: ${asnNumber}`);
    } else if (ipData.network?.asn) {
      asnNumber = ipData.network.asn;
      console.log(`✓ Found in ipData.network.asn: ${asnNumber}`);
    } else if (ipData.network?.carriers?.[0]?.asn) {
      asnNumber = ipData.network.carriers[0].asn;
      console.log(`✓ Found in ipData.network.carriers[0].asn: ${asnNumber}`);
    } else if (ipData.network?.carriers?.[0]?.asnNumeric) {
      asnNumber = ipData.network.carriers[0].asnNumeric;
      console.log(`✓ Found in ipData.network.carriers[0].asnNumeric: ${asnNumber}`);
    } else {
      console.log('✗ No ASN number found in any expected field');
    }
    
    // --- 3. Fetch ASN Data if Available ---
    let asnData = {};
    
    if (asnNumber) {
      const cleanAsnNumber = String(asnNumber).replace(/^AS/i, '');
      const ASN_URL = `${BASE}/asn-info-full?asn=AS${cleanAsnNumber}&localityLanguage=en&key=${KEY}`;
      
      console.log('\n' + '-'.repeat(80));
      console.log('🏢 ASN API REQUEST');
      console.log('-'.repeat(80));
      console.log(`URL: ${ASN_URL}`);
      
      try {
        const asnResponse = await fetch(ASN_URL);
        console.log(`Response Status: ${asnResponse.status} ${asnResponse.statusText}`);
        
        if (asnResponse.ok) {
          const asnText = await asnResponse.text();
          console.log(`Response Size: ${asnText.length} characters`);
          
          asnData = JSON.parse(asnText);
          console.log('✅ ASN data parsed successfully');
          
          // Log complete ASN data
          console.log('\n📊 COMPLETE ASN DATA STRUCTURE:');
          console.log(JSON.stringify(asnData, null, 2));
          
          console.log('\n🔍 ASN FIELD ANALYSIS:');
          console.log(`- Organisation: ${asnData.organisation || 'Not found'}`);
          console.log(`- Registry: ${asnData.registry || 'Not found'}`);
          console.log(`- Registered Country: ${asnData.registeredCountryName || 'Not found'}`);
          console.log(`- Total IPv4 Addresses: ${asnData.totalIpv4Addresses || 0}`);
          console.log(`- Rank: ${asnData.rankText || 'Not found'}`);
        } else {
          const errorText = await asnResponse.text();
          console.warn(`⚠️ ASN API failed: ${response.status}`);
          console.warn(`Error: ${errorText.substring(0, 200)}`);
        }
      } catch (asnError) {
        console.error('❌ ASN fetch error:');
        console.error(`Error: ${asnError.message}`);
      }
    }
    
    // --- 4. Process Extracted Data ---
    console.log('\n' + '-'.repeat(80));
    console.log('📋 EXTRACTED DATA SUMMARY');
    console.log('-'.repeat(80));
    
    // Location data
    const locationData = {
      latitude: ipData?.location?.latitude || null,
      longitude: ipData?.location?.longitude || null,
      continent: ipData?.location?.continent || 'Unknown',
      region: ipData?.location?.principalSubdivision || 'Unknown',
      city: ipData?.location?.city || 'Unknown',
      country: ipData?.country?.name || 'Unknown',
      countryCode: ipData?.country?.isoAlpha2 || 'Unknown',
      timezone: ipData?.location?.timeZone?.ianaTimeId || 'Unknown',
      accuracyRadius: ipData?.location?.accuracyRadius || null
    };
    
    console.log('📍 LOCATION DATA:');
    console.log(JSON.stringify(locationData, null, 2));
    
    // Network data
    const networkData = {
      asn: asnNumber,
      asnFormatted: asnNumber ? `AS${String(asnNumber).replace(/^AS/i, '')}` : 'Unknown',
      isp: asnData?.organisation || ipData?.network?.organisation || 'Unknown',
      connectionType: ipData?.network?.connectionType || 'Unknown',
      registry: asnData?.registry || 'Unknown',
      registeredCountry: asnData?.registeredCountryName || 'Unknown'
    };
    
    console.log('\n🛜 NETWORK DATA:');
    console.log(JSON.stringify(networkData, null, 2));
    
    // Confidence area data
    console.log('\n🎯 CONFIDENCE AREA DATA:');
    if (ipData.confidenceArea && Array.isArray(ipData.confidenceArea)) {
      console.log(`- Total points: ${ipData.confidenceArea.length}`);
      
      // Count valid points
      const validPoints = ipData.confidenceArea.filter(point => 
        Array.isArray(point) && point.length >= 2 &&
        typeof point[0] === 'number' && typeof point[1] === 'number' &&
        !isNaN(point[0]) && !isNaN(point[1])
      );
      
      console.log(`- Valid points: ${validPoints.length}`);
      
      if (validPoints.length > 0) {
        // Calculate bounds
        const lats = validPoints.map(p => p[1]);
        const lons = validPoints.map(p => p[0]);
        
        console.log(`- Lat range: ${Math.min(...lats).toFixed(6)} to ${Math.max(...lats).toFixed(6)}`);
        console.log(`- Lon range: ${Math.min(...lons).toFixed(6)} to ${Math.max(...lons).toFixed(6)}`);
        
        // Calculate area
        const latKm = (Math.max(...lats) - Math.min(...lats)) * 111.32;
        const avgLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const lonKm = (Math.max(...lons) - Math.min(...lons)) * (111.32 * Math.cos(avgLat * Math.PI / 180));
        const areaKm = Math.abs(latKm * lonKm);
        
        console.log(`- Approx area: ${areaKm.toFixed(2)} km²`);
        console.log(`- Dimensions: ${lonKm.toFixed(2)} km × ${latKm.toFixed(2)} km`);
      }
    } else {
      console.log('- No confidence area data available');
    }
    
    // --- 5. Environment Variables Check ---
    console.log('\n' + '-'.repeat(80));
    console.log('⚙️ ENVIRONMENT VARIABLES CHECK');
    console.log('-'.repeat(80));
    console.log(`- BIGDATACLOUD_API_KEY: ${KEY ? 'Set (hidden)' : 'NOT SET'}`);
    console.log(`- DISCORD_WEBHOOK_URL: ${process.env.DISCORD_WEBHOOK_URL ? 'Set' : 'NOT SET'}`);
    
    // --- 6. Final Summary ---
    console.log('\n' + '='.repeat(80));
    console.log('✅ DEBUG SESSION COMPLETE');
    console.log('='.repeat(80));
    console.log(`IP: ${clientIP}`);
    console.log(`Location: ${locationData.city}, ${locationData.region}, ${locationData.country}`);
    console.log(`Coordinates: ${locationData.latitude}, ${locationData.longitude}`);
    console.log(`ASN: ${networkData.asnFormatted}`);
    console.log(`ISP: ${networkData.isp}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('='.repeat(80) + '\n');
    
    // Return minimal HTML response
    return res.status(200).send(html);
    
  } catch (error) {
    console.error('\n' + '❌'.repeat(40));
    console.error('FATAL ERROR IN DEBUG ENDPOINT:');
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error('❌'.repeat(40) + '\n');
    
    // Still return HTML even on error
    return res.status(200).send(html);
  }
                           }
