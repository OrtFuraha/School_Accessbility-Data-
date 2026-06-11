const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

const db = new sqlite3.Database(DB_PATH);

// Realistic Musanze district coordinates
// Schools with their actual locations
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

// Sectors with their centroid coordinates (different from schools)
const sectors = [
    ['Musanze Sector', 45.2, 29.632, -1.493],
    ['Cyuve Sector', 38.5, 29.618, -1.478],
    ['Shingiro Sector', 42.1, 29.648, -1.508],
    ['Kinigi Sector', 35.8, 29.608, -1.468],
    ['Nyange Sector', 28.3, 29.658, -1.518],
    ['Remera Sector', 32.6, 29.598, -1.458],
    ['Busogo Sector', 25.4, 29.668, -1.528],
    ['Gataraga Sector', 30.2, 29.588, -1.443]
];

// Clear existing data
db.run('DELETE FROM schools');
db.run('DELETE FROM sectors');

// Insert schools
const insertSchool = db.prepare(`INSERT INTO schools (name, school_type, capacity, lon, lat) VALUES (?, ?, ?, ?, ?)`);
schools.forEach(s => insertSchool.run(s[0], s[1], s[2], s[3], s[4]));
console.log(`✅ Updated ${schools.length} schools`);

// Insert sectors
const insertSector = db.prepare(`INSERT INTO sectors (name, area_sqkm, lon, lat) VALUES (?, ?, ?, ?)`);
sectors.forEach(s => insertSector.run(s[0], s[1], s[2], s[3]));
console.log(`✅ Updated ${sectors.length} sectors`);

// Verify data
db.get('SELECT COUNT(*) as cnt FROM schools', (err, row) => {
    console.log(`Schools count: ${row.cnt}`);
});
db.get('SELECT COUNT(*) as cnt FROM sectors', (err, row) => {
    console.log(`Sectors count: ${row.cnt}`);
});

db.close();
