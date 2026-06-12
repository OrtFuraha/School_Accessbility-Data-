# 🗺️ Rwanda School Accessibility System
### Musanze District · Northern Province · Road Network GIS Analysis

A professional GIS decision-support platform for analysing school accessibility in rural Rwanda, identifying underserved areas, and generating planning strategies for improving road connectivity.

---

## 📋 Project Overview

This system analyses school accessibility across **4 sectors** in **Musanze District**, Northern Province, Rwanda using:

- **Road network graph** built from 222 road segments (188.2 km)
- **Haversine distance routing** from sector centroids to nearest schools
- **Weighted 4-factor accessibility model**
- **Interactive Leaflet map** with 6 analysis map modes
- **Chart.js dashboards** with accessibility breakdowns
- **Auto-generated planning reports** with CSV/GeoJSON export

---

## 🗂️ Data Sources

| Dataset | File | Features | Projection |
|---------|------|----------|------------|
| School locations | Existiong_Educations.shp | 39 schools | Rwanda TM → WGS84 |
| Road network | Existing_Roads.shp | 222 segments | Rwanda TM → WGS84 |
| District boundaries | Northern_Districts_Boundaries.shp | 5 districts | Rwanda TM → WGS84 |
| Sector boundaries | Study_Area.shp | 4 sectors | Rwanda TM → WGS84 |
| Study area | Northern_Boundary.shp | 1 polygon | Rwanda TM → WGS84 |

**Coordinate conversion:** Rwanda TM (ITRF2005 Transverse Mercator) → WGS84 (EPSG:4326) using proj4

---

## 📊 Accessibility Model

Accessibility scores (0–100) computed using a weighted model:

| Factor | Weight | Method |
|--------|--------|--------|
| Distance to nearest school | **40%** | Haversine straight-line distance |
| Travel time | **20%** | Speed: 20–40 km/h by road surface type |
| Road connectivity | **20%** | Road km within 3 km radius |
| School coverage | **20%** | Number of schools within 3 km |

**Classification:**
- 🟢 **Highly Accessible** — Score ≥ 65
- 🟡 **Moderately Accessible** — Score 35–64
- 🔴 **Underserved** — Score < 35

---

## 🗺️ Map Outputs

The platform generates 6 interactive map views:

1. **📍 Accessibility Map** — Sectors colour-coded by accessibility score
2. **⚠️ Underserved Areas** — Highlights sectors below accessibility threshold
3. **🎯 Priority Intervention Zones** — Areas requiring immediate road investment
4. **🛣️ Proposed Roads** — Recommended road connections to improve access
5. **🌐 Road Network** — Full road network coloured by road class
6. **⭕ Service Areas** — 3 km school service area coverage circles

---

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 18
- Shapefiles in a `DATA/` folder

### Local setup

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/rwanda-school-accessibility.git
cd rwanda-school-accessibility

# 2. Install dependencies
npm install

# 3. Copy environment file
cp .env.example .env
# Edit .env to set your DATA_DIR and SPATIALITE_DB paths

# 4. Build the database from shapefiles
node build_database.js

# 5. Start the server
node server.js

# 6. Open in browser
open http://localhost:1111
```

---

## 🌐 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gis/stats` | GET | Summary statistics |
| `/api/gis/schools` | GET | School locations (GeoJSON) |
| `/api/gis/roads` | GET | Road network (GeoJSON) |
| `/api/gis/sectors` | GET | Sector boundaries (GeoJSON) |
| `/api/gis/districts` | GET | District boundaries (GeoJSON) |
| `/api/gis/accessibility` | GET | Accessibility analysis results |
| `/api/gis/underserved` | GET | Underserved areas |
| `/api/gis/proposed-roads` | GET | Proposed road improvements |
| `/api/gis/service-areas` | GET | School service area polygons |
| `/api/gis/nearest-school` | GET | Nearest school to a point (`?lon=&lat=`) |
| `/api/gis/analyze` | POST | Re-run accessibility analysis |
| `/api/network/stats` | GET | Road network statistics |
| `/api/health` | GET | Server health check |

---

## 🏗️ Project Structure

```
rwanda-school-accessibility/
├── server.js              # Express API server + GIS analysis engine
├── build_database.js      # Shapefile → SQLite database builder
├── package.json
├── .env.example
├── DATA/                  # Shapefiles (not committed to git)
│   ├── Existing_Roads.shp
│   ├── Existiong_Educations.shp
│   ├── Northern_Districts_Boundaries.shp
│   ├── Study_Area.shp
│   └── Northern_Boundary.shp
├── public/
│   └── index.html         # Full GIS dashboard (Leaflet + Chart.js)
└── services/
    └── networkService.js  # Road network graph utilities
```

---

## 🚢 Deployment on Render

### Option A: Web Service (recommended)

1. Push your code to GitHub (without `DATA/` folder and `*.db` files)
2. On [render.com](https://render.com), create a **Web Service**
3. Set **Build Command:** `npm install && node build_database.js`
4. Set **Start Command:** `node server.js`
5. Add environment variables in the Render dashboard
6. Upload your shapefiles via Render's persistent disk or use a public URL

### Option B: Use the included render.yaml

```bash
# render.yaml is included in this repo
# Just connect your GitHub repo to Render
```

### Environment variables for Render

```
PORT=10000
NODE_ENV=production
DATA_DIR=/opt/render/project/src/DATA
SPATIALITE_DB=/opt/render/project/src/data/gis_database.db
```

---

## 📈 Results Summary

Based on current analysis of Musanze District:

| Sector | Nearest School | Distance | Score | Class |
|--------|---------------|----------|-------|-------|
| Gacaca | E.P RUNGU | 1.21 km | 91.4 | 🟢 Highly Accessible |
| Gashaki | G.S SHASHI | 0.67 km | 98.9 | 🟢 Highly Accessible |
| Remera | C.S RWAZA | 0.64 km | 99.1 | 🟢 Highly Accessible |
| Rwaza | C.S BUMARA | 0.96 km | 97.6 | 🟢 Highly Accessible |

*Musanze District has excellent school accessibility due to dense school network and good rural road coverage.*

---

## 🛠️ Technology Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (with proj4 coordinate conversion)
- **GIS Analysis:** Custom Haversine routing engine
- **Frontend:** Leaflet.js + Chart.js
- **Map tiles:** CartoDB Dark / OpenStreetMap / Esri Satellite
- **Coordinate conversion:** proj4 (Rwanda TM → WGS84)

---

## 📄 License

MIT License — see LICENSE file for details.
