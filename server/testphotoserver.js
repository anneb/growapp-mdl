"use strict";

const request = require('request-promise-native');
const fs = require('fs-extra');

// define photoserver
const hostname = 'localhost';
const port = 3100;
const email = 'anne.blankert@geodan.nl';
const baseUrl = 'http://' + hostname + ':' + port;

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

async function testAll()
{
    try {
        if (deviceinfo.deviceid==0 || deviceinfo.devicehash.length < 10) {
            const device = await request({
                uri: baseUrl + '/photoserver/createdevice',
                method: 'POST',
                json: true,
                form: {
                    'email': deviceinfo.email,
                    'hash': deviceinfo.hash
                }
            });
            deviceinfo.deviceid=device.deviceid;
            deviceinfo.devicehash=device.devicehash;
            fs.writeFileSync(__dirname + '/userinfo.json', JSON.stringify(deviceinfo, null, 4));
        }
        // check validationcode
        const userHash = await request({
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
        if (userHash == 'wrong code') {
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
        
        const sendPhotoresult = await insertPhoto(0);
        const insertedPhoto = await getLastInsertedPhoto();

        const rootid = insertedPhoto.properties.id;

        const sendPhotoresult2 = await insertPhoto(rootid);

        // wait for animation to finish
        await sleep(3000);
        const insertedPhoto2 = await getLastInsertedPhoto();

        const sendPhotoresult3 = await insertPhoto(rootid);
        await sleep(3000);
        const insertedPhoto3 = await getLastInsertedPhoto();

        console.log(JSON.stringify(insertedPhoto));
        console.log(JSON.stringify(insertedPhoto2));
        console.log(JSON.stringify(insertedPhoto3));

        const photoset = await getPhotoset(rootid);
        console.log(JSON.stringify(photoset));

        const myphotos = await getMyPhotos();
        console.log(JSON.stringify(myphotos.sort((a,b)=>a.id>b.id).slice(-3)));

        const deletedPhoto = await deletePhoto(photoset[0].filename);
        console.log("delete: "  + deletedPhoto);
        await sleep(3000);
        const lastPhoto = await getLastInsertedPhoto();
        console.log(JSON.stringify(lastPhoto));

        const deletedPhoto2 = await deletePhoto(photoset[2].filename);
        console.log("delete: "  + deletedPhoto2);
        await sleep(3000);
        const lastPhoto2 = await getLastInsertedPhoto();
        console.log(JSON.stringify(lastPhoto2));

        const deletedPhoto3 = await deletePhoto(photoset[1].filename);
        console.log("delete: "  + deletedPhoto3);
        await sleep(3000);
        const lastPhoto3 = await getLastInsertedPhoto();
        console.log(JSON.stringify(lastPhoto3));

    } catch (error) {
        console.log(error);
    };
}

testAll();