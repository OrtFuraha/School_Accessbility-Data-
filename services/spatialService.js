const { getDB } = require('../config/database');

const SpatialService = {
    // Get all schools
    getSchools() {
        const db = getDB();
        return db.prepare(`
            SELECT id, name, school_type, capacity, lon, lat
            FROM schools
            ORDER BY id
        `).all();
    },
    
    // Get all roads
    getRoads() {
        const db = getDB();
        return db.prepare(`
            SELECT id, road_type, road_name, surface, length_m, lon, lat
            FROM roads
            ORDER BY id
        `).all();
    },
    
    // Get all sectors
    getSectors() {
        const db = getDB();
        return db.prepare(`
            SELECT id, name, area_sqkm, lon, lat
            FROM sectors
            ORDER BY id
        `).all();
    },
    
    // Get all districts
    getDistricts() {
        const db = getDB();
        return db.prepare(`
            SELECT id, name, area_sqkm, lon, lat
            FROM districts
            ORDER BY id
        `).all();
    },
    
    // Calculate distance between two points (Haversine formula)
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    },
    
    // Compute accessibility by sector
    computeAccessibilityBySector() {
        const db = getDB();
        const schools = db.prepare('SELECT id, name, lat, lon FROM schools').all();
        const sectors = db.prepare('SELECT id, name, lat, lon, area_sqkm FROM sectors').all();
        
        if (sectors.length === 0 || schools.length === 0) {
            console.log('   No sectors or schools found for analysis');
            return [];
        }
        
        const results = [];
        
        for (const sector of sectors) {
            let nearestSchool = null;
            let minDistance = Infinity;
            
            for (const school of schools) {
                const dist = this.calculateDistance(sector.lat, sector.lon, school.lat, school.lon);
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestSchool = school;
                }
            }
            
            const travelTimeMin = (minDistance / 30) * 60;
            
            let accessibilityClass;
            if (minDistance <= 2) accessibilityClass = 'Highly Accessible';
            else if (minDistance <= 5) accessibilityClass = 'Moderately Accessible';
            else accessibilityClass = 'Underserved';
            
            const accessibilityScore = Math.max(0, Math.min(100, 
                100 - ((minDistance - 0.5) / 10) * 100
            ));
            
            results.push({
                sector_id: sector.id,
                sector_name: sector.name,
                area_sqkm: sector.area_sqkm,
                nearest_school_id: nearestSchool?.id,
                nearest_school_name: nearestSchool?.name || 'Unknown',
                distance_km: minDistance.toFixed(2),
                travel_time_minutes: travelTimeMin.toFixed(1),
                accessibility_class: accessibilityClass,
                accessibility_score: Math.max(0, Math.min(100, accessibilityScore)).toFixed(1),
                centroid_lon: sector.lon,
                centroid_lat: sector.lat
            });
        }
        
        return results;
    },
    
    // Save accessibility results
    saveAccessibilityResults(results) {
        const db = getDB();
        
        // Create table if not exists
        db.prepare(`
            CREATE TABLE IF NOT EXISTS accessibility_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sector_id INTEGER,
                sector_name TEXT,
                distance_km REAL,
                travel_time_minutes REAL,
                accessibility_class TEXT,
                accessibility_score REAL,
                analysis_date TEXT
            )
        `).run();
        
        // Clear old results
        db.prepare('DELETE FROM accessibility_results').run();
        
        const insert = db.prepare(`
            INSERT INTO accessibility_results (sector_id, sector_name, distance_km, travel_time_minutes, accessibility_class, accessibility_score, analysis_date)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `);
        
        for (const result of results) {
            insert.run(
                result.sector_id,
                result.sector_name,
                result.distance_km,
                result.travel_time_minutes,
                result.accessibility_class,
                result.accessibility_score
            );
        }
        
        console.log(`✅ Saved ${results.length} accessibility results`);
        return results.length;
    },
    
    // Get underserved areas
    getUnderservedAreas() {
        const db = getDB();
        return db.prepare(`
            SELECT * FROM accessibility_results 
            WHERE accessibility_class = 'Underserved'
            ORDER BY accessibility_score ASC
        `).all();
    },
    
    // Get summary statistics
    getSummaryStats() {
        const db = getDB();
        
        const schoolCount = db.prepare('SELECT COUNT(*) as cnt FROM schools').get().cnt;
        const roadCount = db.prepare('SELECT COUNT(*) as cnt FROM roads').get().cnt;
        const sectorCount = db.prepare('SELECT COUNT(*) as cnt FROM sectors').get().cnt;
        const districtCount = db.prepare('SELECT COUNT(*) as cnt FROM districts').get().cnt;
        
        let accessStats = { highly: 0, moderate: 0, underserved: 0 };
        try {
            const r = db.prepare(`
                SELECT 
                    SUM(CASE WHEN accessibility_class = 'Highly Accessible' THEN 1 ELSE 0 END) AS highly,
                    SUM(CASE WHEN accessibility_class = 'Moderately Accessible' THEN 1 ELSE 0 END) AS moderate,
                    SUM(CASE WHEN accessibility_class = 'Underserved' THEN 1 ELSE 0 END) AS underserved
                FROM accessibility_results
            `).get();
            if (r) accessStats = r;
        } catch(e) {}
        
        return {
            schools: schoolCount,
            roads: roadCount,
            sectors: sectorCount,
            districts: districtCount,
            accessibility: {
                highly: accessStats.highly || 0,
                moderate: accessStats.moderate || 0,
                underserved: accessStats.underserved || 0
            }
        };
    },
    
    // To GeoJSON
    toGeoJSON(rows, type = 'Point') {
        const features = rows.map(row => {
            let geometry = null;
            if (type === 'Point' && row.lon && row.lat) {
                geometry = { type: 'Point', coordinates: [row.lon, row.lat] };
            }
            return { type: 'Feature', properties: row, geometry };
        });
        return { type: 'FeatureCollection', features: features };
    }
};

module.exports = SpatialService;
