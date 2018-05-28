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
    }).catch(function (error) {
        return error;
    });
    return result;
}

async function getPhotoSets(param) {
    let result;
    if (typeof param === "string") {
        result = await request({
            uri: baseUrl + '/api/photosets?' + param,
            method: 'GET',
            json: true
        });
    } else {
        result = await request({
            uri: baseUrl + '/api/photosets' + (param?`/${param}`:''),
            method: 'GET',
            json: true
        });
    }
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

async function getPhotoSetLikes(userInfo, id)
{
    const result = await request({
        uri: baseUrl + `/api/photosets/${id}/like`,
        json: true,
        method: 'GET',
        auth: {
            user: userInfo.username,
            password: userInfo.hash
        }
    });
    return result;
}

async function highlightPhotoset(userInfo, id, highlight)
{
    const result = await request({
        uri: baseUrl + `/api/photosets/${id}`,
        json: true,
        method: 'PUT',
        body: {
            highlight: highlight
        }
    }).catch(function(error){
        return error;
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

    const singlePhotoset = await getPhotoSets(737);
    console.log(`Photoset 737 has ${singlePhotoset.likes} likes`);
    console.log(`Photoset 737 has ${singlePhotoset.dislikes} dislikes`);
    console.log(`Photoset 737 is highlighted: ${singlePhotoset.highlighted}`);

    const singleDayPhotoset = await getPhotoSets('fromUtc=2018-04-07T00:00:00&toUtc=2018-04-08T00:00:00');
    console.log(`Number of photosets on 27 april 2018: ${singleDayPhotoset.length}`);

    const amsterdamPhotosets = await getPhotoSets('boundingbox=4.72876,52.27817,5.06843,52.43106');
    console.log(`Number of photosets in Amsterdam boundingbox: ${amsterdamPhotosets.length}`);

    const highlightedPhotosets = await getPhotoSets('highlighted=true');
    console.log(`Number of highlighted photosets: ${highlightedPhotosets.length}`);

    const getLikes = await getPhotoSetLikes(thisUser, 737);
    console.log(JSON.stringify(getLikes));

    const likeResult = await likePhotoSet(thisUser, 737);
    console.log(JSON.stringify(likeResult));

    const highlightResult = await highlightPhotoset(thisUser, 737, false);
    console.log(JSON.stringify(highlightResult));

    const highlightResult2 = await highlightPhotoset(thisUser, -1, true);
    console.log(JSON.stringify(highlightResult2));

}

testAll();

