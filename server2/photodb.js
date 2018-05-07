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
    var nodemailer = require('nodemailer');

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

    function isNumeric(n)
    {
        return !isNaN(parseFloat(n)) && isFinite(n);
    }

    function emailValidationCode  (email, validationcode) {
        var transporter = nodemailer.createTransport({
          host: netconfig.smtpserver,
          port: netconfig.smtpport,
          auth: {
              user: netconfig.smtpuser,
              pass: netconfig.smtppassword
          },
          tls:{
              rejectUnauthorized: false
          },
          domain : netconfig.smtpdomain,            // domain used by client to identify itself to server
          secure : false,
          ignoreTLS: true,
          authentication: false
        });
        return new Promise (function(resolve, reject){
            transporter.sendMail({
                to : email,
                from : 'no-reply@growapp.today',
                subject : 'Validation code for GrowApp',
                text: 'validationcode is: ' + validationcode,
                html: '<h1>'+validationcode+'</h1>'
              },
              function(err, info){
                if(err){
                  reject(err);
                } else {
                  resolve(info);
                }
              });
        });
      }
      

    function validateEmail(email) {
        var re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        return re.test(email);
    }

    function checkPhotoInfo(info)
    {
        if (info.hasOwnProperty('latitude') && info.hasOwnProperty('longitude') && info.hasOwnProperty('accuracy') && info.hasOwnProperty('rootid') && info.hasOwnProperty('deviceid') && info.hasOwnProperty('devicehash')) {
            return isNumeric(info.latitude) && isNumeric(info.longitude) && isNumeric(info.accuracy) && isNumeric(info.deviceid) && info.devicehash.length && info.devicehash.length>4;
        } else {
            return false;
        }
    }

    async function dbStorePhoto(photoinfo) {
        if (!checkPhotoInfo(photoinfo)){
            throw {"name": "unprocessable", "message": "missing or bad upload parameters"};
        };
        var deviceid = await getDevice(photoinfo.deviceid, photoinfo.devicehash);
        if (deviceid == 0) {
            // unknown device
            throw {"name": "unknowndevice", "message": "photo upload available for registered devices only"};
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
        if (photoinfo.rootid > 0) {
            sql = "update photo set isroot=true where id=$1 returning id";
            result = await dbPool.query(sql, [photoinfo.rootid]);
            if (result.rows[0].id != photoinfo.rootid) {
                throw {"name": "photonotfound", "message": "rootid of uploaded photo not valid"};
            }
        }

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

    /**
     * @description creates or updates a client device
     * @param {object} deviceInfo containing info.username, info.hash 
     * @param {string} deviceip ip of the client device
     * @returns {object} object.deviceid, object.devicehash
     */
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
                        throw {"name": "createdevicefailed", "message": "Error creating device"};
                    }
                });
            });
    }

    // helper to prefix number with zero's
    function pad(n, width, z) {
        z = z || '0';
        n = n + '';
        return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
    }
  
    /**
     * @description get single user or all users
     * @param {object} userinfo using userinfo.username and username.hash for single user, trustedip for all users
     * @param {string} clientIp ip of client
     * @returns array of userinfo
     */
    async function dbGetUsers(userinfo, clientip) {
        var sql, params;
        if (netconfig.trusted_ips.indexOf(clientip) > -1) {
            // trusted clientIp, list all users
            sql = "select email, displayname, validated, allowmailing from photouser";
            params = [];
        } else {
            var userId = await getUserid(userinfo.username, userinfo.hash);
            if (userId > 0) {
                sql = "select email, displayname, validated, allowmailing from photouser where id=$1";
                params = [userId];
            } else {
                throw {"name": "unknowuser", "message": "userinfo allowed for registered users only"};
            }
        }
        var result = await dbPool.query(sql, params);
        return {"users": result.rows};
    }
    
    /**
     * @description creates or updates user for device, emails a verification code
     * @param {object} userinfo 
     * @returns {object} ok
     */
    async function dbCreateUser(userinfo) {
        var deviceId = await getDevice(userinfo.deviceid, userinfo.devicehash);
        if (deviceId == 0) {
            throw {"name": "unknowndevice", "message": "create user is available for registered devices only"};
        }
        var sql;
        if (!(userinfo.hasOwnProperty('allowmailing') && userinfo.hasOwnProperty('displayname'))) {
            throw {"name": "unprocessable", "message": "missing or bad upload parameters"};
        }
        var allowmailing = userinfo.allowmailing ? true : false;
        var validationcode;
        if (userinfo.username && userinfo.username.length > 5 && validateEmail(userinfo.username)) {
            sql = "select id, validationcode from photouser where email=$1";
            let result = await dbPool.query(sql, [userinfo.username.toLowerCase()]);
            if (result.rows.length) {
                // user already known
                validationcode = result.rows[0].validationcode;                
            } else {
                // new user
                sql = "insert into photouser (email,displayname,validated,validationcode,hash,retrycount,allowmailing) values ($1,$2,false,$3,'',0,$4)";
                var raw = crypto.randomBytes(4);
                validationcode = pad(Math.floor((parseInt(raw.toString('hex'), 16) / 4294967295) * 99999), 5);
                await dbPool.query(sql, [userinfo.username.toLowerCase(), userinfo.displayname, validationcode, userinfo.allowmailing]);
            }
        } else {
            throw {"name": "unprocessable", "message": "email not provided or invalid"};
        }
        var info = await emailValidationCode(userinfo.username, validationcode);
        return { "message": "validationcode mailed to " + userinfo.username};
    }

    async function linkUserToDevice(email, deviceid, devicehash)
    {
        // store user with device if user is on known device
        if (deviceid && deviceid !== '' && devicehash && devicehash !== '') {
            var sql = 'update device set userid=(select id from photouser where email=$1 limit 1) where deviceid=$2 and devicehash=$3';
            await dbPool.query(sql, [email.toLowerCase(), deviceid, devicehash]);
        }
    }


    async function dbUpdateUser(userinfo) {
        var sql;
        var deviceId = 0;
        var userId = 0;
        var hash = userinfo.hash;
        if (userinfo.deviceid && userinfo.devicehash) {
            deviceId = await getDevice(userinfo.deviceid, userinfo.devicehash);
        }
        if (userinfo.username && hash) {
            userId = await getUserid(userinfo.username, userinfo.hash);
        }
        if (userId == 0) {
            if (userinfo.validationcode && userinfo.username && userinfo.username.length > 5 && validateEmail(userinfo.username)) {
                sql = "select id, validationcode, retrycount, hash from photouser where email=$1";
                var result = await dbPool.query(sql, [userinfo.username.toLowerCase()]);
                if (result.rows.length) {
                    if (result.rows[0].retrycount > 5) {
                        throw {"name": "userlocked", "message": "too many failed validation attemps, contact support"};
                    }
                    if (userinfo.validationcode != result.rows[0].validationcode) {
                        sql = "update photouser set retrycount=retrycount+1 where email=$1";
                        await dbPool.query(sql, [userinfo.username.toLowerCase()]);
                        throw {"name": "validationfailed", "message": "wrong validationcode, check and try again"};
                    }
                    // validation succeeded
                    if (result.rows[0].hash && result.rows[0].hash.length > 5) {
                        // keep previously created hash
                        hash = result.rows[0].hash;
                    } else {
                        // create new hash
                        var raw = crypto.randomBytes(16);
                        hash = raw.toString('hex');
                    }    
                    // reset retrycount and update hash
                    sql = 'update photouser set hash=$1, retrycount=0, validated=true where email=$2';
                    await dbPool.query(sql, [hash, userinfo.username.toLowerCase()]);
                    userId = result.rows[0].id;
                }
            } else {
                throw {"name": "unprocessable", "message": "email and/or validationcode not provided or invalid"};
            }
        }
        if (userId > 0) {
            // user known
            if (deviceId > 0) {
                await linkUserToDevice(userinfo.username, userinfo.deviceid, userinfo.devicehash);
            }
            if (userinfo.hasOwnProperty('allowmailing')) {
                sql = "update photouser set allowmailing=$1 where id=$2";
                await dbPool.query(sql, [userinfo.allowmailing?true:false, userId]);
            }
            if (userinfo.hasOwnProperty('displayname')) {
                sql = "update photouser set displayname=$1 where id=$2";
                await dbPool.query(sql, [userinfo.displayname, userId]);
            }
            sql = "select email, hash, allowmailing, displayname from photouser where id=$1";
            result = await dbPool.query(sql, [userId]);
            if (result.rows.length) {
                return {username: result.rows[0].email, hash: result.rows[0].hash, allowmailing: result.rows[0].allowmailing, displayname: result.rows[0].displayname};
            }
        }
        // user not known
        throw {"name": "unknownuser", "message": "failed to update user " + userinfo.username.toLowerCase()};
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

    async function resetPhotoset(oldrootid) {
        var sql = "select id, rootid from photo where rootid=$1 or id=$1 order by time";
        var result = await dbPool.query(sql, [oldrootid]);
        if (result.rows.length) {
            var newrootid = result.rows[0].id;
            sql = "update photo set isroot=$1, rootid=0 where id=$2";
            var subresult = await dbPool.query(sql, [(result.rows.length > 1), newrootid]);
            if (result.rows.length > 1 && oldrootid!=newrootid) {
                sql = "update photo set isroot=false, rootid=$1 where rootid=$2";
                await dbPool.query(sql, [newrootid, oldrootid]);
            }
        }
    }

    async function dbDeletePhoto(id, info, clientip) {
        var userid = await getUserid(info.username, info.hash);
        var sql = "";
        var parameters = [];
        if (userid > 0) {
            sql = 'select p.filename, p.animationfilename, p.rootid, isroot from photo p, device d where p.id=$1 and p.deviceid=d.id and d.userid=$2';
            parameters = [id, userid];            
        } else {
            // user unknown, get device
            let deviceid = await getDevice(info.deviceid, info.devicehash);
            if (deviceid > 0) {
                sql = 'select p.filename, p.animationfilename, p.rootid, isroot from photo p, device d where p.id=$1 and p.deviceid=d.id and d.id=$2';
                parameters = [id, deviceid];
            } else {
                // both user and device unknown, check if clientip is trusted
                if (netconfig.trusted_ips.indexOf(clientip) < 0) {
                    throw {"name": "unknownowner", "message": "photo delete allowed for owners only"};
                } else {
                    sql = 'select p.filename, p.animationfilename, p.rootid, isroot from photo p where p.id=$1';
                    parameters = [id];
                }
            }
        }
        var result = await dbPool.query(sql, parameters);
        if (!(result.rows && result.rows.length)) {
            throw {"name": "photonotfound", "message": "photo not found"};
        }
        var filename = result.rows[0].filename;
        var animationfilename = result.rows[0].animationfilename;
        var rootid = result.rows[0].rootid;
        var isroot = result.rows[0].isroot;
        sql = "delete from photo where id=$1";
        await dbPool.query(sql, [id]);
        deleteFile(__dirname + '/uploads/small/' + filename);
        deleteFile(__dirname + '/uploads/medium/' + filename);
        if (! await deleteFile(__dirname + '/uploads/' + filename)) {
            throw "failed to delete file " + filename;
        }
        if (isroot) {
            if (animationfilename && animationfilename.length) {
                deleteFile(__dirname + '/uploads/small/' + animationfilename);
                deleteFile(__dirname + '/uploads/medium/' + animationfilename);
                deleteFile(__dirname + '/uploads/' + animationfilename);
            }
        }
        if (isroot || rootid > 0) {
            await resetPhotoset(id);
        }
        return {"file": filename, "id": id, "deleted": true};
    }
    
    function tagStringToArray(tagstring)
    {
      if (tagstring) {
          return tagstring.split(', ').map(function(item){var keyval=item.split('=>').map(function(s){return s.replace(/"/g, '');}); var result={}; result[keyval[0]]=keyval[1]; return result;});
      } else {
       return [];
      }
    }

    /**
     * 
     * @param {number} external_deviceid
     * @param {string} devicehash 
     * @returns {number} internal device id, 0 if not found
     */
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

    function photoObject(row) {
        return {
            id: row.id,
            photoSetId: row.isroot? row.id : row.rootid,
            latitude: row.lat,
            longitude: row.lon,
            filename: row.isroot? row.filename.slice(0, -3) + 'jpg' : row.filename,
            accuracy: row.accuracy,
            time: row.time,
            width: row.width,
            height: row.height,
            description: row.description,
            tags: tagStringToArray(row.tags)
        };
    }

    function photoObjectArray(rows, index) {
        let result = [];
        for (let i = index; i < rows.length && rows[i].photosetid==rows[index].photosetid; i++) {
            result.push(photoObject(rows[i]));
        }
        return result;
    }

    function photosetObject(rows, index) {
        if (rows.length > index) {
            let result = {
                id: rows[index].photosetid,
                latitude: rows[index].lat,
                longitude: rows[index].lon,
                highlighted: true,
                likes: rows[index].likes ? rows[index].likes : 0,
                dislikes: rows[index].dislikes ? rows[index].dislikes : 0,
                gif: rows[index].filename.slice(0, -3)+'gif',
                photos: photoObjectArray(rows, index)
            };
            if (result.photos.length > 1) {
                result.thumbnail = result.photos[result.photos.length - 1].filename;
            }
            return result;
        };
    }

    async function dbGetPhotoSets(id) {
        var sql;
        var result;
        var parameters = [];
        if (id) {
            if (!isNumeric(id)) {
                throw {"name": "unprocessable", "message": "parameter id must be numeric"};
            }
            sql = `with photosetlikes as 
            (select photosetid, sum(case when likes > 0 then 1 else 0 end) as likes, sum(case when likes < 0 then -1 else 0 end) as dislikes from photosetlikes group by photosetid),
            photosets as 
            (select id, isroot, rootid, case when isroot=true then id else rootid end photosetid,
                st_x(location) lon, st_y(location) lat, filename, accuracy, time, width, height, description, tags
            from photo
            where id=$1 or rootid=$1
            )
            select photosets.*,photosetlikes.likes, photosetlikes.dislikes 
            from photosets left join photosetlikes on photosets.photosetid=photosetlikes.photosetid
            order by photosetid, id`;
            parameters = [id];
        } else {
            sql = `with photosetlikes as 
            (select photosetid, sum(case when likes > 0 then 1 else 0 end) as likes, sum(case when likes < 0 then -1 else 0 end) as dislikes from photosetlikes group by photosetid),
            photosets as 
            (select id, isroot, rootid, case when isroot=true then id else rootid end photosetid, 
                st_x(location) lon, st_y(location) lat, filename, accuracy, time, width, height, description, tags
            from photo
            where isroot=true or rootid>0 
            )
            select photosets.*,photosetlikes.likes, photosetlikes.dislikes 
            from photosets left join photosetlikes on photosets.photosetid=photosetlikes.photosetid
            order by photosetid, id`;
        }
        result = await dbPool.query(sql, parameters);   
        if (id) {
            // return single photoset
            return photosetObject(result.rows, 0);
        } else {
            // return photoset array
            let photoSets = [];
            for (let i = 0; i < result.rows.length; i++) {
                let photosetid = result.rows[i].photosetid;
                photoSets.push(photosetObject(result.rows, i));
                while (i + 1< result.rows.length && result.rows[i+1].photosetid == photosetid) {
                    i++;
                }
            }
            return photoSets;
        }
    }

    async function dbPhotosetLike (photosetid, like, userinfo) {
        var userid = await getUserid(userinfo.username, userinfo.hash);
        if (userid > 0) {
            var sql = "select id, photosetid, userid, likes from photosetlikes where photosetid=$1 and userid=$2";
            var result = await dbPool.query(sql, [photosetid, userid]);
            if (result.rows.length) {
                if (result.rows[0].likes==like) {
                    like = 0; // reset like
                }
            }
            sql = "insert into photosetlikes (photosetid, userid, likes) values ($1,$2,$3) on conflict(photosetid,userid) do update set likes=$3";
            await dbPool.query(sql, [photosetid, userid, like]);
            sql = "select sum(case when likes=1 then 1 end) as likes, sum(case when likes=-1 then 1 end) as dislikes from photosetlikes where photosetid=$1 group by photosetid";
            result = await dbPool.query(sql, [photosetid]);
            var likes = 0;
            var dislikes = 0;
            if (result.rows.length) {
                likes = result.rows[0].likes ? result.rows[0].likes : 0;
                dislikes = result.rows[0].dislikes ? result.rows[0].dislikes : 0;
            }
            return {photoset: photosetid, yourlikes: like, likes: likes, dislikes: dislikes};
        } else {
            throw {"name": "unknownuser", "message": "(dis)like allowed for registered users only"};
        }
    }


    
    function dbGetPhotoRows(id) {
        var sql;
        if (id) {
            sql = 'select id, st_x(location) lon, st_y(location) lat, accuracy, isroot, rootid, filename, time, width, height, description, tags from photo where visible=true and id=$1';
            return dbPool.query(sql, [id])
                .then(function(result){
                    return result.rows;
                });
        } else {
            sql = 'select id, ST_x(location) lon, st_y(location) lat, accuracy, isroot, rootid, filename, time, width, height, description, tags from photo where visible=true and rootid=0';
            return dbPool.query(sql)
                .then(function(result) {
                    return result.rows;
            });
        }
    }


    function dbGetPhotos(id) {
        return dbGetPhotoRows(id).then(function(rows){
            if (id) {
                // return single photo
                if (rows.length == 1) {
                    return photoObject(rows[0]);
                } else {
                    return undefined;
                }
            } else {
                // return array of photos
                return rows.map(row=>photoObject(row));
            }
        });
    }
    
    class Photodb {
        constructor() 
        { 
            this.getPhotos = function(id)
            {
                return dbGetPhotos(id);
            };
            this.getPhotoSets = function(id) {
                return dbGetPhotoSets(id);
            };
            this.storePhoto = function (photoinfo) {
                return dbStorePhoto(photoinfo);
            };
            this.deletePhoto = function(id, info, clientip) {
                return dbDeletePhoto(id, info, clientip);
            };
            this.createDevice = function(deviceInfo, deviceip) {
                return dbCreateDevice(deviceInfo, deviceip);
            };
            this.getUsers = function(userinfo, clientip) {
                return dbGetUsers(userinfo, clientip);
            };
            this.createUser = function(userinfo) {
                return dbCreateUser(userinfo);
            };
            this.updateUser = function(userinfo) {
                return dbUpdateUser(userinfo);
            };
            this.photosetLike = function (photosetid, like, userinfo) {
                return dbPhotosetLike (photosetid, like, userinfo);
            };
            this.photosetDislike = function(photosetid, like, userinfo) {
                return dbPhotosetLike (photosetid, like, userinfo);
            };
        }
    };

    module.exports = function (config) { netconfig = config; return new Photodb();};

})();
