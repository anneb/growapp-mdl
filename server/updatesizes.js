var fs = require('fs');
var gm = require('gm');
//var pg = require('pg'); //postgres
var Path = require('path');


var Pool = require('pg').Pool;
var dbPool = new Pool({
  user: 'geodb',
  password: 'geodb',
  host: 'localhost',
  database: 'locophoto',
  port: 5432,
  max: 20, // max number of clients in pool
  idleTimeoutMillis: 1000 // close & remove clients which have been idle > 1 second
});


function updateSize(id, filename)
{
  filename = "./uploads/" + filename;
  gm(filename).size(function(err, imageinfo) {
    if (err) {
      console.log ("error: : " + err);
    } else {
      dbPool.query("update photo set width=$1, height=$2 where id=$3", [imageinfo.width, imageinfo.height, id])
        .catch(function(reason){
          console.log("failed to get size of file " + filename + ", reason: " + reason);
        });
    }
  });
}


function updatesizesInDatabase()
{
   // enumerate all input foto's for animation
   dbPool.query("select  id, filename from photo")
    .then(function(result){
      result.rows.forEach(function (row, index, array) {
         updateSize (row.id, row.filename);
      });
    })
    .catch(function(err){
      console.log(err);
    });
}
//resizeAllPhotosInDatabase("./upl/", "./upl/tw", 200);

updatesizesInDatabase();
//pgp.end();
