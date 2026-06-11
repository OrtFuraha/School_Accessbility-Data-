const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

const db = new sqlite3.Database(DB_PATH);

// Clear existing sectors and insert only Musanze sectors
console.log('\n📂 Updating database with Musanze sectors only...\n');

// First, clear all sectors
db.run('DELETE FROM sectors');

// Insert the actual sectors of Musanze District
const musanzeSectors = [
    ['Musanze Center', 29.635, -1.495, 45000],
    ['Cyuve', 29.620, -1.480, 12000],
    ['Shingiro', 29.650, -1.510, 8000],
    ['Kinigi', 29.610, -1.470, 15000],
    ['Nyange', 29.660, -1.520, 6000],
    ['Remera', 29.600, -1.460, 10000],
    ['Busogo', 29.670, -1.530, 5000],
    ['Gataraga', 29.590, -1.445, 7000]
];

const stmt = db.prepare(`INSERT INTO sectors (name, lon, lat, population) VALUES (?, ?, ?, ?)`);

for (const sector of musanzeSectors) {
    stmt.run(sector[0], sector[1], sector[2], sector[3]);
    console.log(`   ✅ Added sector: ${sector[0]} (${sector[1]}, ${sector[2]})`);
}
stmt.finalize();

// Verify
db.get('SELECT COUNT(*) as cnt FROM sectors', (err, row) => {
    console.log(`\n📊 Total Musanze sectors in database: ${row.cnt}`);
});

db.close();
