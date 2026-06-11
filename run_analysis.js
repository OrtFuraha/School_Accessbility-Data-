const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

const db = new sqlite3.Database(DB_PATH);

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

console.log('\n🔍 Running fresh accessibility analysis...\n');

db.all('SELECT id, name, lon, lat FROM sectors', (err, sectors) => {
    db.all('SELECT id, name, lon, lat FROM schools', (err, schools) => {
        
        const results = [];
        
        sectors.forEach(sector => {
            let nearestSchool = null;
            let minDistance = Infinity;
            
            schools.forEach(school => {
                const dist = calculateDistance(sector.lat, sector.lon, school.lat, school.lon);
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestSchool = school;
                }
            });
            
            const travelTime = (minDistance / 30) * 60;
            let accessibilityClass, score;
            
            if (minDistance <= 2) {
                accessibilityClass = "Highly Accessible";
                score = 100 - (minDistance / 2) * 20;
            } else if (minDistance <= 5) {
                accessibilityClass = "Moderately Accessible";
                score = 80 - ((minDistance - 2) / 3) * 30;
            } else if (minDistance <= 10) {
                accessibilityClass = "Poorly Accessible";
                score = 50 - ((minDistance - 5) / 5) * 30;
            } else {
                accessibilityClass = "Underserved";
                score = Math.max(0, 20 - ((minDistance - 10) / 10) * 20);
            }
            
            results.push({
                sector_name: sector.name,
                nearest_school: nearestSchool?.name || 'No school nearby',
                distance_km: minDistance.toFixed(2),
                travel_time_min: travelTime.toFixed(1),
                accessibility_class: accessibilityClass,
                score: Math.max(0, Math.min(100, score)).toFixed(1)
            });
        });
        
        // Sort by distance
        results.sort((a, b) => parseFloat(a.distance_km) - parseFloat(b.distance_km));
        
        console.log('📊 ACCESSIBILITY RESULTS:\n');
        console.log('┌─────────────────────┬─────────────────────┬────────────┬─────────────┬─────────────────────┬────────┐');
        console.log('│ Sector              │ Nearest School      │ Distance   │ Travel Time │ Status              │ Score  │');
        console.log('├─────────────────────┼─────────────────────┼────────────┼─────────────┼─────────────────────┼────────┤');
        
        results.forEach(r => {
            const sectorName = r.sector_name.padEnd(19);
            const schoolName = (r.nearest_school.substring(0, 19) || 'N/A').padEnd(19);
            const dist = `${r.distance_km} km`.padEnd(10);
            const time = `${r.travel_time_min} min`.padEnd(11);
            const status = r.accessibility_class.padEnd(19);
            const score = r.score.padEnd(6);
            console.log(`│ ${sectorName} │ ${schoolName} │ ${dist} │ ${time} │ ${status} │ ${score} │`);
        });
        
        console.log('└─────────────────────┴─────────────────────┴────────────┴─────────────┴─────────────────────┴────────┘');
        
        // Get statistics
        const stats = {
            total_sectors: results.length,
            highly: results.filter(r => r.accessibility_class === 'Highly Accessible').length,
            moderate: results.filter(r => r.accessibility_class === 'Moderately Accessible').length,
            poor: results.filter(r => r.accessibility_class === 'Poorly Accessible').length,
            underserved: results.filter(r => r.accessibility_class === 'Underserved').length
        };
        
        console.log(`\n📊 SUMMARY STATISTICS:`);
        console.log(`   Total Sectors: ${stats.total_sectors}`);
        console.log(`   🟢 Highly Accessible: ${stats.highly}`);
        console.log(`   🟡 Moderately Accessible: ${stats.moderate}`);
        console.log(`   🟠 Poorly Accessible: ${stats.poor}`);
        console.log(`   🔴 Underserved: ${stats.underserved}`);
        
        // Save to database
        db.run('DELETE FROM accessibility_results');
        const stmt = db.prepare(`INSERT INTO accessibility_results 
            (sector_name, nearest_school_name, distance_km, travel_time_minutes, accessibility_class, accessibility_score, analysis_date) 
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
        
        results.forEach(r => {
            stmt.run(r.sector_name, r.nearest_school, r.distance_km, r.travel_time_min, r.accessibility_class, r.score);
        });
        
        console.log(`\n✅ Results saved to database`);
        db.close();
    });
});
