const express = require('express');
const SpatialService = require('../services/spatialService');

const router = express.Router();

// Get summary statistics
router.get('/stats', (req, res) => {
    const stats = SpatialService.getSummaryStats();
    res.json(stats);
});

// Get schools as GeoJSON
router.get('/schools', (req, res) => {
    const schools = SpatialService.getSchools();
    const geojson = SpatialService.toGeoJSON(schools, 'Point');
    res.json(geojson);
});

// Get roads
router.get('/roads', (req, res) => {
    const roads = SpatialService.getRoads();
    res.json(roads);
});

// Get sectors
router.get('/sectors', (req, res) => {
    const sectors = SpatialService.getSectors();
    const geojson = SpatialService.toGeoJSON(sectors, 'Point');
    res.json(geojson);
});

// Get districts
router.get('/districts', (req, res) => {
    const districts = SpatialService.getDistricts();
    const geojson = SpatialService.toGeoJSON(districts, 'Point');
    res.json(geojson);
});

// Get accessibility results
router.get('/accessibility', (req, res) => {
    const db = require('../config/database').getDB();
    const results = db.prepare('SELECT * FROM accessibility_results ORDER BY accessibility_score DESC').all();
    res.json(results);
});

// Get underserved areas
router.get('/underserved', (req, res) => {
    const underserved = SpatialService.getUnderservedAreas();
    res.json(underserved);
});

// Run analysis
router.post('/analyze', (req, res) => {
    const results = SpatialService.computeAccessibilityBySector();
    SpatialService.saveAccessibilityResults(results);
    res.json({ success: true, count: results.length });
});

module.exports = router;
