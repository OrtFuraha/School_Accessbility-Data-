'use strict';
// ── Render-compatible server.js ───────────────────────────────────────
// This version auto-builds the database on startup if it doesn't exist,
// and uses environment-variable paths for Render deployment.

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app  = express();
const PORT = process.env.PORT || 10000;

// ── On Render, DB lives in the project directory ──────────────────────
const DB_DIR  = path.join(__dirname, 'data');
const DB_PATH = process.env.SPATIALITE_DB ||
  path.join(DB_DIR, 'gis_database.db');
const DATA_DIR = process.env.DATA_DIR ||
  path.join(__dirname, 'DATA');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── DB helpers ────────────────────────────────────────────────────────
let _db = null;
function getDB() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
  return _db;
}
const A = (sql,p=[]) => new Promise((r,j) => getDB().all(sql,p,(e,d)=>e?j(e):r(d||[])));
const G = (sql,p=[]) => new Promise((r,j) => getDB().get(sql,p,(e,d)=>e?j(e):r(d||null)));
const R = (sql,p=[]) => new Promise((r,j) => getDB().run(sql,p,function(e){e?j(e):r(this)}));

// ── Check if DB needs building ────────────────────────────────────────
async function needsBuild() {
  try {
    const r = await G("SELECT COUNT(*) c FROM schools");
    return !r || r.c === 0;
  } catch { return true; }
}

// ── Auto-build database if needed ────────────────────────────────────
async function autoBuild() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('⚠️  DATA directory not found at:', DATA_DIR);
    console.log('   Please upload shapefiles to the DATA/ folder');
    return false;
  }
  console.log('🔨 Building database from shapefiles...');
  const build = require('./build_database.js');
  return true;
}

// ── Haversine ─────────────────────────────────────────────────────────
function hav(lo1,la1,lo2,la2){
  const R=6371,dL=(la2-la1)*Math.PI/180,dl=(lo2-lo1)*Math.PI/180;
  const a=Math.sin(dL/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dl/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function pip(lon,lat,geom){
  try{
    const rings=geom.type==='MultiPolygon'?geom.coordinates[0]:geom.coordinates;
    const ring=rings[0];let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
      if(((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)) inside=!inside;
    }
    return inside;
  }catch{return false;}
}
function roadsIn(roads,gjStr){
  try{const sg=JSON.parse(gjStr);let len=0,cnt=0;
    for(const r of roads)if(r.lon&&r.lat&&pip(r.lon,r.lat,sg)){len+=r.length_m||0;cnt++;}
    return{count:cnt,km:+(len/1000).toFixed(2)};}catch{return{count:0,km:0};}
}
function nearestSchool(lon,lat,schools){
  let best=null,bd=Infinity;
  for(const s of schools){if(!s.lon||!s.lat)continue;const d=hav(lon,lat,s.lon,s.lat);if(d<bd){bd=d;best=s;}}
  return best?{school:best,distKm:bd}:null;
}

async function analyse(){
  const sectors=await A('SELECT * FROM sectors');
  const schools=await A('SELECT * FROM schools');
  const roads  =await A('SELECT * FROM roads');
  if(!sectors.length||!schools.length) throw new Error('Empty database');
  await R('DELETE FROM accessibility_results');
  await R('DELETE FROM proposed_roads');
  const results=[],proposed=[];
  for(const sec of sectors){
    const cx=sec.lon,cy=sec.lat;if(!cx||!cy)continue;
    const nr=nearestSchool(cx,cy,schools);
    const distKm=nr?+nr.distKm.toFixed(3):99;
    const nearest=nr?.school;
    const s3km=schools.filter(s=>s.lon&&s.lat&&hav(cx,cy,s.lon,s.lat)<=3).length;
    const rs=sec.geojson?roadsIn(roads,sec.geojson):{count:0,km:0};
    const rNear=roads.filter(r=>r.lon&&r.lat&&hav(cx,cy,r.lon,r.lat)<=3);
    const rLenKm=rNear.reduce((s,r)=>s+(r.length_m||0),0)/1000;
    const connScore=+Math.min(100,(rLenKm/6)*100).toFixed(1);
    const speed=25,travelMin=+(distKm/speed*60).toFixed(1);
    const dS=+Math.max(0,Math.min(100,100-((distKm*1000-500)/9500)*100)).toFixed(1);
    const tS=+Math.max(0,Math.min(100,100-(travelMin/60)*100)).toFixed(1);
    const rS=connScore,sS=+Math.min(100,s3km*25).toFixed(1);
    const score=+(dS*0.40+tS*0.20+rS*0.20+sS*0.20).toFixed(1);
    const cls=score>=65?'Highly Accessible':score>=35?'Moderately Accessible':'Underserved';
    await R(`INSERT INTO accessibility_results(sector_id,sector_name,nearest_school_id,nearest_school_name,distance_to_nearest_school,distance_km,travel_time_minutes,road_connectivity_score,road_density,school_count_in_radius,accessibility_score,accessibility_class,dist_score,road_score,school_score,road_count,total_road_km,centroid_lon,centroid_lat,method,notes,geojson) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [sec.id,sec.name,nearest?.id,nearest?.name,distKm*1000,distKm,travelMin,rS,+(rs.km/(sec.area_sqkm||1)).toFixed(4),s3km,score,cls,dS,rS,sS,rs.count,rs.km,cx,cy,'haversine',`D:${dS} T:${tS} R:${rS} S:${sS}`,sec.geojson]);
    results.push({sector_id:sec.id,sector_name:sec.name,nearest_school_name:nearest?.name,distance_km:distKm,travel_time_minutes:travelMin,accessibility_class:cls,accessibility_score:score,centroid_lon:cx,centroid_lat:cy});
    if(cls!=='Highly Accessible'&&nearest){
      const p={priority:cls==='Underserved'?1:2,priority_label:`${sec.name} → ${nearest.name}`,estimated_length_km:+distKm.toFixed(2),benefit_score:+Math.max(0,100-distKm*10).toFixed(1),intervention_type:distKm>5?'New Road':'Road Upgrade',from_sector:sec.name,to_school:nearest.name,geojson:JSON.stringify({type:'LineString',coordinates:[[cx,cy],[nearest.lon,nearest.lat]]})};
      await R('INSERT INTO proposed_roads(priority,priority_label,estimated_length_km,benefit_score,intervention_type,status,from_sector,to_school,geojson) VALUES(?,?,?,?,?,?,?,?,?)',[p.priority,p.priority_label,p.estimated_length_km,p.benefit_score,p.intervention_type,'proposed',p.from_sector,p.to_school,p.geojson]);
      proposed.push(p);
    }
  }
  return{results,proposed};
}

const fc=(rows,gf='geojson')=>({type:'FeatureCollection',features:rows.map(r=>{const{[gf]:g,...p}=r;let geom=null;try{geom=g?JSON.parse(g):null;}catch{}return{type:'Feature',properties:p,geometry:geom};})});

app.get('/api/gis/stats',async(req,res)=>{try{const[sc,rd,sec,di,pr]=await Promise.all([G('SELECT COUNT(*) c FROM schools'),G('SELECT COUNT(*) c FROM roads'),G('SELECT COUNT(*) c FROM sectors'),G('SELECT COUNT(*) c FROM districts'),G('SELECT COUNT(*) c FROM proposed_roads')]);const rl=await G('SELECT ROUND(SUM(length_m)/1000,1) km FROM roads');let acc={highly:0,moderate:0,underserved:0};try{const r=await G("SELECT SUM(CASE WHEN accessibility_class='Highly Accessible' THEN 1 ELSE 0 END) highly,SUM(CASE WHEN accessibility_class='Moderately Accessible' THEN 1 ELSE 0 END) moderate,SUM(CASE WHEN accessibility_class='Underserved' THEN 1 ELSE 0 END) underserved FROM accessibility_results");if(r)acc=r;}catch{}res.json({schools:sc?.c||0,roads:rd?.c||0,sectors:sec?.c||0,districts:di?.c||0,proposed_roads:pr?.c||0,roadLengthKm:rl?.km||0,accessibility:acc});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/gis/schools',async(req,res)=>{try{const rows=await A('SELECT * FROM schools');res.json({type:'FeatureCollection',features:rows.map(r=>{let g=null;try{g=r.geojson?JSON.parse(r.geojson):null;}catch{}return{type:'Feature',properties:{id:r.id,name:r.name,type:r.school_type,level:r.level,sector:r.sector,district:r.district,lon:r.lon,lat:r.lat},geometry:g};})});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/gis/roads',async(req,res)=>{try{const rows=await A('SELECT * FROM roads');res.json({type:'FeatureCollection',features:rows.map(r=>{let g=null;try{g=r.geojson?JSON.parse(r.geojson):null;}catch{}return{type:'Feature',properties:{id:r.id,type:r.road_type,class:r.road_class,settlement:r.settlement,status:r.status,surface:r.surface,seasonal:r.seasonal,length_m:r.length_m},geometry:g};})});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/gis/districts',async(req,res)=>{try{res.json(fc(await A('SELECT * FROM districts')));}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/gis/sectors',async(req,res)=>{try{const rows=await A('SELECT * FROM sectors');res.json({type:'FeatureCollection',features:rows.map(r=>{let g=null;try{g=r.geojson?JSON.parse(r.geojson):null;}catch{}return{type:'Feature',properties:{id:r.id,name:r.name,district:r.district,province:r.province,area_sqkm:r.area_sqkm,lon:r.lon,lat:r.lat},geometry:g};})});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/gis/accessibility',async(req,res)=>{try{const rows=await A('SELECT * FROM accessibility_results ORDER BY accessibility_score ASC');res.json({type:'FeatureCollection',metadata:{total:rows.length,highly:rows.filter(r=>r.accessibility_class==='Highly Accessible').length,moderate:rows.filter(r=>r.accessibility_class==='Moderately Accessible').length,underserved:rows.filter(r=>r.accessibility_class==='Underserved').length},features:rows.map(r=>{let g=null;try{g=r.geojson?JSON.parse(r.geojson):null;}catch{}return{type:'Feature',properties:r,geometry:g};})});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/gis/underserved',async(req,res)=>{try{res.json(fc(await A("SELECT * FROM accessibility_results WHERE accessibility_class IN ('Underserved','Moderately Accessible') ORDER BY accessibility_score")));}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/gis/proposed-roads',async(req,res)=>{try{res.json(fc(await A('SELECT * FROM proposed_roads ORDER BY priority')));}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/gis/service-areas',async(req,res)=>{try{const radius=req.query.radius?+req.query.radius:3;res.json(fc(await A('SELECT * FROM service_areas WHERE radius_km=?',[radius])));}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/gis/nearest-school',async(req,res)=>{const{lon,lat}=req.query;if(!lon||!lat)return res.status(400).json({error:'lon and lat required'});try{const schools=await A('SELECT * FROM schools WHERE lon IS NOT NULL');const r=nearestSchool(+lon,+lat,schools);res.json({school:r?.school,distance_km:r?.distKm?.toFixed(3)});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/gis/analyze',async(req,res)=>{try{const d=await analyse();res.json({success:true,sectors:d.results.length,proposed:d.proposed.length});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/health',async(req,res)=>{try{const counts={};for(const t of['schools','roads','sectors','districts']){const r=await G(`SELECT COUNT(*) c FROM ${t}`).catch(()=>({c:0}));counts[t]=r?.c||0;}res.json({status:'ok',counts,timestamp:new Date().toISOString()});}catch(e){res.status(500).json({error:e.message});}});
app.get('/',(req,res)=>{const idx=path.join(__dirname,'public','index.html');if(fs.existsSync(idx))return res.sendFile(idx);res.send('<h2>Rwanda School Accessibility — run node build_database.js first</h2>');});

async function start(){
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Rwanda School Accessibility — Production Server           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('   PORT:', PORT);
  console.log('   DB  :', DB_PATH);
  console.log('   DATA:', DATA_DIR);
  getDB();
  if(await needsBuild()){
    console.log('\n⚠️  Database empty — attempting auto-build...');
    await autoBuild();
  }
  try{
    const d=await analyse();
    console.log('\n📊 Analysis:',d.results.length,'sectors,',d.proposed.length,'proposed roads');
    d.results.forEach(r=>console.log(`  - ${r.sector_name} [${r.accessibility_class}] ${r.distance_km}km`));
  }catch(e){console.warn('  Analysis skipped:',e.message);}
  app.listen(PORT,'0.0.0.0',()=>{
    console.log(`\n✅ Listening on http://0.0.0.0:${PORT}`);
  });
}
start().catch(e=>{console.error('❌',e.message);process.exit(1);});
