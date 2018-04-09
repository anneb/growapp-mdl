(function () {

    'use strict';
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

    function _writePhoto(photodata){
        return new Promise(function(resolve, reject){
            var filename = "out.png";
            //fs.writeFile(filename, new Buffer(photodata, 'base64').toString('binary'), 'binary', function(err) {
                fs.writeFile(filename, photodata, 'base64', function(err) {
                if (err) {
                    reject(err);
                }
                resolve(filename);
              });
        });
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

    function _createDevice(deviceInfo, deviceip) {
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
                        throw "Error creating device";
                    }
                });
            });
    }

    function _deletePhoto(photo) {
        // 
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
            this.createPhoto = function (photoinfo) {
                return _writePhoto(photoinfo.photo).then(function(filename){
                    return ({"filename": filename});
                });
            };
            this.deletePhoto = function(photo) {
                return _deletePhoto(photo);
            };
            this.createDevice = function(deviceInfo, deviceip) {
                return _createDevice(deviceInfo, deviceip);
            };
        }
    };

    module.exports = new Photodb();

})();