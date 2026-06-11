const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

const db = new sqlite3.Database(DB_PATH);

// Update sector names to real district names
const sectorUpdates = [
    ['Sector_1', 'Gakenke District'],
    ['Burera', 'Burera District'],
    ['Gakenke', 'Gakenke District'],
    ['Rulindo', 'Rulindo District'],
    ['Gicumbi', 'Gicumbi District'],
    ['Musanze', 'Musanze District']
];

console.log('\n📝 Updating sector names...\n');

for (const [oldName, newName] of sectorUpdates) {
    db.run(`UPDATE sectors SET name = ? WHERE name = ? OR name LIKE ?`, [newName, oldName, `%${oldName}%`], function(err) {
        if (!err && this.changes > 0) {
            console.log(`   ✅ Updated "${oldName}" → "${newName}" (${this.changes} records)`);
        }
    });
}

// Show all sectors after update
setTimeout(() => {
    console.log('\n📊 Current sectors in database:');
    db.all('SELECT id, name, lon, lat FROM sectors ORDER BY name', (err, rows) => {
        if (rows) {
            rows.forEach(s => {
                console.log(`   • ${s.name} (${s.lon.toFixed(4)}, ${s.lat.toFixed(4)})`);
            });
        }
        db.close();
    });
}, 500);
