const fs = require('fs');
const path = require('path');
const os = require('os');
const { parse } = require('csv-parse/sync');

const DATA_PATH = path.join(os.homedir(), 'Desktop', 'DATA');

function loadDataFromDesktop() {
    console.log('\n📂 Loading data from Desktop/DATA folder...');
    console.log(`   Path: ${DATA_PATH}`);
    
    const loadedData = {
        schools: [],
        villages: [],
        roads: []
    };
    
    if (!fs.existsSync(DATA_PATH)) {
        console.log('⚠️ DATA folder not found. Creating sample data...');
        fs.mkdirSync(DATA_PATH, { recursive: true });
        return createSampleData(loadedData);
    }
    
    // Check for schools data
    const schoolFiles = ['schools.csv', 'schools.shp', 'school_data.csv', 'ecoles.csv'];
    for (const file of schoolFiles) {
        const filePath = path.join(DATA_PATH, file);
        if (fs.existsSync(filePath) && file.endsWith('.csv')) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const records = parse(content, { columns: true, skip_empty_lines: true });
                loadedData.schools = records.map(r => ({
                    id: r.id || r.school_id || `SCH_${Math.random()}`,
                    name: r.name || r.school_name || r.ecole || 'School',
                    lat: parseFloat(r.lat || r.latitude || r.y || 0),
                    lon: parseFloat(r.lon || r.longitude || r.x || 0),
                    capacity: parseInt(r.capacity) || 200
                }));
                console.log(`✅ Loaded ${loadedData.schools.length} schools from ${file}`);
                break;
            } catch (e) {
                console.log(`⚠️ Could not parse ${file}: ${e.message}`);
            }
        }
    }
    
    // Check for villages data
    const villageFiles = ['villages.csv', 'villages.shp', 'village_data.csv', 'villages_data.csv', 'imidugudu.csv'];
    for (const file of villageFiles) {
        const filePath = path.join(DATA_PATH, file);
        if (fs.existsSync(filePath) && file.endsWith('.csv')) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const records = parse(content, { columns: true, skip_empty_lines: true });
                loadedData.villages = records.map(r => ({
                    id: r.id || r.village_id || `VIL_${Math.random()}`,
                    name: r.name || r.village_name || r.umudugudu || 'Village',
                    lat: parseFloat(r.lat || r.latitude || r.y || 0),
                    lon: parseFloat(r.lon || r.longitude || r.x || 0),
                    population: parseInt(r.population) || 500
                }));
                console.log(`✅ Loaded ${loadedData.villages.length} villages from ${file}`);
                break;
            } catch (e) {
                console.log(`⚠️ Could not parse ${file}: ${e.message}`);
            }
        }
    }
    
    // Check for roads data
    const roadFiles = ['roads.csv', 'roads.shp', 'road_data.csv', 'routes.csv', 'roads_network.csv'];
    for (const file of roadFiles) {
        const filePath = path.join(DATA_PATH, file);
        if (fs.existsSync(filePath) && file.endsWith('.csv')) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const records = parse(content, { columns: true, skip_empty_lines: true });
                loadedData.roads = records.map(r => ({
                    id: r.id || r.road_id || `RD_${Math.random()}`,
                    type: r.type || r.road_type || 'secondary',
                    start_lat: parseFloat(r.start_lat || r.lat1 || r.from_lat || 0),
                    start_lon: parseFloat(r.start_lon || r.lon1 || r.from_lon || 0),
                    end_lat: parseFloat(r.end_lat || r.lat2 || r.to_lat || 0),
                    end_lon: parseFloat(r.end_lon || r.lon2 || r.to_lon || 0),
                    length_km: parseFloat(r.length_km) || 10
                }));
                console.log(`✅ Loaded ${loadedData.roads.length} roads from ${file}`);
                break;
            } catch (e) {
                console.log(`⚠️ Could not parse ${file}: ${e.message}`);
            }
        }
    }
    
    // If no data loaded, create sample Musanze data
    if (loadedData.schools.length === 0 && loadedData.villages.length === 0) {
        console.log('⚠️ No data files found. Creating Musanze sample data...');
        return createMusanzeSampleData(loadedData);
    }
    
    return loadedData;
}

function createMusanzeSampleData(loadedData) {
    loadedData.schools = [
        { id: 'SCH_001', name: 'Ecole Secondaire Musanze', lat: -1.4950, lon: 29.6350, capacity: 1200 },
        { id: 'SCH_002', name: 'GS Musanze', lat: -1.4900, lon: 29.6300, capacity: 800 },
        { id: 'SCH_003', name: 'College de Musanze', lat: -1.5000, lon: 29.6400, capacity: 600 },
        { id: 'SCH_004', name: 'Ecole Primaire Musanze', lat: -1.4850, lon: 29.6250, capacity: 400 },
        { id: 'SCH_005', name: 'Lycee de Musanze', lat: -1.5050, lon: 29.6450, capacity: 900 }
    ];
    
    loadedData.villages = [
        { id: 'VIL_001', name: 'Musanze Center', lat: -1.4950, lon: 29.6350, population: 45000 },
        { id: 'VIL_002', name: 'Cyuve', lat: -1.4800, lon: 29.6200, population: 12000 },
        { id: 'VIL_003', name: 'Shingiro', lat: -1.5100, lon: 29.6500, population: 8000 },
        { id: 'VIL_004', name: 'Kinigi', lat: -1.4700, lon: 29.6100, population: 15000 },
        { id: 'VIL_005', name: 'Nyange', lat: -1.5200, lon: 29.6600, population: 6000 },
        { id: 'VIL_006', name: 'Remera', lat: -1.4600, lon: 29.6000, population: 10000 },
        { id: 'VIL_007', name: 'Busogo', lat: -1.5300, lon: 29.6700, population: 5000 },
        { id: 'VIL_008', name: 'Gataraga', lat: -1.4450, lon: 29.5900, population: 7000 },
        { id: 'VIL_009', name: 'Nkotsi', lat: -1.5500, lon: 29.6800, population: 4000 },
        { id: 'VIL_010', name: 'Kabaya', lat: -1.4400, lon: 29.5800, population: 3000 }
    ];
    
    loadedData.roads = [
        { id: 'RD_001', type: 'primary', start_lat: -1.4950, start_lon: 29.6350, end_lat: -1.4800, end_lon: 29.6200, length_km: 12.5 },
        { id: 'RD_002', type: 'primary', start_lat: -1.4950, start_lon: 29.6350, end_lat: -1.5100, end_lon: 29.6500, length_km: 15.3 },
        { id: 'RD_003', type: 'secondary', start_lat: -1.4800, start_lon: 29.6200, end_lat: -1.4700, end_lon: 29.6100, length_km: 8.2 },
        { id: 'RD_004', type: 'secondary', start_lat: -1.5100, start_lon: 29.6500, end_lat: -1.5200, end_lon: 29.6600, length_km: 6.5 },
        { id: 'RD_005', type: 'tertiary', start_lat: -1.4700, start_lon: 29.6100, end_lat: -1.4600, end_lon: 29.6000, length_km: 5.8 }
    ];
    
    console.log(`✅ Created Musanze sample data: ${loadedData.schools.length} schools, ${loadedData.villages.length} villages, ${loadedData.roads.length} roads`);
    return loadedData;
}

module.exports = { loadDataFromDesktop };
