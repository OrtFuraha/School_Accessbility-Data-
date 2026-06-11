const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const os = require('os');
const shapefile = require('shapefile');

const DESKTOP_PATH = path.join(os.homedir(), 'Desktop', 'School_Accessibility_Data');
const DATA_PATH = path.join(os.homedir(), 'Desktop', 'DATA');
const DB_PATH = path.join(DESKTOP_PATH, 'spatial_gis.db');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║     Loading Sector Data from Shapefiles                    ║');
console.log('╚════════════════════════════════════════════════════════════╝');

const db = new sqlite3.Database(DB_PATH);

// Function to convert UTM to WGS84
function utmToWgs84(x, y) {
    const lon = (x - 500000) / 111320 + 29.5;
    const lat = y / 111320 - 2.5;
    return { lon: lon, lat: lat };
}

// Function to get centroid of polygon
function getPolygonCentroid(coordinates) {
    let sumX = 0, sumY = 0;
    const ring = coordinates[0];
    for (let i = 0; i < ring.length; i++) {
        sumX += ring[i][0];
        sumY += ring[i][1];
    }
    return { x: sumX / ring.length, y: sumY / ring.length };
}

async function loadSectorsFromShapefile(shpPath, name) {
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
            
            console.log(`\n📄 ${name}: ${features.length} features`);
            
            let inserted = 0;
            const stmt = db.prepare(`INSERT OR REPLACE INTO sectors (name, area_sqkm, lon, lat) VALUES (?, ?, ?, ?)`);
            
            for (const feature of features) {
                const props = feature.properties;
                const geom = feature.geometry;
                
                let sectorName = props.SECTOR || props.NAME || props.name || props.District || `Sector_${inserted + 1}`;
                let area = props.area_sqkm || props.Area_km2 || 0;
                let lon = 0, lat = 0;
                
                if (geom && geom.type === 'Polygon') {
                    const centroid = getPolygonCentroid(geom.coordinates);
                    const coords = utmToWgs84(centroid.x, centroid.y);
                    lon = coords.lon;
                    lat = coords.lat;
                    console.log(`   ${sectorName}: (${lon.toFixed(4)}, ${lat.toFixed(4)})`);
                    stmt.run(sectorName, area, lon, lat);
                    inserted++;
                }
            }
            stmt.finalize();
            console.log(`   ✅ Inserted ${inserted} sectors from ${name}`);
            resolve(inserted);
        } catch (err) {
            console.log(`   ❌ Error: ${err.message}`);
            resolve(0);
        }
    });
}

async function loadAllSectors() {
    // Clear existing sectors
    db.run('DELETE FROM sectors');
    
    // Try different shapefiles that might contain sector/polygon data
    const shapefiles = [
        { path: path.join(DATA_PATH, 'Northern_Districts_Boundaries.shp'), name: 'Districts Boundaries' },
        { path: path.join(DATA_PATH, 'Northern_Boundary.shp'), name: 'Northern Boundary' },
        { path: path.join(DATA_PATH, 'Study_Area.shp'), name: 'Study Area' }
    ];
    
    let totalInserted = 0;
    
    for (const sf of shapefiles) {
        if (fs.existsSync(sf.path)) {
            const count = await loadSectorsFromShapefile(sf.path, sf.name);
            totalInserted += count;
        } else {
            console.log(`\n⚠️ File not found: ${sf.name}`);
        }
    }
    
    // If no sectors loaded, create sample sectors
    if (totalInserted === 0) {
        console.log('\n📝 Creating sample sectors for Musanze district...');
        const sampleSectors = [
            ['Musanze Sector', 45.2, 29.635, -1.495],
            ['Cyuve Sector', 38.5, 29.620, -1.480],
            ['Shingiro Sector', 42.1, 29.650, -1.510],
            ['Kinigi Sector', 35.8, 29.610, -1.470],
            ['Nyange Sector', 28.3, 29.660, -1.520],
            ['Remera Sector', 32.6, 29.600, -1.460],
            ['Busogo Sector', 25.4, 29.670, -1.530],
            ['Gataraga Sector', 30.2, 29.590, -1.445]
        ];
        
        const stmt = db.prepare(`INSERT INTO sectors (name, area_sqkm, lon, lat) VALUES (?, ?, ?, ?)`);
        sampleSectors.forEach(s => stmt.run(s[0], s[1], s[2], s[3]));
        totalInserted = sampleSectors.length;
        console.log(`   ✅ Created ${totalInserted} sample sectors`);
    }
    
    // Show final count
    const count = await new Promise(resolve => {
        db.get('SELECT COUNT(*) as cnt FROM sectors', (err, row) => {
            resolve(row ? row.cnt : 0);
        });
    });
    
    console.log(`\n📊 Total sectors in database: ${count}`);
    db.close();
}

loadAllSectors();
