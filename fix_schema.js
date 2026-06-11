const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

const db = new sqlite3.Database(DB_PATH);

// Drop and recreate accessibility_results table with correct schema
db.run(`DROP TABLE IF EXISTS accessibility_results`);
db.run(`CREATE TABLE accessibility_results (
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

// Verify table was created
db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='accessibility_results'`, (err, rows) => {
    if (err) {
        console.error('Error:', err.message);
    } else {
        console.log('✅ accessibility_results table created successfully');
    }
});

db.close();
