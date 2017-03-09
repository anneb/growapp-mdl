"use strict";
/* global require, console, __dirname, Promise, Buffer */
var express = require('express');
var fs = require('fs');
var bodyParser = require('body-parser');
var multer = require('multer'); // for  enctype="multipart/form-data"
//var im = require('imagemagick');
//var im = require('gm'); // graphicsMagic
var crypto = require('crypto');
//var pg = require('pg'); //postgres
var Path = require('path');
var cors = require('cors');
var nodemailer = require('nodemailer');
var gm = require('gm');

var app = express();


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

app.use(bodyParser.urlencoded({extended: true, limit: '50mb'}));
app.use(bodyParser.json());

app.get('/photoserver/version', cors(), function(req, res){
  console.log('GET /photoserver/version');
  res.json({major: 1, minor: 0, revision: 0});
});

// get method, explain user to use post method
app.get('/photoserver/sendphoto', cors(), function(req, res){
    //console.log('GET /photoserver/sendphoto');
    //var html = '<html><body><form method="post" action="http://localhost:3100">Name: <input type="text" name="name" /><input type="submit" value="Submit" /></form></body>';
    var html = fs.readFileSync('sendphoto.html');
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html);
});

app.get('/photoserver/logposition', cors(), function(req, res) {
  console.log('GET /photoserver/logposition');
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end('ok');
});

function FeatureCollection(message, errno){
    this.type = 'FeatureCollection';
    this.features = [];
        if (message) {
                this.message = message;
        }
        if (errno) {
                this.errorcode = errno;
        }
}

function tagStringToArray(tagstring)
{
  if (tagstring) {
      return tagstring.split(', ').map(function(item){var keyval=item.split('=>').map(function(s){return s.replace(/"/g, '');}); var result={}; result[keyval[0]]=keyval[1]; return result;});
  } else {
   return [];
  }
}

function createCollection(features, message, errno) {
        var featureCollection = new FeatureCollection(message, errno);

        for (var i = 0; i < features.length; i++)
        {
            featureCollection.features.push({ 'type': 'Feature',
              'geometry': JSON.parse(features[i].geom),
              'properties': {
                      id: features[i].id,
                      filename: features[i].filename,
                      isroot: features[i].isroot,
                      accuracy: features[i].accuracy,
                      time: features[i].time,
                      width: features[i].width,
                      height: features[i].height,
		                  description: features[i].description,
                      tags: tagStringToArray(features[i].tags)
              }
            });
        }
        return featureCollection;
}

app.get('/photoserver/getallphotos', cors(), function(req, res) {
  console.log('GET /photoserver/getallphotos');
  var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  if (ip != '80.113.1.130') {
    res.writeHead(403, {'Content-Type': 'text/html'});
    res.end('error: access denied');
    return;
  }
  var page = req.query.page;
  var pageSize = 200;
  var sql = 'select id, filename, deviceid, time from photo order by time desc limit $1 offset $2';
  dbPool.query(sql, [pageSize, pageSize*page])
    .then(function(result) {
      res.json(result.rows);
      res.end();
    })
    .catch(function(reason) {
      console.log(reason);
      res.writeHead(500, {'Content-Type': 'text/html'});
      res.end('error: ' + reason);
    });
});

app.get('/photoserver/getphotos', cors(), function(req, res) {
  console.log('GET /photoserver/getphotos');
  var hashtags = req.query.hashtags;
  if (hashtags) {
    if (RegExp(/[^a-zA-Z\d\s#,]/).test(hashtags)) {
      // invalid characters in hashtags
      res.json(createCollection([], null, null));
      res.end();
      return;
    }
    hashtags = hashtags.replace(' ', '').split(',').filter(function(hashtag) {return hashtag.substr(0,1) == '#';}).map(function(hashtag){return hashtag+'\\y';}).join('|');
  }
  var sql;
  if (hashtags && hashtags != '') {
    sql = 'with tab as (select distinct case when rootid <> 0 then rootid else id end foundid from photo where description ~* $1) select id, ST_AsGeoJSON(location) geom, accuracy, isroot, case when animationfilename is null then filename else animationfilename end filename, time, width, height, description, tags from photo,tab where tab.foundid=photo.id and visible=true;';
    dbPool.query(sql, [hashtags])
      .then(function(result) {
        res.json(createCollection (result.rows, null, null));
        res.end();
      })
      .catch(function(reason){
        console.log(reason);
        res.writeHead(500, {'Content-Type': 'text/html'});
        res.end('error: ' + reason);
      });
  } else {
    sql = 'select id, ST_AsGeoJSON(location) geom, accuracy, isroot, case when animationfilename is null then filename else animationfilename end filename, time, width, height, description, tags from photo where visible=true and rootid=0';
    dbPool.query(sql)
      .then(function(result) {
        res.json(createCollection (result.rows, null, null));
        res.end();
      })
      .catch(function(reason){
        console.log(reason);
        res.writeHead(500, {'Content-Type': 'text/html'});
        res.end('error: ' + reason);
      });
  }
});

app.post('/photoserver/getphotoset', cors(), function(req, res) {
  console.log('POST /photoserver/getphotoset');
  var photoid = req.body.photoid;
  var sql = 'select id, accuracy, filename, time, width, height, description, tags from photo where rootid=$1 or id=$1 order by time';
  dbPool.query(sql, [photoid])
    .then(function(result){
      result.rows.forEach(function(row){
        row.tags = tagStringToArray(row.tags);
      });
      res.json(result.rows);
      res.end();
    })
    .catch(function(reason){
      console.log(reason);
      res.writeHead(500, {'Content-Type' : 'text/html'});
      res.end('error: ' + reason);
    });
});


app.post('/photoserver/getmyphotos', cors(), function(req, res) {
  console.log('POST /photoserver/getmyphotos');
  var username = req.body.username;
  var hash = req.body.hash;
  var deviceid = req.body.deviceid;
  var devicehash = req.body.devicehash;

  username = username.toLowerCase().trim().replace("'", '');
  hash = hash.trim().replace("'", '');

  getUserid(username, hash)
    .then(function(userid){
      var sql;
      var params;
      if (userid === 0) {
        // user not registered on device
        if (!deviceid || deviceid === '' || !devicehash || devicehash === '') {
          res.writeHead(403, {'Content-Type': 'text/html'});
          res.end('error: missing parameters');
          return;
        }
        sql = 'select p.id, p.filename, p.time, p.width, p.height from photo p, device d where p.deviceid=d.id and d.deviceid=$1 and d.devicehash=$2 order by time';
        params = [deviceid, devicehash];
      } else {
        // user registerd on device
        sql = 'select p.id, p.filename, p.time, p.width, p.height from photo p, device d, photouser u where p.deviceid=d.id and d.userid=u.id and u.email=$1 and u.hash=$2 order by time';
        params = [username, hash];
      }
      dbPool.query(sql, params)
        .then (function (result){
          res.json(result.rows);
          res.end();
        })
        .catch(function(reason){
          console.log(reason);
          res.writeHead(500, {'Content-Type': 'text/html'});
          res.end('error: ' + reason);
        });
    });
});

app.post('/photoserver/rotatemyphoto', cors(), function(req, res) {
  console.log('POST /photoserver/rotatemyphoto');
  var username = req.body.username;
  var hash = req.body.hash;
  var deviceid = req.body.deviceid;
  var devicehash = req.body.devicehash;
  var filename = req.body.filename;
  var degrees = req.body.degrees;

  username = username.toLowerCase().trim().replace("'", '');
  hash = hash.trim().replace("'", "");

  getUserid(username, hash)
    .then(function(userid) {
      var sql, parameters;
      if (userid > 0) {
        // user known
        sql = 'select p.id, p.filename, p.width, p.height from photo p, device d where p.filename=$1 and p.deviceid=d.id and d.userid=$2';
        parameters = [filename, userid];
      } else {
        // user not known, check if device is known
        if (!deviceid || deviceid === '' || !devicehash || devicehash === '') {
            res.writeHead(403, {
                'Content-Type': 'text/html'
            });
            res.end('error: missing parameters');
            return;
        }
        sql = 'select p.id, p.filename, p.width, p.height from device d, photo p where d.deviceid=$1 and d.devicehash=$2 and p.deviceid=d.id and p.filename=$3';
        parameters = [deviceid, devicehash, filename];
      }
      dbPool.query(sql, parameters)
        .then(function(result){
          if (result.rows.length === 1)  {
            var d = (degrees == '90') ? 90 : -90;
            var filename = './uploads/' + result.rows[0].filename;
            gm(filename).rotate('white', d).write(filename, function(err){
              if (err) {
                res.writeHead(500, {'Content-Type' : 'text/html'});
                res.end('unable to rotate image');
                return;
              }
              var width = result.rows[0].height;
              var height = result.rows[0].width;
              sql = 'update photo set width=$1, height=$2 where id=$3';
              dbPool.query(sql, [width, height, result.rows[0].id])
                .then(function (result2){
                  filename = './uploads/small/' + result.rows[0].filename;
                  gm(filename).rotate('white', d).write(filename, function(err) {
                    if (err) {
                      res.writeHead(500, {'Content-Type' : 'text/html'});
                      res.end('unable to rotate small image');
                      return;
                    } else {
                      filename = './uploads/medium/' + result.rows[0].filename;
                      gm(filename).rotate('white', d).write(filename, function(err) {
                        if (err) {
                          res.writeHead(500, {'Content-Type' : 'text/html'});
                          res.end('unable to rotate medium image');
                          return;
                        } else {
                          res.end('image rotated');
                        }
                      });
                    }
                  });
                });
            });
          } else {
            // photo not found
            res.writeHead(403, {
                'Content-Type': 'text/html'
            });
            res.end('photo not found or invalid credentials');
          }
        });
    });
}); // rotatemyphoto

app.post('/photoserver/deletemyphoto', cors(), function(req, res) {
    console.log('POST /photoserver/deletemyphoto');
    var username = req.body.username;
    var hash = req.body.hash;
    var deviceid = req.body.deviceid;
    var devicehash = req.body.devicehash;
    var filename = req.body.filename;

    username = username.toLowerCase().trim().replace("'", '');
    hash = hash.trim().replace("'", '');

    getUserid(username, hash)
      .then(function(userid) {
        var sql, parameters;
        if (userid > 0) {
          // user known
          sql = "select p.id, p.animationfilename, p.rootid from photo p, device d where p.filename=$1 and p.deviceid=d.id and d.userid=$2";
          parameters = [filename, userid];
        } else {
          // user not known, check if device is known
          if (!deviceid || deviceid === '' || !devicehash || devicehash === '') {
              res.writeHead(403, {
                  'Content-Type': 'text/html'
              });
              res.end('error: missing parameters');
              return;
          }
          sql = "select p.id, p.animationfilename, p.rootid from device d, photo p where d.deviceid=$1 and d.devicehash=$2 and p.deviceid=d.id and p.filename=$3";
          parameters = [deviceid, devicehash, filename];
        }
        // find photo
        dbPool.query(sql, parameters)
            .then(function(result) {
                if (result.rows.length > 0) {
                    // photo found
                    var photoid = result.rows[0].id;
                    var animationfilename = result.rows[0].animationfilename;
                    var rootid = result.rows[0].rootid;
                    var sql = 'delete from photo where id=$1';
                    dbPool.query(sql, [photoid])
                        .then(function(result) {
                            // photo deleted from table, now delete from disk
                            fs.unlink(__dirname + '/uploads/small/' + filename, function(err) {;});
                            fs.unlink(__dirname + '/uploads/medium/' + filename, function(err) {;});
                            fs.unlink(__dirname + '/uploads/' + filename, function(err, result) {
                                if (err) {
                                    console.log("failed to delete file " + __dirname + '/uploads/' + filename);
                                    res.writeHead(500, {
                                        'Content-Type': 'text/html'
                                    });
                                    res.end("Error deleting " + filename + " from disk");
                                } else {
                                    res.writeHead(200, {
                                        'Content-Type': 'text/html'
                                    });
                                    res.end('photo removed: ' + filename);
                                    // check if this photo was part of an animation
                                    if (animationfilename) {
                                      // this photo was first photo of an animation
                                      fs.unlink(__dirname + '/uploads/small/' + animationfilename, function(err) {;});
                                      fs.unlink(__dirname + '/uploads/medium/' + animationfilename, function(err) {;});
                                      fs.unlink(__dirname + '/uploads/' + animationfilename, function(err, result) {
                                        if (err) {
                                          console.log("failed to delete animation file " + animationfilename);
                                        }
                                      });
                                      // list remaining photos in animation
                                      sql = "select id, filename from photo where rootid=$1 or id=$1 order by time";
                                      dbPool.query(sql, [photoid])
                                        .then(function(result){
                                          if (result.rows.length > 0) {
                                            // store id of new first photo in animation
                                            var newrootid = result.rows[0].id;
                                            sql = "update photo set rootid=0, animationfilename=null, isroot=false where id=$1";
                                            dbPool.query(sql, [newrootid])
                                              .then(function(){
                                                // reset rootid of rest of photos in animation
                                                sql = "update photo set rootid=$1 where rootid=$2";
                                                dbPool.query(sql, [newrootid, photoid])
                                                  .then(function() {
                                                    updateAnimation(newrootid, "./uploads");
                                                });
                                              });
                                          }
                                        });
                                    } else if (rootid) {
                                      // this photo was somewhere in animation
                                      sql = "select id, filename, animationfilename from photo where id=$1 or rootid=$1 order by time";
                                      dbPool.query(sql, [rootid])
                                        .then(function(result){
                                          if (result.rows.length > 1) {
                                            updateAnimation(rootid, "./uploads");
                                          } else if (result.rows.length == 1) {
                                            // only one photo, remove animation
                                            var animationfilename = result.rows[0].animationfilename;
                                            if (animationfilename) {
                                              sql = "update photo set animationfilename=null, rootid=0, isroot=false where id=$1";
                                              dbPool.query(sql, [result.rows[0].id])
                                                .then(function(){
                                                  fs.unlink(__dirname + '/uploads/small/' + animationfilename, function(err) {;});
                                                  fs.unlink(__dirname + '/uploads/medium/' + animationfilename, function(err) {;});
                                                  fs.unlink(__dirname + '/uploads/' + animationfilename, function(err, result){
                                                    if (err) {
                                                      console.log("failed to delete animation file " + animationfilename);
                                                    }
                                                  });
                                                });
                                            }
                                          }
                                        });
                                    }
                                }
                            });
                        })
                        .catch(function(reason) {
                            // error deleting photo from database
                            console.log(reason);
                            res.writeHead(500, {
                                'Content-Type': 'text/html'
                            });
                            res.end('error: ' + reason);
                        });
                } else {
                    // photo not found
                    res.writeHead(403, {
                        'Content-Type': 'text/html'
                    });
                    res.end('photo not found or invalid credentials');
                }
            })
            .catch(function(reason) {
                console.log(reason);
                res.writeHead(500, {
                    'Content-Type': 'text/html'
                });
                res.end('Internal Error: ' + reason);
            });
      });
}); // app.post

// helper to prefix number with zero's
function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

//helper to get validationcode for user
function getValidationCode(email, callback) {
    // callback(err, validationcode)

    var sql = "select validationcode from photouser where email=$1";
    dbPool.query(sql, [email])
        .then(function(result) {
            var validationcode = null;

            if (result.rows.length > 0) {
                validationcode = result.rows[0].validationcode;
                callback(null, validationcode);
            } else {
                // user does not yet exist
                crypto.pseudoRandomBytes(4, function(err, raw) {
                    if (err) {
                        callback(err);
                    } else {
                        validationcode = pad(Math.floor((parseInt(raw.toString('hex'), 16) / 4294967295) * 99999), 5);
                        sql = "insert into photouser (email, validated, validationcode, retrycount) values ($1, false, $2, 0)";
                        dbPool.query(sql, [email, validationcode])
                            .then(function(result) {
                                // new user inserted
                                callback(null, validationcode);
                            })
                            .catch(function(reason) {
                                // insert new user failed
                                callback(reason);
                            });
                    }
                }); // crypto
            }
        })
        .catch(function(reason) {
            callback(reason);

        });
}


function emailValidationCode  (email, validationcode, callback) {
  var transporter = nodemailer.createTransport({
    host: "localhost",
    port: 25,
    /*auth: {
        user: user,
        pass: pass
    },
    tls:{
        rejectUnauthorized: false
    }*/
    domain : "localhost",            // domain used by client to identify itself to server
    secure : false,
    ignoreTLS: true,
    authentication: false
  });
  transporter.sendMail({
    to : email,
    from : "anne.blankert@geodan.nl",
    subject : "Validation code for locophoto app",
    text: "validatiecode is: " + validationcode,
    html: "<h1>"+validationcode+"</h1>"
  },
  function(err, info){
    if(err){
      callback(err);
    } else {
      callback(null, info);
    }
  });
}

// creates a new user if it does not yet exist and sends a validation code by email
app.post('/photoserver/validatemail', cors(), multer().array(), function (req, res){
  console.log('POST /photoserver/validatemail');
  var email = req.body.email;

  email = email.trim().toLowerCase().replace("'", "");
  getValidationCode (email, function(err, validationcode){
    if (err) {

    } else {
      console.log('validationcode = ' + validationcode);
      emailValidationCode (email, validationcode, function (err, info) {
        if (err) {
          res.writeHead(500, {'Content-Type': 'text/html'});
          res.end('Error:' + JSON.stringify(err));
        } else {
          res.writeHead(200, {'Content-Type': 'text/html'});
          res.end('validation code sent by email');
        }
      });
    }
  });
});

function linkUserToDevice(username, deviceid, devicehash)
{
    // store user with device if user is on known device
    if (deviceid && deviceid !== '' && devicehash && devicehash !== '') {
      var sql = "update device set userid=(select id from photouser where email=$1 limit 1) where deviceid=$2 and devicehash=$3";
      dbPool.query(sql, [username, deviceid, devicehash]);
    }
}

// validates previously added user
app.post('/photoserver/validateuser', cors(), multer().array(), function(req, res) {
    console.log('POST /photoserver/validateuser');
    var username = req.body.email;
    var validationcode = req.body.validationcode;

    if (!username || username === '' || !validationcode || validationcode === '') {
        res.writeHead(500, {
            'Content-Type': 'text/html'
        });
        res.end('error: missing parameters');
        return;
    }

    username = username.toLowerCase().trim().replace("'", "");
    validationcode = validationcode.trim().replace("'", "");

    var sql = "select email, validationcode, retrycount, hash from photouser where email=$1";
    dbPool.query(sql, [username])
        .then(function(result) {
            if (result.rows.length === 0) {
                // user not found
                res.writeHead(500, {
                    'Content-Type': 'text/html'
                });
                res.end('error: user does not exist');
            } else {
                // user found
                // check retries
                if (result.rows[0].retrycount > 5) {
                    res.writeHead(200, {
                        'Content-Type': 'text/html'
                    });
                    res.end('too many attempts');
                } else {
                    // check validationcode
                    if (validationcode == result.rows[0].validationcode) {
                        if (result.rows[0].hash && result.rows[0].hash !== '') {
                          // hash already created
                          res.end(result.rows[0].hash);
                          linkUserToDevice(username, req.body.deviceid, req.body.devicehash);
                        } else {
                          // generate new hash
                          crypto.pseudoRandomBytes(16, function(err, raw) {
                              if (err) {

                              } else {
                                  // store hash
                                  var hash = raw.toString('hex');
                                  sql = "update photouser set hash=$1, retrycount=0 where email=$2";
                                  dbPool.query(sql, [hash, username])
                                      .then(function(result) {
                                          // return hash
                                          //res.json({"hash" : hash});
                                          res.end(hash);
                                          linkUserToDevice(username, req.body.deviceid, req.body.devicehash);
                                      });
                              }
                          }); // crypto
                        }
                    } else {
                        // wrong code, increment retrycount
                        sql = "update photouser set retrycount=retrycount+1 where email=$1";
                        dbPool.query(sql, [username])
                            .then(function(result) {
                                res.writeHead(200, {
                                    'Content-Type': 'text/html'
                                });
                                res.end('wrong code');
                            }); // client
                    }
                } // check retrycount
            } // check user
        })
        .catch(function(reason) {
            console.log(reason);
            res.writeHead(500, {
                'Content-Type': 'text/html'
            });
            res.end('error: ' + reason);
        });
});

// generates a random non-existing filename
function getFilename (directory, extension, retrycount, cb) {
    if (retrycount > 0) {
      crypto.pseudoRandomBytes(16, function (err, raw) {
        var filename = directory + raw.toString('hex') + extension;
        if (fs.existsSync(filename)) {
          return getFilename(directory, extension, retrycount - 1, cb);
        } else {
          cb(err, err ? undefined : filename);
          return;
        }
      });
    } else {
      // callback with error
      cb ("file exists", undefined);
    }
}

// creates or updates an animated gif from a set of photos linked to the the
// photo with id of rootid
function updateAnimation(rootid, path)
{
       // enumerate all input foto's for animation
       var sql = "select  id, time, filename from photo where id=$1 or rootid=$1 order by time";
       dbPool.query(sql, [rootid])
          .then(function (result){
            if (result.rows.length > 1) {
              // at least two photos found, create animation
              var outputfilename = Path.parse(result.rows[0].filename).name + ".gif";
              var graphicsMagic = gm();
              for (var i = 0; i < result.rows.length; i++) {
                console.log(result.rows[i].filename);
                graphicsMagic.in('-delay', 100).in(Path.join(path, result.rows[i].filename));
              }
              graphicsMagic.write('uploads/' + outputfilename, function(err){
                if (err) {
                  console.log("Failed to create animation: " + err);
                } else {
                    sql = "update photo set animationfilename=$1, isroot=true where id=$2";
                    console.log("hier: " + sql);
                    dbPool.query(sql, [outputfilename, rootid])
                      .catch(function(reason) {
                        console.log("failed to insert animationfilename: " + reason);
                      });
                }
              });
            }
         })
         .catch(function(reason){
               console.log("error getting animation files: " + reason);
         });
}

function getUserid (email, hash) {
  return new Promise(function (fulfill, reject){
    if ((!email) || (!hash) || (email==="") || (hash==="")) {
      fulfill(0);
    } else {
      var sql = "select id from photouser where email=$1 and hash=$2";
      dbPool.query(sql, [email,hash])
        .then (function (result){
          if (result.rows.length) {
            fulfill(result.rows[0].id);
          } else {
            fulfill(0);
          }
        })
        .catch(function(err) {
          reject(err);
        });
    }
  });
}

function checkDevice(deviceid, devicehash)
{
  return new Promise(function(fulfill, reject){
    if ((!deviceid) || (!devicehash)) {
      fulfill(0);
    } else {
      var sql = "select id from device where deviceid=$1 and devicehash=$2";
      dbPool.query(sql, [deviceid,devicehash])
        .then (function (result){
          if (result.rows.length) {
            fulfill(result.rows[0].id);
          } else {
            fulfill(0);
          }
        })
        .catch(function(err) {
          reject(err);
        });
    }
  });
}

app.post('/photoserver/checkuser', cors(), function(req, res) {
  console.log('POST /photoserver/checkuser');
  getUserid(req.body.email, req.body.hash)
    .then(function(id) {
      if (id > 0) {
        res.json({knownuser: true});
        /* temporary ? side effect: store user with device */
        var deviceid = req.body.deviceid;
        var devicehash = req.body.devicehash;
        if (deviceid && deviceid != '' && devicehash && devicehash !== '') {
          var sql = "update device set userid=$1 where deviceid=$2 and devicehash=$3";
          dbPool.query(sql, [id, deviceid, devicehash]);
        }
      } else {
        res.json({knownuser: false});
      }
    })
    .catch(function(err) {
      res.json({knownuser: false, error: err});
    });
});

app.post('/photoserver/sendphoto', cors(), function(req, res) {
    console.log('POST /photoserver/sendphoto');

    // see if this upload uses file upload
    if (req.files && req.files.photo) {
        console.log('File uploaded to: ' + req.files.photo.path);
        res.writeHead(200, {
            'Content-Type': 'text/html'
        });
        res.end('File uploaded to: ' + req.files.photo.path);
    } else {
        getFilename(__dirname + '/uploads/', ".jpg", 1, function(err, filename) {
            if (!err) {
                fs.writeFile(filename, new Buffer(req.body.photo, 'base64'), 'binary', function(err) {
                    if (err) {
                        console.log("Image Error: ", err);
                        res.writeHead(500, {
                            'Content-Type': 'text/html'
                        });
                        res.end("Server error: ", err);
                    } else {
                        var username = req.body.username;
                        var hash = req.body.hash;
                        var deviceid = req.body.deviceid;
                        var devicehash = req.body.devicehash;
                        var shortfilename = Path.basename(filename);
                        var latitude = req.body.latitude;
                        var longitude = req.body.longitude;
                        var accuracy = parseInt(req.body.accuracy, 10);
                        var location = 'SRID=4326;POINT(' + longitude + ' ' + latitude + ')';
                        var rootid = req.body.rootid;
                        var description = '';
                        if (req.body.description) {
                            try {
                              description = req.body.description.substring(0,400);
                            } catch(e) {
                              ;
                            }
                        }
                        var tags=[];
                        if (req.body.tags) {
                          try {
                            tags = JSON.parse(req.body.tags);
                          } catch(e) {
                            ;
                          }
                        }
                        if (typeof rootid == 'undefined') {
                            rootid = 0;
                        }
                        gm(filename).size(function(err, imageinfo) {
                          if (err) {
                            res.writeHead(500, {
                              'Content-Type': 'text/html'
                            });
                            res.end("Error: invalid photo, could not get size: " + err);
                            console.log ("error: : " + err);
                            fs.unlink(filename, function(err){;});
                          } else {
                            console.log("username=" + username + ", hash=" + hash + ", filename=" + shortfilename + ", width: " + imageinfo.width + ", height: " + imageinfo.height + ", location=" + location + ", accuracy=" + accuracy + ", rootid=" + rootid + ", deviceid=" + deviceid + ", devicehash="  + devicehash);
                            //var sql = "insert into photo (filename, location, accurary) values ('"+shortfilename+"','"+ location + "'," + accuracy + ")";
                            checkDevice(deviceid, devicehash)
                                .then(function(result) {
                                    if (result > 0) {
                                        var deviceid = result;
                                        var tagstring = '';
                                        for (var i = 0; i < tags.length; i++) {
                                          var tag = tags[i];
                                          for (var name in tag) {
                                            if (tagstring !== '') {
                                              tagstring += ',';
                                            }
                                            tagstring += '"' + name.replace('"', '') + '" => "' + tag[name].replace('"', '') +  '"';
                                          }
                                        }
                                        var sql = "insert into photo (filename, width, height, location, accuracy, time, visible, rootid, deviceid, description, tags) values ($1, $2, $3, ST_GeomFromEWKT($4), $5, Now(), TRUE, $6, $7, $8, $9)";
                                        dbPool.query(sql, [shortfilename, imageinfo.width, imageinfo.height, location, accuracy, rootid, deviceid, description, tagstring])
                                            .catch(function(reason) {
                                                console.log(reason);
                                                res.writeHead(500, {
                                                    'Content-Type': 'text/html'
                                                });
                                                res.end('Internal Error: ' + reason);
                                                fs.unlink(filename, function(err){;});
                                            })
                                            .then(function(result) {
                                                console.log('photo inserted!');
                                                gm(filename).resize('200', '200', '^').write(__dirname + '/uploads/small/' + shortfilename,
                                                    function(err) {
                                                      if (err) {
                                                        console.log('failed to create small image');
                                                      } else {
                                                        gm(filename).resize('640', '640', '^').write(__dirname + '/uploads/medium/' + shortfilename,
                                                          function(err) {
                                                            if (err) {
                                                              console.log('failed to create medium image');
                                                            }
                                                          });
                                                      }
                                                      fs.writeFile(filename.slice(0, -5) + ".dat", JSON.stringify({
                                                            latitude: req.body.latitude,
                                                            longitude: req.body.longitude,
                                                            accuracy: req.body.accuracy
                                                        }), function(err) {
                                                            if (err) {
                                                                res.writeHead(500, {
                                                                    'Content-Type': 'text/html'
                                                                });
                                                                res.end('Server error:', err);
                                                                fs.unlink(filename, function(err){;});
                                                                fs.unlink(__dirname + '/uploads/small/' + shortfilename, function(err) {;});
                                                                fs.unline(__dirname + '/uploads/medium/' + shortfilename, function(err) {;});
                                                            } else {
                                                                res.writeHead(200, {
                                                                    'Content-Type': 'text/html'
                                                                });
                                                                res.end('thanks');
                                                            }
                                                        });
                                                    });
                                                if (rootid > 0) {
                                                    updateAnimation(rootid, "./uploads");
                                                }
                                            });
                                    } else {
                                        // user not valid?
                                        res.writeHead(403, {
                                            'Content-Type': 'text/html'
                                        });
                                        res.end('Access denied: device not known or invalid credentials');
                                        fs.unlink(filename, function(err){;});
                                    }
                                }); // checkDevice
                          } // valid photo
                        }); // gm().size()
                    }
                }); // fs.writeFile
            } else {
                console.log('GetFilename error: ' + err);
                res.writeHead(500, {
                    'Content-Type': 'text/html'
                });
                res.end('Server error: ', err);
            }
        }); // getFilename
    }
}); // sendphoto

app.post('/photoserver/createdevice', cors(), function (req, res){
  console.log('/photoserver/createdevice');
  var username = req.body.username;
  var hash = req.body.hash;
  var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  if (ip.substr(0, 7) == "::ffff:") {
    ip = ip.substr(7);
  }
  getUserid(username, hash)
    .then(function(userid){
      var sql = "insert into device (userid,deviceip) values ($1, $2) returning id";
      dbPool.query(sql, [userid,ip])
        .then (function (result){
          if (result.rows.length) {
            var deviceid = result.rows[0].id + 3141;
            var cipher = crypto.createCipher('aes256', 'a password');
            var encrypted = "";
            cipher.on('readable', () => {
              var data = cipher.read();
              if (data)
                encrypted += data.toString('hex');
            });
            cipher.on('end', () => {
                console.log(encrypted);
                sql = "update device set deviceid=$1, devicehash=$2 where id=$3";
                dbPool.query(sql, [deviceid, encrypted, result.rows[0].id])
                  .then(function(result){
                    res.json({deviceid: deviceid, devicehash: encrypted});
                  });
            });
            cipher.write(ip + "," + deviceid);
            cipher.end();
          } else {
            console.log("id not returned?");
          }
        })
        .catch(function(err){
          res.end(err.message);
        });
    })
    .catch(function(err){
      // handle error
    });
}); // createdevice


// get list of tagids and tagtext for the given langcode
app.get('/photoserver/taglist', cors(), function(req, res){
    console.log('/photoserver/taglist');
    var langcode = req.query.langcode;
    var sql = 'select tagid, tagtext from tags where langcode=$1 and active=TRUE';
    dbPool.query(sql, [langcode])
      .then (function (result){
          if (result.rows) {
              res.json(result.rows);
          }
      })
      .catch(function(err){
         res.end(err.message);
      });
});

var port = 3100;
app.listen(port);
console.log('Listening at http://localhost:' + port);
