'use strict';
const shapefile = require('shapefile');
const sqlite3   = require('sqlite3').verbose();
const path      = require('path');
const fs        = require('fs');
const proj4     = require('proj4');

const DB_PATH  = path.join(process.env.HOME,'Desktop/School_Accessibility_Data/spatial_gis.db');
const DATA_DIR = path.join(process.env.HOME,'Desktop/DATA');

proj4.defs('EPSG:4326','+proj=longlat +datum=WGS84 +no_defs');
proj4.defs('RWANDA_TM','+proj=tmerc +lat_0=0 +lon_0=30 +k=0.9999 +x_0=500000 +y_0=5000000 +ellps=GRS80 +units=m +no_defs');

function readPrj(p){const f=p.replace('.shp','.prj');return fs.existsSync(f)?fs.readFileSync(f,'utf8').trim():'';}
function epsg(prj){
  const u=(prj||'').toUpperCase();
  if(u.includes('ZONE_36')) return 'EPSG:32736';
  if(u.includes('GEOGRAPH')||u.includes('DEGREE')) return 'EPSG:4326';
  return 'RWANDA_TM';
}
proj4.defs('EPSG:32736','+proj=utm +zone=36 +south +datum=WGS84 +units=m +no_defs');

function isWGS84(c){return c[0]>=27&&c[0]<=32&&c[1]>=-4&&c[1]<=0;}
function toWGS(c,src){
  if(src==='EPSG:4326'||isWGS84(c)) return [+c[0].toFixed(7),+c[1].toFixed(7)];
  try{const r=proj4(src,'EPSG:4326',[c[0],c[1]]);
    if(r[0]>=27&&r[0]<=32&&r[1]>=-4&&r[1]<=0) return [+r[0].toFixed(7),+r[1].toFixed(7)];}catch{}
  return [+c[0].toFixed(7),+c[1].toFixed(7)];
}
function cvtG(g,src){
  if(!g) return null;
  const cv=c=>toWGS(c,src), rng=r=>r.map(cv);
  if(g.type==='Point')           return {...g,coordinates:cv(g.coordinates)};
  if(g.type==='LineString')      return {...g,coordinates:rng(g.coordinates)};
  if(g.type==='MultiLineString') return {...g,coordinates:g.coordinates.map(rng)};
  if(g.type==='Polygon')         return {...g,coordinates:g.coordinates.map(rng)};
  if(g.type==='MultiPolygon')    return {...g,coordinates:g.coordinates.map(p=>p.map(rng))};
  return g;
}
function cen(g){
  try{
    let c=[];
    if(g.type==='Point') return g.coordinates;
    if(g.type==='Polygon') c=g.coordinates[0];
    else if(g.type==='MultiPolygon') c=g.coordinates[0][0];
    else if(g.type==='LineString') c=g.coordinates;
    else if(g.type==='MultiLineString') c=g.coordinates[0];
    if(!c.length) return [0,0];
    return [+(c.reduce((s,x)=>s+x[0],0)/c.length).toFixed(7),
            +(c.reduce((s,x)=>s+x[1],0)/c.length).toFixed(7)];
  }catch{return [0,0];}
}
function llen(c){
  let l=0;
  for(let i=1;i<c.length;i++){
    const dx=(c[i][0]-c[i-1][0])*111320*Math.cos(c[i][1]*Math.PI/180);
    const dy=(c[i][1]-c[i-1][1])*111320;
    l+=Math.sqrt(dx*dx+dy*dy);
  }
  return l;
}
function parea(c){
  if(!c||!c[0]||c[0].length<3) return 0;
  const r=c[0];let a=0;
  for(let i=0;i<r.length-1;i++) a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];
  return Math.abs(a/2)*111.32*111.32;
}
async function readShp(fp){
  const feats=[];
  const src=await shapefile.open(fp);
  let r=await src.read();
  while(!r.done){if(r.value)feats.push(r.value);r=await src.read();}
  return feats;
}
function dbR(db,sql,p=[]){return new Promise((res,rej)=>db.run(sql,p,function(e){e?rej(e):res(this);}));}

async function main(){
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Building Rwanda GIS Database                ║');
  console.log('╚══════════════════════════════════════════════╝');

  if(fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const db=new sqlite3.Database(DB_PATH);
  await dbR(db,'PRAGMA journal_mode=WAL');

  const tbls=[
    `CREATE TABLE schools(id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,school_type TEXT,level TEXT,sector TEXT,district TEXT,province TEXT,
      capacity INTEGER DEFAULT 0,lon REAL,lat REAL,geojson TEXT,properties TEXT)`,
    `CREATE TABLE roads(id INTEGER PRIMARY KEY AUTOINCREMENT,
      road_type TEXT,road_class TEXT,settlement TEXT,status TEXT,surface TEXT,
      seasonal INTEGER DEFAULT 0,length_m REAL,lon REAL,lat REAL,geojson TEXT,properties TEXT)`,
    `CREATE TABLE districts(id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,area_sqkm REAL,lon REAL,lat REAL,geojson TEXT,properties TEXT)`,
    `CREATE TABLE sectors(id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,district TEXT,province TEXT,sect_id TEXT,
      area_sqkm REAL,lon REAL,lat REAL,geojson TEXT,properties TEXT)`,
    `CREATE TABLE study_area(id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,area_sqkm REAL,lon REAL,lat REAL,geojson TEXT,properties TEXT)`,
    `CREATE TABLE accessibility_results(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sector_id INTEGER,sector_name TEXT,
      nearest_school_id INTEGER,nearest_school_name TEXT,
      distance_to_nearest_school REAL,distance_km REAL,
      travel_time_minutes REAL,road_connectivity_score REAL,
      road_density REAL,school_count_in_radius INTEGER,
      accessibility_score REAL,accessibility_class TEXT,
      dist_score REAL,road_score REAL,school_score REAL,
      road_count INTEGER DEFAULT 0,total_road_km REAL DEFAULT 0,
      centroid_lon REAL,centroid_lat REAL,
      method TEXT DEFAULT 'network',notes TEXT,
      analysis_date TEXT DEFAULT(datetime('now')),geojson TEXT)`,
    `CREATE TABLE proposed_roads(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      priority INTEGER,priority_label TEXT,
      estimated_length_km REAL,benefit_score REAL,
      intervention_type TEXT,status TEXT DEFAULT 'proposed',
      from_sector TEXT,to_school TEXT,geojson TEXT)`,
    `CREATE TABLE service_areas(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER,school_name TEXT,
      radius_km REAL,geojson TEXT)`,
    `CREATE TABLE villages(id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,population INTEGER DEFAULT 0,lon REAL,lat REAL,geojson TEXT)`,
  ];
  for(const s of tbls) await dbR(db,s);
  console.log('✅ Tables created\n');

  const imports=[
    {file:'Existing_Roads.shp',              table:'roads'},
    {file:'Existiong_Educations.shp',         table:'schools'},
    {file:'Northern_Districts_Boundaries.shp',table:'districts'},
    {file:'Study_Area.shp',                   table:'sectors'},
    {file:'Northern_Boundary.shp',            table:'study_area'},
  ];

  for(const {file,table} of imports){
    const fp=path.join(DATA_DIR,file);
    if(!fs.existsSync(fp)){console.log('⚠️  Missing:',file);continue;}
    const src=epsg(readPrj(fp));
    const feats=await readShp(fp);
    console.log('📄',file,'→',table,'|',src,'|',feats.length,'features');

    await new Promise((done)=>{
      db.serialize(()=>{
        db.run('BEGIN');
        let cnt=0,pend=feats.length;
        if(!pend){db.run('COMMIT');done();return;}
        feats.forEach((f)=>{
          if(!f.geometry){pend--;if(!pend){db.run('COMMIT');done();}return;}
          const g=cvtG(f.geometry,src);
          const p=f.properties||{};
          const [lon,lat]=cen(g);
          const gj=JSON.stringify(g);
          const pr=JSON.stringify(p);
          let sql,vals;

          if(table==='roads'){
            const coords=g.type==='MultiLineString'?g.coordinates.flat():g.coordinates||[];
            // Use actual field names from shapefile
            sql=`INSERT INTO roads(road_type,road_class,settlement,status,surface,seasonal,length_m,lon,lat,geojson,properties) VALUES(?,?,?,?,?,?,?,?,?,?,?)`;
            vals=[
              p.Type||p.CLASS||p.Class||'rural',
              p.Class||p.CLASS||'Other road',
              p.Settlement||'Rural',
              p.Status||'unknown',
              p.SurfaceDis||'unpaved',
              (p.Seasonal_1||'').toLowerCase().includes('yes')?1:0,
              +llen(coords).toFixed(1),lon,lat,gj,pr
            ];
          } else if(table==='schools'){
            // Use actual field names: School_Nam, School_lev, Type, SECTOR, District, PROVINCE
            sql=`INSERT INTO schools(name,school_type,level,sector,district,province,capacity,lon,lat,geojson,properties) VALUES(?,?,?,?,?,?,?,?,?,?,?)`;
            vals=[
              p.School_Nam||p.S||p.name||'School',
              p.Type||p.School_Typ||'primary',
              p.School_lev||'primary',
              p.SECTOR||p.Sector||'',
              p.District||p.DISTRICT||'',
              p.PROVINCE||p.Province||'',
              0,lon,lat,gj,pr
            ];
          } else if(table==='districts'){
            sql=`INSERT INTO districts(name,area_sqkm,lon,lat,geojson,properties) VALUES(?,?,?,?,?,?)`;
            vals=[p.District||p.DISTRICT||p.Dist_Name||'District',
              +parea(g.type==='MultiPolygon'?g.coordinates[0]:g.coordinates).toFixed(2),lon,lat,gj,pr];
          } else if(table==='sectors'){
            // Use actual field names: Sector, District, Province, Sect_ID
            sql=`INSERT INTO sectors(name,district,province,sect_id,area_sqkm,lon,lat,geojson,properties) VALUES(?,?,?,?,?,?,?,?,?)`;
            vals=[
              p.Sector||p.SECTOR||p.Sect_Nam||'Sector',
              p.District||p.DISTRICT||'Musanze',
              p.Province||p.PROVINCE||'Northern',
              String(p.Sect_ID||p.SECT_ID||''),
              +parea(g.type==='MultiPolygon'?g.coordinates[0]:g.coordinates).toFixed(2),
              lon,lat,gj,pr
            ];
          } else {
            sql=`INSERT INTO study_area(name,area_sqkm,lon,lat,geojson,properties) VALUES(?,?,?,?,?,?)`;
            vals=[p.Province||p.Prov_Name||'Northern Province',
              +parea(g.type==='MultiPolygon'?g.coordinates[0]:g.coordinates).toFixed(2),lon,lat,gj,pr];
          }

          db.run(sql,vals,function(err){
            if(!err) cnt++;
            pend--;
            if(!pend) db.run('COMMIT',()=>{console.log('   ✅',cnt,'records');done();});
          });
        });
      });
    });
  }

  // Show sector names
  console.log('\n📍 Sectors:');
  await new Promise(res=>db.all('SELECT id,name,district,ROUND(lon,4) lon,ROUND(lat,4) lat,ROUND(area_sqkm,1) area FROM sectors',[],(e,rows)=>{
    (rows||[]).forEach(r=>console.log('  ',r.id,r.name,'|',r.district,'|','['+r.lon+','+r.lat+']',r.area+'km²'));
    res();
  }));

  console.log('\n🏫 School sample:');
  await new Promise(res=>db.all('SELECT id,name,level,sector,ROUND(lon,4) lon,ROUND(lat,4) lat FROM schools LIMIT 6',[],(e,rows)=>{
    (rows||[]).forEach(r=>console.log('  ',r.id,r.name,'|',r.level,'|',r.sector,'|','['+r.lon+','+r.lat+']'));
    res();
  }));

  console.log('\n🛣️  Road sample:');
  await new Promise(res=>db.all('SELECT id,road_class,settlement,status,ROUND(length_m) len FROM roads LIMIT 5',[],(e,rows)=>{
    (rows||[]).forEach(r=>console.log('  ',r.id,r.road_class,'|',r.settlement,'|',r.status,'|',r.len+'m'));
    res();
  }));

  db.close(()=>console.log('\n✅ Database built successfully\n   Run: node server.js'));
}
main().catch(e=>{console.error('❌',e.message);process.exit(1);});
