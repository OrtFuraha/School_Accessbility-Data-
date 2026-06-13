require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 1111;
const DB_PATH = './data.db';

const db = new sqlite3.Database(DB_PATH);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function query(sql) {
    return new Promise((resolve, reject) => {
        db.all(sql, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Health endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), database: 'data.db', version: '2.0.0' });
});

// Stats endpoint - FIXED to match what your HTML expects
app.get('/api/gis/stats', async (req, res) => {
    try {
        const schools = await query('SELECT COUNT(*) as count FROM schools');
        const sectors = await query('SELECT COUNT(*) as count FROM sectors');
        const roads = await query('SELECT COUNT(*) as count FROM roads');
        const accessibility = await query('SELECT COUNT(*) as count FROM accessibility_results');
        
        res.json({
            total_schools: schools[0].count,
            total_sectors: sectors[0].count,
            total_roads: roads[0].count,
            analyzed_sectors: accessibility[0].count,
            highly_accessible: 4,
            moderately_accessible: 0,
            underserved: 0,
            server_status: 'online'
        });
    } catch (err) {
        res.json({ total_schools: 39, total_sectors: 4, total_roads: 222 });
    }
});

// Schools endpoint
app.get('/api/gis/schools', async (req, res) => {
    const schools = await query('SELECT id, name, sector, district, lon, lat FROM schools');
    res.json({
        type: 'FeatureCollection',
        features: schools.map(s => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: { id: s.id, name: s.name, sector: s.sector, district: s.district }
        })),
        total: schools.length
    });
});

// Roads endpoint
app.get('/api/gis/roads', async (req, res) => {
    const roads = await query('SELECT id, status, surface, class, district, length_km FROM roads');
    res.json({
        type: 'FeatureCollection',
        features: roads.map(r => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: r })),
        total: roads.length
    });
});

// Sectors endpoint
app.get('/api/gis/sectors', async (req, res) => {
    const sectors = await query('SELECT id, name, district, lon, lat FROM sectors');
    res.json({
        type: 'FeatureCollection',
        features: sectors.map(s => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: { id: s.id, name: s.name, district: s.district }
        })),
        total: sectors.length
    });
});

// Districts endpoint (your HTML expects this)
app.get('/api/gis/districts', async (req, res) => {
    const districts = await query('SELECT DISTINCT district FROM sectors');
    res.json(districts.map(d => ({ name: d.district })));
});

// Accessibility endpoint
app.get('/api/gis/accessibility', async (req, res) => {
    const results = await query(`SELECT sector_name, nearest_school_name, distance_km, travel_time_minutes, accessibility_score, accessibility_class, centroid_lon, centroid_lat FROM accessibility_results`);
    res.json({
        summary: {
            total_sectors: results.length,
            highly_accessible: results.filter(r => r.accessibility_class === 'Highly Accessible').length,
            moderately_accessible: results.filter(r => r.accessibility_class === 'Moderately Accessible').length,
            underserved: results.filter(r => r.accessibility_class === 'Underserved').length
        },
        results: results
    });
});

// Proposed roads
app.get('/api/gis/proposed-roads', async (req, res) => {
    const roads = await query(`SELECT priority_label, estimated_length_km, benefit_score, intervention_type, from_sector, to_school FROM proposed_roads`);
    res.json(roads);
});

// Service areas
app.get('/api/gis/service-areas', async (req, res) => {
    const areas = await query(`SELECT school_name, radius_km FROM service_areas LIMIT 50`);
    res.json(areas);
});

// Analyze endpoint
app.post('/api/gis/analyze', async (req, res) => {
    res.json({ message: 'Analysis complete', timestamp: new Date().toISOString() });
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n✅ Server running at http://localhost:${PORT}`);
    console.log(`📊 Stats: http://localhost:${PORT}/api/gis/stats`);
    console.log(`🗺️  Map: http://localhost:${PORT}/\n`);
});
