const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const os = require('os');

const app = express();
const PORT = 1111;

// Set Desktop path for file saving
const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const UPLOADS_PATH = path.join(DESKTOP_PATH, 'uploads');
const OUTPUTS_PATH = path.join(DESKTOP_PATH, 'outputs');
const GIS_PATH = path.join(DESKTOP_PATH, 'gis_files');

// Create Desktop folders if they don't exist
if (!fs.existsSync(DESKTOP_PATH)) fs.mkdirSync(DESKTOP_PATH, { recursive: true });
if (!fs.existsSync(UPLOADS_PATH)) fs.mkdirSync(UPLOADS_PATH, { recursive: true });
if (!fs.existsSync(OUTPUTS_PATH)) fs.mkdirSync(OUTPUTS_PATH, { recursive: true });
if (!fs.existsSync(GIS_PATH)) fs.mkdirSync(GIS_PATH, { recursive: true });

console.log(`\n📁 Files will be saved to: ${DESKTOP_PATH}`);

// Configure multer to save files to Desktop
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
        const fileExt = path.extname(file.originalname).toLowerCase();
        const gisExtensions = ['.cpg', '.dbf', '.prj', '.sbn', '.sbx', '.shp', '.shx'];
        
        if (gisExtensions.includes(fileExt)) {
            cb(null, file.originalname);
        } else {
            const timestamp = Date.now();
            cb(null, `${timestamp}_${file.originalname}`);
        }
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

function findNearestSchoolFromLocation(lat, lon) {
    let nearestSchool = null;
    let minDistance = Infinity;
    let shortestPath = Infinity;
    
    database.schools.forEach(school => {
        const networkDistance = findShortestPath({lat: lat, lon: lon}, school);
        if (networkDistance < minDistance) {
            minDistance = networkDistance;
            shortestPath = networkDistance;
            nearestSchool = school;
        }
    });
    
    return {
        school: nearestSchool,
        distance_km: shortestPath.toFixed(2),
        travel_time_min: (shortestPath / 30 * 60).toFixed(0)
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

function analyzeAccessibility() {
    console.log('\n[Analysis] Running accessibility analysis...');
    database.accessibilityResults = [];
    
    database.villages.forEach(village => {
        let nearestSchool = null;
        let minDistance = Infinity;
        let shortestPath = Infinity;
        
        database.schools.forEach(school => {
            const networkDistance = findShortestPath(village, school);
            if (networkDistance < minDistance) {
                minDistance = networkDistance;
                shortestPath = networkDistance;
                nearestSchool = school;
            }
        });
        
        const travelTime = shortestPath / 30 * 60;
        const connectivityScore = calculateConnectivityScore(village);
        const roadDensity = calculateRoadDensity(village);
        
        const accessibilityScore = (
            (shortestPath / 10) * 4 +
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
            (Math.max(0, shortestPath - 5) / 20) * 0.5 +
            (Math.max(0, travelTime - 30) / 60) * 0.3 +
            (village.population / 2000) * 0.2
        ));
        
        database.accessibilityResults.push({
            village_id: village.id,
            village_name: village.name,
            nearest_school_id: nearestSchool ? nearestSchool.id : 'N/A',
            nearest_school_name: nearestSchool ? nearestSchool.name : 'N/A',
            distance_km: shortestPath.toFixed(2),
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
                cost_estimate: Math.round(distance * 50000),
                priority_score: village.priority_score
            });
        }
    });
}

function saveResultsToDesktop() {
    // Save accessibility results as CSV
    const resultsCSV = ['Village,Nearest School,Distance (km),Travel Time (min),Connectivity Score,Road Density,Accessibility Category,Priority Score,Population'];
    database.accessibilityResults.forEach(r => {
        resultsCSV.push(`"${r.village_name}","${r.nearest_school_name}",${r.distance_km},${r.travel_time_min},${r.road_connectivity_score},${r.road_density},"${r.accessibility_category}",${r.priority_score},${r.population}`);
    });
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'accessibility_results.csv'), resultsCSV.join('\n'));
    
    // Save proposed roads as CSV
    const roadsCSV = ['Road ID,From Village,To School,Length (km),Priority Level,Cost Estimate (USD)'];
    database.proposedRoads.forEach(r => {
        roadsCSV.push(`${r.road_id},"${r.from_village}","${r.to_school}",${r.length_km},${r.priority_level},${r.cost_estimate}`);
    });
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'proposed_roads.csv'), roadsCSV.join('\n'));
    
    // Save summary statistics
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
            `Average Road Density,${stats.avg_road_density}`
        ];
        fs.writeFileSync(path.join(OUTPUTS_PATH, 'summary_statistics.csv'), summaryCSV.join('\n'));
    }
    
    console.log(`📁 Results saved to Desktop: ${OUTPUTS_PATH}`);
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
    const avgDensity = results.reduce((sum, r) => sum + parseFloat(r.road_density), 0) / total;
    
    return {
        total_villages: total,
        underserved_count: underserved,
        underserved_percentage: ((underserved / total) * 100).toFixed(1),
        highly_accessible: good,
        moderately_accessible: moderate,
        avg_distance_km: avgDistance.toFixed(2),
        avg_travel_time_min: avgTravelTime.toFixed(0),
        avg_connectivity_score: avgConnectivity.toFixed(2),
        avg_road_density: avgDensity.toFixed(2)
    };
}

function generateGeoJSON() {
    const accessibilityFeatures = database.accessibilityResults.map(r => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [parseFloat(r.lon), parseFloat(r.lat)] },
        properties: { village: r.village_name, category: r.accessibility_category, distance_km: r.distance_km, travel_time_min: r.travel_time_min, priority_score: r.priority_score, population: r.population }
    }));
    
    const underservedFeatures = database.accessibilityResults.filter(r => r.is_underserved === 1).map(r => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [parseFloat(r.lon), parseFloat(r.lat)] },
        properties: { village: r.village_name, distance_km: r.distance_km, priority_score: r.priority_score, population: r.population }
    }));
    
    const priorityFeatures = database.proposedRoads.map(r => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[parseFloat(r.from_lon), parseFloat(r.from_lat)], [parseFloat(r.to_lon), parseFloat(r.to_lat)]] },
        properties: { road_id: r.road_id, from_village: r.from_village, to_school: r.to_school, length_km: r.length_km, priority_level: r.priority_level, cost_estimate: r.cost_estimate }
    }));
    
    const proposedFeatures = database.proposedRoads.map(r => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[parseFloat(r.from_lon), parseFloat(r.from_lat)], [parseFloat(r.to_lon), parseFloat(r.to_lat)]] },
        properties: { road_id: r.road_id, from: r.from_village, to: r.to_school, length_km: r.length_km }
    }));
    
    return {
        accessibility: { type: "FeatureCollection", features: accessibilityFeatures },
        underserved: { type: "FeatureCollection", features: underservedFeatures },
        priority_zones: { type: "FeatureCollection", features: priorityFeatures },
        proposed_roads: { type: "FeatureCollection", features: proposedFeatures }
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
    
    const fileExt = path.extname(file.originalname).toLowerCase();
    const gisExtensions = ['.cpg', '.dbf', '.prj', '.sbn', '.sbx', '.shp', '.shx'];
    const isGISFile = gisExtensions.includes(fileExt);
    
    const fileInfo = {
        id: Date.now() + '-' + Math.random(),
        type: type,
        filename: file.originalname,
        originalName: file.originalname,
        size: file.size,
        size_mb: (file.size / (1024 * 1024)).toFixed(2),
        mimetype: file.mimetype,
        extension: fileExt,
        path: file.path,
        saved_to_desktop: file.path,
        isGISFile: isGISFile,
        uploadDate: new Date().toISOString(),
        status: 'uploaded'
    };
    
    database.uploadedFiles.push(fileInfo);
    
    if (isGISFile) {
        database.gisFiles.push(fileInfo);
        console.log(`[GIS] Saved to Desktop: ${file.originalname} → ${GIS_PATH}`);
    } else {
        console.log(`[File] Saved to Desktop: ${file.originalname} → ${UPLOADS_PATH}`);
    }
    
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
        try {
            parseCSVFile(file.path, type);
            res.json({ 
                success: true, 
                message: `${type} CSV data loaded successfully and saved to Desktop`, 
                count: database[type].length, 
                file: fileInfo,
                saved_to: file.path,
                isGIS: false
            });
        } catch (error) {
            res.json({ 
                success: true, 
                message: `File saved to Desktop: ${file.originalname}`, 
                file: fileInfo,
                saved_to: file.path,
                isGIS: false
            });
        }
    } else if (isGISFile) {
        res.json({ 
            success: true, 
            message: `GIS file saved to Desktop: ${file.originalname}`, 
            file: fileInfo,
            saved_to: file.path,
            isGIS: true,
            gisType: fileExt,
            note: `GIS shapefile component stored in: ${GIS_PATH}`
        });
    } else {
        res.json({ 
            success: true, 
            message: `File saved to Desktop: ${file.originalname}`, 
            file: fileInfo,
            saved_to: file.path,
            isGIS: false
        });
    }
});

app.post('/api/analyze', (req, res) => {
    try {
        if (database.schools.length === 0) return res.json({ error: 'No school data available. Please upload schools data first.' });
        if (database.villages.length === 0) return res.json({ error: 'No village data available. Please upload villages data first.' });
        
        analyzeAccessibility();
        const stats = getStatistics();
        const geojson = generateGeoJSON();
        
        // Save GeoJSON files to Desktop
        fs.writeFileSync(path.join(OUTPUTS_PATH, 'accessibility_map.geojson'), JSON.stringify(geojson.accessibility, null, 2));
        fs.writeFileSync(path.join(OUTPUTS_PATH, 'underserved_areas.geojson'), JSON.stringify(geojson.underserved, null, 2));
        fs.writeFileSync(path.join(OUTPUTS_PATH, 'priority_zones.geojson'), JSON.stringify(geojson.priority_zones, null, 2));
        fs.writeFileSync(path.join(OUTPUTS_PATH, 'proposed_roads.geojson'), JSON.stringify(geojson.proposed_roads, null, 2));
        
        res.json({
            success: true,
            message: `Analysis completed. Results saved to: ${OUTPUTS_PATH}`,
            statistics: stats,
            villages_analyzed: database.accessibilityResults.length,
            underserved_found: database.accessibilityResults.filter(r => r.is_underserved === 1).length,
            proposed_roads: database.proposedRoads.length,
            saved_to_desktop: OUTPUTS_PATH
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/location/nearest-school', (req, res) => {
    const { lat, lon } = req.body;
    if (!lat || !lon) {
        return res.status(400).json({ error: 'Latitude and longitude required' });
    }
    
    const result = findNearestSchoolFromLocation(parseFloat(lat), parseFloat(lon));
    if (result.school) {
        res.json({
            success: true,
            location: { lat: parseFloat(lat), lon: parseFloat(lon) },
            nearest_school: result.school,
            distance_km: result.distance_km,
            travel_time_min: result.travel_time_min
        });
    } else {
        res.json({ success: false, error: 'No schools found' });
    }
});

app.post('/api/location/calculate-route', (req, res) => {
    const { lat, lon, school_id } = req.body;
    if (!lat || !lon || !school_id) {
        return res.status(400).json({ error: 'Latitude, longitude, and school_id required' });
    }
    
    const route = calculateRoute(parseFloat(lat), parseFloat(lon), school_id);
    if (route) {
        res.json({
            success: true,
            route: route
        });
    } else {
        res.json({ success: false, error: 'Could not calculate route' });
    }
});

app.get('/api/location/schools-list', (req, res) => {
    res.json({
        success: true,
        schools: database.schools.map(s => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon }))
    });
});

app.get('/api/results', (req, res) => {
    res.json({
        accessibility: database.accessibilityResults,
        proposed_roads: database.proposedRoads,
        statistics: getStatistics()
    });
});

app.get('/api/geojson/:name', (req, res) => {
    const filePath = path.join(OUTPUTS_PATH, `${req.params.name}.geojson`);
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
        total_uploads: database.uploadedFiles.length,
        gis_files: database.gisFiles.length,
        desktop_save_path: DESKTOP_PATH,
        uploaded_files: database.uploadedFiles.slice(-20),
        gis_files_list: database.gisFiles
    });
});

app.get('/api/uploads/list', (req, res) => {
    res.json({
        total_files: database.uploadedFiles.length,
        gis_files_count: database.gisFiles.length,
        desktop_save_path: DESKTOP_PATH,
        all_files: database.uploadedFiles,
        gis_files: database.gisFiles,
        by_extension: {
            cpg: database.gisFiles.filter(f => f.extension === '.cpg').length,
            dbf: database.gisFiles.filter(f => f.extension === '.dbf').length,
            prj: database.gisFiles.filter(f => f.extension === '.prj').length,
            sbn: database.gisFiles.filter(f => f.extension === '.sbn').length,
            sbx: database.gisFiles.filter(f => f.extension === '.sbx').length,
            shp: database.gisFiles.filter(f => f.extension === '.shp').length,
            shx: database.gisFiles.filter(f => f.extension === '.shx').length
        }
    });
});

app.post('/api/generate-sample', (req, res) => {
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
    
    res.json({ success: true, schools: database.schools.length, villages: database.villages.length, roads: database.roads.length });
});

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log(' SCHOOL ACCESSIBILITY ANALYSIS SYSTEM');
    console.log('='.repeat(60));
    console.log(` Server running at: http://localhost:${PORT}`);
    console.log(` Dashboard: http://localhost:${PORT}`);
    console.log('='.repeat(60));
    console.log('\n📁 FILE SAVING LOCATION:');
    console.log(`   All files are saved to your Desktop:`);
    console.log(`   ${DESKTOP_PATH}`);
    console.log('\n   Subfolders:');
    console.log(`   ├── uploads/     - Regular uploaded files`);
    console.log(`   ├── gis_files/   - GIS shapefile components (.shp, .dbf, .prj, etc.)`);
    console.log(`   └── outputs/     - Analysis results (CSV, GeoJSON)`);
    console.log('='.repeat(60));
    console.log('\n FEATURES:');
    console.log(' 1. Upload ANY file format (CSV, GIS, Images, etc.)');
    console.log(' 2. GIS shapefile support (.cpg, .dbf, .prj, .sbn, .sbx, .shp, .shx)');
    console.log(' 3. Location-based routing with GPS');
    console.log(' 4. Calculate network distances & travel times');
    console.log(' 5. Classify accessibility (Green/Yellow/Red)');
    console.log(' 6. Identify underserved areas');
    console.log(' 7. Generate proposed road improvements');
    console.log(' 8. Export GeoJSON maps and CSV results');
    console.log(' 9. ALL FILES SAVED TO DESKTOP');
    console.log('='.repeat(60) + '\n');
});
