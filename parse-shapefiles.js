const shapefile = require('shapefile');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_PATH = path.join(os.homedir(), 'Desktop', 'DATA');

async function parseShapefile(shpPath) {
    try {
        const source = await shapefile.open(shpPath);
        const features = [];
        let feature;
        
        while (feature = await source.read()) {
            if (feature && feature.value) {
                features.push(feature.value);
            } else if (feature && feature.done) {
                break;
            }
        }
        
        return features;
    } catch (err) {
        console.log(`Error parsing: ${err.message}`);
        return [];
    }
}

async function analyzeShapefiles() {
    console.log('\n📂 Analyzing all shapefiles in DATA folder...\n');
    
    const files = fs.readdirSync(DATA_PATH);
    const shapefiles = files.filter(f => f.toLowerCase().endsWith('.shp'));
    
    for (const shpFile of shapefiles) {
        const shpPath = path.join(DATA_PATH, shpFile);
        console.log(`📄 Reading: ${shpFile}`);
        
        const features = await parseShapefile(shpPath);
        
        if (features.length > 0) {
            console.log(`   ✅ Found ${features.length} features`);
            
            // Show sample feature structure
            const sample = features[0];
            console.log(`   📍 Sample geometry type: ${sample.geometry?.type || 'unknown'}`);
            console.log(`   📋 Sample properties:`, Object.keys(sample.properties || {}).slice(0, 5));
            
            // Extract coordinates from first few features
            features.slice(0, 3).forEach((f, idx) => {
                if (f.geometry && f.geometry.type === 'Point') {
                    console.log(`      Point ${idx + 1}: [${f.geometry.coordinates[0]}, ${f.geometry.coordinates[1]}]`);
                } else if (f.geometry && f.geometry.type === 'LineString') {
                    const coords = f.geometry.coordinates;
                    if (coords.length > 0) {
                        console.log(`      Line ${idx + 1}: from [${coords[0][0]}, ${coords[0][1]}] to [${coords[coords.length-1][0]}, ${coords[coords.length-1][1]}]`);
                    }
                } else if (f.geometry && f.geometry.type === 'Polygon') {
                    const centroid = f.geometry.coordinates[0].reduce((sum, coord) => [sum[0] + coord[0], sum[1] + coord[1]], [0, 0]);
                    const center = [centroid[0] / f.geometry.coordinates[0].length, centroid[1] / f.geometry.coordinates[0].length];
                    console.log(`      Polygon ${idx + 1}: centroid [${center[0]}, ${center[1]}]`);
                }
            });
        } else {
            console.log(`   ⚠️ No features found or unable to read`);
        }
        console.log('');
    }
}

analyzeShapefiles();
