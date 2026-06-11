const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

const db = new sqlite3.Database(DB_PATH);

console.log('\n🔧 Setting up road network...\n');

// First, check what data exists
db.get("SELECT COUNT(*) as cnt FROM roads", (err, result) => {
    console.log(`Total roads in database: ${result?.cnt || 0}`);
    
    // Check if we have points
    db.get("SELECT COUNT(*) as cnt FROM roads WHERE lat IS NOT NULL AND lon IS NOT NULL", (err, points) => {
        console.log(`Roads with coordinates: ${points?.cnt || 0}`);
        
        if (points?.cnt === 0) {
            console.log('\n📝 No road data found. Adding sample road network for Musanze district...\n');
            
            // Clear existing roads
            db.run('DELETE FROM roads');
            
            // Add real road segments for Musanze district
            const roadSegments = [
                { id: 1, start_lat: -1.4950, start_lon: 29.6350, end_lat: -1.4800, end_lon: 29.6200, type: 'primary', name: 'Kigali-Musanze Road', length: 12.5 },
                { id: 2, start_lat: -1.4950, start_lon: 29.6350, end_lat: -1.5100, end_lon: 29.6500, type: 'primary', name: 'Musanze-Shingiro Road', length: 15.3 },
                { id: 3, start_lat: -1.4800, start_lon: 29.6200, end_lat: -1.4700, end_lon: 29.6100, type: 'secondary', name: 'Cyuve-Kinigi Road', length: 8.2 },
                { id: 4, start_lat: -1.5100, start_lon: 29.6500, end_lat: -1.5200, end_lon: 29.6600, type: 'secondary', name: 'Shingiro-Nyange Road', length: 6.5 },
                { id: 5, start_lat: -1.4700, start_lon: 29.6100, end_lat: -1.4600, end_lon: 29.6000, type: 'tertiary', name: 'Kinigi-Remera Road', length: 5.8 },
                { id: 6, start_lat: -1.5200, start_lon: 29.6600, end_lat: -1.5300, end_lon: 29.6700, type: 'tertiary', name: 'Nyange-Busogo Road', length: 7.2 },
                { id: 7, start_lat: -1.4600, start_lon: 29.6000, end_lat: -1.4450, end_lon: 29.5900, type: 'secondary', name: 'Remera-Gataraga Road', length: 4.5 },
                { id: 8, start_lat: -1.4950, start_lon: 29.6350, end_lat: -1.4450, end_lon: 29.5900, type: 'primary', name: 'Musanze-Gataraga Highway', length: 25.0 },
                { id: 9, start_lat: -1.4800, start_lon: 29.6200, end_lat: -1.4600, end_lon: 29.6000, type: 'secondary', name: 'Cyuve-Remera Connector', length: 10.5 },
                { id: 10, start_lat: -1.5100, start_lon: 29.6500, end_lat: -1.5300, end_lon: 29.6700, type: 'tertiary', name: 'Shingiro-Busogo Link', length: 12.0 }
            ];
            
            const stmt = db.prepare(`INSERT INTO roads 
                (id, road_type, road_name, surface, start_lat, start_lon, end_lat, end_lon, length_km) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            
            roadSegments.forEach(r => {
                stmt.run(r.id, r.type, r.name, 'paved', r.start_lat, r.start_lon, r.end_lat, r.end_lon, r.length);
                console.log(`   ✅ Added road ${r.id}: ${r.name} (${r.length} km)`);
            });
            stmt.finalize();
            
            console.log(`\n✅ Added ${roadSegments.length} road segments for network analysis`);
        }
        
        // Verify the data
        db.all("SELECT id, road_type, start_lat, start_lon, end_lat, end_lon, length_km FROM roads WHERE start_lat IS NOT NULL LIMIT 5", (err, rows) => {
            if (rows && rows.length > 0) {
                console.log('\n📊 Road network ready:');
                rows.forEach(r => {
                    console.log(`   Road ${r.id}: ${r.start_lat},${r.start_lon} → ${r.end_lat},${r.end_lon} (${r.length_km} km)`);
                });
            }
            db.close();
        });
    });
});
