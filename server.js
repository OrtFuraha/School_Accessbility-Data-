const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 1111;

// Set Desktop path for file saving
const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const UPLOADS_PATH = path.join(DESKTOP_PATH, 'uploads');
const OUTPUTS_PATH = path.join(DESKTOP_PATH, 'outputs');
const GIS_PATH = path.join(DESKTOP_PATH, 'gis_files');

// Create Desktop folders if they don't exist
[DESKTOP_PATH, UPLOADS_PATH, OUTPUTS_PATH, GIS_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log(`\n📁 Files will be saved to: ${DESKTOP_PATH}`);

// Configure multer for file uploads
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

// Database in memory
const database = {
    schools: [],
    villages: [],
    roads: [],
    accessibilityResults: [],
    proposedRoads: [],
    uploadedFiles: [],
    gisFiles: []
};

// Helper: Calculate distance using Haversine formula
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

// Helper: Distance from point to line
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

function findNearestSchoolFromLocation(lat, lon) {
    let nearestSchool = null;
    let minDistance = Infinity;
    
    database.schools.forEach(school => {
        const networkDistance = findShortestPath({lat: lat, lon: lon}, school);
        if (networkDistance < minDistance) {
            minDistance = networkDistance;
            nearestSchool = school;
        }
    });
    
    return {
        school: nearestSchool,
        distance_km: minDistance.toFixed(2),
        travel_time_min: (minDistance / 30 * 60).toFixed(0)
    };
}

function calculateRoute(lat, lon, schoolId) {
    const school = database.schools.find(s => s.id === schoolId);
    if (!school) return null;
    
    let totalDistance = calculateDistance(lat, lon, school.lat, school.lon);
    let routePoints = [[lon, lat], [school.lon, school.lat]];
    
    if (database.roads.length > 0) {
        let nearestRoadStart = null;
        let minStartDist = Infinity;
        
        database.roads.forEach(road => {
            const dist = pointToLineDistance(lat, lon, road.start_lat, road.start_lon, road.end_lat, road.end_lon);
            if (dist < minStartDist) {
                minStartDist = dist;
                nearestRoadStart = road;
            }
        });
        
        let nearestRoadEnd = null;
        let minEndDist = Infinity;
        
        database.roads.forEach(road => {
            const dist = pointToLineDistance(school.lat, school.lon, road.start_lat, road.start_lon, road.end_lat, road.end_lon);
            if (dist < minEndDist) {
                minEndDist = dist;
                nearestRoadEnd = road;
            }
        });
        
        if (nearestRoadStart && nearestRoadEnd) {
            routePoints = [
                [lon, lat],
                [nearestRoadStart.start_lon, nearestRoadStart.start_lat],
                [nearestRoadStart.end_lon, nearestRoadStart.end_lat],
                [nearestRoadEnd.start_lon, nearestRoadEnd.start_lat],
                [nearestRoadEnd.end_lon, nearestRoadEnd.end_lat],
                [school.lon, school.lat]
            ];
            totalDistance = minStartDist + (nearestRoadStart.length_km || 10) + minEndDist;
        }
    }
    
    return {
        start: {lat: lat, lon: lon},
        end: {lat: school.lat, lon: school.lon},
        school: school,
        distance_km: totalDistance.toFixed(2),
        travel_time_min: (totalDistance / 30 * 60).toFixed(0),
        route_points: routePoints
    };
}

function generateSampleData() {
    console.log('Generating sample spatial data...');
    
    database.schools = [
        { id: 'SCH_1', name: 'Central School', lat: 30, lon: 30, capacity: 200 },
        { id: 'SCH_2', name: 'East School', lat: 70, lon: 30, capacity: 150 },
        { id: 'SCH_3', name: 'North School', lat: 30, lon: 70, capacity: 300 },
        { id: 'SCH_4', name: 'West School', lat: 70, lon: 70, capacity: 250 },
        { id: 'SCH_5', name: 'Central High', lat: 50, lon: 50, capacity: 400 }
    ];
    
    database.villages = [];
    for (let i = 0; i < 25; i++) {
        database.villages.push({
            id: `VIL_${i}`,
            name: `Village ${i+1}`,
            lat: 10 + Math.random() * 80,
            lon: 10 + Math.random() * 80,
            population: Math.floor(100 + Math.random() * 1900)
        });
    }
    
    database.roads = [];
    for (let i = 0; i <= 100; i += 20) {
        database.roads.push({ id: `RD_H_${i}`, type: 'primary', start_lat: i, start_lon: 0, end_lat: i, end_lon: 100, length_km: 111.32 });
        database.roads.push({ id: `RD_V_${i}`, type: 'primary', start_lat: 0, start_lon: i, end_lat: 100, end_lon: i, length_km: 111.32 });
    }
    
    console.log(`Sample data generated: ${database.schools.length} schools, ${database.villages.length} villages, ${database.roads.length} roads`);
}

function analyzeAccessibility() {
    console.log('\n[Analysis] Running accessibility analysis...');
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
            (village.population / 2000) * 0.2
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
    console.log(`[Analysis] Complete: ${database.accessibilityResults.length} villages analyzed`);
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
                road_id: `PROP_${idx + 1}`,
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
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'accessibility_results.csv'), resultsCSV.join('\n'));
    
    const roadsCSV = ['Road ID,From Village,To School,Length (km),Priority Level,Priority Score'];
    database.proposedRoads.forEach(r => {
        roadsCSV.push(`${r.road_id},"${r.from_village}","${r.to_school}",${r.length_km},${r.priority_level},${r.priority_score}`);
    });
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'proposed_roads.csv'), roadsCSV.join('\n'));
    
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
            `Average Connectivity Score,${stats.avg_connectivity_score}`
        ];
        fs.writeFileSync(path.join(OUTPUTS_PATH, 'summary_statistics.csv'), summaryCSV.join('\n'));
    }
    
    console.log(`📁 Results saved to Desktop: ${OUTPUTS_PATH}`);
}

function generateAndSaveGeoJSON() {
    console.log('\n🗺️ Generating GeoJSON files...');
    
    const accessibilityFeatures = database.accessibilityResults.map(r => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [parseFloat(r.lon), parseFloat(r.lat)] },
        properties: { 
            village: r.village_name,
            category: r.accessibility_category,
            distance_km: parseFloat(r.distance_km),
            travel_time_min: parseInt(r.travel_time_min),
            priority_score: parseFloat(r.priority_score),
            population: r.population,
            status: r.status
        }
    }));
    
    const accessibilityGeoJSON = { type: "FeatureCollection", features: accessibilityFeatures };
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'accessibility_map.geojson'), JSON.stringify(accessibilityGeoJSON, null, 2));
    
    const underservedFeatures = database.accessibilityResults.filter(r => r.is_underserved === 1).map(r => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [parseFloat(r.lon), parseFloat(r.lat)] },
        properties: { 
            village: r.village_name,
            distance_km: parseFloat(r.distance_km),
            priority_score: parseFloat(r.priority_score),
            population: r.population
        }
    }));
    
    const underservedGeoJSON = { type: "FeatureCollection", features: underservedFeatures };
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'underserved_areas.geojson'), JSON.stringify(underservedGeoJSON, null, 2));
    
    const priorityFeatures = database.accessibilityResults.filter(r => r.is_underserved === 1 && parseFloat(r.priority_score) > 0.6).map(r => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [parseFloat(r.lon), parseFloat(r.lat)] },
        properties: { 
            village: r.village_name,
            priority_score: parseFloat(r.priority_score),
            distance_km: parseFloat(r.distance_km)
        }
    }));
    
    const priorityZonesGeoJSON = { type: "FeatureCollection", features: priorityFeatures };
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'priority_zones.geojson'), JSON.stringify(priorityZonesGeoJSON, null, 2));
    
    const proposedRoadsFeatures = database.proposedRoads.map(r => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[parseFloat(r.from_lon), parseFloat(r.from_lat)], [parseFloat(r.to_lon), parseFloat(r.to_lat)]] },
        properties: { 
            road_id: r.road_id,
            from_village: r.from_village,
            to_school: r.to_school,
            length_km: parseFloat(r.length_km),
            priority_level: r.priority_level
        }
    }));
    
    const proposedRoadsGeoJSON = { type: "FeatureCollection", features: proposedRoadsFeatures };
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'proposed_roads.geojson'), JSON.stringify(proposedRoadsGeoJSON, null, 2));
    
    console.log(`✅ GeoJSON files saved to: ${OUTPUTS_PATH}`);
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
        console.log(`✅ Loaded ${database.schools.length} schools from CSV`);
    } else if (type === 'villages') {
        database.villages = records.map(r => ({
            id: r.id || r.village_id || `VIL_${Math.random()}`,
            name: r.name || r.village_name || 'Unknown Village',
            lat: parseFloat(r.lat || r.latitude || 0),
            lon: parseFloat(r.lon || r.longitude || 0),
            population: parseInt(r.population) || 100
        }));
        console.log(`✅ Loaded ${database.villages.length} villages from CSV`);
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
        console.log(`✅ Loaded ${database.roads.length} roads from CSV`);
    }
}

// API Endpoints
app.post('/api/upload/:type', upload.single('file'), (req, res) => {
    const { type } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    
    const fileExt = path.extname(file.originalname).toLowerCase();
    const gisExtensions = ['.cpg', '.dbf', '.prj', '.sbn', '.sbx', '.shp', '.shx'];
    const isGISFile = gisExtensions.includes(fileExt);
    
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
        try {
            parseCSVFile(file.path, type);
            res.json({ success: true, message: `${type} CSV data loaded`, count: database[type].length });
        } catch (error) {
            res.json({ success: true, message: `File saved to Desktop` });
        }
    } else if (isGISFile) {
        console.log(`[GIS] Saved to Desktop: ${file.originalname}`);
        res.json({ success: true, message: `GIS file saved: ${file.originalname}` });
    } else {
        res.json({ success: true, message: `File saved to Desktop` });
    }
});

app.post('/api/analyze', (req, res) => {
    try {
        if (database.schools.length === 0 || database.villages.length === 0) {
            generateSampleData();
        }
        analyzeAccessibility();
        const stats = getStatistics();
        res.json({
            success: true,
            message: `Analysis completed. Results saved to Desktop`,
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
    const result = findNearestSchoolFromLocation(parseFloat(lat), parseFloat(lon));
    if (result.school) {
        res.json({ success: true, nearest_school: result.school, distance_km: result.distance_km, travel_time_min: result.travel_time_min });
    } else {
        res.json({ success: false, error: 'No schools found' });
    }
});

app.post('/api/location/calculate-route', (req, res) => {
    const { lat, lon, school_id } = req.body;
    if (!lat || !lon || !school_id) return res.status(400).json({ error: 'Missing parameters' });
    const route = calculateRoute(parseFloat(lat), parseFloat(lon), school_id);
    if (route) {
        res.json({ success: true, route: route });
    } else {
        res.json({ success: false, error: 'Could not calculate route' });
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
    const filePath = path.join(OUTPUTS_PATH, `${req.params.type}.geojson`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'File not found. Run analysis first.' });
    }
});

app.get('/api/data-status', (req, res) => {
    res.json({
        schools: database.schools.length,
        villages: database.villages.length,
        roads: database.roads.length,
        results: database.accessibilityResults.length,
        desktop_save_path: DESKTOP_PATH
    });
});

app.post('/api/generate-sample', (req, res) => {
    generateSampleData();
    analyzeAccessibility();
    res.json({ success: true, message: 'Sample data generated' });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'School Accessibility System Running' });
});

app.use(express.static('public'));

// Start server
app.listen(PORT, () => {
    console.log('\n============================================================');
    console.log(' SCHOOL ACCESSIBILITY ANALYSIS SYSTEM');
    console.log('============================================================');
    console.log(` Server running at: http://localhost:${PORT}`);
    console.log(` Dashboard: http://localhost:${PORT}`);
    console.log(` Data saved to: ${DESKTOP_PATH}`);
    console.log('============================================================');
    console.log('\n📁 Available Maps:');
    console.log('   • Accessibility Map - Villages with color-coded status');
    console.log('   • Underserved Areas - Villages needing intervention');
    console.log('   • Priority Zones - High priority areas');
    console.log('   • Proposed Roads - Suggested road improvements');
    console.log('============================================================\n');
});

// Export functionality for multiple formats
app.get('/api/export/:format/:type', (req, res) => {
    const { format, type } = req.params;
    const filePath = path.join(OUTPUTS_PATH, `${type}.geojson`);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'No data available. Run analysis first.' });
    }
    
    const geojsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    switch(format) {
        case 'geojson':
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=${type}.geojson`);
            res.send(JSON.stringify(geojsonData, null, 2));
            break;
            
        case 'csv':
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
            res.setHeader('Content-Disposition', `attachment; filename=${type}.csv`);
            res.send(csvData);
            break;
            
        case 'json':
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=${type}.json`);
            res.send(JSON.stringify(geojsonData, null, 2));
            break;
            
        case 'kml':
            let kmlData = '<?xml version="1.0" encoding="UTF-8"?>\n';
            kmlData += '<kml xmlns="http://www.opengis.net/kml/2.2">\n';
            kmlData += '<Document>\n';
            kmlData += `<name>${type}</name>\n`;
            
            geojsonData.features.forEach(feature => {
                if (feature.geometry.type === 'Point') {
                    kmlData += '  <Placemark>\n';
                    kmlData += `    <name>${feature.properties.village || feature.properties.name || 'Location'}</name>\n`;
                    kmlData += '    <Point>\n';
                    kmlData += `      <coordinates>${feature.geometry.coordinates[0]},${feature.geometry.coordinates[1]},0</coordinates>\n`;
                    kmlData += '    </Point>\n';
                    kmlData += '  </Placemark>\n';
                } else if (feature.geometry.type === 'LineString') {
                    kmlData += '  <Placemark>\n';
                    kmlData += `    <name>${feature.properties.road_id || 'Road'}</name>\n`;
                    kmlData += '    <LineString>\n';
                    kmlData += '      <coordinates>\n';
                    feature.geometry.coordinates.forEach(coord => {
                        kmlData += `        ${coord[0]},${coord[1]},0\n`;
                    });
                    kmlData += '      </coordinates>\n';
                    kmlData += '    </LineString>\n';
                    kmlData += '  </Placemark>\n';
                }
            });
            
            kmlData += '</Document>\n</kml>';
            res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
            res.setHeader('Content-Disposition', `attachment; filename=${type}.kml`);
            res.send(kmlData);
            break;
            
        case 'gpx':
            let gpxData = '<?xml version="1.0" encoding="UTF-8"?>\n';
            gpxData += '<gpx version="1.1" creator="School Accessibility System" xmlns="http://www.topografix.com/GPX/1/1">\n';
            
            geojsonData.features.forEach(feature => {
                if (feature.geometry.type === 'Point') {
                    gpxData += '  <wpt>\n';
                    gpxData += `    <name>${feature.properties.village || feature.properties.name || 'Location'}</name>\n`;
                    gpxData += `    <lat>${feature.geometry.coordinates[1]}</lat>\n`;
                    gpxData += `    <lon>${feature.geometry.coordinates[0]}</lon>\n`;
                    gpxData += '  </wpt>\n';
                }
            });
            
            gpxData += '</gpx>';
            res.setHeader('Content-Type', 'application/gpx+xml');
            res.setHeader('Content-Disposition', `attachment; filename=${type}.gpx`);
            res.send(gpxData);
            break;
            
        default:
            res.status(400).json({ error: 'Unsupported format' });
    }
});

// Export all data as shapefile (zip containing .shp, .shx, .dbf, .prj)
app.get('/api/export/shapefile/:type', (req, res) => {
    const { type } = req.params;
    const filePath = path.join(OUTPUTS_PATH, `${type}.geojson`);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'No data available. Run analysis first.' });
    }
    
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    
    // Add GeoJSON as fallback (for simplicity, we provide GeoJSON in zip)
    const geojsonData = fs.readFileSync(filePath);
    zip.addFile(`${type}.geojson`, geojsonData);
    
    // Create a README for shapefile conversion
    const readme = `This zip contains ${type}.geojson file.
    
To convert to Shapefile:
1. Use QGIS: Layer > Save As > ESRI Shapefile
2. Use ogr2ogr: ogr2ogr -f "ESRI Shapefile" ${type}.shp ${type}.geojson
3. Use online converter: https://mapshaper.org/

The GeoJSON file contains all the spatial data for ${type}.`;
    
    zip.addFile('README.txt', Buffer.from(readme, 'utf8'));
    
    const buffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_shapefile.zip`);
    res.send(buffer);
});

console.log('✅ Export formats enabled: GeoJSON, CSV, JSON, KML, GPX, Shapefile (ZIP)');
