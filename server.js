const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { parse } = require('csv-parse/sync');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 1111;

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const OUTPUTS_PATH = path.join(DESKTOP_PATH, 'outputs');
const DATA_PATH = path.join(os.homedir(), 'Desktop', 'DATA');

[DESKTOP_PATH, OUTPUTS_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log(`\n📁 Files saved to: ${DESKTOP_PATH}`);
console.log(`📂 Data source: ${DATA_PATH}`);

app.use(express.json());
app.use(express.static('public'));
app.use('/outputs', express.static(OUTPUTS_PATH));

const database = {
    schools: [],
    villages: [],
    roads: [],
    accessibilityResults: [],
    proposedRoads: []
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

// OSRM Routing function
async function getOSRMRoute(startLat, startLon, endLat, endLon) {
    try {
        // Using OSRM demo server (for production, you'd set up your own OSRM server with Rwanda data)
        const url = `http://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=polyline`;
        
        const response = await axios.get(url);
        
        if (response.data && response.data.routes && response.data.routes.length > 0) {
            const route = response.data.routes[0];
            const distance = route.distance / 1000; // Convert to km
            const duration = route.duration / 60; // Convert to minutes
            const geometry = route.geometry;
            
            // Decode polyline to get coordinates
            const decodedPoints = decodePolyline(geometry);
            
            return {
                success: true,
                distance_km: distance,
                travel_time_min: duration,
                route_points: decodedPoints,
                geometry: geometry
            };
        } else {
            return {
                success: false,
                message: "No route found"
            };
        }
    } catch (error) {
        console.log("OSRM error, using direct line:", error.message);
        return {
            success: false,
            distance_km: calculateDistance(startLat, startLon, endLat, endLon),
            travel_time_min: calculateDistance(startLat, startLon, endLat, endLon) / 30 * 60,
            route_points: [[endLon, endLat], [startLon, startLat]],
            message: "Using direct line (OSRM unavailable)"
        };
    }
}

// Decode polyline (simplified version)
function decodePolyline(encoded) {
    if (!encoded) return [];
    
    let points = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;
    
    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        
        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        
        points.push([lng / 1e5, lat / 1e5]);
    }
    
    return points;
}

// Build road network graph for local routing
function buildRoadGraph() {
    const graph = {};
    database.roads.forEach(road => {
        const startKey = `${road.start_lat},${road.start_lon}`;
        const endKey = `${road.end_lat},${road.end_lon}`;
        
        if (!graph[startKey]) graph[startKey] = [];
        if (!graph[endKey]) graph[endKey] = [];
        
        const distance = calculateDistance(road.start_lat, road.start_lon, road.end_lat, road.end_lon);
        
        graph[startKey].push({ node: endKey, distance: distance, roadId: road.id });
        graph[endKey].push({ node: startKey, distance: distance, roadId: road.id });
    });
    
    return graph;
}

// Local Dijkstra routing
function findLocalRoute(startLat, startLon, endLat, endLon, roadGraph) {
    if (Object.keys(roadGraph).length === 0) {
        return {
            distance_km: calculateDistance(startLat, startLon, endLat, endLon),
            travel_time_min: calculateDistance(startLat, startLon, endLat, endLon) / 30 * 60,
            route_points: [[endLon, endLat], [startLon, startLat]]
        };
    }
    
    // Find nearest nodes
    let startNode = null;
    let startNodeDist = Infinity;
    let endNode = null;
    let endNodeDist = Infinity;
    
    for (let node of Object.keys(roadGraph)) {
        const [nodeLat, nodeLon] = node.split(',').map(Number);
        const distToStart = calculateDistance(startLat, startLon, nodeLat, nodeLon);
        const distToEnd = calculateDistance(endLat, endLon, nodeLat, nodeLon);
        
        if (distToStart < startNodeDist) {
            startNodeDist = distToStart;
            startNode = node;
        }
        if (distToEnd < endNodeDist) {
            endNodeDist = distToEnd;
            endNode = node;
        }
    }
    
    if (!startNode || !endNode) {
        return {
            distance_km: calculateDistance(startLat, startLon, endLat, endLon),
            travel_time_min: calculateDistance(startLat, startLon, endLat, endLon) / 30 * 60,
            route_points: [[endLon, endLat], [startLon, startLat]]
        };
    }
    
    // Dijkstra
    const distances = {};
    const previous = {};
    const nodes = new Set(Object.keys(roadGraph));
    
    for (let node of nodes) distances[node] = Infinity;
    distances[startNode] = 0;
    
    while (nodes.size > 0) {
        let current = null;
        let minDist = Infinity;
        for (let node of nodes) {
            if (distances[node] < minDist) {
                minDist = distances[node];
                current = node;
            }
        }
        
        if (current === null || current === endNode) break;
        nodes.delete(current);
        
        for (let neighbor of roadGraph[current]) {
            const alt = distances[current] + neighbor.distance;
            if (alt < distances[neighbor.node]) {
                distances[neighbor.node] = alt;
                previous[neighbor.node] = current;
            }
        }
    }
    
    // Reconstruct path
    const path = [];
    let current = endNode;
    while (current && previous[current]) {
        const [lat, lon] = current.split(',').map(Number);
        path.unshift([lon, lat]);
        current = previous[current];
    }
    if (startNode) {
        const [lat, lon] = startNode.split(',').map(Number);
        path.unshift([lon, lat]);
    }
    
    const totalDistance = (distances[endNode] !== Infinity ? distances[endNode] : 0) + startNodeDist + endNodeDist;
    
    return {
        distance_km: totalDistance,
        travel_time_min: totalDistance / 30 * 60,
        route_points: path
    };
}

// Load data from Desktop/DATA folder
function loadDataFromDesktop() {
    console.log('\n📂 Loading data from Desktop/DATA folder...');
    
    if (!fs.existsSync(DATA_PATH)) {
        console.log('⚠️ DATA folder not found. Creating sample Musanze data...');
        fs.mkdirSync(DATA_PATH, { recursive: true });
        return createMusanzeSampleData();
    }
    
    const files = fs.readdirSync(DATA_PATH);
    
    for (const file of files) {
        const filePath = path.join(DATA_PATH, file);
        if (file.endsWith('.csv')) {
            const content = fs.readFileSync(filePath, 'utf8');
            const records = parse(content, { columns: true, skip_empty_lines: true });
            
            if (file.toLowerCase().includes('school')) {
                database.schools = records.map(r => ({
                    id: r.id || r.school_id || `SCH_${Math.random()}`,
                    name: r.name || r.school_name || 'School',
                    lat: parseFloat(r.lat || r.latitude || 0),
                    lon: parseFloat(r.lon || r.longitude || 0),
                    capacity: parseInt(r.capacity) || 200
                })).filter(s => s.lat !== 0 && s.lon !== 0);
                console.log(`✅ Loaded ${database.schools.length} schools from ${file}`);
            }
            else if (file.toLowerCase().includes('village')) {
                database.villages = records.map(r => ({
                    id: r.id || r.village_id || `VIL_${Math.random()}`,
                    name: r.name || r.village_name || 'Village',
                    lat: parseFloat(r.lat || r.latitude || 0),
                    lon: parseFloat(r.lon || r.longitude || 0),
                    population: parseInt(r.population) || 500
                })).filter(v => v.lat !== 0 && v.lon !== 0);
                console.log(`✅ Loaded ${database.villages.length} villages from ${file}`);
            }
            else if (file.toLowerCase().includes('road')) {
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
                })).filter(r => r.start_lat !== 0 && r.start_lon !== 0);
                console.log(`✅ Loaded ${database.roads.length} roads from ${file}`);
            }
        }
    }
    
    if (database.schools.length === 0 || database.villages.length === 0) {
        console.log('⚠️ Some data missing. Creating sample Musanze data...');
        createMusanzeSampleData();
    }
}

function createMusanzeSampleData() {
    database.schools = [
        { id: 'SCH_001', name: 'Ecole Secondaire Musanze', lat: -1.4950, lon: 29.6350, capacity: 1200 },
        { id: 'SCH_002', name: 'GS Musanze', lat: -1.4900, lon: 29.6300, capacity: 800 },
        { id: 'SCH_003', name: 'College de Musanze', lat: -1.5000, lon: 29.6400, capacity: 600 },
        { id: 'SCH_004', name: 'Ecole Primaire Musanze', lat: -1.4850, lon: 29.6250, capacity: 400 },
        { id: 'SCH_005', name: 'Lycee de Musanze', lat: -1.5050, lon: 29.6450, capacity: 900 }
    ];
    
    database.villages = [
        { id: 'VIL_001', name: 'Musanze Center', lat: -1.4950, lon: 29.6350, population: 45000 },
        { id: 'VIL_002', name: 'Cyuve', lat: -1.4800, lon: 29.6200, population: 12000 },
        { id: 'VIL_003', name: 'Shingiro', lat: -1.5100, lon: 29.6500, population: 8000 },
        { id: 'VIL_004', name: 'Kinigi', lat: -1.4700, lon: 29.6100, population: 15000 },
        { id: 'VIL_005', name: 'Nyange', lat: -1.5200, lon: 29.6600, population: 6000 },
        { id: 'VIL_006', name: 'Remera', lat: -1.4600, lon: 29.6000, population: 10000 },
        { id: 'VIL_007', name: 'Busogo', lat: -1.5300, lon: 29.6700, population: 5000 },
        { id: 'VIL_008', name: 'Gataraga', lat: -1.4450, lon: 29.5900, population: 7000 }
    ];
    
    database.roads = [
        { id: 'RD_001', type: 'primary', start_lat: -1.4950, start_lon: 29.6350, end_lat: -1.4800, end_lon: 29.6200, length_km: 12.5 },
        { id: 'RD_002', type: 'primary', start_lat: -1.4950, start_lon: 29.6350, end_lat: -1.5100, end_lon: 29.6500, length_km: 15.3 },
        { id: 'RD_003', type: 'secondary', start_lat: -1.4800, start_lon: 29.6200, end_lat: -1.4700, end_lon: 29.6100, length_km: 8.2 },
        { id: 'RD_004', type: 'secondary', start_lat: -1.5100, start_lon: 29.6500, end_lat: -1.5200, end_lon: 29.6600, length_km: 6.5 },
        { id: 'RD_005', type: 'tertiary', start_lat: -1.4700, start_lon: 29.6100, end_lat: -1.4600, end_lon: 29.6000, length_km: 5.8 }
    ];
    
    console.log(`✅ Created Musanze sample data: ${database.schools.length} schools, ${database.villages.length} villages, ${database.roads.length} roads`);
}

function analyzeAccessibility() {
    console.log('\n[Analysis] Running accessibility analysis...');
    database.accessibilityResults = [];
    const roadGraph = buildRoadGraph();
    
    database.villages.forEach(village => {
        let nearestSchool = null;
        let minDistance = Infinity;
        
        database.schools.forEach(school => {
            const route = findLocalRoute(village.lat, village.lon, school.lat, school.lon, roadGraph);
            if (route.distance_km < minDistance) {
                minDistance = route.distance_km;
                nearestSchool = school;
            }
        });
        
        const travelTime = minDistance / 30 * 60;
        
        let category, status;
        if (minDistance <= 2) {
            category = "Highly Accessible";
            status = "good";
        } else if (minDistance <= 5) {
            category = "Moderately Accessible";
            status = "moderate";
        } else {
            category = "Poorly Accessible / Underserved";
            status = "poor";
        }
        
        const priorityScore = Math.min(1, (minDistance / 20) * 0.6 + (village.population / 50000) * 0.4);
        
        database.accessibilityResults.push({
            village_id: village.id,
            village_name: village.name,
            nearest_school_id: nearestSchool ? nearestSchool.id : 'N/A',
            nearest_school_name: nearestSchool ? nearestSchool.name : 'N/A',
            distance_km: minDistance.toFixed(2),
            travel_time_min: travelTime.toFixed(0),
            accessibility_category: category,
            status: status,
            is_underserved: minDistance > 5 ? 1 : 0,
            priority_score: priorityScore.toFixed(2),
            population: village.population,
            lat: village.lat,
            lon: village.lon
        });
    });
    
    generateProposedRoads();
    saveResultsToDesktop();
    generateAllGeoJSON();
    
    console.log(`[Analysis] Complete: ${database.accessibilityResults.length} villages analyzed`);
}

function generateProposedRoads() {
    const underserved = database.accessibilityResults.filter(r => r.is_underserved === 1);
    underserved.sort((a, b) => parseFloat(b.priority_score) - parseFloat(a.priority_score));
    const highPriority = underserved.slice(0, Math.min(5, underserved.length));
    
    database.proposedRoads = [];
    highPriority.forEach((village, idx) => {
        const villageData = database.villages.find(v => v.id === village.village_id);
        const schoolData = database.schools.find(s => s.id === village.nearest_school_id);
        
        if (villageData && schoolData) {
            database.proposedRoads.push({
                road_id: `PROP_${idx + 1}`,
                from_village: village.village_name,
                from_lat: villageData.lat,
                from_lon: villageData.lon,
                to_school: schoolData.name,
                to_lat: schoolData.lat,
                to_lon: schoolData.lon,
                length_km: village.distance_km,
                priority_level: parseFloat(village.distance_km) > 10 ? 1 : 2,
                priority_score: village.priority_score
            });
        }
    });
}

function generateAllGeoJSON() {
    console.log('\n🗺️ Generating GeoJSON map files...');
    
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
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'accessibility_map.geojson'), JSON.stringify({ type: "FeatureCollection", features: accessibilityFeatures }, null, 2));
    
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
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'underserved_areas.geojson'), JSON.stringify({ type: "FeatureCollection", features: underservedFeatures }, null, 2));
    
    const priorityFeatures = database.accessibilityResults.filter(r => r.is_underserved === 1 && parseFloat(r.priority_score) > 0.5).map(r => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [parseFloat(r.lon), parseFloat(r.lat)] },
        properties: { 
            village: r.village_name, 
            priority_score: parseFloat(r.priority_score),
            distance_km: parseFloat(r.distance_km)
        }
    }));
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'priority_zones.geojson'), JSON.stringify({ type: "FeatureCollection", features: priorityFeatures }, null, 2));
    
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
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'proposed_roads.geojson'), JSON.stringify({ type: "FeatureCollection", features: proposedRoadsFeatures }, null, 2));
    
    console.log(`✅ All GeoJSON files saved to: ${OUTPUTS_PATH}`);
}

function saveResultsToDesktop() {
    const resultsCSV = ['Village,Nearest School,Distance (km),Travel Time (min),Accessibility Category,Priority Score,Population'];
    database.accessibilityResults.forEach(r => {
        resultsCSV.push(`"${r.village_name}","${r.nearest_school_name}",${r.distance_km},${r.travel_time_min},"${r.accessibility_category}",${r.priority_score},${r.population}`);
    });
    fs.writeFileSync(path.join(OUTPUTS_PATH, 'accessibility_results.csv'), resultsCSV.join('\n'));
    console.log(`📁 Results saved to: ${OUTPUTS_PATH}`);
}

function getStatistics() {
    const results = database.accessibilityResults;
    if (results.length === 0) return null;
    
    return {
        total_villages: results.length,
        underserved_count: results.filter(r => r.is_underserved === 1).length,
        underserved_percentage: ((results.filter(r => r.is_underserved === 1).length / results.length) * 100).toFixed(1),
        highly_accessible: results.filter(r => r.status === 'good').length,
        moderately_accessible: results.filter(r => r.status === 'moderate').length,
        avg_distance_km: (results.reduce((sum, r) => sum + parseFloat(r.distance_km), 0) / results.length).toFixed(2),
        avg_travel_time_min: (results.reduce((sum, r) => sum + parseFloat(r.travel_time_min), 0) / results.length).toFixed(0)
    };
}

// API Endpoints
app.post('/api/location/calculate-route', async (req, res) => {
    const { lat, lon, school_id } = req.body;
    const school = database.schools.find(s => s.id === school_id);
    if (!school) return res.json({ success: false, error: 'School not found' });
    
    // Try OSRM first for real road routing
    const osrmRoute = await getOSRMRoute(parseFloat(lat), parseFloat(lon), school.lat, school.lon);
    
    if (osrmRoute.success) {
        res.json({
            success: true,
            route: {
                start: { lat: parseFloat(lat), lon: parseFloat(lon) },
                end: { lat: school.lat, lon: school.lon },
                school: school,
                distance_km: osrmRoute.distance_km.toFixed(2),
                travel_time_min: osrmRoute.travel_time_min.toFixed(0),
                route_points: osrmRoute.route_points,
                source: "OSRM (Open Source Routing Machine)"
            }
        });
    } else {
        // Fallback to local road network
        const roadGraph = buildRoadGraph();
        const localRoute = findLocalRoute(parseFloat(lat), parseFloat(lon), school.lat, school.lon, roadGraph);
        res.json({
            success: true,
            route: {
                start: { lat: parseFloat(lat), lon: parseFloat(lon) },
                end: { lat: school.lat, lon: school.lon },
                school: school,
                distance_km: localRoute.distance_km.toFixed(2),
                travel_time_min: localRoute.travel_time_min.toFixed(0),
                route_points: localRoute.route_points,
                source: "Local Road Network"
            }
        });
    }
});

app.post('/api/location/nearest-school', (req, res) => {
    const { lat, lon } = req.body;
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

app.get('/api/geojson/:name', (req, res) => {
    const filePath = path.join(OUTPUTS_PATH, `${req.params.name}.geojson`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

app.get('/api/data-status', (req, res) => {
    res.json({
        schools: database.schools.length,
        villages: database.villages.length,
        roads: database.roads.length,
        results: database.accessibilityResults.length,
        data_source_path: DATA_PATH
    });
});

app.use(express.static('public'));

// Initialize
loadDataFromDesktop();
analyzeAccessibility();

app.listen(PORT, () => {
    console.log('\n============================================================');
    console.log(' SCHOOL ACCESSIBILITY ANALYSIS SYSTEM');
    console.log('============================================================');
    console.log(` Server: http://localhost:${PORT}`);
    console.log(` Dashboard: http://localhost:${PORT}`);
    console.log(` Data source: ${DATA_PATH}`);
    console.log('============================================================');
    console.log('\n🗺️ Routing Features:');
    console.log('   • OSRM (Open Source Routing Machine) for real road routing');
    console.log('   • Orange route lines following actual roads');
    console.log('   • Automatic map zoom to show full route');
    console.log('   • Accurate distance and travel time calculation');
    console.log('============================================================\n');
});
