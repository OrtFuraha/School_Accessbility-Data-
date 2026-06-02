const fs = require('fs');
const path = require('path');

// Read current server.js
let serverContent = fs.readFileSync('server.js', 'utf8');

// Find and replace the KML export section with improved version
const kmlSectionStart = `else if (format === 'kml') {`;
const kmlSectionEnd = `else if (format === 'gpx') {`;

// Create improved KML generation
const improvedKML = `else if (format === 'kml') {
        let kmlData = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Rwanda School Accessibility - ${type.replace('_', ' ')}</name>
  <description>School Accessibility Analysis for Rwanda - EPSG:32736 Projection
Generated: ${new Date().toISOString()}
Total Features: ${geojsonData.features.length}
Country: Rwanda
Projection: WGS 84 / UTM zone 36S</description>
  
  <Style id="villageGreen">
    <IconStyle>
      <scale>1.2</scale>
      <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/grn-pushpin.png</href></Icon>
    </IconStyle>
    <LabelStyle>
      <color>ff00aa00</color>
      <scale>0.8</scale>
    </LabelStyle>
  </Style>
  
  <Style id="villageYellow">
    <IconStyle>
      <scale>1.2</scale>
      <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon>
    </IconStyle>
    <LabelStyle>
      <color>ff00aaff</color>
      <scale>0.8</scale>
    </LabelStyle>
  </Style>
  
  <Style id="villageRed">
    <IconStyle>
      <scale>1.2</scale>
      <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/red-pushpin.png</href></Icon>
    </IconStyle>
    <LabelStyle>
      <color>ffff0000</color>
      <scale>0.8</scale>
    </LabelStyle>
  </Style>
  
  <Style id="schoolStyle">
    <IconStyle>
      <scale>1.5</scale>
      <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/blue-pushpin.png</href></Icon>
    </IconStyle>
    <LabelStyle>
      <color>ff0000ff</color>
      <scale>1.0</scale>
    </LabelStyle>
  </Style>
  
  <Style id="roadStyle">
    <LineStyle>
      <color>ffff0000</color>
      <width>4</width>
    </LineStyle>
  </Style>
  
  <Style id="roadProposed">
    <LineStyle>
      <color>ff00ff00</color>
      <width>3</width>
    </LineStyle>
  </Style>
  
  <Folder>
    <name>Rwanda Locations</name>
    <description>School accessibility data for Rwanda</description>`;
        
        geojsonData.features.forEach(feature => {
            if (feature.geometry.type === 'Point') {
                // Convert UTM coordinates back to lat/lon for Google Earth display
                // Since KML expects lat/lon, we need to convert from UTM
                const utmX = feature.geometry.coordinates[0];
                const utmY = feature.geometry.coordinates[1];
                
                // Convert UTM to lat/lon (simplified - for display purposes)
                // Google Earth uses lat/lon, so we use the original lat/lon from database
                const originalVillage = database.accessibilityResults.find(v => v.village_name === feature.properties.village);
                const lat = originalVillage ? originalVillage.lat : utmY / 111320;
                const lon = originalVillage ? originalVillage.lon : utmX / 111320;
                
                let style = '#villageGreen';
                if (feature.properties.status === 'poor') style = '#villageRed';
                else if (feature.properties.status === 'moderate') style = '#villageYellow';
                else if (feature.properties.name && feature.properties.name.includes('School')) style = '#schoolStyle';
                
                kmlData += `
    <Placemark>
      <name>${feature.properties.village || feature.properties.name || 'Location'}</name>
      <styleUrl>${style}</styleUrl>
      <description>
        <![CDATA[
        <div style="font-family: Arial; padding: 10px;">
          <h3>${feature.properties.village || feature.properties.name || 'Rwanda Location'}</h3>
          <table border="0" cellpadding="3">
            ${feature.properties.distance_km ? `<tr><td><b>Distance to School:</b></td><td>${feature.properties.distance_km} km</td></tr>` : ''}
            ${feature.properties.travel_time_min ? `<tr><td><b>Travel Time:</b></td><td>${feature.properties.travel_time_min} minutes</td></tr>` : ''}
            ${feature.properties.population ? `<tr><td><b>Population:</b></td><td>${feature.properties.population.toLocaleString()} people</td></tr>` : ''}
            ${feature.properties.priority_score ? `<tr><td><b>Priority Score:</b></td><td>${feature.properties.priority_score}</td></tr>` : ''}
            ${feature.properties.category ? `<tr><td><b>Accessibility:</b></td><td>${feature.properties.category}</td></tr>` : ''}
            ${feature.properties.nearest_school ? `<tr><td><b>Nearest School:</b></td><td>${feature.properties.nearest_school}</td></tr>` : ''}
            <tr><td><b>Country:</b></td><td>Rwanda</td></tr>
            <tr><td><b>Projection:</b></td><td>EPSG:32736 (UTM Zone 36S)</td></tr>
          </table>
          <br>
          <i>Data from Rwanda School Accessibility Analysis System</i>
        </div>
        ]]>
      </description>
      <Point>
        <coordinates>${lon},${lat},0</coordinates>
      </Point>
    </Placemark>`;
            } else if (feature.geometry.type === 'LineString') {
                // Convert UTM coordinates to lat/lon for each point
                let coordsString = '';
                feature.geometry.coordinates.forEach(coord => {
                    const utmX = coord[0];
                    const utmY = coord[1];
                    // Find matching original coordinates or estimate
                    const originalRoad = database.proposedRoads.find(r => r.road_id === feature.properties.road_id);
                    if (originalRoad) {
                        coordsString += `        ${originalRoad.to_lon},${originalRoad.to_lat},0\n`;
                    } else {
                        // Approximate conversion
                        const lon = utmX / 111320;
                        const lat = utmY / 111320;
                        coordsString += `        ${lon},${lat},0\n`;
                    }
                });
                
                kmlData += `
    <Placemark>
      <name>${feature.properties.road_id || 'Proposed Road'}</name>
      <styleUrl>#roadStyle</styleUrl>
      <description>
        <![CDATA[
        <div style="font-family: Arial; padding: 10px;">
          <h3>${feature.properties.road_id || 'Road Improvement'}</h3>
          <table border="0" cellpadding="3">
            <tr><td><b>From:</b></td><td>${feature.properties.from_village || 'N/A'}</td></tr>
            <tr><td><b>To:</b></td><td>${feature.properties.to_school || 'N/A'}</td></tr>
            <tr><td><b>Length:</b></td><td>${feature.properties.length_km || 0} km</td></tr>
            <tr><td><b>Priority Level:</b></td><td>${feature.properties.priority_level || 'N/A'}</td></tr>
            <tr><td><b>Country:</b></td><td>Rwanda</td></tr>
          </table>
        </div>
        ]]>
      </description>
      <LineString>
        <coordinates>
${coordsString}        </coordinates>
      </LineString>
    </Placemark>`;
            }
        });
        
        // Add Rwanda country outline approximation
        kmlData += `
    <Placemark>
      <name>Rwanda Country Boundary (Approximate)</name>
      <styleUrl>#roadStyle</styleUrl>
      <LineString>
        <coordinates>
          29.5,-2.8,0
          30.8,-2.8,0
          30.8,-1.0,0
          29.5,-1.0,0
          29.5,-2.8,0
        </coordinates>
      </LineString>
    </Placemark>
  </Folder>
</Document>
</kml>`;
        
        res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
        res.setHeader('Content-Disposition', `attachment; filename=RWANDA_${type}.kml`);
        res.send(kmlData);`;

// Replace the old KML section with the improved one
let startIndex = serverContent.indexOf(kmlSectionStart);
let endIndex = serverContent.indexOf(kmlSectionEnd, startIndex);

if (startIndex !== -1 && endIndex !== -1) {
    serverContent = serverContent.substring(0, startIndex) + improvedKML + serverContent.substring(endIndex);
    fs.writeFileSync('server.js', serverContent);
    console.log('✅ KML export function updated successfully!');
} else {
    console.log('⚠️ Could not find KML section in server.js');
}
