/**
 * Road Network Analysis Module
 * Performs graph-based road network analysis for school accessibility
 */

class RoadNetworkAnalyzer {
    constructor() {
        this.graph = null;
        this.nodes = [];
        this.edges = [];
        this.nodeIndex = new Map();
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    buildNetwork(roads) {
        console.log('🏗️ Building road network graph...');
        
        this.graph = {};
        this.nodes = [];
        this.edges = [];
        this.nodeIndex.clear();
        
        let nodeId = 0;
        
        roads.forEach(road => {
            if (!road.start_lat || !road.start_lon || !road.end_lat || !road.end_lon) return;
            
            const startKey = `${road.start_lat},${road.start_lon}`;
            const endKey = `${road.end_lat},${road.end_lon}`;
            
            if (!this.nodeIndex.has(startKey)) {
                this.nodeIndex.set(startKey, { id: nodeId++, lat: road.start_lat, lon: road.start_lon });
                this.nodes.push({ id: nodeId - 1, lat: road.start_lat, lon: road.start_lon });
            }
            if (!this.nodeIndex.has(endKey)) {
                this.nodeIndex.set(endKey, { id: nodeId++, lat: road.end_lat, lon: road.end_lon });
                this.nodes.push({ id: nodeId - 1, lat: road.end_lat, lon: road.end_lon });
            }
        });
        
        for (let i = 0; i < this.nodes.length; i++) {
            this.graph[i] = [];
        }
        
        roads.forEach(road => {
            if (!road.start_lat || !road.start_lon || !road.end_lat || !road.end_lon) return;
            
            const startKey = `${road.start_lat},${road.start_lon}`;
            const endKey = `${road.end_lat},${road.end_lon}`;
            const startNode = this.nodeIndex.get(startKey);
            const endNode = this.nodeIndex.get(endKey);
            
            if (startNode && endNode) {
                const distance = road.length_km || this.calculateDistance(
                    road.start_lat, road.start_lon,
                    road.end_lat, road.end_lon
                );
                
                this.graph[startNode.id].push({ to: endNode.id, distance: distance });
                this.graph[endNode.id].push({ to: startNode.id, distance: distance });
                this.edges.push({ from: startNode.id, to: endNode.id, distance: distance });
            }
        });
        
        console.log(`   ✅ Network built: ${this.nodes.length} nodes, ${this.edges.length} edges`);
        return { graph: this.graph, nodes: this.nodes, edges: this.edges };
    }

    findNearestNode(lat, lon) {
        let nearest = null;
        let minDist = Infinity;
        
        this.nodes.forEach(node => {
            const dist = this.calculateDistance(lat, lon, node.lat, node.lon);
            if (dist < minDist) {
                minDist = dist;
                nearest = node;
            }
        });
        
        return { node: nearest, distance: minDist };
    }

    findShortestPath(startNodeId, endNodeId) {
        if (startNodeId === endNodeId) return { distance: 0, path: [startNodeId], found: true };
        
        const distances = new Array(this.nodes.length).fill(Infinity);
        const previous = new Array(this.nodes.length).fill(-1);
        const visited = new Array(this.nodes.length).fill(false);
        
        distances[startNodeId] = 0;
        
        for (let i = 0; i < this.nodes.length; i++) {
            let current = -1;
            let minDist = Infinity;
            
            for (let j = 0; j < this.nodes.length; j++) {
                if (!visited[j] && distances[j] < minDist) {
                    minDist = distances[j];
                    current = j;
                }
            }
            
            if (current === -1 || current === endNodeId) break;
            visited[current] = true;
            
            if (this.graph[current]) {
                for (let neighbor of this.graph[current]) {
                    const alt = distances[current] + neighbor.distance;
                    if (alt < distances[neighbor.to]) {
                        distances[neighbor.to] = alt;
                        previous[neighbor.to] = current;
                    }
                }
            }
        }
        
        const path = [];
        let current = endNodeId;
        while (current !== -1 && previous[current] !== -1) {
            path.unshift(current);
            current = previous[current];
        }
        if (path.length > 0) path.unshift(startNodeId);
        
        return {
            distance: distances[endNodeId],
            path: path,
            found: distances[endNodeId] !== Infinity
        };
    }

    calculateRoadDistance(startLat, startLon, endLat, endLon) {
        const startNode = this.findNearestNode(startLat, startLon);
        const endNode = this.findNearestNode(endLat, endLon);
        
        if (!startNode.node || !endNode.node) {
            const directDist = this.calculateDistance(startLat, startLon, endLat, endLon);
            return {
                distance: directDist,
                travelTime: directDist / 30 * 60,
                method: 'euclidean',
                routePoints: [[startLon, startLat], [endLon, endLat]]
            };
        }
        
        const result = this.findShortestPath(startNode.node.id, endNode.node.id);
        
        if (!result.found) {
            const directDist = this.calculateDistance(startLat, startLon, endLat, endLon);
            return {
                distance: directDist,
                travelTime: directDist / 30 * 60,
                method: 'euclidean',
                routePoints: [[startLon, startLat], [endLon, endLat]]
            };
        }
        
        const routePoints = [];
        for (let i = 0; i < result.path.length; i++) {
            const node = this.nodes[result.path[i]];
            if (node) routePoints.push([node.lon, node.lat]);
        }
        
        const totalDistance = startNode.distance + result.distance + endNode.distance;
        
        return {
            distance: totalDistance,
            travelTime: totalDistance / 30 * 60,
            method: 'road_network',
            routePoints: routePoints,
            startConnection: startNode.distance,
            endConnection: endNode.distance
        };
    }

    findNearestSchoolViaNetwork(pointLat, pointLon, schools) {
        let nearestSchool = null;
        let bestRoute = null;
        let minDistance = Infinity;
        
        for (const school of schools) {
            const route = this.calculateRoadDistance(pointLat, pointLon, school.lat, school.lon);
            if (route.distance < minDistance) {
                minDistance = route.distance;
                nearestSchool = school;
                bestRoute = route;
            }
        }
        
        return {
            school: nearestSchool,
            distance: minDistance,
            travelTime: bestRoute ? bestRoute.travelTime : 0,
            method: bestRoute ? bestRoute.method : 'none',
            routePoints: bestRoute ? bestRoute.routePoints : []
        };
    }

    calculateConnectivityScore(lat, lon, radiusKm = 2) {
        const nearest = this.findNearestNode(lat, lon);
        if (!nearest.node) return 0;
        
        let reachableCount = 0;
        for (let i = 0; i < this.nodes.length; i++) {
            const dist = this.calculateDistance(lat, lon, this.nodes[i].lat, this.nodes[i].lon);
            if (dist <= radiusKm) reachableCount++;
        }
        
        return Math.min(reachableCount / 10, 1);
    }

    getNetworkStats() {
        let totalLength = 0;
        this.edges.forEach(edge => {
            totalLength += edge.distance;
        });
        
        return {
            nodes: this.nodes.length,
            edges: this.edges.length,
            totalRoadLength: totalLength,
            avgEdgeLength: totalLength / (this.edges.length || 1)
        };
    }
}

module.exports = RoadNetworkAnalyzer;
