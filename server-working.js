const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { parse } = require('csv-parse/sync');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 1111;

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const OUTPUTS_PATH = path.join(DESKTOP_PATH, 'outputs');
const DATA_PATH = path.join(os.homedir(), 'Desktop', 'DATA');
const DB_PATH = path.join(DESKTOP_PATH, 'gis_database.db');

[DESKTOP_PATH, OUTPUTS_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log(`\n========================================`);
console.log(` School Accessibility System`);
console.log(` Using: SQLite (Fast & Reliable)`);
console.log(` Data: ${DATA_PATH}`);
console.log(`========================================\n`);

app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database(DB_PATH);

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS schools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_id TEXT, name TEXT, lat REAL, lon REAL, capacity INTEGER, sector TEXT, district TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS sectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sector_id TEXT, name TEXT, lat REAL, lon REAL, population INTEGER, district TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS roads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        road_id TEXT, type TEXT, start_lat REAL, start_lon REAL, end_lat REAL, end_lon REAL, length_km REAL)`);
    
    console.log('✅ Database ready');
});

// Load data function
async function loadMusanzeData() {
    return new Promise((resolve) => {
        // Sample Musanze data
        const schools = [
            ['SCH_001', 'G.S. Musanze', -1.4950, 29.6350, 1200, 'Musanze', 'Musanze'],
            ['SCH_002', 'Ecole Secondaire Cyuve', -1.4800, 29.6200, 800, 'Cyuve', 'Musanze'],
            ['SCH_003', 'College Shingiro', -1.5100, 29.6500, 600, 'Shingiro', 'Musanze'],
            ['SCH_004', 'G.S. Kinigi', -1.4700, 29.6100, 400, 'Kinigi', 'Musanze'],
            ['SCH_005', 'Lycee Nyange', -1.5200, 29.6600, 900, 'Nyange', 'Musanze']
        ];
        
        const sectors = [
            ['SEC_001', 'Musanze Sector', -1.4950, 29.6350, 45000, 'Musanze'],
            ['SEC_002', 'Cyuve Sector', -1.4800, 29.6200, 12000, 'Musanze'],
            ['SEC_003', 'Shingiro Sector', -1.5100, 29.6500, 8000, 'Musanze'],
            ['SEC_004', 'Kinigi Sector', -1.4700, 29.6100, 15000, 'Musanze'],
            ['SEC_005', 'Nyange Sector', -1.5200, 29.6600, 6000, 'Musanze']
        ];
        
        const roads = [
            ['RD_001', 'primary', -1.4950, 29.6350, -1.4800, 29.6200, 12.5],
            ['RD_002', 'primary', -1.4950, 29.6350, -1.5100, 29.6500, 15.3],
            ['RD_003', 'secondary', -1.4800, 29.6200, -1.4700, 29.6100, 8.2]
        ];
        
        db.run('DELETE FROM schools');
        db.run('DELETE FROM sectors');
        db.run('DELETE FROM roads');
        
        const insertSchool = db.prepare(`INSERT INTO schools (school_id, name, lat, lon, capacity, sector, district) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        schools.forEach(s => insertSchool.run(s[0], s[1], s[2], s[3], s[4], s[5], s[6]));
        
        const insertSector = db.prepare(`INSERT INTO sectors (sector_id, name, lat, lon, population, district) VALUES (?, ?, ?, ?, ?, ?)`);
        sectors.forEach(s => insertSector.run(s[0], s[1], s[2], s[3], s[4], s[5]));
        
        const insertRoad = db.prepare(`INSERT INTO roads (road_id, type, start_lat, start_lon, end_lat, end_lon, length_km) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        roads.forEach(r => insertRoad.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6]));
        
        console.log(`✅ Loaded ${schools.length} schools, ${sectors.length} sectors, ${roads.length} roads`);
        resolve();
    });
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

// API Endpoints
app.get('/api/data-status', (req, res) => {
    db.get('SELECT COUNT(*) as c FROM schools', (err, schools) => {
        db.get('SELECT COUNT(*) as c FROM sectors', (err, sectors) => {
            db.get('SELECT COUNT(*) as c FROM roads', (err, roads) => {
                res.json({ 
                    schools: schools?.c || 0, 
                    sectors: sectors?.c || 0, 
                    roads: roads?.c || 0,
                    message: "SQLite database - Ready to use"
                });
            });
        });
    });
});

app.get('/api/results', (req, res) => {
    db.all('SELECT * FROM sectors', (err, sectors) => {
        db.all('SELECT * FROM schools', (err, schools) => {
            const results = sectors.map(sector => {
                let nearest = null;
                let minDist = Infinity;
                schools.forEach(school => {
                    const dist = calculateDistance(sector.lat, sector.lon, school.lat, school.lon);
                    if (dist < minDist) {
                        minDist = dist;
                        nearest = school;
                    }
                });
                return {
                    sector_name: sector.name,
                    nearest_school: nearest?.name || 'N/A',
                    distance_km: minDist.toFixed(2),
                    travel_time_min: (minDist / 30 * 60).toFixed(0),
                    category: minDist <= 2 ? "Highly Accessible" : (minDist <= 5 ? "Moderately Accessible" : "Poorly Accessible"),
                    population: sector.population
                };
            });
            
            const stats = {
                total_sectors: results.length,
                underserved_count: results.filter(r => r.category === 'Poorly Accessible').length,
                highly_accessible: results.filter(r => r.category === 'Highly Accessible').length,
                moderately_accessible: results.filter(r => r.category === 'Moderately Accessible').length,
                avg_distance_km: (results.reduce((s, r) => s + parseFloat(r.distance_km), 0) / results.length).toFixed(2),
                avg_travel_time_min: (results.reduce((s, r) => s + parseFloat(r.travel_time_min), 0) / results.length).toFixed(0)
            };
            res.json({ accessibility: results, statistics: stats });
        });
    });
});

app.use(express.static('public'));

// Start server
loadMusanzeData().then(() => {
    app.listen(PORT, () => {
        console.log(`\n========================================`);
        console.log(`✅ Server running at http://localhost:${PORT}`);
        console.log(`📊 Data loaded successfully`);
        console.log(`========================================\n`);
    });
});
