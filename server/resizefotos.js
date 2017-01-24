var fs = require('fs');
var gm = require('gm');
//var pg = require('pg'); //postgres
var pgp = require('pg-promise')();
var Path = require('path');

var db = pgp("postgres://geodb:geodb@localhost:5432/locophoto");


function resizePhoto(filename, outputdir, pixelsize)
{
  if (fs.existsSync(filename)) {
    var smallfilename = Path.join(outputdir, Path.parse(filename).base);
    //var writeStream = fs.createWriteStream (smallfilename);
    gm(filename).resize(pixelsize).write(smallfilename,
          function(err) {
            if (err) {
              console.log("Error resizing file " + filename + ", message: " + err);
            }
            //writeStream.close();
            console.log(smallfilename);
    });
  } else {
    console.log("file not found: " + filename);
  }
}

function resizeAllPhotosInDatabase(inpath, outpath, pixelsize)
{
    db.query("select  id, filename from photo order by time")
      .then(function(rows){
        rows.forEach(function (row, index, array) {
         resizePhoto (inpath + row.filename, outpath, pixelsize);
        });
      })
      .catch(function(err){
        console.log(err);
      });
}

// creates or updates an animated gif from a set of photos linked to the the
// photo with id of rootid
function updateAnimation(rootid, path)
{
       // enumerate all input foto's for animation
       db.query("select  id, time, filename from photo where id=$1 or rootid=$1 order by time", [rootid])
        .then(function(rows){
          if (rows.length > 0) {
            // at least one photo found, create animation
            var outputfilename = Path.join(path, Path.parse(rows[0].filename).name + ".gif");
            console.log(outputfilename);
              var graphicsMagic = gm();

              // do NOT use rows.forEach() here!
              for (var i = 0; i < rows.length; i++) {
                var fullfilename = Path.join(path, rows[i].filename);
                // do not use async exists or stat here!
                if (fs.existsSync(fullfilename)) {
                    graphicsMagic.in('-delay', 100).in(fullfilename);
                } else {
                    return console.log("file " + fullfilename + " is missing")
                }
              }
            //console.log("FINAL ARGS: " + graphicsMagic.args());
            graphicsMagic.write(outputfilename, function(err){
              if (err) {
                console.log("hiero: " + err);
              } else {
                db.query("update photo set animationfilename=$1 where id=$2", [Path.parse(outputfilename).base, rootid])
                  .catch(function(err){
                    console.log(err);
                  })
              }
            });
          }
        })
        .catch(function(err){
          console.log(err);
        });
}


function recreateAllAnimationsFromDatabase()
{
   // enumerate all input foto's for animation
   db.query("select  distinct rootid from photo where rootid > 0")
    .then(function(rows){
      rows.forEach(function (row, index, array) {
         updateAnimation (row.rootid, "./upl/tw/");
      });
    })
    .catch(function(err){
      console.log(err);
    });
}
//resizeAllPhotosInDatabase("./upl/", "./upl/tw", 200);

recreateAllAnimationsFromDatabase();
//pgp.end();
