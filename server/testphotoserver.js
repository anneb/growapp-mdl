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

async function testAll()
{
    try {    
        // check validationcode
        const userHash = await request({
            uri: baseUrl + '/photoserver/validateuser',
            method: 'POST',
            form: {
                    'email': deviceinfo.email,
                    'validationcode': deviceinfo.validationcode
                },
            headers: { /* 'Content-Type': 'application/x-www-form-urlencoded' */}
            });
        if (userHash == 'wrong code') {
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
        } else {
            if (deviceinfo.hash != userHash) {
                deviceinfo.hash=userHash;
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
        }

        // retrieve all photos
        const allPhotos = await request({
            uri:baseUrl+'/photoserver/getphotos',
            json: true
        });
        if (allPhotos.type=='FeatureCollection') {
            console.log('Number of photo locations: ' + allPhotos.features.length);
        } else {
            throw 'unexpected result from getphotos';
        }

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
                rootid: 0,
                photo: fs.readFileSync(__dirname + '/../www/trees.jpg').toString('base64')
            }
        });
        console.log(sendPhotoresult);

    } catch (error) {
        console.log(error);
    };
}

testAll();