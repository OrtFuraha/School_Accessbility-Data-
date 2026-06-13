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

// Verify database has required tables
db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sectors'", (err, row) => {
  if (err || !row) {
    console.error('❌ Database missing required tables');
    console.error('Expected tables: sectors, schools, roads');
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

// Get all schools
app.get('/api/gis/schools', async (req, res) => {
  try {
    const schools = await query(`
      SELECT id, name, sector, district, lon, lat 
      FROM schools 
      ORDER BY name
      LIMIT 200
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
      total: schools.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/gis/schools:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all roads
app.get('/api/gis/roads', async (req, res) => {
  try {
    const roads = await query(`
      SELECT id, status, surface, class, district, length_km 
      FROM roads 
      LIMIT 200
    `);
    
    res.json({
      type: 'FeatureCollection',
      features: roads.map(r => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [] },
        properties: {
          id: r.id,
          status: r.status,
          surface: r.surface,
          class: r.class,
          district: r.district,
          length_km: r.length_km
        }
      })),
      total: roads.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/gis/roads:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get accessibility analysis results
app.get('/api/gis/accessibility', async (req, res) => {
  try {
    const results = await query(`
      SELECT 
        sector_name,
        nearest_school_name,
        distance_km,
        travel_time_minutes,
        accessibility_score,
        accessibility_class,
        road_connectivity_score
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
        : 0
    };
    
    res.json({
      summary,
      results,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/gis/accessibility:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get proposed roads (infrastructure recommendations)
app.get('/api/gis/proposed-roads', async (req, res) => {
  try {
    const roads = await query(`
      SELECT 
        priority_label,
        estimated_length_km,
        benefit_score,
        intervention_type,
        from_sector,
        to_school
      FROM proposed_roads 
      ORDER BY benefit_score DESC
    `);
    
    res.json({
      proposed_roads: roads,
      total: roads.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/gis/proposed-roads:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get service areas (school catchment zones)
app.get('/api/gis/service-areas', async (req, res) => {
  try {
    const areas = await query(`
      SELECT school_name, radius_km, geojson 
      FROM service_areas 
      LIMIT 50
    `);
    
    res.json({
      service_areas: areas,
      total: areas.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/gis/service-areas:', err);
    res.status(500).json({ error: err.message });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Rwanda School Accessibility System',
    version: '2.0.0',
    status: 'running',
    endpoints: [
      '/api/health',
      '/api/gis/schools',
      '/api/gis/roads',
      '/api/gis/accessibility',
      '/api/gis/proposed-roads',
      '/api/gis/service-areas'
    ],
    database: path.basename(DB_PATH)
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  Rwanda School Accessibility — GIS Platform v5          ║
║  Ready for Production on Render                          ║
╚════════════════════════════════════════════════════════════╝

🗺️  Server: http://localhost:${PORT}
📊 Database: ${DB_PATH} (${(stats.size / 1024 / 1024).toFixed(2)} MB)
✅ Status: Running

📡 Endpoints:
   GET  /                 - API information
   GET  /api/health       - Health check
   GET  /api/gis/schools  - List all schools
   GET  /api/gis/roads    - Road network data
   GET  /api/gis/accessibility - Accessibility analysis
   GET  /api/gis/proposed-roads - Infrastructure recommendations
   GET  /api/gis/service-areas - School catchment zones

💡 Render Deployment: Ready to go!
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
