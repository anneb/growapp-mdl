"use strict";

const request = require('request-promise-native');
const fs = require('fs-extra');
const assert = require('assert');

const config = require(__dirname + '/testapi.config.js');
// define photoserver
const baseUrl = config.baseUrl;

async function createDevice()
{
    const deviceInfo = await request({
        uri: baseUrl + '/api/device',
        method: 'POST',
        json: true,
        body: {}
    });
    return deviceInfo;
}

async function createUser(deviceInfo, username, displayName, allowMailing)
{
    const userInfo = await request({
        uri: baseUrl + '/api/users',
        method: 'POST',
        json: true,
        body: {
            deviceid: deviceInfo.deviceid,
            devicehash: deviceInfo.devicehash,
            username: username,
            displayname: displayName,
            allowmailing: allowMailing
        }

    });
    return userInfo;
}

async function validateUser(deviceInfo, username ,validationcode)
{
    const userInfo = await request({
        uri: baseUrl + '/api/users',
        method: 'PUT',
        json: true,
        body: {
            deviceid: deviceInfo.deviceid,
            devicehash: deviceInfo.devicehash,
            username: username,
            validationcode: validationcode            
        }
    });
    return userInfo;
}


async function testAll()
{
    let thisDevice = {};
    let thisUser = {};    

    // load or create device
    if (!fs.existsSync(__dirname + '/deviceinfo.json')) {
        thisDevice = await createDevice();
        fs.writeFileSync(__dirname + '/deviceinfo.json', JSON.stringify(thisDevice, null, 4));
    } else {
        thisDevice = require(__dirname + '/deviceinfo.json');
    }

    // check if validationcode is known
    if (config.validationcode == 0) {
        if (fs.existsSync(__dirname + "/userinfo.json")) {
            fs.unlinkSync(__dirname + "/userinfo.json");    
        }
        if (config.validationcode == 0) {
            thisUser = await createUser(thisDevice, config.username, config.displayName, config.allowMailing);
            console.log(JSON.stringify(thisUser));
            console.log('update validiationcode in testapi.config.js');
            process.exit(1);
        }        
    }

    // reload or download user credentials
    if (fs.existsSync(__dirname + '/userinfo.json')) {
        // reload credentials from file
        thisUser = require(__dirname + "/userinfo.json");
    } else {
        // download from api
        thisUser = await validateUser(thisDevice, config.username, config.validationcode);
        fs.writeFileSync(__dirname + '/userinfo.json', JSON.stringify(thisUser));
    }
}



/* 

if (!fs.existsSync(__dirname + '/userinfo.json')) {
    console.error('File "userinfo.json" not found.\nCopy "userinfo.json.example" to "userinfo.json".\nThen edit "userinfo.json" to replace email with a valid email-address');
    process.exit(1);
}

let deviceinfo = require(__dirname + '/userinfo.json');

function sleep(ms) {
    return new Promise(resolve=> setTimeout(resolve, ms));
}

async function insertPhoto(rootid) {
    // send a photo
    const sendPhotoresult = await request({
        uri: baseUrl + '/photoserver/sendphoto',
        method: 'POST',
        form: {
            username: deviceinfo.email,
            hash: deviceinfo.hash,
            deviceid: deviceinfo.deviceid,
            devicehash: deviceinfo.devicehash,
            latitude: 52.3423,
            longitude: 4.913040,
            accuracy: 10,
            rootid: rootid,
            photo: fs.readFileSync(__dirname + '/../www/trees.jpg').toString('base64')
        }
    });
    return sendPhotoresult;
}

async function deletePhoto(filename) {
    const deletePhotoResult = await request({
        uri: baseUrl + '/photoserver/deletemyphoto',
        method: 'POST',
        form: {
            deviceid: deviceinfo.deviceid,
            devicehash: deviceinfo.devicehash,
            filename: filename
        }
    });
    return deletePhotoResult;
}

async function getLastInsertedPhoto() {
    // retrieve all photos
    const allPhotos = await request({
        uri:baseUrl+'/photoserver/getphotos',
        json: true
    });
    if (!allPhotos.type=='FeatureCollection') {
        throw 'unexpected result from getphotos';
    }
    //get photo with highest id at test location
    let result = null;
    const insertedPhoto = allPhotos.features.reduce((result, feature)=>feature.geometry.coordinates[0]==4.91304&&feature.geometry.coordinates[1]==52.3423&&(result?feature.properties.id>result.properties.id:true)?feature:result);
    if (!insertedPhoto) {
        throw 'newly added photo not found';
    }
    return insertedPhoto;
}

async function getMyPhotos() {
    const myPhotos = await request({
        uri:baseUrl+'/photoserver/getmyphotos',
        method: 'POST',
        json: true,
        form: {
            username: deviceinfo.email,
            hash: deviceinfo.hash,
            deviceid: deviceinfo.deviceid,
            devicehash: deviceinfo.devicehash
        }
    });
    if (!Array.isArray(myPhotos)) {
        throw 'unexpected result from getmyphotos';
    }
    return myPhotos;
}

async function getPhotoset(rootid) {
    const result = await request({
        uri:baseUrl + '/photoserver/getphotoset',
        json: true,
        method: 'POST',
        form: {
            photoid: rootid
        }
    });
    return result;
}

async function checkUser() {
    const result = await request({
        uri:baseUrl+'/photoserver/checkuser',
        method: 'POST',
        json: true,
        form: {
            email: deviceinfo.email,
            hash: deviceinfo.hash,
            deviceid: deviceinfo.deviceid,
            devicehash: deviceinfo.devicehash
        }
    });
    return result;
}

async function getTagList(langcode) {
    const result = await request({
        uri:baseUrl+'/photoserver/taglist',
        method: 'GET',
        json: true,
        qs: {
            langcode: langcode
        }
    });
    return result;
}

function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}
*/
async function testAll2()
{
    try {
        if (deviceinfo.deviceid==0 || deviceinfo.devicehash.length < 10) {
            const device = await request({
                uri: baseUrl + '/photoserver/createdevice',
                method: 'POST',
                json: true
            });
            deviceinfo.deviceid=device.deviceid;
            deviceinfo.devicehash=device.devicehash;
            fs.writeFileSync(__dirname + '/userinfo.json', JSON.stringify(deviceinfo, null, 4));
        }
        // check validationcode        
        let userHash = '';
        if (deviceinfo.validationcode > 0) {
            try {
                userHash = await request({
                    uri: baseUrl + '/photoserver/validateuser',
                    method: 'POST',
                    form: {
                            'email': deviceinfo.email,
                            'validationcode': deviceinfo.validationcode,
                            'deviceid': deviceinfo.deviceid,
                            'devicehash': deviceinfo.devicehash
                        },
                    headers: { /* 'Content-Type': 'application/x-www-form-urlencoded' */}
                });
                if (deviceinfo.hash != userHash && userHash != 'wrong code') {
                    deviceinfo.hash=userHash;
                    fs.writeFileSync(__dirname + '/userinfo.json', JSON.stringify(deviceinfo, null, 4));
                }
            } catch(err) {
                    // user not yet known
                    console.log(JSON.stringify(err));
            }
        }
        if (userHash == '' || userHash == 'wrong code') {
            // reset deviceinfo
            if (deviceinfo.validationcode > 0) {
                deviceinfo.validationcode = 0;
                deviceinfo.deviceid=0;
                deviceinfo.devicehash=0;
                deviceinfo.hash='';
                fs.writeFileSync(__dirname + '/userinfo.json', JSON.stringify(deviceinfo, null, 4));
            }
            // request new validationcode
            const responseMessage = await request({
                uri: baseUrl + '/photoserver/validatemail',
                method: 'POST',
                form: {
                    'email': deviceinfo.email
                }
            });
            console.log(responseMessage);
            console.log('update validationcode in file userinfo.json\nto value emailed to "' + deviceinfo.email + '"');
            process.exit(1);
        }

        const checkUserResult = await checkUser();
        if (!checkUserResult.knownuser) {
            throw "user not recognized?";
        }

        const tagList = await getTagList('nl');
        if (!Array.isArray(tagList) || tagList.length < 1) {
            throw "Taglist should be non-empty array";
        }
        
        const sendPhotoresult = await insertPhoto(0);
        if (sendPhotoresult != "thanks") {
            throw "Sendphoto should return 'thanks'";
        }
        const insertedPhoto = await getLastInsertedPhoto();
        if (!(insertedPhoto && insertedPhoto.properties && insertedPhoto.properties.hasOwnProperty('isroot') && insertedPhoto.properties.isroot==false)) {
            throw "Inserted photo should have property 'isroot:false";
        }

        const photoid = insertedPhoto.properties.id;
        if (!isNumeric(photoid) || parseInt(photoid) == 0) {
            throw "photoid should be numeric and larger than 0";
        }
        const sendPhotoresult2 = await insertPhoto(photoid);
        if (sendPhotoresult2 != "thanks") {
            throw "Sendphoto should return 'thanks'";
        }

        // wait for animation to finish
        await sleep(3000);
        const insertedPhoto2 = await getLastInsertedPhoto();
        if (!(insertedPhoto2 && insertedPhoto2.properties && insertedPhoto2.properties.hasOwnProperty('isroot') && insertedPhoto2.properties.isroot==true && insertedPhoto2.properties.id==photoid)) {
            throw `Inserted photo should have property 'id:${photoid},isroot:true`;
        }


        const sendPhotoresult3 = await insertPhoto(photoid);
        if (sendPhotoresult3 != "thanks") {
            throw "Sendphoto should return 'thanks'";
        }
        await sleep(3000);
        const insertedPhoto3 = await getLastInsertedPhoto();
        if (!(insertedPhoto3 && insertedPhoto3.properties && insertedPhoto3.properties.hasOwnProperty('isroot') && insertedPhoto3.properties.isroot==true && insertedPhoto3.properties.id==photoid)) {
            throw `Inserted photo should have property 'id:${photoid},isroot:true`;
        }

        const photoset = await getPhotoset(photoid);
        if (!(Array.isArray(photoset) && photoset.length==3 && photoset[0].id == photoid)) {
            throw `photoset should have 3 photos where first photo should have id: ${photoid}`;
        }

        const myphotos = await getMyPhotos();
        if (myphotos.sort((a,b)=>a.id>b.id).slice(-3)[0].id != photoid) {
            throw `third last myphoto should have id ${photoid}`;
        }

        const deletedPhoto = await deletePhoto(photoset[0].filename);
        if (deletedPhoto.indexOf("photo removed") < 0) {
            throw "deletedPhoto should contain string 'photo removed'";
        }
        await sleep(3000);
        const lastPhoto = await getLastInsertedPhoto();
        if (!(lastPhoto.properties.isroot==true && lastPhoto.properties.id>photoid)) {
            throw "last photo should have property 'isroot:true' and id>photoid";
        }

        const deletedPhoto2 = await deletePhoto(photoset[2].filename);
        if (deletedPhoto2.indexOf("photo removed") < 0) {
            throw "deletedPhoto2 should contain string 'photo removed'";
        }

        await sleep(3000);
        const lastPhoto2 = await getLastInsertedPhoto();
        if (!(lastPhoto2.properties.isroot==false && lastPhoto.properties.id>photoid)) {
            throw "last photo should have property 'isroot:false' and id>photoid";
        }

        const deletedPhoto3 = await deletePhoto(photoset[1].filename);
        if (deletedPhoto3.indexOf("photo removed") < 0) {
            throw "deletedPhoto3 should contain string 'photo removed'";
        }
    } catch (error) {
        console.log(error);
    };
}

testAll();

