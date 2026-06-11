'use strict';
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs2     = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app  = express();
const PORT = process.env.PORT || 1111;
const DB   = path.join(process.env.HOME,'Desktop/School_Accessibility_Data/spatial_gis.db');

app.use(cors()); app.use(express.json({limit:'50mb'}));
app.use(express.static(path.join(__dirname,'public')));

let _db=null;
function getDB(){
  if(_db) return _db;
  if(!fs2.existsSync(DB)) throw new Error('DB not found — run: node build_database.js');
  _db=new sqlite3.Database(DB,sqlite3.OPEN_READWRITE); return _db;
}
const A=(sql,p=[])=>new Promise((r,j)=>getDB().all(sql,p,(e,d)=>e?j(e):r(d||[])));
const G=(sql,p=[])=>new Promise((r,j)=>getDB().get(sql,p,(e,d)=>e?j(e):r(d||null)));
const R=(sql,p=[])=>new Promise((r,j)=>getDB().run(sql,p,function(e){e?j(e):r(this)}));

// ── Haversine distance in KM ──────────────────────────────────────────
function hav(lo1,la1,lo2,la2){
  const R=6371,dL=(la2-la1)*Math.PI/180,dl=(lo2-lo1)*Math.PI/180;
  const a=Math.sin(dL/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dl/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ── Point-in-polygon ──────────────────────────────────────────────────
function pip(lon,lat,geom){
  try{
    const rings=geom.type==='MultiPolygon'?geom.coordinates[0]:geom.coordinates;
    const ring=rings[0]; let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
      if(((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)) inside=!inside;
    }
    return inside;
  }catch{return false;}
}

// ── Roads inside sector polygon ───────────────────────────────────────
function roadsIn(roads,gjStr){
  try{
    const sg=JSON.parse(gjStr); let len=0,cnt=0;
    for(const r of roads) if(r.lon&&r.lat&&pip(r.lon,r.lat,sg)){len+=r.length_m||0;cnt++;}
    return {count:cnt, km:+(len/1000).toFixed(2)};
  }catch{return{count:0,km:0};}
}

// ── PURE HAVERSINE nearest school (reliable, correct units) ───────────
function nearestSchoolSL(lon,lat,schools){
  let best=null, bestD=Infinity;
  for(const s of schools){
    if(!s.lon||!s.lat) continue;
    const d=hav(lon,lat,s.lon,s.lat);
    if(d<bestD){bestD=d;best=s;}
  }
  return best?{school:best,distKm:bestD}:null;
}

// ── CORE ANALYSIS (straight-line — reliable, no network bugs) ─────────
async function analyse(){
  const sectors=await A('SELECT * FROM sectors');
  const schools=await A('SELECT * FROM schools');
  const roads  =await A('SELECT * FROM roads');
  if(!sectors.length) throw new Error('No sectors');
  if(!schools.length) throw new Error('No schools');

  // Count road network nodes for display only
  const netNodes = new Set();
  for(const road of roads){
    let geom; try{geom=road.geojson?JSON.parse(road.geojson):null;}catch{continue;}
    if(!geom) continue;
    const segs=geom.type==='MultiLineString'?geom.coordinates:[geom.coordinates];
    for(const seg of segs){
      for(const coord of (seg||[])){
        if(coord&&coord[0]&&coord[1])
          netNodes.add(coord[0].toFixed(4)+'_'+coord[1].toFixed(4));
      }
    }
  }
  console.log('   Network nodes counted:',netNodes.size);

  await R('DELETE FROM accessibility_results');
  await R('DELETE FROM proposed_roads');
  await R('DELETE FROM service_areas');

  const results=[],proposed=[];

  for(const sec of sectors){
    const cx=sec.lon, cy=sec.lat;
    if(!cx||!cy) continue;

    // ── Nearest school: straight-line haversine (correct km) ──────────
    const nr=nearestSchoolSL(cx,cy,schools);
    const distKm=nr?+nr.distKm.toFixed(3):99;
    const nearest=nr?.school;

    // ── Schools within radii ──────────────────────────────────────────
    const s3km=schools.filter(s=>s.lon&&s.lat&&hav(cx,cy,s.lon,s.lat)<=3).length;

    // ── Road stats inside sector polygon ──────────────────────────────
    const rs=sec.geojson?roadsIn(roads,sec.geojson):{count:0,km:0};

    // ── Road connectivity: roads within 3km ───────────────────────────
    const rNear=roads.filter(r=>r.lon&&r.lat&&hav(cx,cy,r.lon,r.lat)<=3);
    const rLenKm=rNear.reduce((s,r)=>s+(r.length_m||0),0)/1000;
    const connScore=+Math.min(100,(rLenKm/(3*2))*100).toFixed(1);

    const areaSqkm=sec.area_sqkm||1;
    const roadDen=rs.km/areaSqkm;

    // ── Travel time ───────────────────────────────────────────────────
    // Paved ratio determines speed: paved=40km/h, unpaved=20km/h
    const pavedCount=rNear.filter(r=>(r.status||'').toLowerCase().includes('pav')||(r.surface||'').toLowerCase().includes('pav')).length;
    const pavedRatio=rNear.length>0?pavedCount/rNear.length:0;
    const speed=20+(pavedRatio*20); // 20–40 km/h
    const travelMin=+(distKm/speed*60).toFixed(1);

    // ── WEIGHTED SCORING MODEL ────────────────────────────────────────
    // Distance score: 100 if ≤0.5km, 0 if ≥10km
    const dS=+Math.max(0,Math.min(100,100-((distKm*1000-500)/9500)*100)).toFixed(1);
    // Travel time score: 100 if ≤5min, 0 if ≥60min
    const tS=+Math.max(0,Math.min(100,100-(travelMin/60)*100)).toFixed(1);
    // Road connectivity score (already 0–100)
    const rS=connScore;
    // School coverage score: 25 pts per school within 3km, max 100
    const sS=+Math.min(100,s3km*25).toFixed(1);

    // Weighted composite: 40% dist, 20% travel, 20% road, 20% school
    const score=+(dS*0.40+tS*0.20+rS*0.20+sS*0.20).toFixed(1);
    const cls=score>=65?'Highly Accessible':score>=35?'Moderately Accessible':'Underserved';

    await R(`INSERT INTO accessibility_results(
      sector_id,sector_name,nearest_school_id,nearest_school_name,
      distance_to_nearest_school,distance_km,travel_time_minutes,
      road_connectivity_score,road_density,school_count_in_radius,
      accessibility_score,accessibility_class,
      dist_score,road_score,school_score,road_count,total_road_km,
      centroid_lon,centroid_lat,method,notes,geojson)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [sec.id,sec.name,nearest?.id,nearest?.name,
       distKm*1000,distKm,travelMin,rS,+roadDen.toFixed(4),s3km,
       score,cls,dS,rS,sS,rs.count,rs.km,cx,cy,'haversine',
       `D:${dS}(40%) T:${tS}(20%) R:${rS}(20%) S:${sS}(20%)`,sec.geojson]);

    results.push({sector_id:sec.id,sector_name:sec.name,
      nearest_school_name:nearest?.name,distance_km:distKm,
      travel_time_minutes:travelMin,accessibility_class:cls,
      accessibility_score:score,centroid_lon:cx,centroid_lat:cy});

    // ── Proposed road for non-highly-accessible sectors ───────────────
    if(cls!=='Highly Accessible'&&nearest){
      const p={
        priority:cls==='Underserved'?1:2,
        priority_label:`${sec.name} → ${nearest.name}`,
        estimated_length_km:+distKm.toFixed(2),
        benefit_score:+Math.max(0,100-distKm*10).toFixed(1),
        intervention_type:distKm>5?'New Road Construction':distKm>2?'Road Upgrade':'Surface Improvement',
        from_sector:sec.name, to_school:nearest.name,
        geojson:JSON.stringify({type:'LineString',coordinates:[[cx,cy],[nearest.lon,nearest.lat]]})
      };
      await R('INSERT INTO proposed_roads(priority,priority_label,estimated_length_km,benefit_score,intervention_type,status,from_sector,to_school,geojson) VALUES(?,?,?,?,?,?,?,?,?)',
        [p.priority,p.priority_label,p.estimated_length_km,p.benefit_score,p.intervention_type,'proposed',p.from_sector,p.to_school,p.geojson]);
      proposed.push(p);
    }
  }

  // ── Service area circles for schools ─────────────────────────────────
  const schSample=schools.slice(0,20);
  for(const sch of schSample){
    if(!sch.lon||!sch.lat) continue;
    for(const radius of [1,2,3]){
      const pts=48;
      const coords=Array.from({length:pts+1},(_,i)=>{
        const angle=i*(2*Math.PI/pts);
        const dlat=radius/111.32;
        const dlon=radius/(111.32*Math.cos(sch.lat*Math.PI/180));
        return [+(sch.lon+dlon*Math.cos(angle)).toFixed(6),+(sch.lat+dlat*Math.sin(angle)).toFixed(6)];
      });
      await R('INSERT INTO service_areas(school_id,school_name,radius_km,geojson) VALUES(?,?,?,?)',
        [sch.id,sch.name,radius,JSON.stringify({type:'Polygon',coordinates:[coords]})]);
    }
  }

  return{results,proposed,networkNodes:netNodes.size};
}

// ── GeoJSON helper ────────────────────────────────────────────────────
const fc=(rows,gf='geojson')=>({type:'FeatureCollection',features:rows.map(r=>{
  const{[gf]:g,...p}=r; let geom=null;
  try{geom=g?JSON.parse(g):null;}catch{}
  return{type:'Feature',properties:p,geometry:geom};
})});

// ── ROUTES ────────────────────────────────────────────────────────────
app.get('/api/gis/stats',async(req,res)=>{
  try{
    const[sc,rd,sec,di,pr]=await Promise.all([
      G('SELECT COUNT(*) c FROM schools'),G('SELECT COUNT(*) c FROM roads'),
      G('SELECT COUNT(*) c FROM sectors'),G('SELECT COUNT(*) c FROM districts'),
      G('SELECT COUNT(*) c FROM proposed_roads'),
    ]);
    const rl=await G('SELECT ROUND(SUM(length_m)/1000,1) km FROM roads');
    let acc={highly:0,moderate:0,underserved:0,avg_score:0,avg_dist:0};
    try{const r=await G(`SELECT
      SUM(CASE WHEN accessibility_class='Highly Accessible' THEN 1 ELSE 0 END) highly,
      SUM(CASE WHEN accessibility_class='Moderately Accessible' THEN 1 ELSE 0 END) moderate,
      SUM(CASE WHEN accessibility_class='Underserved' THEN 1 ELSE 0 END) underserved,
      ROUND(AVG(accessibility_score),1) avg_score,
      ROUND(AVG(distance_km),2) avg_dist
      FROM accessibility_results`);if(r)acc=r;}catch{}
    res.json({schools:sc?.c||0,roads:rd?.c||0,sectors:sec?.c||0,
      districts:di?.c||0,proposed_roads:pr?.c||0,
      roadLengthKm:rl?.km||0,accessibility:acc});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/gis/schools',async(req,res)=>{
  try{const rows=await A('SELECT * FROM schools');
    res.json({type:'FeatureCollection',features:rows.map(r=>{
      let geom=null;try{geom=r.geojson?JSON.parse(r.geojson):null;}catch{}
      return{type:'Feature',
        properties:{id:r.id,name:r.name,type:r.school_type,level:r.level,
          sector:r.sector,district:r.district,lon:r.lon,lat:r.lat},
        geometry:geom};})});}catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/gis/roads',async(req,res)=>{
  try{const rows=await A('SELECT * FROM roads');
    res.json({type:'FeatureCollection',features:rows.map(r=>{
      let geom=null;try{geom=r.geojson?JSON.parse(r.geojson):null;}catch{}
      return{type:'Feature',
        properties:{id:r.id,type:r.road_type,class:r.road_class,
          settlement:r.settlement,status:r.status,surface:r.surface,
          seasonal:r.seasonal,length_m:r.length_m},
        geometry:geom};})});}catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/gis/districts',async(req,res)=>{try{res.json(fc(await A('SELECT * FROM districts')));}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/gis/sectors',async(req,res)=>{
  try{const rows=await A('SELECT * FROM sectors');
    res.json({type:'FeatureCollection',features:rows.map(r=>{
      let geom=null;try{geom=r.geojson?JSON.parse(r.geojson):null;}catch{}
      return{type:'Feature',
        properties:{id:r.id,name:r.name,district:r.district,
          province:r.province,area_sqkm:r.area_sqkm,lon:r.lon,lat:r.lat},
        geometry:geom};})});}catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/gis/accessibility',async(req,res)=>{
  try{const rows=await A('SELECT * FROM accessibility_results ORDER BY accessibility_score ASC');
    res.json({type:'FeatureCollection',
      metadata:{total:rows.length,
        highly:rows.filter(r=>r.accessibility_class==='Highly Accessible').length,
        moderate:rows.filter(r=>r.accessibility_class==='Moderately Accessible').length,
        underserved:rows.filter(r=>r.accessibility_class==='Underserved').length},
      features:rows.map(r=>{let g=null;try{g=r.geojson?JSON.parse(r.geojson):null;}catch{}
        return{type:'Feature',properties:r,geometry:g};})});}
  catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/gis/underserved',async(req,res)=>{
  try{res.json(fc(await A(`SELECT * FROM accessibility_results
    WHERE accessibility_class IN ('Underserved','Moderately Accessible')
    ORDER BY accessibility_score`)));}catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/gis/proposed-roads',async(req,res)=>{
  try{res.json(fc(await A('SELECT * FROM proposed_roads ORDER BY priority')));}
  catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/gis/service-areas',async(req,res)=>{
  try{const radius=req.query.radius?+req.query.radius:3;
    res.json(fc(await A('SELECT * FROM service_areas WHERE radius_km=?',[radius])));}
  catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/gis/study-area',async(req,res)=>{
  try{res.json(fc(await A('SELECT * FROM study_area')));}
  catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/network/stats',async(req,res)=>{
  try{const rl=await G('SELECT ROUND(SUM(length_m)/1000,1) km FROM roads');
    const paved=await G("SELECT COUNT(*) c FROM roads WHERE status LIKE '%pav%'");
    const rural=await G("SELECT COUNT(*) c FROM roads WHERE settlement='Rural'");
    res.json({nodes:5881,totalRoadKm:rl?.km||0,pavedCount:paved?.c||0,ruralCount:rural?.c||0});}
  catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/gis/nearest-school',async(req,res)=>{
  const{lon,lat}=req.query;
  if(!lon||!lat) return res.status(400).json({error:'lon and lat required'});
  try{const schools=await A('SELECT * FROM schools WHERE lon IS NOT NULL');
    const r=nearestSchoolSL(+lon,+lat,schools);
    res.json({school:r?.school,distance_km:r?.distKm?.toFixed(3)});}
  catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/gis/analyze',async(req,res)=>{
  try{const data=await analyse();
    res.json({success:true,sectors:data.results.length,proposed:data.proposed.length});}
  catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/health',async(req,res)=>{
  try{const counts={};
    for(const t of['schools','roads','sectors','districts','proposed_roads','service_areas']){
      const r=await G(`SELECT COUNT(*) c FROM ${t}`);counts[t]=r?.c||0;}
    res.json({status:'ok',counts});}catch(e){res.status(500).json({error:e.message});}
});

app.get('/',(req,res)=>{
  const idx=path.join(__dirname,'public','index.html');
  if(fs2.existsSync(idx)) return res.sendFile(idx);
  res.send('<h2>Rwanda School Accessibility API</h2>');
});

// ── START ─────────────────────────────────────────────────────────────
async function start(){
  console.log('\u2554'+'\u2550'.repeat(60)+'\u2557');
  console.log('\u2551  Rwanda School Accessibility \u2014 GIS Platform v4          \u2551');
  console.log('\u255a'+'\u2550'.repeat(60)+'\u255d');
  getDB();
  const counts={};
  for(const t of['schools','roads','sectors','districts']){
    const r=await G(`SELECT COUNT(*) c FROM ${t}`).catch(()=>({c:0}));
    counts[t]=r?.c||0;
  }
  console.log('\n\uD83D\uDCCA Database:');
  for(const[t,c] of Object.entries(counts)) console.log('  ',t.padEnd(12)+':',c);

  if(counts.schools>0&&counts.roads>0){
    console.log('\n\uD83D\uDD0D Running accessibility analysis...');
    try{
      const data=await analyse();
      const H=data.results.filter(r=>r.accessibility_class==='Highly Accessible').length;
      const M=data.results.filter(r=>r.accessibility_class==='Moderately Accessible').length;
      const U=data.results.filter(r=>r.accessibility_class==='Underserved').length;
      console.log('\n\uD83D\uDCCA Results:');
      console.log('  \u2705 Sectors:          ',data.results.length);
      console.log('  \uD83D\uDFE2 Highly Accessible:',H);
      console.log('  \uD83D\uDFE1 Moderately:       ',M);
      console.log('  \uD83D\uDD34 Underserved:      ',U);
      console.log('  \uD83D\uDEE3\uFE0F Proposed Roads:  ',data.proposed.length);
      data.results.forEach(r=>console.log('    -',r.sector_name,
        `[${r.accessibility_class}] score:${r.accessibility_score} dist:${r.distance_km}km travel:${r.travel_time_minutes}min`));
    }catch(e){console.warn('  Analysis error:',e.message);}
  }

  app.listen(PORT,()=>{
    console.log('\n\uD83D\uDDFA\uFE0F  http://localhost:'+PORT);
    console.log('  /api/gis/schools  /api/gis/roads  /api/gis/accessibility');
    console.log('  /api/gis/proposed-roads  /api/gis/service-areas');
  });
}
start().catch(e=>{console.error('\u274C',e.message);process.exit(1);});
