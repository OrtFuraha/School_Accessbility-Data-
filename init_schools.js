const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

const db = new sqlite3.Database(DB_PATH);

console.log('\n🏫 Setting up schools data...\n');

// Check existing schools
db.get("SELECT COUNT(*) as cnt FROM schools", (err, result) => {
    console.log(`Existing schools: ${result?.cnt || 0}`);
    
    if (result?.cnt === 0) {
        console.log('\n📝 Adding schools for Musanze district...\n');
        
        const schools = [
            { id: 1, name: 'G.S. Musanze', lat: -1.4950, lon: 29.6350, capacity: 1200, type: 'primary' },
            { id: 2, name: 'Ecole Secondaire Cyuve', lat: -1.4800, lon: 29.6200, capacity: 800, type: 'secondary' },
            { id: 3, name: 'College Shingiro', lat: -1.5100, lon: 29.6500, capacity: 600, type: 'secondary' },
            { id: 4, name: 'G.S. Kinigi', lat: -1.4700, lon: 29.6100, capacity: 400, type: 'primary' },
            { id: 5, name: 'Lycee Nyange', lat: -1.5200, lon: 29.6600, capacity: 900, type: 'secondary' },
            { id: 6, name: 'Ecole Primaire Remera', lat: -1.4600, lon: 29.6000, capacity: 500, type: 'primary' },
            { id: 7, name: 'G.S. Busogo', lat: -1.5300, lon: 29.6700, capacity: 350, type: 'primary' },
            { id: 8, name: 'College Gataraga', lat: -1.4450, lon: 29.5900, capacity: 450, type: 'secondary' }
        ];
        
        const stmt = db.prepare(`INSERT INTO schools (id, name, lat, lon, capacity, school_type) VALUES (?, ?, ?, ?, ?, ?)`);
        
        schools.forEach(s => {
            stmt.run(s.id, s.name, s.lat, s.lon, s.capacity, s.type);
            console.log(`   ✅ Added school: ${s.name} at (${s.lat}, ${s.lon})`);
        });
        stmt.finalize();
        
        console.log(`\n✅ Added ${schools.length} schools`);
    }
    
    // Verify
    db.all("SELECT id, name, lat, lon, capacity FROM schools LIMIT 5", (err, rows) => {
        if (rows && rows.length > 0) {
            console.log('\n📊 Schools ready:');
            rows.forEach(s => {
                console.log(`   ${s.name}: (${s.lat}, ${s.lon}) - Capacity: ${s.capacity}`);
            });
        }
        db.close();
    });
});
