const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const os = require('os');
const shapefile = require('shapefile');

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DATA_PATH = path.join(os.homedir(), 'Desktop', 'DATA');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║     Loading ALL Shapefile Data                              ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log(`\n📁 Data source: ${DATA_PATH}`);
console.log(`💾 Database: ${DB_PATH}\n`);

// Connect to database
const db = new sqlite3.Database(DB_PATH);

// Clear existing tables
db.run('DELETE FROM schools');
db.run('DELETE FROM roads');
db.run('DELETE FROM sectors');
db.run('DELETE FROM districts');

console.log('✅ Cleared existing data\n');

// Function to convert UTM to WGS84 (approximate for Rwanda UTM zone 36S)
function utmToWgs84(x, y) {
    // Rough conversion for Rwanda (UTM zone 36S to lat/lon)
    // This is approximate - for exact conversion use proj4
    const lon = (x - 500000) / 111320 + 29.5;
    const lat = y / 111320 - 2.5;
    return { lon: lon, lat: lat };
}

// Function to parse shapefile and extract data
async function parseShapefile(shpPath, type) {
    return new Promise(async (resolve) => {
        try {
            const source = await shapefile.open(shpPath);
            const features = [];
            let result;
            
            while (true) {
                result = await source.read();
                if (result.done) break;
                if (result.value) features.push(result.value);
            }
            
            console.log(`   📍 Found ${features.length} features in ${path.basename(shpPath)}`);
            
            let inserted = 0;
            
            if (type === 'roads') {
                const stmt = db.prepare(`INSERT INTO roads (road_type, road_name, surface, length_m, lon, lat) VALUES (?, ?, ?, ?, ?, ?)`);
                
                for (const feature of features) {
                    const props = feature.properties;
                    const geom = feature.geometry;
                    
                    let lon = 0, lat = 0;
                    if (geom && geom.type === 'LineString' && geom.coordinates.length > 0) {
                        const midPoint = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
                        const coords = utmToWgs84(midPoint[0], midPoint[1]);
                        lon = coords.lon;
                        lat = coords.lat;
                    }
                    
                    stmt.run(
                        props.Class || props.type || 'unknown',
                        props.ROAD_NO || props.road_no || '',
                        props.Surface || props.surface || '',
                        props.length_m || props.Shape_Leng || 0,
                        lon,
                        lat
                    );
                    inserted++;
                }
                stmt.finalize();
            } 
            else if (type === 'schools') {
                const stmt = db.prepare(`INSERT INTO schools (name, school_type, capacity, lon, lat) VALUES (?, ?, ?, ?, ?)`);
                
                for (const feature of features) {
                    const props = feature.properties;
                    const geom = feature.geometry;
                    
                    let lon = 0, lat = 0;
                    if (geom && geom.type === 'Point') {
                        const coords = utmToWgs84(geom.coordinates[0], geom.coordinates[1]);
                        lon = coords.lon;
                        lat = coords.lat;
                    }
                    
                    stmt.run(
                        props.S || props.name || props.School || 'School',
                        props.type || 'education',
                        props.capacity || 200,
                        lon,
                        lat
                    );
                    inserted++;
                }
                stmt.finalize();
            }
            else if (type === 'districts') {
                const stmt = db.prepare(`INSERT INTO districts (name, area_sqkm, lon, lat) VALUES (?, ?, ?, ?)`);
                
                for (const feature of features) {
                    const props = feature.properties;
                    const geom = feature.geometry;
                    
                    let lon = 0, lat = 0;
                    if (geom && geom.type === 'Polygon') {
                        const centroid = geom.coordinates[0].reduce((sum, coord) => [sum[0] + coord[0], sum[1] + coord[1]], [0, 0]);
                        const centerX = centroid[0] / geom.coordinates[0].length;
                        const centerY = centroid[1] / geom.coordinates[0].length;
                        const coords = utmToWgs84(centerX, centerY);
                        lon = coords.lon;
                        lat = coords.lat;
                    }
                    
                    stmt.run(
                        props.District || props.NAME || props.name || 'District',
                        props.Area_km2 || 0,
                        lon,
                        lat
                    );
                    inserted++;
                }
                stmt.finalize();
            }
            else if (type === 'sectors') {
                const stmt = db.prepare(`INSERT INTO sectors (name, area_sqkm, lon, lat) VALUES (?, ?, ?, ?)`);
                
                for (const feature of features) {
                    const props = feature.properties;
                    const geom = feature.geometry;
                    
                    let lon = 0, lat = 0;
                    if (geom && geom.type === 'Polygon') {
                        const centroid = geom.coordinates[0].reduce((sum, coord) => [sum[0] + coord[0], sum[1] + coord[1]], [0, 0]);
                        const centerX = centroid[0] / geom.coordinates[0].length;
                        const centerY = centroid[1] / geom.coordinates[0].length;
                        const coords = utmToWgs84(centerX, centerY);
                        lon = coords.lon;
                        lat = coords.lat;
                    }
                    
                    stmt.run(
                        props.SECTOR || props.NAME || props.name || 'Sector',
                        props.area_sqkm || 0,
                        lon,
                        lat
                    );
                    inserted++;
                }
                stmt.finalize();
            }
            
            console.log(`      ✅ Inserted ${inserted} records into ${type}`);
            resolve(inserted);
        } catch (err) {
            console.log(`   ❌ Error parsing ${path.basename(shpPath)}: ${err.message}`);
            resolve(0);
        }
    });
}

// Process all shapefiles
async function processAllShapefiles() {
    const files = fs.readdirSync(DATA_PATH);
    const shpFiles = files.filter(f => f.toLowerCase().endsWith('.shp'));
    
    console.log(`📄 Found ${shpFiles.length} shapefiles\n`);
    
    for (const shpFile of shpFiles) {
        const shpPath = path.join(DATA_PATH, shpFile);
        const name = shpFile.toLowerCase();
        
        console.log(`📄 Processing: ${shpFile}`);
        
        if (name.includes('road')) {
            await parseShapefile(shpPath, 'roads');
        } 
        else if (name.includes('education')) {
            await parseShapefile(shpPath, 'schools');
        }
        else if (name.includes('district') && !name.includes('boundary')) {
            await parseShapefile(shpPath, 'districts');
        }
        else if (name.includes('sector') || name.includes('boundary')) {
            await parseShapefile(shpPath, 'sectors');
        }
        else {
            console.log(`   ⚠️ Unknown type, skipping`);
        }
    }
    
    // Show final counts
    console.log('\n📊 FINAL DATABASE CONTENTS:');
    const tables = ['schools', 'roads', 'sectors', 'districts'];
    for (const table of tables) {
        const count = await new Promise(resolve => {
            db.get(`SELECT COUNT(*) as cnt FROM ${table}`, (err, row) => {
                resolve(row ? row.cnt : 0);
            });
        });
        console.log(`   ${table}: ${count} rows`);
    }
    
    console.log('\n✅ All shapefile data loaded successfully!');
    db.close();
}

processAllShapefiles();
