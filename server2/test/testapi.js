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

async function updateUser(deviceInfo, userInfo, fieldInfo)
{
    const requestOptions = {
        uri: baseUrl + '/api/users',
        method: 'PUT',
        json: true,
        auth: {
            user: userInfo.username,
            password: userInfo.hash
        },
        body: {
            deviceid: deviceInfo.deviceid,
            devicehash: deviceInfo.devicehash,
        }
    };
    if (fieldInfo) {
        // merge body with fieldInfo
        requestOptions.body = Object.assign(requestOptions.body,fieldInfo);
    }
    return await request(requestOptions);
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

async function getPhotos(param, deviceInfo, userInfo) {
    const requestOptions = {
        method: 'GET',
        json: true
    };
    if (userInfo) {
        requestOptions.auth = {
            user: userInfo.username,
            password: userInfo.hash
        };
    } else if (deviceInfo) {
        requestOptions.auth = {
            user: deviceInfo.deviceid.toString(),
            password: deviceInfo.devicehash
        };
    }
    if (typeof param === "string") {
        // pass param as URL query parameter
        requestOptions.uri = baseUrl + '/api/photos?' + param;
    } else {
        // pass id as REST path parameter
        requestOptions.uri = baseUrl + '/api/photos' + (param?`/${param}`:'');
    }
    return await request(requestOptions);
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

async function insertPhoto(deviceInfo, userInfo, rootid) {
    // send a photo
    const requestOptions = {
        uri: baseUrl + '/api/photos',
        method: 'POST',
        json: true,
        body: {
            deviceid: deviceInfo.deviceid,
            devicehash: deviceInfo.devicehash,
            latitude: 52.3423,
            longitude: 4.913040,
            accuracy: 10,
            rootid: rootid,
            photo: fs.readFileSync(__dirname + '/trees.jpg').toString('base64')
        }
    };
    if (userInfo) {
        requestOptions.auth = {
            user: userInfo.username,
            password: userInfo.hash
        };
    } else if (deviceInfo) {
        requestOptions.auth = {
            user: deviceInfo.deviceid.toString(),
            password: deviceInfo.devicehash
        };
    }
    const insertPhotoresult = await request(requestOptions);
    return insertPhotoresult;
}

async function updatePhoto(deviceInfo, userInfo, id, photoInfo) {
    // send a photo
    const requestOptions = {
        uri: baseUrl +  `/api/photos/${id}`,
        method: 'PUT',
        json: true,
        body: photoInfo
    };
    if (userInfo) {
        requestOptions.auth = {
            user: userInfo.username,
            password: userInfo.hash
        };
    } else if (deviceInfo) {
        requestOptions.auth = {
            user: deviceInfo.deviceid.toString(),
            password: deviceInfo.devicehash
        };
    }
    const updatePhotoresult = await request(requestOptions);
    return updatePhotoresult;
}


async function downloadPhoto(uri) {
    const downloadResult = await request({
        uri: baseUrl + '/uploads/' + uri,
        method: 'GET',
        json: false
    });
    return downloadResult;
}

async function deletePhoto(deviceInfo, userInfo, id) {
    const requestOptions = {
        uri: baseUrl + '/api/photos' + (id?`/${id}`:''),
        method: 'DELETE',
        json: true,
        body: {}
    };
    if (userInfo) {
        requestOptions.auth = {
            user: userInfo.username,
            password: userInfo.hash
        };
    } else if (deviceInfo) {
        requestOptions.auth = {
            user: deviceInfo.deviceid.toString(),
            password: deviceInfo.devicehash
        };
    }
    const deletePhotoResult = await request(requestOptions);
    return deletePhotoResult;
}

async function testInsertAndDelete(thisDevice, thisUser)
{
    const insertFirstPhotoResult = await insertPhoto(thisDevice, thisUser, 0);
    console.log(JSON.stringify(insertFirstPhotoResult));

    const smallFirstPhoto = await downloadPhoto('small/' + insertFirstPhotoResult.uri);
    console.log(`smallFirstPhoto downloaded, size: ${smallFirstPhoto.length}`);

    const insertSecondPhotoResult = await insertPhoto(thisDevice, thisUser, insertFirstPhotoResult.id);
    console.log(JSON.stringify(insertSecondPhotoResult));

    const insertThirdPhotoResult = await insertPhoto(thisDevice, thisUser, insertFirstPhotoResult.id);
    console.log(JSON.stringify(insertThirdPhotoResult));

    const myPhotoList = await getPhotos('myphotos=true', thisDevice, thisUser);
    console.log(`My photo list has ${myPhotoList.length} photos`);

    const updatedPhoto = await updatePhoto(thisDevice, thisUser, insertThirdPhotoResult.id, {description:'updated description', tags: [{"5":"2 cm"}], rotate: 90});
    console.log('updatedPhoto: ' + JSON.stringify(updatedPhoto));
    const rotatedPhoto = await updatePhoto(thisDevice, thisUser, insertThirdPhotoResult.id, {rotate: -90});
    console.log('rotatedPhoto: ' + JSON.stringify(rotatedPhoto));

    const testPhotoset = await getPhotoSets(insertFirstPhotoResult.id);
    console.log(`testPhoteset now has ${testPhotoset.photos.length} photos`);

    const deleteSecondPhotoResult = await deletePhoto(thisDevice, thisUser, insertSecondPhotoResult.id);
    console.log(JSON.stringify(deleteSecondPhotoResult));

    const testSmallerPhotoset = await getPhotoSets(insertFirstPhotoResult.id);
    console.log(`testSmallerPhoteset now has ${testSmallerPhotoset.photos.length} photos`);

    const deleteFirstPhotoResult = await deletePhoto(thisDevice, thisUser, insertFirstPhotoResult.id);
    console.log(JSON.stringify(deleteFirstPhotoResult));

    const testEmptyPhotoset = await getPhotoSets(insertFirstPhotoResult.id);
    console.log(`testEmptyPhoteset now has ${testEmptyPhotoset.photos.length} photos`);

    const lastPhotoPhotoset = await getPhotoSets(insertThirdPhotoResult.id);
    console.log(`lastPhotoPhoteset now has ${lastPhotoPhotoset.photos.length} photos`);

    const deleteThirdPhotoResult = await deletePhoto(thisDevice, thisUser, insertThirdPhotoResult.id);
    console.log(JSON.stringify(deleteThirdPhotoResult));
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

    aboutMe.users[0].allowmailing = !aboutMe.users[0].allowmailing;
    aboutMe.users[0].displayname = aboutMe.users[0].displayname ? null : 'My Full Displayname';
    const updatedMe = await updateUser(thisDevice, thisUser, aboutMe.users[0]);
    console.log(JSON.stringify(updatedMe));

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

    const longPhotosets = await getPhotoSets('minPhotos=85');
    console.log(`Number of long photosets: ${longPhotosets.length}`);

    const taggedFigPhotosets = await getPhotoSets('tags=fig');
    console.log(`Number of photosets with photos tagged '#fig': ${taggedFigPhotosets.length}`);

    const taggedFigOrOakPhotosets = await getPhotoSets('tags=fig,oak');
    console.log(`Number of photosets with photos tagged '#fig' or '#oak': ${taggedFigOrOakPhotosets.length}`);
    
    const getLikes = await getPhotoSetLikes(thisUser, 737);
    console.log(JSON.stringify(getLikes));

    const likeResult = await likePhotoSet(thisUser, 737);
    console.log(JSON.stringify(likeResult));

    await testInsertAndDelete(thisDevice, null);
    await testInsertAndDelete(thisDevice, thisUser);

    const highlightResult = await highlightPhotoset(thisUser, 737, false);
    console.log(JSON.stringify(highlightResult));

    const highlightResult2 = await highlightPhotoset(thisUser, -1, true);
    console.log(JSON.stringify(highlightResult2));

}

testAll();

