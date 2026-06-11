const proj4 = require("proj4");

const rwandaTM =
"+proj=tmerc +lat_0=0 +lon_0=30 +k=0.9999 +x_0=500000 +y_0=5000000 +ellps=GRS80 +units=m +no_defs";

const wgs84 = "EPSG:4326";

function convert(x, y) {
    return proj4(rwandaTM, wgs84, [x, y]);
}

console.log(convert(464619, 4832208));
