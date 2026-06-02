const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const os = require('os');
const proj4 = require('proj4');

const app = express();
const PORT = process.env.PORT || 1111;

// Define projections
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");
proj4.defs("EPSG:32736", "+proj=utm +zone=36 +south +datum=WGS84 +units=m +no_defs");

// Set Desktop path
const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const UPLOADS_PATH = path.join(DESKTOP_PATH, 'uploads');
const OUTPUTS_PATH = path.join(DESKTOP_PATH, 'outputs');
const GIS_PATH = path.join(DESKTOP_PATH, 'gis_files');

[DESKTOP_PATH, UPLOADS_PATH, OUTPUTS_PATH, GIS_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log(`\n📁 Files saved to: ${DESKTOP_PATH}`);

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const fileExt = path.extname(file.originalname).toLowerCase();
        const gisExtensions = ['.cpg', '.dbf', '.prj', '.sbn', '.sbx', '.shp', '.shx'];
        if (gisExtensions.includes(fileExt)) {
            cb(null, GIS_PATH);
        } else {
            cb(null, UPLOADS_PATH);
        }
    },
    filename: function (req, file, cb) {
        const timestamp = Date.now();
        cb(null, `${timestamp}_${file.originalname}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        cb(null, true);
    }
});

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_PATH));
app.use('/gis', express.static(GIS_PATH));
app.use('/outputs', express.static(OUTPUTS_PATH));

const database = {
    schools: [],
    villages: [],
    roads: [],
    accessibilityResults: [],
    proposedRoads: [],
    uploadedFiles: [],
    gisFiles: []
};

function toRwandaUTM(lon, lat) {
    try {
        const result = proj4('EPSG:4326', 'EPSG:32736', [lon, lat]);
        return { x: result[0], y: result[1] };
    } catch (error) {
        return { x: lon, y: lat };
    }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function pointToLineDistance(px, py, x1, y1, x2, y2) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;
    let xx, yy;
    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * C; yy = y1 + param * D; }
    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy) * 111.32;
}

function calculateConnectivityScore(village) {
    if (database.roads.length === 0) return 0.3;
    let nearbyRoads = 0;
    database.roads.forEach(road => {
        const dist = pointToLineDistance(village.lat, village.lon, road.start_lat, road.start_lon, road.end_lat, road.end_lon);
        if (dist < 5) nearbyRoads++;
    });
    return Math.min(nearbyRoads / 5, 1);
}

function calculateRoadDensity(village) {
    if (database.roads.length === 0) return 0.2;
    let totalLength = 0;
    database.roads.forEach(road => {
        const dist = pointToLineDistance(village.lat, village.lon, road.start_lat, road.start_lon, road.end_lat, road.end_lon);
        if (dist < 10) totalLength += road.length_km || 10;
    });
    return Math.min(totalLength / 50, 2);
}

function findShortestPath(village, school) {
    let minDistance = calculateDistance(village.lat, village.lon, school.lat, school.lon);
    if (database.roads.length === 0) return minDistance;
    database.roads.forEach(road => {
        const distToRoad = pointToLineDistance(village.lat, village.lon, road.start_lat, road.start_lon, road.end_lat, road.end_lon);
        const distSchoolToRoad = pointToLineDistance(school.lat, school.lon, road.start_lat, road.start_lon, road.end_lat, road.end_lon);
        const totalDist = distToRoad + (road.length_km || 10) + distSchoolToRoad;
        if (totalDist < minDistance) minDistance = totalDist;
    });
    return minDistance;
}

function generateRwandanSampleData() {
    console.log('Generating Rwandan sample data...');
    
    // Rwandan Schools (real approximate coordinates)
    database.schools = [
        { id: 'SCH_001', name: 'Ecole Secondaire de Kigali', lat: -1.9441, lon: 30.0619, capacity: 1200 },
        { id: 'SCH_002', name: 'Groupe Scolaire Butare', lat: -2.6017, lon: 29.7368, capacity: 800 },
        { id: 'SCH_003', name: 'College Saint Andre', lat: -1.9536, lon: 30.0605, capacity: 600 },
        { id: 'SCH_004', name: 'Ecole des Sciences de Byimana', lat: -2.0150, lon: 29.8550, capacity: 500 },
        { id: 'SCH_005', name: 'Lycee de Kigali', lat: -1.9500, lon: 30.0700, capacity: 1500 },
        { id: 'SCH_006', name: 'GS Gahini', lat: -1.7500, lon: 30.5000, capacity: 700 },
        { id: 'SCH_007', name: 'College de Save', lat: -2.4500, lon: 29.7500, capacity: 550 },
        { id: 'SCH_008', name: 'Ecole Secondaire de Ruhengeri', lat: -1.5000, lon: 29.6500, capacity: 650 },
        { id: 'SCH_009', name: 'GS Rubavu', lat: -1.6833, lon: 29.2333, capacity: 600 },
        { id: 'SCH_010', name: 'College Adventiste de Gitwe', lat: -2.1167, lon: 29.8667, capacity: 450 }
    ];
    
    // Rwandan Villages with coordinates and populations
    database.villages = [
        { id: 'VIL_001', name: 'Nyarugenge', lat: -1.9441, lon: 30.0619, population: 85000 },
        { id: 'VIL_002', name: 'Butare', lat: -2.6017, lon: 29.7368, population: 50000 },
        { id: 'VIL_003', name: 'Ruhengeri', lat: -1.5000, lon: 29.6500, population: 55000 },
        { id: 'VIL_004', name: 'Gisenyi', lat: -1.6833, lon: 29.2333, population: 42000 },
        { id: 'VIL_005', name: 'Byumba', lat: -1.5783, lon: 30.0867, population: 35000 },
        { id: 'VIL_006', name: 'Cyangugu', lat: -2.4833, lon: 28.9000, population: 28000 },
        { id: 'VIL_007', name: 'Kibuye', lat: -2.0667, lon: 29.3500, population: 25000 },
        { id: 'VIL_008', name: 'Rwamagana', lat: -1.9500, lon: 30.4333, population: 32000 },
        { id: 'VIL_009', name: 'Muhanga', lat: -2.0833, lon: 29.7500, population: 40000 },
        { id: 'VIL_010', name: 'Nyamata', lat: -2.1500, lon: 30.0833, population: 22000 },
        { id: 'VIL_011', name: 'Rulindo', lat: -1.7000, lon: 30.0000, population: 18000 },
        { id: 'VIL_012', name: 'Kayonza', lat: -1.8667, lon: 30.5333, population: 20000 },
        { id: 'VIL_013', name: 'Bugesera', lat: -2.2000, lon: 30.1333, population: 15000 },
        { id: 'VIL_014', name: 'Nyagatare', lat: -1.3000, lon: 30.3333, population: 38000 },
        { id: 'VIL_015', name: 'Rutsiro', lat: -1.8667, lon: 29.3167, population: 16000 },
        { id: 'VIL_016', name: 'Karongi', lat: -2.0667, lon: 29.3500, population: 19000 },
        { id: 'VIL_017', name: 'Nyanza', lat: -2.3500, lon: 29.7500, population: 21000 },
        { id: 'VIL_018', name: 'Gicumbi', lat: -1.6333, lon: 30.0833, population: 17000 },
        { id: 'VIL_019', name: 'Burera', lat: -1.5000, lon: 29.7833, population: 14000 },
        { id: 'VIL_020', name: 'Gatsibo', lat: -1.6333, lon: 30.3333, population: 23000 },
        { id: 'VIL_021', name: 'Ngoma', lat: -2.2000, lon: 30.5000, population: 16500 },
        { id: 'VIL_022', name: 'Kamonyi', lat: -2.0000, lon: 29.8167, population: 19500 },
        { id: 'VIL_023', name: 'Nyaruguru', lat: -2.6500, lon: 29.5500, population: 14500 },
        { id: 'VIL_024', name: 'Nyamasheke', lat: -2.3333, lon: 29.0000, population: 13500 },
        { id: 'VIL_025', name: 'Rusizi', lat: -2.4833, lon: 28.9000, population: 31000 }
    ];
    
    // Rwandan Roads (connecting major towns)
    database.roads = [
        { id: 'RD_001', type: 'primary', start_lat: -1.9441, start_lon: 30.0619, end_lat: -2.6017, end_lon: 29.7368, length_km: 135.5 },
        { id: 'RD_002', type: 'primary', start_lat: -1.9441, start_lon: 30.0619, end_lat: -1.5000, end_lon: 29.6500, length_km: 85.2 },
        { id: 'RD_003', type: 'secondary', start_lat: -1.9441, start_lon: 30.0619, end_lat: -1.6833, end_lon: 29.2333, length_km: 98.7 },
        { id: 'RD_004', type: 'secondary', start_lat: -2.6017, start_lon: 29.7368, end_lat: -1.9441, end_lon: 30.0619, length_km: 135.5 },
        { id: 'RD_005', type: 'primary', start_lat: -1.5000, start_lon: 29.6500, end_lat: -1.9441, end_lon: 30.0619, length_km: 85.2 },
        { id: 'RD_006', type: 'secondary', start_lat: -1.6833, start_lon: 29.2333, end_lat: -1.9441, end_lon: 30.0619, length_km: 98.7 },
        { id: 'RD_007', type: 'tertiary', start_lat: -1.5783, start_lon: 30.0867, end_lat: -1.9441, end_lon: 30.0619, length_km: 45.3 },
        { id: 'RD_008', type: 'tertiary', start_lat: -2.0833, start_lon: 29.7500, end_lat: -2.6017, end_lon: 29.7368, length_km: 62.8 },
        { id: 'RD_009', type: 'secondary', start_lat: -1.9500, start_lon: 30.4333, end_lat: -1.9441, end_lon: 30.0619, length_km: 42.5 },
        { id: 'RD_010', type: 'tertiary', start_lat: -2.1500, start_lon: 30.0833, end_lat: -2.6017, end_lon: 29.7368, length_km: 78.3 }
    ];
    
    console.log(`Rwandan sample data generated: ${database.schools.length} schools, ${database.villages.length} villages, ${database.roads.length} roads`);
}

function analyzeAccessibility() {
    console.log('\n[Analysis] Running accessibility analysis for Rwanda...');
    database.accessibilityResults = [];
    
    database.villages.forEach(village => {
        let nearestSchool = null;
        let minDistance = Infinity;
        
        database.schools.forEach(school => {
            const networkDistance = findShortestPath(village, school);
            if (networkDistance < minDistance) {
                minDistance = networkDistance;
                nearestSchool = school;
            }
        });
        
        const travelTime = minDistance / 30 * 60;
        const connectivityScore = calculateConnectivityScore(village);
        const roadDensity = calculateRoadDensity(village);
        
        const accessibilityScore = (
            (minDistance / 10) * 4 +
            (travelTime / 60) * 3 +
            (1 - connectivityScore) * 2 +
            (1 - Math.min(roadDensity / 2, 1)) * 1
        );
        
        let category, status;
        if (accessibilityScore < 2) {
            category = "Highly Accessible";
            status = "good";
        } else if (accessibilityScore < 5) {
            category = "Moderately Accessible";
            status = "moderate";
        } else {
            category = "Poorly Accessible / Underserved";
            status = "poor";
        }
        
        const priorityScore = Math.min(1, (
            (Math.max(0, minDistance - 5) / 20) * 0.5 +
            (Math.max(0, travelTime - 30) / 60) * 0.3 +
            (village.population / 85000) * 0.2
        ));
        
        database.accessibilityResults.push({
            village_id: village.id,
            village_name: village.name,
            nearest_school_id: nearestSchool ? nearestSchool.id : 'N/A',
            nearest_school_name: nearestSchool ? nearestSchool.name : 'N/A',
            distance_km: minDistance.toFixed(2),
            travel_time_min: travelTime.toFixed(0),
            road_connectivity_score: connectivityScore.toFixed(2),
            road_density: roadDensity.toFixed(2),
            accessibility_score: accessibilityScore.toFixed(2),
            accessibility_category: category,
            status: status,
            is_underserved: category === "Poorly Accessible / Underserved" ? 1 : 0,
            priority_score: priorityScore.toFixed(2),
            population: village.population,
            lat: village.lat,
            lon: village.lon
        });
    });
    
    generateProposedRoads();
    saveResultsToDesktop();
    generateAndSaveGeoJSON();
    console.log(`[Analysis] Complete: ${database.accessibilityResults.length} villages analyzed in Rwanda`);
}

function generateProposedRoads() {
    const underserved = database.accessibilityResults.filter(r => r.is_underserved === 1);
    underserved.sort((a, b) => parseFloat(b.priority_score) - parseFloat(a.priority_score));
    const highPriority = underserved.slice(0, Math.ceil(underserved.length * 0.3));
    
    database.proposedRoads = [];
    highPriority.forEach((village, idx) => {
        const villageData = database.villages.find(v => v.id === village.village_id);
        const schoolData = database.schools.find(s => s.id === village.nearest_school_id);
        
        if (villageData && schoolData) {
            const distance = parseFloat(village.distance_km);
            database.proposedRoads.push({
                road_id: `PROP_RWA_${idx + 1}`,
                from_village: village.village_name,
                from_lat: villageData.lat,
                from_lon: villageData.lon,
                to_school: schoolData.name,
                to_lat: schoolData.lat,
                to_lon: schoolData.lon,
                length_km: distance.toFixed(2),
                priority_level: distance < 10 ? 1 : 2,
                priority_score: village.priority_score
            });
        }
    });
}

function saveResultsToDesktop() {
    const resultsCSV = ['Village,Nearest School,Distance (km),Travel Time (min),Connectivity Score,Road Density,Accessibility Category,Priority Score,Population'];
    database.accessibilityResults.forEach(r => {
        resultsCSV.push(`"${r.village_name}","${r.nearest_school_name}",${r.distance_km},${r.travel_time_min},${r.road_connectivity_score},${r.road_density},"${r.accessibility_category}",${r.priority_score},${r.population}`);
    });
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'rwanda_accessibility_results.csv'), resultsCSV.join('\n'));
    
    const roadsCSV = ['Road ID,From Village,To School,Length (km),Priority Level,Priority Score'];
    database.proposedRoads.forEach(r => {
        roadsCSV.push(`${r.road_id},"${r.from_village}","${r.to_school}",${r.length_km},${r.priority_level},${r.priority_score}`);
    });
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'rwanda_proposed_roads.csv'), roadsCSV.join('\n'));
    
    const stats = getStatistics();
    if (stats) {
        const summaryCSV = ['Metric,Value',
            `Total Villages,${stats.total_villages}`,
            `Underserved Villages,${stats.underserved_count}`,
            `Underserved Percentage,${stats.underserved_percentage}%`,
            `Highly Accessible,${stats.highly_accessible}`,
            `Moderately Accessible,${stats.moderately_accessible}`,
            `Average Distance (km),${stats.avg_distance_km}`,
            `Average Travel Time (min),${stats.avg_travel_time_min}`,
            `Average Connectivity Score,${stats.avg_connectivity_score}`,
            `Projection,EPSG:32736 - WGS 84 / UTM zone 36S`,
            `Country,Rwanda`
        ];
        fs.writeFileSync(path.join(OUTPUTS_PATH, 'rwanda_summary_statistics.csv'), summaryCSV.join('\n'));
    }
    
    const projectionInfo = `Rwanda Geographic Information
Country: Republic of Rwanda
Projection: WGS 84 / UTM zone 36S
EPSG Code: 32736
Coordinate System: Projected
Units: Meters
Datum: WGS 84
UTM Zone: 36 South
Valid Area: Rwanda (East Africa)
Generated: ${new Date().toISOString()}
`;
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'RWANDA_PROJECTION_INFO.txt'), projectionInfo);
    
    console.log(`📁 Rwanda results saved to Desktop: ${OUTPUTS_PATH}`);
}

function generateAndSaveGeoJSON() {
    console.log('\n🗺️ Generating GeoJSON files with Rwanda Projection (EPSG:32736)...');
    
    const accessibilityFeatures = database.accessibilityResults.map(r => {
        const utm = toRwandaUTM(parseFloat(r.lon), parseFloat(r.lat));
        return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [utm.x, utm.y] },
            properties: { 
                village: r.village_name,
                category: r.accessibility_category,
                distance_km: parseFloat(r.distance_km),
                travel_time_min: parseInt(r.travel_time_min),
                priority_score: parseFloat(r.priority_score),
                population: r.population,
                status: r.status,
                country: "Rwanda",
                projection: "EPSG:32736 - WGS 84 / UTM zone 36S"
            }
        };
    });
    
    const accessibilityGeoJSON = { 
        type: "FeatureCollection", 
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::32736" } },
        features: accessibilityFeatures 
    };
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'RWANDA_accessibility_map.geojson'), JSON.stringify(accessibilityGeoJSON, null, 2));
    
    const underservedFeatures = database.accessibilityResults.filter(r => r.is_underserved === 1).map(r => {
        const utm = toRwandaUTM(parseFloat(r.lon), parseFloat(r.lat));
        return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [utm.x, utm.y] },
            properties: { 
                village: r.village_name,
                distance_km: parseFloat(r.distance_km),
                priority_score: parseFloat(r.priority_score),
                population: r.population,
                country: "Rwanda"
            }
        };
    });
    
    const underservedGeoJSON = { 
        type: "FeatureCollection", 
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::32736" } },
        features: underservedFeatures 
    };
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'RWANDA_underserved_areas.geojson'), JSON.stringify(underservedGeoJSON, null, 2));
    
    const priorityFeatures = database.accessibilityResults.filter(r => r.is_underserved === 1 && parseFloat(r.priority_score) > 0.6).map(r => {
        const utm = toRwandaUTM(parseFloat(r.lon), parseFloat(r.lat));
        return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [utm.x, utm.y] },
            properties: { 
                village: r.village_name,
                priority_score: parseFloat(r.priority_score),
                distance_km: parseFloat(r.distance_km),
                country: "Rwanda"
            }
        };
    });
    
    const priorityZonesGeoJSON = { 
        type: "FeatureCollection", 
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::32736" } },
        features: priorityFeatures 
    };
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'RWANDA_priority_zones.geojson'), JSON.stringify(priorityZonesGeoJSON, null, 2));
    
    const proposedRoadsFeatures = database.proposedRoads.map(r => {
        const startUtm = toRwandaUTM(parseFloat(r.from_lon), parseFloat(r.from_lat));
        const endUtm = toRwandaUTM(parseFloat(r.to_lon), parseFloat(r.to_lat));
        return {
            type: "Feature",
            geometry: { type: "LineString", coordinates: [[startUtm.x, startUtm.y], [endUtm.x, endUtm.y]] },
            properties: { 
                road_id: r.road_id,
                from_village: r.from_village,
                to_school: r.to_school,
                length_km: parseFloat(r.length_km),
                priority_level: r.priority_level,
                country: "Rwanda"
            }
        };
    });
    
    const proposedRoadsGeoJSON = { 
        type: "FeatureCollection", 
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::32736" } },
        features: proposedRoadsFeatures 
    };
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'RWANDA_proposed_roads.geojson'), JSON.stringify(proposedRoadsGeoJSON, null, 2));
    
    console.log(`✅ Rwanda Projection GeoJSON files saved to: ${OUTPUTS_PATH}`);
}

function getStatistics() {
    const results = database.accessibilityResults;
    if (results.length === 0) return null;
    
    const total = results.length;
    const underserved = results.filter(r => r.is_underserved === 1).length;
    const good = results.filter(r => r.status === 'good').length;
    const moderate = results.filter(r => r.status === 'moderate').length;
    const avgDistance = results.reduce((sum, r) => sum + parseFloat(r.distance_km), 0) / total;
    const avgTravelTime = results.reduce((sum, r) => sum + parseFloat(r.travel_time_min), 0) / total;
    const avgConnectivity = results.reduce((sum, r) => sum + parseFloat(r.road_connectivity_score), 0) / total;
    
    return {
        total_villages: total,
        underserved_count: underserved,
        underserved_percentage: ((underserved / total) * 100).toFixed(1),
        highly_accessible: good,
        moderately_accessible: moderate,
        avg_distance_km: avgDistance.toFixed(2),
        avg_travel_time_min: avgTravelTime.toFixed(0),
        avg_connectivity_score: avgConnectivity.toFixed(2)
    };
}

function parseCSVFile(filePath, type) {
    const content = fs.readFileSync(filePath, 'utf8');
    const records = parse(content, { columns: true, skip_empty_lines: true });
    
    if (type === 'schools') {
        database.schools = records.map(r => ({
            id: r.id || r.school_id || `SCH_${Math.random()}`,
            name: r.name || r.school_name || 'Unknown School',
            lat: parseFloat(r.lat || r.latitude || 0),
            lon: parseFloat(r.lon || r.longitude || 0),
            capacity: parseInt(r.capacity) || 200
        }));
    } else if (type === 'villages') {
        database.villages = records.map(r => ({
            id: r.id || r.village_id || `VIL_${Math.random()}`,
            name: r.name || r.village_name || 'Unknown Village',
            lat: parseFloat(r.lat || r.latitude || 0),
            lon: parseFloat(r.lon || r.longitude || 0),
            population: parseInt(r.population) || 100
        }));
    } else if (type === 'roads') {
        database.roads = records.map(r => ({
            id: r.id || r.road_id || `RD_${Math.random()}`,
            type: r.type || r.road_type || 'secondary',
            start_lat: parseFloat(r.start_lat || r.lat1 || 0),
            start_lon: parseFloat(r.start_lon || r.lon1 || 0),
            end_lat: parseFloat(r.end_lat || r.lat2 || 0),
            end_lon: parseFloat(r.end_lon || r.lon2 || 0),
            length_km: parseFloat(r.length_km) || calculateDistance(
                parseFloat(r.start_lat || r.lat1 || 0),
                parseFloat(r.start_lon || r.lon1 || 0),
                parseFloat(r.end_lat || r.lat2 || 0),
                parseFloat(r.end_lon || r.lon2 || 0)
            )
        }));
    }
}

// API Endpoints
app.post('/api/upload/:type', upload.single('file'), (req, res) => {
    const { type } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
        try {
            parseCSVFile(file.path, type);
            res.json({ success: true, message: `${type} CSV data loaded`, count: database[type].length });
        } catch (error) {
            res.json({ success: true, message: `File saved to Desktop` });
        }
    } else {
        res.json({ success: true, message: `File saved to Desktop` });
    }
});

app.post('/api/analyze', (req, res) => {
    try {
        if (database.schools.length === 0 || database.villages.length === 0) {
            generateRwandanSampleData();
        }
        analyzeAccessibility();
        const stats = getStatistics();
        res.json({
            success: true,
            message: `Rwanda analysis completed. Results saved to Desktop with EPSG:32736 projection`,
            statistics: stats,
            villages_analyzed: database.accessibilityResults.length,
            underserved_found: database.accessibilityResults.filter(r => r.is_underserved === 1).length,
            proposed_roads: database.proposedRoads.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/location/nearest-school', (req, res) => {
    const { lat, lon } = req.body;
    if (!lat || !lon) return res.status(400).json({ error: 'Coordinates required' });
    let nearestSchool = null;
    let minDistance = Infinity;
    database.schools.forEach(school => {
        const distance = calculateDistance(parseFloat(lat), parseFloat(lon), school.lat, school.lon);
        if (distance < minDistance) {
            minDistance = distance;
            nearestSchool = school;
        }
    });
    if (nearestSchool) {
        res.json({ success: true, nearest_school: nearestSchool, distance_km: minDistance.toFixed(2), travel_time_min: (minDistance / 30 * 60).toFixed(0) });
    } else {
        res.json({ success: false, error: 'No schools found' });
    }
});

app.post('/api/location/calculate-route', (req, res) => {
    const { lat, lon, school_id } = req.body;
    if (!lat || !lon || !school_id) return res.status(400).json({ error: 'Missing parameters' });
    const school = database.schools.find(s => s.id === school_id);
    if (school) {
        const route = {
            start: { lat: parseFloat(lat), lon: parseFloat(lon) },
            end: { lat: school.lat, lon: school.lon },
            school: school,
            distance_km: calculateDistance(parseFloat(lat), parseFloat(lon), school.lat, school.lon).toFixed(2),
            travel_time_min: (calculateDistance(parseFloat(lat), parseFloat(lon), school.lat, school.lon) / 30 * 60).toFixed(0),
            route_points: [[parseFloat(lon), parseFloat(lat)], [school.lon, school.lat]]
        };
        res.json({ success: true, route: route });
    } else {
        res.json({ success: false, error: 'School not found' });
    }
});

app.get('/api/location/schools-list', (req, res) => {
    res.json({ success: true, schools: database.schools });
});

app.get('/api/results', (req, res) => {
    res.json({ 
        accessibility: database.accessibilityResults, 
        proposed_roads: database.proposedRoads, 
        statistics: getStatistics(),
        schools: database.schools,
        villages: database.villages,
        roads: database.roads
    });
});

app.get('/api/geojson/:type', (req, res) => {
    const filePath = path.join(OUTPUTS_PATH, `RWANDA_${req.params.type}.geojson`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'File not found. Run analysis first.' });
    }
});

app.get('/api/export/:format/:type', (req, res) => {
    const { format, type } = req.params;
    const filePath = path.join(OUTPUTS_PATH, `RWANDA_${type}.geojson`);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'No data available' });
    }
    
    const geojsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (format === 'geojson') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=RWANDA_${type}.geojson`);
        res.send(JSON.stringify(geojsonData, null, 2));
    } else if (format === 'csv') {
        let csvData = '';
        if (geojsonData.features && geojsonData.features.length > 0) {
            const headers = Object.keys(geojsonData.features[0].properties);
            csvData = headers.join(',') + '\n';
            geojsonData.features.forEach(feature => {
                const row = headers.map(h => feature.properties[h] || '').join(',');
                csvData += row + '\n';
            });
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=RWANDA_${type}.csv`);
        res.send(csvData);
    } else if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=RWANDA_${type}.json`);
        res.send(JSON.stringify(geojsonData, null, 2));
    } else if (format === 'kml') {
        let kmlData = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>Rwanda ${type}</name>\n';
        geojsonData.features.forEach(feature => {
            if (feature.geometry.type === 'Point') {
                kmlData += '<Placemark>\n<name>' + (feature.properties.village || 'Location') + '</name>\n<Point>\n<coordinates>' + feature.geometry.coordinates[0] + ',' + feature.geometry.coordinates[1] + ',0</coordinates>\n</Point>\n</Placemark>\n';
            }
        });
        kmlData += '</Document>\n</kml>';
        res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
        res.setHeader('Content-Disposition', `attachment; filename=RWANDA_${type}.kml`);
        res.send(kmlData);
    } else if (format === 'gpx') {
        let gpxData = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Rwanda School System">\n';
        geojsonData.features.forEach(feature => {
            if (feature.geometry.type === 'Point') {
                gpxData += '<wpt lat="' + feature.geometry.coordinates[1] + '" lon="' + feature.geometry.coordinates[0] + '">\n<name>' + (feature.properties.village || 'Location') + '</name>\n</wpt>\n';
            }
        });
        gpxData += '</gpx>';
        res.setHeader('Content-Type', 'application/gpx+xml');
        res.setHeader('Content-Disposition', `attachment; filename=RWANDA_${type}.gpx`);
        res.send(gpxData);
    } else {
        res.status(400).json({ error: 'Unsupported format' });
    }
});

app.get('/api/data-status', (req, res) => {
    res.json({
        schools: database.schools.length,
        villages: database.villages.length,
        roads: database.roads.length,
        results: database.accessibilityResults.length,
        desktop_save_path: DESKTOP_PATH,
        country: "Rwanda",
        projection: "EPSG:32736 - WGS 84 / UTM zone 36S"
    });
});

app.post('/api/generate-sample', (req, res) => {
    generateRwandanSampleData();
    analyzeAccessibility();
    res.json({ success: true, message: 'Rwandan sample data generated', schools: database.schools.length, villages: database.villages.length });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Rwanda School Accessibility System Running', projection: 'EPSG:32736' });
});

app.use(express.static('public'));

// Generate initial Rwandan data
generateRwandanSampleData();
analyzeAccessibility();

app.listen(PORT, () => {
    console.log('\n============================================================');
    console.log(' RWANDA SCHOOL ACCESSIBILITY ANALYSIS SYSTEM');
    console.log('============================================================');
    console.log(` Server: http://localhost:${PORT}`);
    console.log(` Dashboard: http://localhost:${PORT}`);
    console.log(` Projection: EPSG:32736 - WGS 84 / UTM zone 36S`);
    console.log(` Country: Rwanda`);
    console.log(` Data saved to: ${DESKTOP_PATH}`);
    console.log('============================================================');
    console.log('\n📁 Rwanda Output Files:');
    console.log('   • RWANDA_accessibility_map.geojson');
    console.log('   • RWANDA_underserved_areas.geojson');
    console.log('   • RWANDA_priority_zones.geojson');
    console.log('   • RWANDA_proposed_roads.geojson');
    console.log('   • rwanda_accessibility_results.csv');
    console.log('   • rwanda_proposed_roads.csv');
    console.log('   • rwanda_summary_statistics.csv');
    console.log('============================================================\n');
});
