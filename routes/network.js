/**
 * Network Analysis Routes
 * API endpoints for road network analysis
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/network/stats
 * Returns road network statistics
 */
router.get('/stats', async (req, res) => {
    const networkService = req.app.locals.networkService;
    
    if (!networkService || !networkService.isNetworkReady()) {
        return res.status(503).json({ 
            error: 'Network service not ready',
            message: 'Road network is still initializing'
        });
    }
    
    const stats = networkService.getNetworkStats();
    res.json({
        success: true,
        network: stats,
        status: 'ready'
    });
});

/**
 * POST /api/network/route
 * Calculate route between two points using road network
 * Body: { start_lat, start_lon, end_lat, end_lon }
 */
router.post('/route', async (req, res) => {
    const { start_lat, start_lon, end_lat, end_lon } = req.body;
    
    if (!start_lat || !start_lon || !end_lat || !end_lon) {
        return res.status(400).json({ 
            error: 'Missing parameters',
            required: ['start_lat', 'start_lon', 'end_lat', 'end_lon']
        });
    }
    
    const networkService = req.app.locals.networkService;
    
    if (!networkService || !networkService.isNetworkReady()) {
        return res.status(503).json({ 
            error: 'Network service not ready',
            message: 'Please wait for network initialization'
        });
    }
    
    const route = await networkService.calculateRoadDistance(
        parseFloat(start_lat), parseFloat(start_lon),
        parseFloat(end_lat), parseFloat(end_lon)
    );
    
    res.json({
        success: true,
        distance_km: route.distance.toFixed(2),
        travel_time_min: route.travelTime.toFixed(1),
        method: route.method,
        route_points: route.routePoints,
        route_geometry: {
            type: 'LineString',
            coordinates: route.routePoints
        }
    });
});

/**
 * POST /api/network/nearest-school
 * Find nearest school using road network
 * Body: { lat, lon }
 */
router.post('/nearest-school', async (req, res) => {
    const { lat, lon } = req.body;
    
    if (!lat || !lon) {
        return res.status(400).json({ 
            error: 'Missing parameters',
            required: ['lat', 'lon']
        });
    }
    
    const networkService = req.app.locals.networkService;
    
    if (!networkService || !networkService.isNetworkReady()) {
        return res.status(503).json({ 
            error: 'Network service not ready',
            message: 'Please wait for network initialization'
        });
    }
    
    const result = await networkService.findNearestSchoolViaNetwork(
        parseFloat(lat), parseFloat(lon)
    );
    
    if (!result.school) {
        return res.json({
            success: false,
            error: 'No schools found'
        });
    }
    
    res.json({
        success: true,
        school: {
            id: result.school.id,
            name: result.school.name,
            lat: result.school.lat,
            lon: result.school.lon,
            capacity: result.school.capacity
        },
        distance_km: result.distance.toFixed(2),
        travel_time_min: result.travelTime.toFixed(1),
        method: result.method,
        route_points: result.routePoints
    });
});

/**
 * GET /api/network/connectivity
 * Get connectivity score for a location
 * Query: lat, lon
 */
router.get('/connectivity', async (req, res) => {
    const { lat, lon } = req.query;
    
    if (!lat || !lon) {
        return res.status(400).json({ 
            error: 'Missing parameters',
            required: ['lat', 'lon']
        });
    }
    
    const networkService = req.app.locals.networkService;
    
    if (!networkService || !networkService.isNetworkReady()) {
        return res.status(503).json({ 
            error: 'Network service not ready'
        });
    }
    
    const score = await networkService.getConnectivityScore(
        parseFloat(lat), parseFloat(lon)
    );
    
    res.json({
        success: true,
        connectivity_score: score,
        interpretation: score >= 0.7 ? 'Good connectivity' :
                        score >= 0.4 ? 'Moderate connectivity' : 'Poor connectivity'
    });
});

/**
 * GET /api/network/status
 * Check network service status
 */
router.get('/status', (req, res) => {
    const networkService = req.app.locals.networkService;
    
    res.json({
        status: networkService && networkService.isNetworkReady() ? 'ready' : 'initializing',
        network_ready: networkService ? networkService.isNetworkReady() : false
    });
});

module.exports = router;
