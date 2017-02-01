'use strict';
/*
app.js
assumes openlayers.js and proj4.js are loaded

Main objects in this module:

_utils: general utility functions
OLMap: openlayers, geolocation
PhotoServer: communication with remote geographic photo server
App: UI and handler hooks into OLMap

*/

/* global document, console, ol, Image, CameraPreview, StatusBar, localStorage */

Number.prototype.toRad = function() { // helper
    return this * Math.PI / 180;
};

var _utils = {
    hideElement: function (selector) {
        var element = document.querySelector(selector);
        if (element) {
            element.classList.add('hidden');
        }
    },
    showElement: function(selector) {
        var element = document.querySelector(selector);
        if (element) {
            element.classList.remove('hidden');
        }
    },
    disableElement: function(selector) {
        var element = document.querySelector(selector);
        if (element) {
            element.setAttribute('disabled', '');
            // componentHandler.upgradeElement(element);
        }
    },
    enableElement: function(selector) {
        var element = document.querySelector(selector);
        if (element) {
            element.removeAttribute('disabled');
            // componentHandler.upgradeElement(element);
        }
    },
    // calculate world distance in km between two world points (lat/lon)
    calculateDistance: function(pos1, pos2) {
        var R = 6371; // km
        var dLon = (pos2[0] - pos1[0]).toRad();
        var dLat = (pos2[1] - pos1[1]).toRad();
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(pos1[1].toRad()) * Math.cos(pos2[1].toRad()) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
};

// object for communicating with remote photoserver
var PhotoServer = new function() {
  var photoServer = this;

  this.init = function(serverURL)  {
      this.server = serverURL;
  };

  // reset cache time
  this.resetCacheTime = function()
  {
      window.localStorage.cacheTime = Date.now();
  };

  // get cache time, updated to now if older then 10 minutes
  this.getCacheTime = function() {
    var now = Date.now();
    var cacheTime;
    if (window.localStorage.cacheTime) {
        cacheTime = window.localStorage.cacheTime;
        if (now - cacheTime > 10 * 60 * 1000 /* 10 minutes */) {
            cacheTime = now;
            window.localStorage.cacheTime = cacheTime;
        }
    } else {
        cacheTime = now;
        window.localStorage.cacheTime = cacheTime;
    }
    return cacheTime;
  };

  this.photoLayer = null;
  this.updatePhotos = function() {
    //adds or reloads photo positions into Photolayer
    if (photoServer.photoLayer) {
        // update source
        photoServer.photoLayer.setSource(
            new ol.source.Vector({
                projection: 'EPSG:4326',
                url: photoServer.server + '/photoserver/getphotos?' + photoServer.getCacheTime(), // File created in node
                format: new ol.format.GeoJSON()
            })
        );
    } else {
        photoServer.photoLayer = new ol.layer.Vector({
            source: new ol.source.Vector({
                projection: 'EPSG:4326',
                url: photoServer.server + '/photoserver/getphotos?' + photoServer.getCacheTime(), // File created in node
                format: new ol.format.GeoJSON()
            }),
            style: new ol.style.Style({
                image: new ol.style.RegularShape({
                        radius: 12,
                        points: 4,
                        angle: Math.PI / 4,
                        fill: new ol.style.Fill({
                            color: 'red'
                        }),
                        stroke: new ol.style.Stroke({
                            color: 'black',
                            width: 1
                        })
                    })
                    //image: new ol.style.Circle({ radius: 4, fill: new ol.style.Fill({color: 'red'}), stroke: new ol.style.Stroke({color: 'black', width: 1})})

            })
        });
    }
    return photoServer.photoLayer;
  };

  // return url to large version of photo
  this.bigPhotoUrl = function(photofile) {
    if (photofile.substr(-4, 4) === '.gif') {
        /* todo: add cache update to url for gif, sequence number? */
        return photoServer.server + '/uploads/' + photofile;
    }
    return photoServer.server + '/uploads/' + photofile;
  };

  // ensure this device is registered with server
  this.ensureDeviceRegistration = function(done)
  {
    if (window.localStorage) {
        var email = window.localStorage.email;
        var hash = window.localStorage.hash;
        var deviceid = window.localStorage.deviceid;
        var devicehash = window.localStorage.devicehash;
        if ((!deviceid) || (deviceid==='undefined') || (!devicehash) || (devicehash==='undefined') ) {
            var xhr = new XMLHttpRequest();
            var formData = 'username=' + email +  '&hash=' + hash;
            xhr.open('POST', photoServer.server+'/photoserver/createdevice');
            xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
            // xhr.responseType = 'json'; // DOES NOT WORK ON ANDROID 4.4!
            xhr.onreadystatechange = function (event) {
               if (xhr.readyState === 4) {
                   if (xhr.status === 200) {
                     var result = JSON.parse(xhr.responseText);
                     window.localStorage.deviceid = result.deviceid;
                     window.localStorage.devicehash = result.devicehash;
                     if (done) {
                        done(true);
                     }
                   } else {
                     if (done) {
                       done(false);
                     }
                     console.log ('Error registering device: ' + xhr.statusText);
                   }
               }
            };
            xhr.send(formData);
        } else {
            // device already registered
            if (done) {
                done(true);
            }
        }
    } else {
        // cannot register without window.localStorage
        if (done) {
            done(false);
        }
    }
  };


  // upload picture contents (photodata) to photoserver
  this.uploadPhotoData = function(imagedata, rootid, location, accuracy, callback) {
      var xhr = new XMLHttpRequest();
      var formData = 'photo=' + encodeURIComponent(imagedata) + '&latitude=' + location[1] + '&longitude=' + location[0] + '&accuracy=' + accuracy + '&username=' + window.localStorage.email +  '&hash=' + window.localStorage.hash + '&rootid=' + rootid + '&deviceid=' + window.localStorage.deviceid + '&devicehash=' + window.localStorage.devicehash;
      xhr.open('POST', photoServer.server + '/photoserver/sendphoto');
      xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
      xhr.onreadystatechange = function (event) {
         if (xhr.readyState === 4) {
             if (xhr.status === 200) {
               callback (null, xhr.responseText);
             } else {
                callback('Error', xhr.statusText);
             }
         }
      };
      xhr.send(formData);
  };

  // get all my photos and call callback(err, photoarray)
  this.getMyPhotos = function(callback) {
        var xhr = new XMLHttpRequest();
        var formData = 'username=' + window.localStorage.email +  '&hash=' + window.localStorage.hash + '&deviceid=' + window.localStorage.deviceid + '&devicehash=' + window.localStorage.devicehash;
        xhr.open('POST', photoServer.server+'/photoserver/getmyphotos');
        xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
        xhr.onreadystatechange = function (event) {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    callback (null, xhr.responseText);
                } else {
                    callback('Error', xhr.statusText);
                }
            }
        };
        xhr.send(formData);
  };

    this.deletePhoto = function(photo, callback) {
        var xhr = new XMLHttpRequest();
        var formData = 'username=' + window.localStorage.email +  '&hash=' + window.localStorage.hash + '&filename=' + photo.filename + '&deviceid=' + window.localStorage.deviceid + '&devicehash=' + window.localStorage.devicehash;
        xhr.open('POST', this.server+'/photoserver/deletemyphoto');
        xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
        xhr.onreadystatechange = function (event) {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    callback (null, xhr.responseText);
                } else {
                    callback('Error', xhr.statusText);
                }
            }
        };
        xhr.send(formData);
    };

    this.rotateMyPhoto = function(photo, degrees, callback) {
        var xhr = new XMLHttpRequest();
        var formData = 'degrees=' + degrees + '&username=' + window.localStorage.email +  '&hash=' + window.localStorage.hash + '&filename=' + photo.filename + '&deviceid=' + window.localStorage.deviceid + '&devicehash=' + window.localStorage.devicehash;
        xhr.open('POST', this.server+'/photoserver/rotatemyphoto');
        xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
        xhr.onreadystatechange = function (event) {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    callback (null, xhr.responseText);
                } else {
                    callback('Error', xhr.statusText);
                }
            }
        };
        xhr.send(formData);
    };

    this.emailValidationCode = function(email, callback)
    {
        var xhr = new XMLHttpRequest();
        var formData = 'email=' + encodeURIComponent(email);
        xhr.open('POST', photoServer.server+'/photoserver/validatemail');
        xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
        xhr.onreadystatechange = function (event) {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    callback(false, 'mail sent, please check your email...');
                } else {
                    callback(true, 'Error' + xhr.statusText);
                }
            }
        };
        xhr.send(formData);
    };

    this.validateuser = function(email, code, deviceid, devicehash, callback)
    {
        var xhr = new XMLHttpRequest();
        var formData = 'email=' + encodeURIComponent(email) + '&validationcode=' + encodeURIComponent(code)  + '&deviceid=' + encodeURIComponent(localStorage.deviceid) + '&devicehash=' + encodeURIComponent(localStorage.devicehash);
        xhr.open('POST', photoServer.server+'/photoserver/validateuser');
        xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
        xhr.onreadystatechange = function (event) {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    if (xhr.responseText.length !== 32) {
                        callback (true, 'Validation failed: ' + xhr.responseText);
                    } else {
                        var hash = xhr.responseText;
                        callback (false, hash);
                    }
                } else {
                    callback (true, 'Request error, http status: ' + xhr.status + ', statusText: ' + xhr.statusText);
                }
            }
        };
        xhr.send(formData);
    };

    this.checkuser = function(callback)
    {
        var xhr = new XMLHttpRequest();
        if (localStorage.email) {
            window.localStorage.email = window.localStorage.email.trim().toLowerCase();
        }
        var formData = 'email=' + encodeURIComponent(localStorage.email) + '&hash=' + encodeURIComponent(localStorage.hash) + '&deviceid=' + encodeURIComponent(localStorage.deviceid) + '&devicehash=' + encodeURIComponent(localStorage.devicehash);
        xhr.open('POST', photoServer.server+'/photoserver/checkuser');
        xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
        // xhr.responseType = 'json'; // DOES NOT WORK ON ANDROID 4.4!
        xhr.onreadystatechange = function (event) {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    var result = JSON.parse(xhr.responseText);
                    if (result.error) {
                        callback('Error', result.error);
                    } else {
                        if (result.knownuser) {
                            callback(null, true);
                        } else {
                            callback(null, false);
                        }
                    }
                } else {
                    callback ('Request error, http status: ' + xhr.status + ', statusText: ' + xhr.statusText);
                }
            }
        };
        xhr.send(formData);
    };
}(); // PhotoServer

var OLMap = new function() {
    var olMap = this;

    this.init = function(mapId, featureFieldName) {
        olMap.initMap(mapId);
        olMap.initGeoLocation();
        olMap.initDragHandler();
        olMap.initPanZoomHandler();
        olMap.initClickFeatureHandler(featureFieldName);
    };

    this.initMap = function (mapId) {
        this.photoLayer = PhotoServer.updatePhotos();
        this.openStreetMapLayer = new ol.layer.Tile({
            source: new ol.source.OSM({
                url: 'https://saturnus.geodan.nl/mapproxy/osm/tiles/osmgrayscale_EPSG900913/{z}/{x}/{y}.png?origin=nw'
            })
        });
        this.layers = [
            this.openStreetMapLayer,
            this.photoLayer
        ];
        this.olmap = new ol.Map({
            layers: this.layers,
            target: mapId,
            controls: [],
            view: new ol.View({
                projection: 'EPSG:3857',
                center: ol.proj.transform([4.913024, 52.34223], 'EPSG:4326', 'EPSG:3857'), //Geodan Amsterdam
                zoom: 16
            })
        });
    };/* initMap */

    this.geoLocationErrorHandler = function(message) {
        console.warn('unhandled geolocation Error: ' + message);
    };

    this.geoLocationChangedHandler = function(coordinates) {
        console.warn('unhandled geolocation Changed handler');
    };

    this.initGeoLocation = function ()
    {
        // geolocation
        this.geoLocation = new ol.Geolocation({
        projection: this.olmap.getView().getProjection(),
        tracking: true,
        trackingOptions: {
                enableHighAccuracy: true
            }
        });
        this.accuracyFeature = new ol.Feature();
        this.geoLocation.on('change:accuracyGeometry', function() {
            olMap.accuracyFeature.setGeometry(olMap.geoLocation.getAccuracyGeometry());
        });

        this.positionFeature = new ol.Feature();
        this.positionFeature.setStyle(new ol.style.Style({
            image: new ol.style.Circle({
                radius: 6,
                fill: new ol.style.Fill({
                    color: '#3399CC'
                }),
                stroke: new ol.style.Stroke({
                    color: '#fff',
                    width: 2
                })
            })
        }));
        this.mapTracking = true;
        this.geoLocation.on('change:position', function() {
            var coordinates = olMap.geoLocation.getPosition();
            olMap.positionFeature.setGeometry(coordinates ?
                new ol.geom.Point(coordinates) : null);
            if (coordinates && olMap.mapTracking) {
                olMap.isManualMove = false;
                olMap.olmap.getView().setCenter(coordinates);
                setTimeout(function() {
                    olMap.isManualMove = true;
                }, 300);
            }
            olMap.geoLocationChangedHandler(coordinates);
        });
        new ol.layer.Vector({
            map: this.olmap,
                 source: new ol.source.Vector({
                    features: [this.accuracyFeature, this.positionFeature]
                 })
        });

        // handle geolocation error.
        this.geoLocation.on('error', function(error) {
            olMap.geoLocationErrorHandler(error.message);
        });
    };

    this.dragStart = false;
    this.dragPrevPixel = null;

    this.dragHandler = function (status, pixel, prevpixel) {
        console.log ('dragging: ' + status + ', current: ' + JSON.stringify(pixel) + ', prevpoint: ' + JSON.stringify(prevpixel));
    };

    this.initDragHandler = function() {
      this.olmap.on('pointerdrag', function (event){ // pointerdrag is OL3 experimental
          if (!olMap.dragStart) {
            olMap.dragStart = true;
            olMap.dragStartPixel = olMap.dragPrevPixel = event.pixel;
            olMap.dragHandler('dragstart', event.pixel, event.pixel);
          } else {
            olMap.dragHandler('dragging', event.pixel, olMap.dragPrevPixel);
            olMap.dragPrevPixel = event.pixel;
          }
      });
      this.olmap.on('moveend', function (event){
          if (olMap.dragStart) {
              olMap.dragStart = false;
              olMap.dragHandler('dragend', olMap.dragPrevPixel, olMap.dragPrevPixel);
          } else {
            olMap.dragHandler('moveend', null, null);
          }
      });
    };

    this.panZoomHandler = function(status) {
      console.log('panzoom: ' + status);
    };

    this.initPanZoomHandler = function () {
      this.olmap.getView().on('change:resolution', function(){
          olMap.panZoomHandler('zoom');
      });
    };

    /* find first feature at pixel that has featureFieldName */
    this.getFeatureFromPixel = function(pixel, featureFieldName) {
      var resultfeature = null;
      this.olmap.forEachFeatureAtPixel(pixel, function(feature, layer) {
        if (feature.get(featureFieldName)) {
            resultfeature = feature;
            return true; // feature found
        } else {
            return false; // try next feature
        }
      });
      return resultfeature;
    };

    this.clickFeatureHandler = function (feature) {
        console.log('feature: ' + feature);
    };

    this.initClickFeatureHandler = function(featureFieldName) {
        this.olmap.on('click', function(event){
            if (!event.dragging) {
                olMap.clickFeatureHandler(olMap.getFeatureFromPixel(olMap.olmap.getEventPixel(event.originalEvent), featureFieldName));
            }
        });
    };
};

// main app object
var App = new function() {
    // set self (geodan policy: use lowercase class name)
    var app = this;


    this.init = function(server, mapId, isMobileDevice) {

        // store setup for mobile device or web
        this.isMobileDevice = isMobileDevice;

        this.featureInfoPopupInit();
        this.cameraPopupInit();

        // initialize photoServer object
        PhotoServer.init(server);

        // setup handler hooks into OLMap
        OLMap.geoLocationErrorHandler = this.geoLocationErrorHandler;
        OLMap.geoLocationChangedHandler = this.geoLocationChangedHandler;
        OLMap.dragHandler = this.mapDragHandler;
        OLMap.clickFeatureHandler = this.clickFeatureHandler;
        OLMap.panZoomHandler = this.panZoomHandler;
        // intialise OLMap
        OLMap.init(mapId, 'filename');
        this.buttonLocation = document.querySelector('#gapp_button_location');
        this.buttonLocation.addEventListener('click', function(){app.setMapTracking(!OLMap.mapTracking);});

        window.addEventListener('hashchange', this.navigate.bind(this), false);
        this.showStoredMessage();
    };

    this.showStoredMessage = function () {
        if (window.localStorage.storedMessage && window.localStorage.storedMessage !== '') {
            this.showMessage(window.localStorage.storedMessage);
            window.localStorage.removeItem('storedMessage');
        }
    };

    this.hideDrawer = function() {
        var drawer = document.querySelector('.mdl-layout__drawer');
        if (drawer.classList.contains('is-visible')) {
            var layout = document.querySelector('.mdl-layout');
            layout.MaterialLayout.toggleDrawer();
        }
    };

    /* remove any overlay layers and optionally add named layer */
    this.updateLayers = function(layername) {
        var legendvertical = document.querySelector('#gapp_legendvertical');
        var legendhorizontal = document.querySelector('#gapp_legendhorizontal');
        var legendmin = document.querySelectorAll('.legendmin');
        var legendmax = document.querySelectorAll('.legendmax');
        legendvertical.classList.add('hidden');
        legendhorizontal.classList.add('hidden');
        [].forEach.call(legendmin, function (element) {
            element.innerHTML = '';
        });
        [].forEach.call(legendmax, function (element) {
            element.innerHTML = '';
        });
        var layers = OLMap.olmap.getLayers();
        if (layers.getLength() > 2) {
            layers.removeAt(1);
        }
        var orientation = 'h';
        if (window.innerWidth < window.innerHeight) {
            orientation = 'v';
        }

        // prepare and show legend
        if (layername !== '') {
            var image = document.querySelector('#legendimagev');
            image.src = layername.substring(1) + 'v.png';
            image = document.querySelector('#legendimageh');
            image.src = layername.substring(1) + 'h.png';
            if (orientation === 'v') {
                var legendtop = document.querySelector('.legendtop');
                var legendbottom = document.querySelector('.legendbottom');
                if (layername === '#layerseason') {
                    legendtop.classList.add('legendtoprotated');
                    legendbottom.classList.add('legendbottomrotated');
                } else {
                    legendtop.classList.remove('legendtoprotated');
                    legendbottom.classList.remove('legendbottomrotated');
                }
                legendvertical.classList.remove('hidden');
            } else {
                legendhorizontal.classList.remove('hidden');
            }
            if (layername === '#layertrend') {
                [].forEach.call(legendmin, function (element) {
                    element.innerHTML = '-0.3';
                });
                [].forEach.call(legendmax, function (element) {
                    element.innerHTML = '+0.3';
                });
            } else if (layername === '#layerseason') {
                [].forEach.call(legendmin, function (element) {
                    element.innerHTML = 'January';
                });
                [].forEach.call(legendmax, function (element) {
                    element.innerHTML = 'December';
                });
            }
        }

        var mapLayerName = {};
        mapLayerName['#layerseason'] = 'startofseason';
        mapLayerName['#layertrend'] = 'vegetationtrend';
        mapLayerName['#layertemperature'] = 'temperature';

        // add maplayer
        switch(layername) {
            case '#layerseason':
            case '#layertrend':
                var seasonlayer = new ol.layer.Tile({
                    source: new ol.source.XYZ({
                        url: 'http://saturnus.geodan.nl/mapproxy/myseasons/tiles/'+mapLayerName[layername]+'/EPSG900913/{z}/{x}/{y}.png?origin=nw'
                    })
                });
                layers.insertAt(1, seasonlayer);
                break;
            case '#layertemperature':
                var yd = new Date();
                yd.setDate(yd.getDate() - 1);
                var yesterdayString = yd.getFullYear() + '-' + ('0'+(yd.getMonth() + 1)).substr(-2) + '-' + ('0'+yd.getDate()).substr(-2);
                var temperatureLayer = new ol.layer.Tile ({
                    source: new ol.source.XYZ({
                        //url: '//map1{a-c}.vis.earthdata.nasa.gov/wmts-webmerc/' +
                        url: 'http://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
                        'MODIS_Aqua_Land_Surface_Temp_Day/default/'+yesterdayString+'/' +
                        'GoogleMapsCompatible_Level7/{z}/{y}/{x}.png',
                        maxZoom: 7
                    })
                });
                layers.insertAt(1, temperatureLayer);
                break;
        }
    };

    this.toggleLayer = function(layerHash)
    {
        var layerElements = [];
        var layerHashes = ['#layerseason', '#layertrend', '#layertemperature'];
        var layerIds = ['#gapp_layer_season', '#gapp_layer_trend', '#gapp_layer_temperature'];
        var clickedLayer = 0;
        var activeLayer = -1;
        for (var i = 0; i < layerHashes.length; i++) {
            layerElements.push(document.querySelector(layerIds[i]));
            if (layerElements[i].classList.contains('mdl-navigation__link--current')) {
                activeLayer = i;
            }
            if (layerHashes[i] === layerHash) {
                clickedLayer = i;
            }
        }
        if (activeLayer > -1) {
            layerElements[activeLayer].classList.remove('mdl-navigation__link--current');
        }

        if (activeLayer !== clickedLayer) {
            layerElements[clickedLayer].classList.add('mdl-navigation__link--current');
            this.updateLayers(layerHash);
        } else {
            this.updateLayers('');
        }
    };

    this.navigate = function() {
        switch (window.location.hash) {
            case '#managephoto':
                app.hideDrawer();
                if (!app.isMobileDevice) {
                    // web version
                    if (!localStorage.email || window.localStorage.email==='' || !localStorage.hash || window.localStorage.hash==='') {
                        app.showMessage('Web photo management requires user registration');
                        window.location.hash='';
                        return;
                    }
                }
                window.location = 'gallery.html';
                break;
            case '#layerseason':
            case '#layertrend':
            case '#layertemperature':
                this.toggleLayer(window.location.hash);
                this.hideDrawer();
                window.location.hash='';
                break;
            case '#account':
                window.location.hash='';
                window.location= 'account.html';
                break;
            case '#language':
                window.location.hash='';
                window.location = 'language.html';
                break;
            case '#help':
                window.location.hash='';
                window.location = 'help.html';
                break;
            case '#info':
                window.location.hash='';
                window.location = 'info.html';
                break;
        }
    };

    this.featureInfoPopupInit = function()
    {
        this.featureInfoPopup = document.querySelector('#gapp_featureinfo');
        this.featureInfoPopup.show = function() {
            app.featureInfoPopup.classList.remove('hidden');
            document.addEventListener('backbutton', app.featureInfoPopup.hide);
        };

        this.featureInfoPopup.hide = function() {
            app.featureInfoPopup.classList.add('hidden');
            document.removeEventListener('backbutton', app.featureInfoPopup.hide);
            app.activeFeature = null;
        };

        /* todo: zoomable fullscreen photo? http://ignitersworld.com/lab/imageViewer.html */
        this.fullscreenphotopopup = document.querySelector('#gapp_fullscreenphotopopup');
        this.fullscreenphotopopup.show = function() {
            if (typeof StatusBar !== 'undefined') {
                StatusBar.hide();
            }
            app.fullscreenphoto = document.querySelector('#gapp_fullscreenphoto');
            var featureinfophoto = document.querySelector('#gapp_featureinfo_photo');
            app.fullscreenphoto.src = featureinfophoto.src;
            document.removeEventListener('backbutton', app.featureInfoPopup.hide);
            document.addEventListener('backbutton', app.fullscreenphotopopup.hide);
            app.fullscreenphotopopup.classList.remove('hidden');
        };
        this.fullscreenphotopopup.hide = function() {
            if (typeof StatusBar !== 'undefined') {
                StatusBar.show();
            }
            document.removeEventListener('backbutton', app.fullscreenphotopopup.hide);
            document.addEventListener('backbutton', app.featureInfoPopup.hide);
            app.fullscreenphotopopup.classList.add('hidden');
        };

        var gappFeatureInfoClose = document.querySelector('#gapp_featureinfo_close');
        gappFeatureInfoClose.addEventListener('click', app.featureInfoPopup.hide);

        var gappFeatureInfoFullScreen = document.querySelector('#gapp_featureinfo_fullscreen');
        gappFeatureInfoFullScreen.addEventListener('click', app.fullscreenphotopopup.show);

        var gappFeatureInfoFullScreenClose = document.querySelector('#gapp_fullscreenphotopopup_close');
        gappFeatureInfoFullScreenClose.addEventListener('click', app.fullscreenphotopopup.hide);

        var buttonFeatureInfoAddPhoto = document.querySelector('#gapp_featureinfo_addphoto');
        buttonFeatureInfoAddPhoto.addEventListener('click', function(){
            PhotoServer.ensureDeviceRegistration(function(result) {
                if (result) {
                    var url = app.featureInfoPhoto.url;
                    var photoid = app.featureInfoPhoto.photoid;
                    if (url.substr(-4, 4) === '.gif') {
                    // overlay_pictue: replace animated picture with first picture
                        url = url.substr(0, url.length -4) + '.jpg';
                    }
                    app.cameraPopup.show(url, photoid);
                } else {
                    // device could not be registered, offline? no window.localStorage?
                    app.showMessage('device registration failed, try again later');
                }
            });
        });
    };

    /* camera window */
    this.cameraPopupInit = function () {
        this.cameraPopup = document.querySelector('#gapp_camera_popup');
        this.cameraPreviewPhoto = document.querySelector('#gapp_camera_photo_preview_frame img');
        this.cameraPopup.show = function(overlayURL, photoid) {
            if (typeof StatusBar !== 'undefined') {
               StatusBar.hide();
            }
            setTimeout(function() {
              if (typeof overlayURL === 'undefined') {
                  overlayURL = null;
                  photoid = 0;
              }
              app.cameraPreviewPhoto.photoid = photoid;
              var cameraOverlayPictureFrame = document.querySelector('#gapp_camera_overlay_picture_frame');
              if (overlayURL) {
                  var cameraOverlayPicture = document.querySelector('#gapp_camera_overlay_picture');
                  cameraOverlayPicture.src = overlayURL;
                  cameraOverlayPictureFrame.classList.remove('hidden');
              } else {
                  cameraOverlayPictureFrame.classList.add('hidden');
              }
              document.addEventListener('backbutton', app.cameraPopup.hide);
              window.addEventListener('orientationchange', app.cameraPopup.resetCamera);
              document.querySelector('#mainUI').classList.add('hidden');
              app.cameraPopup.classList.remove('hidden');
              app.cameraPopup.startCamera();
            }, 100);
        };
        this.cameraPopup.hide = function() {
            document.removeEventListener('backbutton', app.cameraPopup.hide);
            window.removeEventListener('orientationchange', app.cameraPopup.resetCamera);
            app.cameraPopup.stopCamera();
            if (typeof StatusBar !== 'undefined') {
                StatusBar.show();
            }
            document.querySelector('#mainUI').classList.remove('hidden');
            app.cameraPopup.classList.add('hidden');
        };
        this.cameraPopup.startCamera = function() {
            if (app.isMobileDevice) {
                var width = app.cameraPopup.offsetWidth;
                var height = app.cameraPopup.offsetHeight;
                if (width > height) {
                    // landscape
                    if (screen.width > screen.height) {
                        width = screen.width;
                        height = screen.height;
                    } else {
                        width = screen.height;
                        height = screen.width;
                    }
                } else {
                    // portrait
                    if (screen.width < screen.height) {
                        width = screen.width;
                        height = screen.height;
                    } else {
                        width = screen.height;
                        height = screen.width;
                    }
                }
                var tapEnabled = true;
                var dragEnabled = true;
                var toBack = true; // camera z-value can either be completely at the back or completey on top
                CameraPreview.startCamera({x: 0, y: 0, width: width, height: height, camera: 'back', tapPhoto: tapEnabled, previewDrag: dragEnabled, toBack: toBack});
                CameraPreview.setZoom(0);
                window.plugins.insomnia.keepAwake();
            }
        };
        this.cameraPopup.stopCamera = function() {
            if (app.isMobileDevice) {
                CameraPreview.stopCamera();
                window.plugins.insomnia.allowSleepAgain();
            }
        };
        this.cameraPopup.resetCamera = function() {
            /* todo: replace setTimeout by wait for resize event */
            /* todo: resize: handle case where resetCamera() is called by code */
            app.cameraPopup.stopCamera();
            setTimeout(app.cameraPopup.startCamera, 1000);
        };
        var cameraButton = document.querySelector('#gapp_button_camera');
        cameraButton.addEventListener('click', function() {
            PhotoServer.ensureDeviceRegistration(function(result) {
                if (result) {
                    app.cameraPopup.show();
                } else {
                    // device could not be registered, offline? no window.localStorage?
                    app.showMessage('device registration failed, try again later');
                }
            });
        });

        /* Preview Photo taken by camera */
        /* todo: add toggle to show/hide overlay-picture with preview */
        this.cameraPreviewPhotoFrame = document.querySelector('#gapp_camera_photo_preview_frame');
        this.cameraPreviewPhotoFrame.show = function () {
            document.removeEventListener('backbutton', app.cameraPopup.hide);
            document.addEventListener('backbutton', app.cameraPreviewPhotoFrame.hide);
            app.cameraPreviewPhotoFrame.classList.remove('hidden');
        };
        this.cameraPreviewPhotoFrame.hide = function () {
            app.cameraPreviewPhotoFrame.classList.add('hidden');
            document.removeEventListener('backbutton', app.cameraPreviewPhotoFrame.hide);
            document.addEventListener('backbutton', app.cameraPopup.hide);
        };
        this.buttonPreviewPhotoClose = document.querySelector('#gapp_camera_photo_close');
        this.buttonPreviewPhotoClose.addEventListener('click', function() {
            app.cameraPreviewPhotoFrame.hide();
            app.cameraPopup.resetCamera();
        });

        this.buttonPreviewPhotoOk = document.querySelector('#gapp_camera_photo_ok');
        this.buttonPreviewPhotoOk.addEventListener('click', function() {
            app.showMessage('uploading photo...');
            var p = app.cameraPreviewPhoto;
            PhotoServer.uploadPhotoData(p.rawdata, p.photoid, p.myLocation, p.accuracy, function(err, message) {
                if (err) {
                    app.showMessage('Upload failed: ' + message);
                } else {
                    // success! Free memory and close dialog
                    p.rawdata = null;
                    app.cameraPreviewPhoto.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
                    PhotoServer.resetCacheTime(); // reset cache
                    app.photoLayer = PhotoServer.updatePhotos();
                    app.cameraPreviewPhotoFrame.hide();
                    app.cameraPopup.hide();

                }
            });
        });

        var buttonTakePhoto = document.querySelector('#gapp_camera_takephoto');
        buttonTakePhoto.addEventListener('touchstart', function() {
            buttonTakePhoto.classList.remove('mdl-color--white');
            buttonTakePhoto.classList.add('mdl-button--colored');
        });
        buttonTakePhoto.addEventListener('touchmove', function() {
            buttonTakePhoto.classList.remove('mdl-button--colored');
            buttonTakePhoto.classList.add('mdl-color--white');
        });
        buttonTakePhoto.addEventListener('touchend', function() {
            if (buttonTakePhoto.classList.contains('mdl-button--colored')) {
                buttonTakePhoto.classList.remove('mdl-button--colored');
                buttonTakePhoto.classList.add('mdl-color--white');
                // todo: photo shutter animation
                // check if photo orientation is same as overlay-picture orientation
                var orientationOk = true;
                var cameraOverlayPictureFrame = document.querySelector('#gapp_camera_overlay_picture_frame');
                if (!cameraOverlayPictureFrame.classList.contains('hidden')) {
                  var cameraOverlayPicture = document.querySelector('#gapp_camera_overlay_picture');
                  if (window.innerWidth > window.innerHeight) {
                    if (cameraOverlayPicture.width < cameraOverlayPicture.height) {
                      orientationOk = false;
                    }
                  } else if (cameraOverlayPicture.width > cameraOverlayPicture.height) {
                    orientationOk = false;
                  }
                }
                if (orientationOk) {
                  // takePicture fires cordova.plugins.camerapreview.setOnPictureTakenHandler
                  CameraPreview.takePicture();//({maxWidth: 640, maxHeight: 640});
                } else {
                  alert ('Camera orientation wrong, please adjust orientation');
                }
            }
        });

        var cameraClose = document.querySelector('#gapp_camera_close');
        cameraClose.addEventListener('click', app.cameraPopup.hide);
    };

    this.cordovaDeviceReady = function () {
        CameraPreview.setOnPictureTakenHandler(function(result){
            var myLocation = OLMap.geoLocation.getPosition();
            if (myLocation) {
                app.cameraPreviewPhoto.rawdata = result;
                result = null; // free memory
                app.cameraPreviewPhoto.src = 'data:image/jpeg;base64,' + app.cameraPreviewPhoto.rawdata;
                myLocation = ol.proj.transform(myLocation, 'EPSG:3857', 'EPSG:4326');
                var accuracy = OLMap.geoLocation.getAccuracy();
                app.cameraPreviewPhoto.myLocation = myLocation;
                app.cameraPreviewPhoto.accuracy = accuracy;
                app.cameraPreviewPhotoFrame.show();
            } else {
                app.showMessage('Required photo location unknown');
            }
        });
    };

    this.geoLocationErrorHandler = function(message) {
      app.showMessage('location: ' + message);
    };

    this.geoLocationFixed = false;
    this.geoLocationChangedHandler = function (coordinates) {
        if (!app.geoLocationFixed && coordinates) {
            app.geoLocationFixed = true;
            app.buttonLocation.removeAttribute('disabled');
            app.buttonLocation.classList.add('mdl-color--white');
            app.buttonLocation.classList.add('mdl-color-text--blue-700');

            if (app.isMobileDevice) {
                // enable camera button
                var cameraButton = document.querySelector('#gapp_button_camera');
                cameraButton.removeAttribute('disabled');
            }
        }
    };

    // tracking: automatically keep user location in map center on/off
    this.setMapTracking = function(enabled) {
        OLMap.mapTracking = enabled;
        if (enabled) {
            app.buttonLocation.classList.remove('inactive');
            var coordinates = OLMap.geoLocation.getPosition();
            if (coordinates) {
                OLMap.olmap.getView().setCenter(coordinates);
            }
        } else {
            app.buttonLocation.classList.add('inactive');
        }
    };

    this.mapDragHandler = function (status, pixel, prevpixel) {
        switch(status) {
            case 'dragstart':
                app.setMapTracking(false);
                break;
            case 'dragging':
                // drag info window along
                if (app.activeFeature) {
                    app.featureInfoPopup.style.left = (parseInt(app.featureInfoPopup.style.left, 10) - (prevpixel[0] - pixel[0])) + 'px';
                    app.featureInfoPopup.style.top = (parseInt(app.featureInfoPopup.style.top, 10) - (prevpixel[1] - pixel[1])) + 'px';
                }
                break;
            case 'dragend':
            case 'moveend':
                // handle end of kinetic effect after drag
                if (app.activeFeature) {
                    var geometry = app.activeFeature.getGeometry();
                    var coordinates = geometry.getCoordinates();
                    var endpixel = OLMap.olmap.getPixelFromCoordinate(coordinates);

                    app.featureInfoPopup.style.left = endpixel[0] + 'px';
                    app.featureInfoPopup.style.top = (endpixel[1] - 15) + 'px';
                }
                break;
        }
    };

    this.clickFeatureHandler = function(feature) {
        app.featureInfoPopup.hide();
        app.activeFeature = feature;
        if (feature) {
            var geometry = feature.getGeometry();
            var coordinates = geometry.getCoordinates();
            var pixel = OLMap.olmap.getPixelFromCoordinate(coordinates);

            app.featureInfoPopup.style.left = pixel[0] + 'px';
            app.featureInfoPopup.style.top = (pixel[1] - 15) + 'px';

            // calculate distance between user and feature
            var userLocation = OLMap.geoLocation.getPosition();
            var distance = 1000; // initialize at 1000 km
            if (userLocation) {
                distance = _utils.calculateDistance(ol.proj.transform(coordinates, 'EPSG:3857', 'EPSG:4326'), ol.proj.transform(userLocation, 'EPSG:3857', 'EPSG:4326'));
            }

            var picture_url = PhotoServer.bigPhotoUrl(feature.get('filename'));
            var spinner = document.querySelector('#gapp_featureinfo_spinner');
            var errorInfo = document.querySelector('#gapp_featureinfo_error');
            errorInfo.classList.add('hidden');
            app.featureInfoPhoto = document.querySelector('#gapp_featureinfo_photo');
            app.featureInfoPhoto.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
            app.featureInfoPhoto.url = picture_url;
            app.featureInfoPhoto.photoid = feature.get('id');
            spinner.classList.add('is-active');
            var photo = new Image();
            photo.onload = function() {
                spinner.classList.remove('is-active');
                app.featureInfoPhoto.src = app.featureInfoPhoto.url; // not: this.src, may show delayed loading picture
            };
            photo.onerror = function() {
                spinner.classList.remove('is-active');
                errorInfo.classList.remove('hidden');
            };

            photo.src = picture_url;
            var picture_width = feature.get('width');
            var picture_height = feature.get('height');
            var aspectratio = 1.0;
            if (picture_height && picture_width) {
                aspectratio = picture_width / picture_height;
            }
            if (aspectratio >= 1) {
                // landscape
                app.featureInfoPopup.style.width = Math.floor(200 * aspectratio) + 'px';
                app.featureInfoPopup.style.height = '200px';
            }
            else {
                // portrait
                app.featureInfoPopup.style.width = '200px';
                app.featureInfoPopup.style.height = Math.floor(200 / aspectratio) + 'px';
            }

            var addphotobutton = document.querySelector('#gapp_featureinfo_addphoto');
            if (app.isMobileDevice && distance < 0.08) {
                addphotobutton.removeAttribute('disabled');
            }
            else {
                addphotobutton.setAttribute('disabled', '');
            }
            app.featureInfoPopup.show();
        }
    };

    this.panZoomHandler = function(status) {
        switch (status) {
            case 'zoom':
                app.featureInfoPopup.hide();
                app.setMapTracking(false);
                break;
        }
    };

    this.showMessage = function(message, timeout)
    {
        if (typeof timeout === 'undefined') {
            timeout = 2000;
        }
        var data = {
            message: message,
            timeout: timeout
        };
        // init message popups at bottom of screen
        var snackbarContainer = document.querySelector('#gapp-snackbar');
        snackbarContainer.MaterialSnackbar.showSnackbar(data);
    };
};

document.addEventListener('deviceready', App.cordovaDeviceReady, false);
