#!/usr/bin/env node

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 1111;

// CRITICAL: Use local database file (uploaded to GitHub)
const DB_PATH = './data.db';

console.log('🚀 Starting Rwanda School Accessibility System...');
console.log(`📂 Database path: ${DB_PATH}`);

// Check if database exists
if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ Database not found at: ${DB_PATH}`);
  console.error('Please ensure data.db is uploaded to GitHub');
  process.exit(1);
}

// Check database size
const stats = fs.statSync(DB_PATH);
console.log(`✅ Database found: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

const db = new sqlite3.Database(DB_PATH);

// Serve static files from public directory (THIS IS KEY!)
app.use(express.static('public'));
app.use('/css', express.static('public/css'));
app.use('/js', express.static('public/js'));
app.use('/images', express.static('public/images'));

// Verify database has required tables
db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sectors'", (err, row) => {
  if (err || !row) {
    console.error('❌ Database missing required tables');
    process.exit(1);
  }
  console.log('✅ Database tables verified');
});

app.use(cors());
app.use(express.json());

// Helper function for database queries
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Health check endpoint (for Render)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: path.basename(DB_PATH),
    version: '2.0.0'
  });
});

// Get all schools with GeoJSON
app.get('/api/gis/schools', async (req, res) => {
  try {
    const schools = await query(`
      SELECT id, name, sector, district, lon, lat 
      FROM schools 
      ORDER BY name
    `);
    
    res.json({
      type: 'FeatureCollection',
      features: schools.map(s => ({
        type: 'Feature',
        geometry: { 
          type: 'Point', 
          coordinates: [s.lon, s.lat] 
        },
        properties: {
          id: s.id,
          name: s.name,
          sector: s.sector,
          district: s.district
        }
      })),
      total: schools.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all roads
app.get('/api/gis/roads', async (req, res) => {
  try {
    const roads = await query(`
      SELECT id, status, surface, class, district, length_km, geojson 
      FROM roads 
    `);
    
    const features = [];
    for (const road of roads) {
      try {
        let geometry;
        if (road.geojson) {
          geometry = JSON.parse(road.geojson);
        } else {
          geometry = { type: 'LineString', coordinates: [] };
        }
        
        features.push({
          type: 'Feature',
          geometry: geometry,
          properties: {
            id: road.id,
            status: road.status,
            surface: road.surface,
            class: road.class,
            district: road.district,
            length_km: road.length_km
          }
        });
      } catch(e) {
        console.error('Error parsing road geometry:', e.message);
      }
    }
    
    res.json({
      type: 'FeatureCollection',
      features: features,
      total: roads.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get accessibility analysis results
app.get('/api/gis/accessibility', async (req, res) => {
  try {
    const results = await query(`
      SELECT 
        sector_id,
        sector_name,
        nearest_school_name,
        distance_km,
        travel_time_minutes,
        accessibility_score,
        accessibility_class,
        road_connectivity_score,
        centroid_lon,
        centroid_lat
      FROM accessibility_results 
      ORDER BY accessibility_score DESC
    `);
    
    const summary = {
      total_sectors: results.length,
      highly_accessible: results.filter(r => r.accessibility_class === 'Highly Accessible').length,
      moderately_accessible: results.filter(r => r.accessibility_class === 'Moderately Accessible').length,
      underserved: results.filter(r => r.accessibility_class === 'Underserved').length,
      average_score: results.length > 0 
        ? (results.reduce((sum, r) => sum + r.accessibility_score, 0) / results.length).toFixed(1)
        : 0,
      average_distance: results.length > 0
        ? (results.reduce((sum, r) => sum + r.distance_km, 0) / results.length).toFixed(2)
        : 0
    };
    
    res.json({
      summary,
      results,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get proposed roads (infrastructure recommendations)
app.get('/api/gis/proposed-roads', async (req, res) => {
  try {
    const roads = await query(`
      SELECT 
        priority,
        priority_label,
        estimated_length_km,
        benefit_score,
        intervention_type,
        status,
        from_sector,
        to_school,
        geojson
      FROM proposed_roads 
      ORDER BY benefit_score DESC
    `);
    
    const features = roads.map(road => {
      let geometry = null;
      try {
        if (road.geojson) geometry = JSON.parse(road.geojson);
      } catch(e) {}
      
      return {
        type: 'Feature',
        geometry: geometry || { type: 'LineString', coordinates: [] },
        properties: {
          priority: road.priority,
          priority_label: road.priority_label,
          estimated_length_km: road.estimated_length_km,
          benefit_score: road.benefit_score,
          intervention_type: road.intervention_type,
          from_sector: road.from_sector,
          to_school: road.to_school
        }
      };
    });
    
    res.json({
      type: 'FeatureCollection',
      features: features,
      total: roads.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get service areas (school catchment zones)
app.get('/api/gis/service-areas', async (req, res) => {
  try {
    const areas = await query(`
      SELECT id, school_id, school_name, radius_km, geojson 
      FROM service_areas 
    `);
    
    const features = areas.map(area => {
      let geometry = null;
      try {
        if (area.geojson) geometry = JSON.parse(area.geojson);
      } catch(e) {}
      
      return {
        type: 'Feature',
        geometry: geometry || { type: 'Polygon', coordinates: [] },
        properties: {
          school_id: area.school_id,
          school_name: area.school_name,
          radius_km: area.radius_km
        }
      };
    });
    
    res.json({
      type: 'FeatureCollection',
      features: features,
      total: areas.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get sectors with GeoJSON
app.get('/api/gis/sectors', async (req, res) => {
  try {
    const sectors = await query(`
      SELECT id, name, district, lon, lat, geojson 
      FROM sectors 
    `);
    
    const features = sectors.map(sector => {
      let geometry = null;
      try {
        if (sector.geojson) geometry = JSON.parse(sector.geojson);
        else geometry = { type: 'Point', coordinates: [sector.lon, sector.lat] };
      } catch(e) {
        geometry = { type: 'Point', coordinates: [sector.lon, sector.lat] };
      }
      
      return {
        type: 'Feature',
        geometry: geometry,
        properties: {
          id: sector.id,
          name: sector.name,
          district: sector.district
        }
      };
    });
    
    res.json({
      type: 'FeatureCollection',
      features: features,
      total: sectors.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Rwanda School Accessibility System',
    version: '2.0.0',
    description: 'GIS Platform for School Accessibility Analysis in Rwanda',
    endpoints: [
      '/api/health',
      '/api/info',
      '/api/gis/schools',
      '/api/gis/roads',
      '/api/gis/sectors',
      '/api/gis/accessibility',
      '/api/gis/proposed-roads',
      '/api/gis/service-areas'
    ],
    frontend: {
      main: '/',
      accessibility_map: '/accessibility-map.html',
      priority_map: '/priority-map.html',
      underserved_map: '/underserved-map.html',
      proposed_roads: '/proposed-roads-map.html'
    }
  });
});

// Serve main index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve specific map pages
app.get('/accessibility-map.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'accessibility-map.html'));
});

app.get('/priority-map.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'priority-map.html'));
});

app.get('/underserved-map.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'underserved-map.html'));
});

app.get('/proposed-roads-map.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'proposed-roads-map.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  Rwanda School Accessibility — GIS Platform v5          ║
║  Full Map Interface Enabled                              ║
╚════════════════════════════════════════════════════════════╝

🗺️  LOCAL SERVER: http://localhost:${PORT}
🌐  RENDER URL: https://your-app.onrender.com

📊 Database: ${DB_PATH} (${(stats.size / 1024 / 1024).toFixed(2)} MB)
✅ Status: Running with Map Interface

🎨 MAP PAGES AVAILABLE:
   ┌─────────────────────────────────────────────────────┐
   │ 📍 Main Dashboard:    http://localhost:${PORT}/       │
   │ 🗺️ Accessibility:     http://localhost:${PORT}/accessibility-map.html │
   │ ⭐ Priority Areas:    http://localhost:${PORT}/priority-map.html │
   │ ⚠️ Underserved:       http://localhost:${PORT}/underserved-map.html │
   │ 🛣️ Proposed Roads:    http://localhost:${PORT}/proposed-roads-map.html │
   └─────────────────────────────────────────────────────┘

📡 API Endpoints:
   GET /api/health
   GET /api/info
   GET /api/gis/schools
   GET /api/gis/roads
   GET /api/gis/sectors
   GET /api/gis/accessibility
   GET /api/gis/proposed-roads
   GET /api/gis/service-areas

💡 Open your browser and click on any map page above!
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  db.close(() => {
    console.log('Database connection closed');
    process.exit(0);
  });
});

// Stats endpoint (for original HTML compatibility)
app.get('/api/gis/stats', async (req, res) => {
  try {
    const schools = await query('SELECT COUNT(*) as count FROM schools');
    const sectors = await query('SELECT COUNT(*) as count FROM sectors');
    const roads = await query('SELECT COUNT(*) as count FROM roads');
    const results = await query('SELECT COUNT(*) as count FROM accessibility_results');
    
    res.json({
      total_schools: schools[0].count,
      total_sectors: sectors[0].count,
      total_roads: roads[0].count,
      results_count: results[0].count,
      server_status: 'online',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats endpoint (for original HTML compatibility)
app.get('/api/gis/stats', async (req, res) => {
  try {
    const schools = await query('SELECT COUNT(*) as count FROM schools');
    const sectors = await query('SELECT COUNT(*) as count FROM sectors');
    const roads = await query('SELECT COUNT(*) as count FROM roads');
    const results = await query('SELECT COUNT(*) as count FROM accessibility_results');
    
    res.json({
      total_schools: schools[0].count,
      total_sectors: sectors[0].count,
      total_roads: roads[0].count,
      results_count: results[0].count,
      server_status: 'online',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
