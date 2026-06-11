const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

// Ensure directory exists
const fs = require('fs');
if (!fs.existsSync(DESKTOP_PATH)) fs.mkdirSync(DESKTOP_PATH, { recursive: true });

// Delete existing database
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const db = new sqlite3.Database(DB_PATH);

// Create tables with sample data
db.serialize(() => {
    // Create schools table
    db.run(`CREATE TABLE schools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        school_type TEXT,
        capacity INTEGER,
        lon REAL,
        lat REAL
    )`);
    
    // Insert sample schools (Musanze district)
    const schools = [
        ['G.S. Musanze', 'primary', 1200, 29.635, -1.495],
        ['Ecole Secondaire Cyuve', 'secondary', 800, 29.620, -1.480],
        ['College Shingiro', 'secondary', 600, 29.650, -1.510],
        ['G.S. Kinigi', 'primary', 400, 29.610, -1.470],
        ['Lycee Nyange', 'secondary', 900, 29.660, -1.520],
        ['Ecole Primaire Remera', 'primary', 500, 29.600, -1.460],
        ['G.S. Busogo', 'primary', 350, 29.670, -1.530],
        ['College Gataraga', 'secondary', 450, 29.590, -1.445]
    ];
    
    const insertSchool = db.prepare(`INSERT INTO schools (name, school_type, capacity, lon, lat) VALUES (?, ?, ?, ?, ?)`);
    schools.forEach(s => insertSchool.run(s[0], s[1], s[2], s[3], s[4]));
    console.log(`✅ Inserted ${schools.length} schools`);
    
    // Create roads table
    db.run(`CREATE TABLE roads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        road_type TEXT,
        road_name TEXT,
        surface TEXT,
        length_m REAL,
        lon REAL,
        lat REAL
    )`);
    
    // Insert sample roads
    const roads = [
        ['primary', 'Kigali-Musanze', 'paved', 12500, 29.635, -1.495],
        ['primary', 'Musanze-Cyuve', 'paved', 15300, 29.620, -1.480],
        ['secondary', 'Cyuve-Kinigi', 'unpaved', 8200, 29.610, -1.470],
        ['secondary', 'Shingiro-Nyange', 'unpaved', 6500, 29.660, -1.520]
    ];
    
    const insertRoad = db.prepare(`INSERT INTO roads (road_type, road_name, surface, length_m, lon, lat) VALUES (?, ?, ?, ?, ?, ?)`);
    roads.forEach(r => insertRoad.run(r[0], r[1], r[2], r[3], r[4], r[5]));
    console.log(`✅ Inserted ${roads.length} roads`);
    
    // Create sectors table
    db.run(`CREATE TABLE sectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        area_sqkm REAL,
        lon REAL,
        lat REAL
    )`);
    
    // Insert sample sectors
    const sectors = [
        ['Musanze Sector', 45.2, 29.635, -1.495],
        ['Cyuve Sector', 38.5, 29.620, -1.480],
        ['Shingiro Sector', 42.1, 29.650, -1.510],
        ['Kinigi Sector', 35.8, 29.610, -1.470],
        ['Nyange Sector', 28.3, 29.660, -1.520],
        ['Remera Sector', 32.6, 29.600, -1.460],
        ['Busogo Sector', 25.4, 29.670, -1.530],
        ['Gataraga Sector', 30.2, 29.590, -1.445]
    ];
    
    const insertSector = db.prepare(`INSERT INTO sectors (name, area_sqkm, lon, lat) VALUES (?, ?, ?, ?)`);
    sectors.forEach(s => insertSector.run(s[0], s[1], s[2], s[3]));
    console.log(`✅ Inserted ${sectors.length} sectors`);
    
    // Create districts table
    db.run(`CREATE TABLE districts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        area_sqkm REAL,
        lon REAL,
        lat REAL
    )`);
    
    // Insert sample districts
    const districts = [
        ['Musanze District', 530.0, 29.635, -1.495],
        ['Burera District', 510.0, 29.750, -1.500]
    ];
    
    const insertDistrict = db.prepare(`INSERT INTO districts (name, area_sqkm, lon, lat) VALUES (?, ?, ?, ?)`);
    districts.forEach(d => insertDistrict.run(d[0], d[1], d[2], d[3]));
    console.log(`✅ Inserted ${districts.length} districts`);
    
    // Create accessibility_results table
    db.run(`CREATE TABLE accessibility_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sector_id INTEGER,
        sector_name TEXT,
        distance_km REAL,
        travel_time_minutes REAL,
        accessibility_class TEXT,
        accessibility_score REAL,
        analysis_date TEXT
    )`);
    
    console.log(`\n✅ Database initialized with sample data`);
    console.log(`   Location: ${DB_PATH}`);
    
    // Show counts
    db.each("SELECT 'schools' as table, COUNT(*) as cnt FROM schools UNION SELECT 'roads', COUNT(*) FROM roads UNION SELECT 'sectors', COUNT(*) FROM sectors", (err, row) => {
        if (!err) console.log(`   ${row.table}: ${row.cnt} records`);
    });
});

db.close();
