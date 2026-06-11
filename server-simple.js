const express = require('express');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 1111;

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

console.log(`\n╔════════════════════════════════════════════════════════════╗`);
console.log(`║     Rwanda School Accessibility System                    ║`);
console.log(`║     Real Data | Musanze District                          ║`);
console.log(`╚════════════════════════════════════════════════════════════╝`);
console.log(`\n📁 Database: ${DB_PATH}\n`);

app.use(express.json());
app.use(express.static('public'));

// Connect to database
const db = new sqlite3.Database(DB_PATH);

// Calculate distance between two points (Haversine formula)
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

// Ensure accessibility_results table exists
db.run(`CREATE TABLE IF NOT EXISTS accessibility_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER,
    sector_name TEXT,
    nearest_school_id INTEGER,
    nearest_school_name TEXT,
    distance_km REAL,
    travel_time_minutes REAL,
    accessibility_class TEXT,
    accessibility_score REAL,
    analysis_date TEXT
)`);

// API Endpoints
app.get('/api/gis/stats', (req, res) => {
    db.get('SELECT COUNT(*) as cnt FROM schools', (err, schools) => {
        db.get('SELECT COUNT(*) as cnt FROM roads', (err, roads) => {
            db.get('SELECT COUNT(*) as cnt FROM sectors', (err, sectors) => {
                db.get('SELECT COUNT(*) as cnt FROM districts', (err, districts) => {
                    db.all('SELECT accessibility_class, COUNT(*) as cnt FROM accessibility_results GROUP BY accessibility_class', (err, access) => {
                        const accessMap = { highly: 0, moderate: 0, underserved: 0 };
                        if (access && access.length > 0) {
                            access.forEach(a => {
                                if (a.accessibility_class === 'Highly Accessible') accessMap.highly = a.cnt;
                                else if (a.accessibility_class === 'Moderately Accessible') accessMap.moderate = a.cnt;
                                else if (a.accessibility_class === 'Underserved') accessMap.underserved = a.cnt;
                            });
                        }
                        res.json({
                            schools: schools?.cnt || 0,
                            roads: roads?.cnt || 0,
                            sectors: sectors?.cnt || 0,
                            districts: districts?.cnt || 0,
                            accessibility: accessMap
                        });
                    });
                });
            });
        });
    });
});

app.get('/api/gis/schools', (req, res) => {
    db.all('SELECT id, name, school_type, capacity, lon, lat FROM schools', (err, rows) => {
        if (err) {
            res.json({ type: "FeatureCollection", features: [] });
            return;
        }
        const features = rows.map(s => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [s.lon, s.lat] },
            properties: { name: s.name, type: s.school_type, capacity: s.capacity }
        }));
        res.json({ type: "FeatureCollection", features: features });
    });
});

app.get('/api/gis/sectors', (req, res) => {
    db.all('SELECT id, name, area_sqkm, lon, lat FROM sectors', (err, rows) => {
        if (err) {
            res.json({ type: "FeatureCollection", features: [] });
            return;
        }
        const features = rows.map(s => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [s.lon, s.lat] },
            properties: { name: s.name, area: s.area_sqkm }
        }));
        res.json({ type: "FeatureCollection", features: features });
    });
});

app.get('/api/gis/roads', (req, res) => {
    db.all('SELECT id, road_type, road_name, surface, length_m, lon, lat FROM roads', (err, rows) => {
        res.json(rows || []);
    });
});

app.get('/api/gis/accessibility', (req, res) => {
    db.all('SELECT * FROM accessibility_results ORDER BY distance_km ASC', (err, rows) => {
        res.json(rows || []);
    });
});

app.get('/api/gis/underserved', (req, res) => {
    db.all("SELECT * FROM accessibility_results WHERE accessibility_class = 'Underserved' ORDER BY distance_km DESC", (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/gis/analyze', (req, res) => {
    // Run accessibility analysis
    db.all('SELECT id, name, lon, lat FROM sectors', (err, sectors) => {
        if (err || !sectors || sectors.length === 0) {
            return res.json({ success: false, error: 'No sectors found' });
        }
        
        db.all('SELECT id, name, lon, lat FROM schools', (err, schools) => {
            if (err || !schools || schools.length === 0) {
                return res.json({ success: false, error: 'No schools found' });
            }
            
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
                let accessibilityClass;
                let score;
                
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
                    sector_id: sector.id,
                    sector_name: sector.name,
                    nearest_school_id: nearestSchool?.id || null,
                    nearest_school_name: nearestSchool?.name || 'No school nearby',
                    distance_km: minDistance.toFixed(2),
                    travel_time_minutes: travelTime.toFixed(1),
                    accessibility_class: accessibilityClass,
                    accessibility_score: Math.max(0, Math.min(100, score)).toFixed(1)
                });
            });
            
            // Sort results by distance
            results.sort((a, b) => parseFloat(a.distance_km) - parseFloat(b.distance_km));
            
            // Clear old results
            db.run('DELETE FROM accessibility_results', (err) => {
                if (err) {
                    console.error('Error clearing results:', err.message);
                }
                
                // Insert new results
                const stmt = db.prepare(`INSERT INTO accessibility_results 
                    (sector_id, sector_name, nearest_school_id, nearest_school_name, distance_km, travel_time_minutes, accessibility_class, accessibility_score, analysis_date) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
                
                results.forEach(r => {
                    stmt.run(r.sector_id, r.sector_name, r.nearest_school_id, r.nearest_school_name, r.distance_km, r.travel_time_minutes, r.accessibility_class, r.accessibility_score);
                });
                
                console.log(`✅ Analyzed ${results.length} sectors`);
                res.json({ success: true, count: results.length, results: results });
            });
        });
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', database: 'sqlite' });
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
    console.log(`║  🗺️  Server running at http://localhost:${PORT}              ║`);
    console.log(`║                                                            ║`);
    console.log(`║  API endpoints:                                            ║`);
    console.log(`║  GET /api/gis/stats          — Summary statistics          ║`);
    console.log(`║  GET /api/gis/schools        — School locations            ║`);
    console.log(`║  GET /api/gis/roads          — Road network                ║`);
    console.log(`║  GET /api/gis/sectors        — Sector locations            ║`);
    console.log(`║  GET /api/gis/accessibility  — Accessibility results       ║`);
    console.log(`║  POST /api/gis/analyze       — Run analysis                ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝`);
});
