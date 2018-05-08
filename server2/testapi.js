"use strict";

const request = require('request-promise-native');
const fs = require('fs-extra');
const assert = require('assert');

const config = require(__dirname + '/testapi.config.js');
// define photoserver
const baseUrl = config.baseUrl;

async function checkApi()
{
    const result = await request({
        uri: baseUrl + '/api/',
        method: 'GET'
    });
    return result;
}

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

async function getUser(userInfo) {
    const result = await request({
        uri: baseUrl + '/api/users',
        method: 'GET',
        json: true,
        auth: {
            user: userInfo.username,
            password: userInfo.hash
        }
    });
    return result;
}

async function getPhotos(id) {
    const result = await request({
        uri: baseUrl + '/api/photos' + (id?`/${id}`:''),
        method: 'GET',
        json: true
    });
    return result;
}

async function getPhotoSets(id) {
    const result = await request({
        uri: baseUrl + '/api/photosets' + (id?`/${id}`:''),
        method: 'GET',
        json: true
    });
    return result;
}

async function likePhotoSet(userInfo, id)
{
    const result = await request({
        uri: baseUrl + `/api/photosets/${id}/like`,
        json: true,
        method: 'POST',
        auth: {
            user: userInfo.username,
            password: userInfo.hash
        }
    });
    return result;
}


async function testAll()
{
    let thisDevice = {};
    let thisUser = {};

    // check if API is up and running
    const apiMessage = await checkApi();
    console.log(apiMessage);

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

    // Get my user info, using basic auth
    const aboutMe = await getUser(thisUser);
    console.log(JSON.stringify(aboutMe));

    const allPhotos = await getPhotos();
    console.log(`Number of photos: ${allPhotos.length}`);

    const allPhotoSets = await getPhotoSets();
    console.log(`Number of photosets: ${allPhotoSets.length}`);

    const singlePhoto = await getPhotos(1712);
    console.log(JSON.stringify(singlePhoto));

    const singlePhotoSet = await getPhotoSets(737);
    console.log(`Photoset 737 has ${singlePhotoSet.likes} likes`);
    console.log(`Photoset 737 has ${singlePhotoSet.dislikes} dislikes`);

    const likeResult = await likePhotoSet(thisUser, 737);
    console.log(JSON.stringify(likeResult));

}

testAll();

