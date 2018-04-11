(function () {

    'use strict';
    var netconfig;
    var fs = require('fs-extra');
    var crypto = require('crypto');
    var Pool = require('pg').Pool;
        var dbPool = new Pool({
        user: process.env.PGUSER || 'geodb',
        password: process.env.PGPASSWORD || 'geodb',
        host: process.env.PGHOST || 'localhost',
        database: process.env.PGDATABASE || 'locophoto',
        port: process.env.PGPORT || 5432,
        max: 20, // max number of clients in pool
        idleTimeoutMillis: 1000 // close & remove clients which have been idle > 1 second
    });
    var gm = require('gm');

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

    // generates a random non-existing filename
    function getFilename (directory, extension) {
        return new Promise(function(resolve, reject){
              crypto.pseudoRandomBytes(16, function(err, raw){
                  if (err) {
                      reject(err);
                  } else {
                      var filename = raw.toString('hex') + extension;
                      var fullFilename = directory + filename;
                      if (fs.existsSync(fullFilename)) {
                          reject('file ' + filename + ' exists');
                      } else {
                          resolve({"fullfilename": fullFilename, "basename": filename});
                      }
                  }
              });
        });
    }

    async function getImageInfo(filename) {
        return new Promise(function(resolve, reject){
            gm(filename).identify(function(err, imageinfo){
                if (err) {
                    resolve();
                } else {
                    resolve(imageinfo);
                }
            });
        });
    }

    async function resizeImage(filename, width, height, type, outputFilename) {
        return new Promise(function(resolve, reject){
            gm(filename).resize(width.toString(), height.toString(), type).write(outputFilename, function(err){
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async function dbStorePhoto(photoinfo) {
        var deviceid = await getDevice(photoinfo.deviceid, photoinfo.devicehash);
        if (deviceid == 0) {
            // unknown device
            throw {"name": "unknowndeviceerror", "message": "photo upload available for registered devices only"};
        }
        var filenameObject = await getFilename(__dirname + "/uploads/", ".jpg");
        var basename = await new Promise (function(resolve, reject){
                fs.writeFile(filenameObject.fullfilename, photoinfo.photo, 'base64', function(err) {
                    if (err) {
                        reject(err);
                    }
                    resolve(filenameObject.basename);
                });
            });
        var imageInfo = await getImageInfo(filenameObject.fullfilename);
        if (!imageInfo) {
            fs.unlink(filenameObject.fullfilename);
            throw "Invalid or corrupted image";
        }
        var location = 'SRID=4326;POINT(' + photoinfo.longitude + ' ' + photoinfo.latitude + ')';
        var description = photoinfo.description ? photoinfo.description.substring(0, 400) : null;
        var tags = photoinfo.tags;
        var sqltags = tags.map(tag=>Object.entries(tag).map(keyval=>keyval.map(entry=>'"'+entry.replace('"', '')+'"').join(' => '))).join(', ');
        var sql = 'insert into photo (filename, width, height, location, accuracy, time, visible, rootid, deviceid, description, tags) values ($1, $2, $3, ST_GeomFromEWKT($4), $5, Now(), TRUE, $6, $7, $8, $9) returning id';
        var result = await dbPool.query(sql, [basename, imageInfo.size.width, imageInfo.size.height, location, parseInt(photoinfo.accuracy, 10), photoinfo.rootid, deviceid, description, sqltags]);
        var photoid = (result.rows && result.rows.length && result.rows[0].id) ? result.rows[0].id : 0;
        await resizeImage(filenameObject.fullfilename, 200, 200, '^', __dirname + "/uploads/small/" + basename);
        await resizeImage(filenameObject.fullfilename, 640, 640, '^', __dirname + "/uploads/medium/" + basename);

        return {"uri": "/uploads/" + basename, "id": photoid, "width": imageInfo.size.width, "height": imageInfo.size.height};
    }

    function getUserid (email, hash) {
        return new Promise(function (resolve, reject){
          if ((!email) || (!hash) || (email==='') || (hash==='')) {
            resolve(0);
          } else {
            var sql = 'select id from photouser where email=$1 and hash=$2';
            dbPool.query(sql, [email,hash])
              .then (function (result){
                if (result.rows.length) {
                  resolve(result.rows[0].id);
                } else {
                  resolve(0);
                }
              })
              .catch(function(err) {
                reject(err);
              });
          }
        });
    }

    function encrypt (secret)
    {
        return new Promise(function(resolve, reject){
            var cipher = crypto.createCipher('aes256', 'a password');
            var encrypted = '';
            cipher.on('readable', () => {
              var data = cipher.read();
              if (data) {
                encrypted += data.toString('hex');
              }
            });
            cipher.on('end', () => {
                resolve(encrypted);
            });
            cipher.write(secret);
            cipher.end();
        });
    }

    function dbCreateDevice(deviceInfo, deviceip) {
        return getUserid(deviceInfo.username, deviceInfo.hash)
            .then(function(userid){
            // userid = 0 if user not known
            var sql = 'insert into device (userid,deviceip) values ($1, $2) returning id';
            return dbPool.query(sql, [userid,deviceip])
                .then (function (result){
                    if (result.rows.length) {
                        var deviceid = result.rows[0].id + 3141;
                        return encrypt(deviceip + ',' + deviceid).then(function(encrypted){
                            var sql = 'update device set deviceid=$1, devicehash=$2 where id=$3';
                            return dbPool.query(sql, [deviceid, encrypted, result.rows[0].id])
                              .then(function(result){
                                return {deviceid: deviceid, devicehash: encrypted};
                              });
                        });
                    } else {
                        throw {"name": "createdeviceerror", "message": "Error creating device"};
                    }
                });
            });
    }

    function deleteFile(filename) {
        return new Promise (function(resolve, reject){
            fs.unlink(filename, function(err) {
                if (err) {
                    resolve(false);
                }
                resolve(true);
            });
        });        
    }

    async function dbDeletePhoto(id, info, clientip) {
        var userid = await getUserid(info.username, info.hash);
        var sql = "";
        var parameters = [];
        if (userid > 0) {
            sql = 'select p.filename, p.animationfilename, p.rootid from photo p, device d where p.id=$1 and p.deviceid=d.id and d.userid=$2';
            parameters = [id, userid];            
        } else {
            // user unknown, get device
            let deviceid = await getDevice(info.deviceid, info.devicehash);
            if (deviceid > 0) {
                sql = 'select p.filename, p.animationfilename, p.rootid from photo p, device d where p.id=$1 and p.deviceid=d.id and d.id=$2';
                parameters = [id, deviceid];
            } else {
                // both user and device unknown, check if clientip is trusted
                if (netconfig.trusted_ips.indexOf(clientip) < 0) {
                    throw {"name": "unknownownererror", "message": "photo delete allowed for owners only"};
                } else {
                    sql = 'select p.filename, p.animationfilename, p.rootid from photo p where p.id=$1';
                    parameters = [id];
                }
            }
        }
        var result = await dbPool.query(sql, parameters);
        if (result.rows && result.rows.length) {
            deleteFile(__dirname + '/uploads/small/' + result.rows[0].filename);
            deleteFile(__dirname + '/uploads/medium/' + result.rows[0].filename);
            if (! await deleteFile(__dirname + '/uploads/' + result.rows[0].filename)) {
                throw "failed to delete file " + result.rows[0].filename;
            }

        }
        return {"file": result.rows[0].filename, "id": id, "deleted": true};
    }
    
    function tagStringToArray(tagstring)
    {
      if (tagstring) {
          return tagstring.split(', ').map(function(item){var keyval=item.split('=>').map(function(s){return s.replace(/"/g, '');}); var result={}; result[keyval[0]]=keyval[1]; return result;});
      } else {
       return [];
      }
    }

    function getDevice(deviceid, devicehash)
    {
        return new Promise(function(resolve, reject){
            if ((!deviceid) || (!devicehash)) {
                resolve(0);
            } else {
                var sql = 'select id from device where deviceid=$1 and devicehash=$2';
                dbPool.query(sql, [deviceid,devicehash])
                    .then (function (result){
                        if (result.rows.length) {
                            resolve(result.rows[0].id);
                        } else {
                            resolve(0);
                        }
                    })
                    .catch(function(err) {
                        reject(err);
                    });
            }
        });
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
    
    
    class Photodb {
        constructor() 
        { 
            this.getPhotos = function(id)
            {
                var sql;
                if (id) {
                    sql = 'select id, ST_AsGeoJSON(location) geom, accuracy, isroot, filename, time, width, height, description, tags from photo where visible=true and id=$1';
                    return dbPool.query(sql, [id])
                        .then(function(result){
                            return createCollection(result.rows, null, null);
                        });
                } else {
                    sql = 'select id, ST_AsGeoJSON(location) geom, accuracy, isroot, filename, time, width, height, description, tags from photo where visible=true and rootid=0';
                    return dbPool.query(sql)
                        .then(function(result) {
                            return createCollection(result.rows, null, null);
                    });
                }
            };
            this.storePhoto = function (photoinfo) {
                return dbStorePhoto(photoinfo).then(function(result){
                    return (result);
                });                
            };
            this.deletePhoto = function(id, info, clientip) {
                return dbDeletePhoto(id, info, clientip);
            };
            this.createDevice = function(deviceInfo, deviceip) {
                return dbCreateDevice(deviceInfo, deviceip);
            };
        }
    };

    module.exports = function (config) { netconfig = config; return new Photodb();};

})();