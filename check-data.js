#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const os = require('os');

const DB_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data', 'gis_database.db');
const DATA_PATH = path.join(os.homedir(), 'Desktop', 'converted');

console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
console.log('║                    DATA INTEGRITY CHECK - MUSANZE DISTRICT                  ║');
console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

// Check if database exists
console.log('📁 CHECKING DATABASE...');
console.log('─'.repeat(60));

if (fs.existsSync(DB_PATH)) {
    console.log(`✅ Database found at: ${DB_PATH}`);
    const stats = fs.statSync(DB_PATH);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Modified: ${stats.mtime.toLocaleString()}`);
} else {
    console.log(`❌ Database NOT found at: ${DB_PATH}`);
    process.exit(1);
}

// Open database connection
const db = new sqlite3.Database(DB_PATH);

// Check tables
console.log('\n📊 CHECKING DATABASE TABLES...');
console.log('─'.repeat(60));

const tables = ['schools', 'sectors', 'roads', 'accessibility_results'];
tables.forEach(table => {
    db.get(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='${table}'`, (err, row) => {
        if (err) {
            console.log(`❌ Error checking table ${table}: ${err.message}`);
        } else if (row && row.count > 0) {
            console.log(`✅ Table '${table}' exists`);
        } else {
            console.log(`❌ Table '${table}' does NOT exist`);
        }
    });
});

// Wait for queries to complete
setTimeout(() => {
    // Check data in each table using direct queries
    console.log('\n📈 CHECKING DATA COUNTS...');
    console.log('─'.repeat(60));
    
    // Query schools
    db.get('SELECT COUNT(*) as count FROM schools', (err, row) => {
        if (err) {
            console.log(`❌ Error counting schools: ${err.message}`);
        } else {
            console.log(`🏫 SCHOOLS: ${row.count} records`);
            if (row.count > 0) {
                db.all('SELECT name, sector, lat, lon FROM schools LIMIT 5', (err, rows) => {
                    if (!err && rows) {
                        console.log(`   Sample schools:`);
                        rows.forEach(s => {
                            console.log(`      • ${s.name} (${s.sector || 'N/A'}) - [${s.lat}, ${s.lon}]`);
                        });
                    }
                });
            }
        }
    });
    
    // Query sectors
    db.get('SELECT COUNT(*) as count FROM sectors', (err, row) => {
        if (err) {
            console.log(`❌ Error counting sectors: ${err.message}`);
        } else {
            console.log(`\n🏘️ SECTORS: ${row.count} records`);
            if (row.count > 0) {
                db.all('SELECT name, population, lat, lon FROM sectors LIMIT 5', (err, rows) => {
                    if (!err && rows) {
                        console.log(`   Sample sectors:`);
                        rows.forEach(s => {
                            console.log(`      • ${s.name} - Population: ${s.population.toLocaleString()} - [${s.lat}, ${s.lon}]`);
                        });
                    }
                });
            }
        }
    });
    
    // Query roads
    db.get('SELECT COUNT(*) as count FROM roads', (err, row) => {
        if (err) {
            console.log(`❌ Error counting roads: ${err.message}`);
        } else {
            console.log(`\n🛣️ ROADS: ${row.count} records`);
            if (row.count > 0) {
                db.all('SELECT road_id, type, length_km FROM roads LIMIT 5', (err, rows) => {
                    if (!err && rows) {
                        console.log(`   Sample roads:`);
                        rows.forEach(r => {
                            console.log(`      • ${r.road_id} (${r.type}) - ${r.length_km} km`);
                        });
                    }
                });
            }
        }
    });
    
    // Query accessibility results
    db.get('SELECT COUNT(*) as count FROM accessibility_results', (err, row) => {
        if (err) {
            console.log(`❌ Error counting results: ${err.message}`);
        } else {
            console.log(`\n📊 ACCESSIBILITY RESULTS: ${row.count} records`);
            if (row.count > 0) {
                db.all('SELECT sector_name, category, distance_km FROM accessibility_results LIMIT 5', (err, rows) => {
                    if (!err && rows) {
                        console.log(`   Sample results:`);
                        rows.forEach(r => {
                            console.log(`      • ${r.sector_name} - ${r.category} - ${r.distance_km} km`);
                        });
                    }
                });
            }
        }
    });
    
    // Check converted folder
    console.log('\n📂 CHECKING CONVERTED FOLDER...');
    console.log('─'.repeat(60));
    
    if (fs.existsSync(DATA_PATH)) {
        console.log(`✅ Converted folder found at: ${DATA_PATH}`);
        const files = fs.readdirSync(DATA_PATH);
        const csvFiles = files.filter(f => f.endsWith('.csv') && (f.includes('musanze') || f.includes('school') || f.includes('sector') || f.includes('road')));
        
        console.log(`\n📄 MUSANZE CSV FILES FOUND: ${csvFiles.length}`);
        csvFiles.forEach(file => {
            const filePath = path.join(DATA_PATH, file);
            const stats = fs.statSync(filePath);
            console.log(`   • ${file} - ${(stats.size / 1024).toFixed(1)} KB`);
        });
    } else {
        console.log(`❌ Converted folder NOT found at: ${DATA_PATH}`);
    }
    
    // Data comparison - final summary
    setTimeout(() => {
        console.log('\n📊 DATA INTEGRITY SUMMARY');
        console.log('═'.repeat(60));
        
        // Get all counts in parallel
        let schoolsCount = 0, sectorsCount = 0, roadsCount = 0, resultsCount = 0;
        
        db.get('SELECT COUNT(*) as count FROM schools', (err, row) => { schoolsCount = row?.count || 0; });
        db.get('SELECT COUNT(*) as count FROM sectors', (err, row) => { sectorsCount = row?.count || 0; });
        db.get('SELECT COUNT(*) as count FROM roads', (err, row) => { roadsCount = row?.count || 0; });
        db.get('SELECT COUNT(*) as count FROM accessibility_results', (err, row) => { resultsCount = row?.count || 0; });
        
        setTimeout(() => {
            console.log(`
┌─────────────────────┬─────────────┬──────────────┐
│ Data Type           │ Count       │ Status       │
├─────────────────────┼─────────────┼──────────────┤
│ Schools             │ ${String(schoolsCount).padEnd(9)} │ ${schoolsCount > 0 ? '✅ LOADED' : '❌ EMPTY'.padEnd(10)} │
│ Sectors             │ ${String(sectorsCount).padEnd(9)} │ ${sectorsCount > 0 ? '✅ LOADED' : '❌ EMPTY'.padEnd(10)} │
│ Roads               │ ${String(roadsCount).padEnd(9)} │ ${roadsCount > 0 ? '✅ LOADED' : '❌ EMPTY'.padEnd(10)} │
│ Accessibility Results│ ${String(resultsCount).padEnd(9)} │ ${resultsCount > 0 ? '✅ ANALYZED' : '⚠️ RUN ANALYSIS'.padEnd(10)} │
└─────────────────────┴─────────────┴──────────────┘
                            `);
            
            console.log('\n💡 RECOMMENDATIONS:');
            if (schoolsCount === 0) console.log('   ⚠️ No schools found! Run "Load Data" button to load data.');
            if (sectorsCount === 0) console.log('   ⚠️ No sectors found! Run "Load Data" button to load data.');
            if (roadsCount === 0) console.log('   ⚠️ No roads found! Run "Load Data" button to load data.');
            if (schoolsCount > 0 && sectorsCount > 0 && resultsCount === 0) {
                console.log('   ✅ Data is loaded! Click "Run Analysis" to generate accessibility results.');
            }
            if (schoolsCount > 0 && sectorsCount > 0 && resultsCount > 0) {
                console.log('   ✅ All data is loaded and analyzed! Your system is ready.');
            }
            
            console.log('\n' + '═'.repeat(60));
            console.log('✅ Data check completed!');
            
            // Close database
            db.close();
        }, 500);
    }, 500);
}, 500);
