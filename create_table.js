const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

const db = new sqlite3.Database(DB_PATH);

// Create accessibility_results table
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
)`, (err) => {
    if (err) {
        console.error('Error creating table:', err.message);
    } else {
        console.log('✅ accessibility_results table created');
    }
});

// Verify table exists
db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
    if (err) {
        console.error('Error:', err.message);
    } else {
        console.log('Tables in database:', tables.map(t => t.name).join(', '));
    }
    db.close();
});
