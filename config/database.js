const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

let db = null;

function getDB() {
    if (!db) {
        // Check if database exists
        if (!fs.existsSync(DB_PATH)) {
            console.error(`❌ Database not found at ${DB_PATH}`);
            console.error('   Please run: node build_database.js');
            process.exit(1);
        }
        
        db = new sqlite3.Database(DB_PATH);
        console.log('✅ Database connected:', path.basename(DB_PATH));
    }
    return db;
}

function testSpatial() {
    const db = getDB();
    try {
        const result = db.prepare("SELECT sqlite_version() as version").get();
        console.log(`   SQLite version: ${result.version}`);
        
        // Check tables
        const tables = ['schools', 'roads', 'sectors', 'districts'];
        for (const table of tables) {
            const count = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get();
            if (count && count.cnt > 0) {
                console.log(`   📊 ${table}: ${count.cnt} records`);
            }
        }
        return true;
    } catch (err) {
        console.error('Spatial test failed:', err.message);
        return false;
    }
}

function getTableStats() {
    const db = getDB();
    const stats = {};
    const tables = ['schools', 'roads', 'sectors', 'districts', 'study_area'];
    
    for (const table of tables) {
        try {
            const result = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get();
            stats[table] = result ? result.cnt : 0;
        } catch (e) {
            stats[table] = null;
        }
    }
    return stats;
}

module.exports = { getDB, testSpatial, getTableStats, DB_PATH };
