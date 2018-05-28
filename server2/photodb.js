(function () {

    'use strict';
    let netconfig;
    const fs = require('fs-extra');
    const crypto = require('crypto');
    const Pool = require('pg').Pool;
        var dbPool = new Pool({
        user: process.env.PGUSER || 'geodb',
        password: process.env.PGPASSWORD || 'geodb',
        host: process.env.PGHOST || 'localhost',
        database: process.env.PGDATABASE || 'locophoto',
        port: process.env.PGPORT || 5432,
        max: 20, // max number of clients in pool
        idleTimeoutMillis: 1000 // close & remove clients which have been idle > 1 second
    });
    const gm = require('gm');
    const nodemailer = require('nodemailer');

    // generates a random non-existing filename
    function randomFilename (directory, extension) {
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
        const transporter = nodemailer.createTransport({
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
        const re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
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
        const deviceid = await getDevice(photoinfo.deviceid, photoinfo.devicehash);
        if (deviceid == 0) {
            // unknown device
            throw {"name": "unknowndevice", "message": "photo upload available for registered devices only"};
        }
        const userId = await getUserid(photoinfo.username, photoinfo.hash);
        if (userId > 0) {
            await linkUserToDevice(photoinfo.username, photoinfo.deviceid, photoinfo.devicehash);
        }
        const filenameObject = await randomFilename(__dirname + "/uploads/", ".jpg");
        const basename = await new Promise (function(resolve, reject){
                fs.writeFile(filenameObject.fullfilename, photoinfo.photo, 'base64', function(err) {
                    if (err) {
                        reject(err);
                    }
                    resolve(filenameObject.basename);
                });
            });
        const imageInfo = await getImageInfo(filenameObject.fullfilename);
        if (!imageInfo) {
            fs.unlink(filenameObject.fullfilename);
            throw "Invalid or corrupted image";
        }
        const location = 'SRID=4326;POINT(' + photoinfo.longitude + ' ' + photoinfo.latitude + ')';
        const description = photoinfo.description ? photoinfo.description.substring(0, 400) : null;
        const tags = Array.isArray(photoinfo.tags)?photoinfo.tags:[];
        const sqltags = tags.map(tag=>Object.entries(tag).map(keyval=>keyval.map(entry=>'"'+entry.replace('"', '')+'"').join(' => '))).join(', ');
        let sql = 'insert into photo (filename, width, height, location, accuracy, time, visible, rootid, deviceid, description, tags) values ($1, $2, $3, ST_GeomFromEWKT($4), $5, Now(), TRUE, $6, $7, $8, $9) returning id';
        let result = await dbPool.query(sql, [basename, imageInfo.size.width, imageInfo.size.height, location, parseInt(photoinfo.accuracy, 10), photoinfo.rootid, deviceid, description, sqltags]);
        const photoid = (result.rows && result.rows.length && result.rows[0].id) ? result.rows[0].id : 0;
        await resizeImage(filenameObject.fullfilename, 200, 200, '^', __dirname + "/uploads/small/" + basename);
        await resizeImage(filenameObject.fullfilename, 640, 640, '^', __dirname + "/uploads/medium/" + basename);
        if (photoinfo.rootid > 0) {
            sql = "update photo set isroot=true where id=$1 returning id";
            result = await dbPool.query(sql, [photoinfo.rootid]);
            if (result.rows[0].id != photoinfo.rootid) {
                throw {"name": "photonotfound", "message": "rootid of uploaded photo not valid"};
            }
        }

        return {"uri": basename, "id": photoid, "width": imageInfo.size.width, "height": imageInfo.size.height};
    }

    /**
     *
     * @param {string} username
     * @param {staring} password
     * @returns {number} internal user id, 0 if not found
     */
    function getUserid (email, hash) {
        return new Promise(function (resolve, reject){
          if ((!email) || (!hash) || (email==='') || (hash==='')) {
            resolve(0);
          } else {
            const sql = 'select id from photouser where email=$1 and hash=$2';
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
            const cipher = crypto.createCipher('aes256', 'a password');
            let encrypted = '';
            cipher.on('readable', () => {
              const data = cipher.read();
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
            const sql = 'insert into device (userid,deviceip) values ($1, $2) returning id';
            return dbPool.query(sql, [userid,deviceip])
                .then (function (result){
                    if (result.rows.length) {
                        const deviceid = result.rows[0].id + 3141;
                        return encrypt(deviceip + ',' + deviceid).then(function(encrypted){
                            const sql = 'update device set deviceid=$1, devicehash=$2 where id=$3';
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
        let sql, params;
        if (netconfig.trusted_ips.indexOf(clientip) > -1) {
            // trusted clientIp, list all users
            sql = "select email, displayname, validated, allowmailing from photouser";
            params = [];
        } else {
            const userId = await getUserid(userinfo.username, userinfo.hash);
            if (userId > 0) {
                sql = "select email, displayname, validated, allowmailing from photouser where id=$1";
                params = [userId];
            } else {
                throw {"name": "unknowuser", "message": "userinfo allowed for registered users only"};
            }
        }
        const result = await dbPool.query(sql, params);
        return {"users": result.rows};
    }
    
    /**
     * @description creates or updates user for device, emails a verification code
     * @param {object} userinfo 
     * @returns {object} ok
     */
    async function dbCreateUser(userinfo) {
        const deviceId = await getDevice(userinfo.deviceid, userinfo.devicehash);
        if (deviceId == 0) {
            throw {"name": "unknowndevice", "message": "create user is available for registered devices only"};
        }
        let sql;
        if (!(userinfo.hasOwnProperty('allowmailing') && userinfo.hasOwnProperty('displayname'))) {
            throw {"name": "unprocessable", "message": "missing or bad upload parameters"};
        }
        const allowmailing = userinfo.allowmailing ? true : false;
        let validationcode;
        if (userinfo.username && userinfo.username.length > 5 && validateEmail(userinfo.username)) {
            sql = "select id, validationcode, displayname, allowmailing from photouser where email=$1";
            let result = await dbPool.query(sql, [userinfo.username.toLowerCase()]);
            if (result.rows.length) {
                // user already known
                validationcode = result.rows[0].validationcode;
                if (result.rows[0].displayname != userinfo.displayname || result.rows[0].allowmailing != userinfo.allowmailing) {                    // update allowmailing and displayname
                    sql = 'update photouser set displayname=$1, allowmailing=$2 where email=$3';
                    await dbPool.query(userSQL, [userinfo.displayname, userinfo.allowmailing, userinfo.username]);
                }
            } else {
                // new user
                sql = "insert into photouser (email,displayname,validated,validationcode,hash,retrycount,allowmailing) values ($1,$2,false,$3,'',0,$4)";
                const raw = crypto.randomBytes(4);
                validationcode = pad(Math.floor((parseInt(raw.toString('hex'), 16) / 4294967295) * 99999), 5);
                await dbPool.query(sql, [userinfo.username.toLowerCase(), userinfo.displayname, validationcode, userinfo.allowmailing]);
            }
        } else {
            throw {"name": "unprocessable", "message": "email not provided or invalid"};
        }
        const info = await emailValidationCode(userinfo.username, validationcode);
        return { "message": "validationcode mailed to " + userinfo.username};
    }

    async function linkUserToDevice(email, deviceid, devicehash)
    {
        // store user with device if user is on known device
        if (deviceid && deviceid !== '' && devicehash && devicehash !== '') {
            let sql = 'update device set userid=(select id from photouser where email=$1 limit 1) where deviceid=$2 and devicehash=$3';
            await dbPool.query(sql, [email.toLowerCase(), deviceid, devicehash]);
        }
    }


    async function dbUpdateUser(userinfo) {
        let sql;
        let deviceId = 0;
        let userId = 0;
        let hash = userinfo.hash;
        if (userinfo.deviceid && userinfo.devicehash) {
            deviceId = await getDevice(userinfo.deviceid, userinfo.devicehash);
            if (deviceId == 0) {
                throw {"name": "unprocessable", "message": "missing or wrong deviceid and/or devicehash"};
            }
        }
        if (userinfo.username && hash) {
            userId = await getUserid(userinfo.username, userinfo.hash);
        }
        if (userId == 0) {
            if (userinfo.validationcode && userinfo.username && userinfo.username.length > 5 && validateEmail(userinfo.username)) {
                sql = "select id, validationcode, retrycount, hash from photouser where email=$1";
                const result = await dbPool.query(sql, [userinfo.username.toLowerCase()]);
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
                        const raw = crypto.randomBytes(16);
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
            const result = await dbPool.query(sql, [userId]);
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
        let sql = "select id, rootid from photo where rootid=$1 or id=$1 order by time";
        const result = await dbPool.query(sql, [oldrootid]);
        if (result.rows.length) {
            const newrootid = result.rows[0].id;
            sql = "update photo set isroot=$1, rootid=0 where id=$2";
            const subresult = await dbPool.query(sql, [(result.rows.length > 1), newrootid]);
            if (result.rows.length > 1 && oldrootid!=newrootid) {
                sql = "update photo set isroot=false, rootid=$1 where rootid=$2";
                await dbPool.query(sql, [newrootid, oldrootid]);
            }
        }
    }

    async function dbDeletePhoto(id, info, clientip) {
        const userid = await getUserid(info.username, info.hash);
        let sql = "";
        let parameters = [];
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
        const result = await dbPool.query(sql, parameters);
        if (!(result.rows && result.rows.length)) {
            throw {"name": "photonotfound", "message": "photo not found"};
        }
        const filename = result.rows[0].filename;
        const animationfilename = result.rows[0].animationfilename;
        const rootid = result.rows[0].rootid;
        const isroot = result.rows[0].isroot;
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
                const sql = 'select id from device where deviceid=$1 and devicehash=$2';
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
            photoSetId: row.photosetid,
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
            const result = {
                id: rows[index].photosetid,
                latitude: rows[index].lat,
                longitude: rows[index].lon,
                highlighted: rows[index].highlight,
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
        return {photos:[]};
    }

    function isValidDate(d) {
        if ( Object.prototype.toString.call(d) === "[object Date]" ) {
            // it is a date
            if ( isNaN( d.getTime() ) ) {  // d.valueOf() could also work
              // date is not valid
              return false;
            }
            else {
              // date is valid
              return true;
            }
        }
        return false;
    }

    function isValidNumericValue(number, min, max)
    {
        if (isNaN(number)) {
            return false;
        }
        return (number >= min && number <= max);
    }

    async function dbGetPhotosets(query) {
        let sql;
        let sqlParams = [];
        if (query.id) {
            if (!isNumeric(query.id)) {
                throw {"name": "unprocessable", "message": "parameter id must be numeric"};
            }
            sql = `with photosetlikes as 
            (select photosetid, sum(case when likes > 0 then 1 else 0 end) as likes, sum(case when likes < 0 then -1 else 0 end) as dislikes from photosetlikes group by photosetid),
            photosets as 
            (select id, isroot, rootid, highlight, case when rootid=0 then id else rootid end photosetid,
                st_x(location) lon, st_y(location) lat, filename, accuracy, time, width, height, description, tags
            from photo
            where id=$1 or rootid=$1
            )
            select photosets.*,photosetlikes.likes, photosetlikes.dislikes 
            from photosets left join photosetlikes on photosets.photosetid=photosetlikes.photosetid
            order by photosetid desc, id asc`;
            sqlParams = [query.id];
        } else if (Object.keys(query).length == 0) {
            sql = `with photosetlikes as 
            (select photosetid, sum(case when likes > 0 then 1 else 0 end) as likes, sum(case when likes < 0 then -1 else 0 end) as dislikes from photosetlikes group by photosetid),
            photosets as 
            (select id, isroot, rootid, highlight, case when rootid=0 then id else rootid end photosetid,
                st_x(location) lon, st_y(location) lat, filename, accuracy, time, width, height, description, tags
            from photo
            )
            select photosets.*,photosetlikes.likes, photosetlikes.dislikes 
            from photosets left join photosetlikes on photosets.photosetid=photosetlikes.photosetid
            order by photosetid desc, id asc`;
        } else {
            const sqlQueryExpressions = [];
            const havingExpressions = [];
            if (query.hasOwnProperty('minPhotos')) {
                if (!isValidNumericValue(query.minPhotos, 0, 2000)) {
                    throw {"name": "unprocessable", "message" : `error parsing minPhotos value: ${minPhotos}`};
                }
            }
            if (query.fromUtc) {
                const fromTime = new Date(query.fromUtc);
                if (!isValidDate(fromTime)) {
                    throw {"name": "unprocessable", "message" : "parsing frommUtc failed"};
                }
                sqlParams.push(fromTime);
                sqlQueryExpressions.push("time>=$" + sqlParams.length);
            }
            if (query.toUtc) {
                const toTime = new Date(query.toUtc);
                if (!isValidDate(toTime)) {
                    throw {"name": "unprocessable", "message" : "parsing fromUtc failed"};
                }
                sqlParams.push(toTime);
                sqlQueryExpressions.push("time<$" + sqlParams.length);
            }
            if (query.boundingbox) {
                const coords = query.boundingbox.split(',').map((coord, index)=>{
                    let result=parseFloat(coord);
                    if (!isValidNumericValue(result, index % 2 ? -90.0 : -180, index % 2 ? 90.0 : 180.0)) { 
                        throw {"name": "unprocessable", "message" : `error parsing boundingbox value: ${coord}`};
                    }
                    return result;});
                sqlParams.push(`SRID=4326;LINESTRING(${coords[0]} ${coords[1]}, ${coords[2]} ${coords[3]})`);
                sqlQueryExpressions.push("ST_Intersects(location, ST_Envelope(ST_GeomFromEWKT($"+sqlParams.length+")))");
            }
            if (query.hasOwnProperty('highlighted')) {
                let highlighted = query.highlighted;
                if (highlighted === false || highlighted == 0 || highlighted === "false" || highlighted == "0") {
                    highlighted = false;
                } else {
                    highlighted = true;
                }
                sqlParams.push(highlighted);
                sqlQueryExpressions.push ('highlight=$' + sqlParams.length);
            }
            const whereClause = sqlQueryExpressions.length ? " where "+sqlQueryExpressions.join(" and ") : "";
            sql  = `with photosetlikes as 
            (select photosetid, sum(case when likes > 0 then 1 else 0 end) as likes, sum(case when likes < 0 then -1 else 0 end) as dislikes from photosetlikes group by photosetid
            ), selectedphotos as (
                select case when rootid=0 then id else rootid end as photosetid from photo `+whereClause+`
            ), selectedphotosets as (
                select photosetid from selectedphotos group by photosetid
            ), photosets as (
                select id, isroot, rootid, highlight, case when rootid=0 then id else rootid end photosetid,
                st_x(location) lon, st_y(location) lat, filename, accuracy, time, width, height, description, tags
            from photo p join selectedphotosets s on (p.id=s.photosetid or p.rootid=s.photosetid)
            ) select photosets.*,photosetlikes.likes, photosetlikes.dislikes 
            from photosets left join photosetlikes on photosets.photosetid=photosetlikes.photosetid
            order by photosetid desc, id asc;`;
        }
        const result = await dbPool.query(sql, sqlParams);
        if (query.id) {
            // return single photoset
            return photosetObject(result.rows, 0);
        } else {
            // return photoset array
            const minPhotos = query.hasOwnProperty('minPhotos') ? query.minPhotos : 0;

            let photoSets = [];
            for (let i = 0; i < result.rows.length; i++) {
                let photosetid = result.rows[i].photosetid;
                let photosetObj = photosetObject(result.rows, i);
                if (photosetObj.photos.length >= minPhotos) {
                    photoSets.push(photosetObj);
                }
                while (i + 1< result.rows.length && result.rows[i+1].photosetid == photosetid) {
                    i++;
                }
            }
            return photoSets;
        }
    }

    async function dbPhotosetLike (photosetid, like, userinfo) {
        // like == 1: toggle like
        // like == 0: get info only
        // like == -1: toggle dislike
        const userid = await getUserid(userinfo.username, userinfo.hash);
        if (userid > 0) {
            let currentMyLikes = 0;
            let sql = "select id, photosetid, userid, likes from photosetlikes where photosetid=$1 and userid=$2";
            let result = await dbPool.query(sql, [photosetid, userid]);
            if (result.rows.length) {
                currentMyLikes = result.rows[0].likes;
            }
            if (like != 0){
                if (like == currentMyLikes) {
                    // reset myLikes to 0
                    like = 0;
                }
                sql = "insert into photosetlikes (photosetid, userid, likes) values ($1,$2,$3) on conflict(photosetid,userid) do update set likes=$3";
                await dbPool.query(sql, [photosetid, userid, like]);
                currentMyLikes = like;
            }
            sql = "select sum(case when likes=1 then 1 end) as likes, sum(case when likes=-1 then 1 end) as dislikes from photosetlikes where photosetid=$1 group by photosetid";
            result = await dbPool.query(sql, [photosetid]);
            let likes = 0;
            let dislikes = 0;
            if (result.rows.length) {
                likes = result.rows[0].likes ? result.rows[0].likes : 0;
                dislikes = result.rows[0].dislikes ? result.rows[0].dislikes : 0;
            }
            return {photoset: photosetid, yourlikes: currentMyLikes, likes: likes, dislikes: dislikes};
        } else {
            throw {"name": "unknownuser", "message": "(dis)like allowed for registered users only"};
        }
    }

    async function dbUpdatePhotoset(photosetid, info, clientip) {
        let queryResult = {};
        if (netconfig.trusted_ips.indexOf(clientip) < 0) {
            throw {"name": "unauthorized", "message": "photoset highlight allowed for admins only"};
        } else {
            if (!isNumeric(photosetid)) {
                throw {"name": "unprocessable", "message": "parameter photosetid must be numeric"};
            }
            if (!info.hasOwnProperty('highlight') || (info.highlight !== false && info.highlight !== true)) {
                throw {"name": "unprocessable", "message": "parameter highlight must be true or false"};
            }
            const sql = "update photo set highlight=$1 where id=$2 or rootid=$2";
            queryResult = await dbPool.query(sql, [info.highlight?true:false, photosetid]);
            if (!queryResult.rowCount) {
                throw {"name": "photonotfound", "message": "photoset id not found"};
            }
        }
        return {"photoset": photosetid, "highlight": info.highlight, "photosetsize": queryResult.rowCount};
    }

    
    async function dbGetPhotoRows(params) {
        let sql;
        if (params.id) {
            // get photo for given id
            sql = 'select id, st_x(location) lon, st_y(location) lat, accuracy, isroot, rootid, filename, time, width, height, description, tags from photo where visible=true and id=$1';
            return dbPool.query(sql, [params.id])
                .then(function(result){
                    return result.rows;
                });
        } else {
            if (params.myphotos) {
                let sqlParams;
                // get photo for user or device identified by credentials
                if (!(params.username && params.hash)) {
                    throw {"name":"unprocessable", "message": "myphotos requires authentication"};
                }
                if (params.username.indexOf('@') > -1) {
                    // user auth
                    const userId = await getUserid(params.username, params.hash);
                    if (userId == 0) {
                        throw {"name": "unauthorized", "message":"user unknown or wrong password"};
                    }
                    sql = 'select p.id, ST_x(p.location) lon, st_y(p.location) lat, p.accuracy, p.isroot, p.rootid, p.filename, p.time, p.width, p.height, p.description, p.tags from photo p,device d where p.visible=true and p.deviceid=d.id and d.userid=$1 order by id desc';
                    sqlParams = [userId];
                } else {
                    // device auth
                    const deviceId = await getDevice(params.username, params.hash);
                    if (deviceId == 0) {
                        throw {"name": "unauthorized", "message":"device unknown or wrong password"};
                    }
                    sql = 'select p.id, ST_x(p.location) lon, st_y(p.location) lat, p.accuracy, p.isroot, p.rootid, p.filename, p.time, p.width, p.height, p.description, p.tags from photo p where p.visible=true and p.deviceid=$1 order by id desc';
                    sqlParams = [deviceId];
                }
                return dbPool.query(sql, sqlParams)
                    .then(function(result){
                        return result.rows;
                });
            } else {
                // get all photos
                sql = 'select id, ST_x(location) lon, st_y(location) lat, accuracy, isroot, rootid, filename, time, width, height, description, tags from photo where visible=true and rootid=0 order by id desc';
                return dbPool.query(sql)
                    .then(function(result) {
                        return result.rows;
                });
            }
        }
    }


    function dbGetPhotos(params) {
        return dbGetPhotoRows(params).then(function(rows){
            if (params.id) {
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
        }).catch(function(error){
            throw error;
        });
    }
    
    class Photodb {
        constructor() 
        { 
            this.getPhotos = function(id)
            {
                return dbGetPhotos(id);
            };
            this.getPhotosets = function(params) {
                return dbGetPhotosets(params);
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
            this.updatePhotoset = function(photosetid, info, clientip) {
                return dbUpdatePhotoset(photosetid, info, clientip);
            };
        }
    };

    module.exports = function (config) { netconfig = config; return new Photodb();};

})();
