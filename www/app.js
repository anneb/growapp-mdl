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

/* global window, document, console, ol, Image, CameraPreview, StatusBar,
   localStorage, XMLHttpRequest, setTimeout, screen */

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
    },
    escapeHTML: function(str) {
     str = str + "";
     var out = "";
     for(var i=0; i<str.length; i++) {
         if(str[i] === '<') {
             out += '&lt;';
         } else if(str[i] === '>') {
             out += '&gt;';
         } else if(str[i] === "'") {
             out += '&#39;';
         } else if(str[i] === '"') {
             out += '&quot;';
         } else {
             out += str[i];
         }
     }
     return out;
    }
};

// object for communication with remote photoserver
var PhotoServer = function() {
  var _photoServer = this;

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

  this.photoSource = null;
  this.updatePhotos = function() {
    //adds or reloads photo positions into photoSource
    _photoServer.photoSource = new ol.source.Vector({
        projection: 'EPSG:4326',
        url: _photoServer.server + '/photoserver/getphotos?' + _photoServer.getCacheTime(), // File created in node
        format: new ol.format.GeoJSON()
    });
    return _photoServer.photoSource;
  };

  // return url to large version of photo
  this.bigPhotoUrl = function(photofile) {
    if (photofile.substr(-4, 4) === '.gif') {
        /* todo: add cache update to url for gif, sequence number? */
        return _photoServer.server + '/uploads/' + photofile;
    }
    return _photoServer.server + '/uploads/' + photofile;
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
            xhr.open('POST', _photoServer.server+'/photoserver/createdevice');
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
  this.uploadPhotoData = function(imagedata, rootid, location, accuracy, description, callback) {
      var xhr = new XMLHttpRequest();
      var formData = 'photo=' + encodeURIComponent(imagedata) + '&latitude=' + location[1] + '&longitude=' + location[0] + '&accuracy=' + accuracy + '&description='+encodeURIComponent(description.description)+'&tags='+encodeURIComponent(JSON.stringify(description.tags))+'&username=' + window.localStorage.email +  '&hash=' + window.localStorage.hash + '&rootid=' + rootid + '&deviceid=' + window.localStorage.deviceid + '&devicehash=' + window.localStorage.devicehash;
      xhr.open('POST', _photoServer.server + '/photoserver/sendphoto');
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
        xhr.open('POST', _photoServer.server+'/photoserver/getmyphotos');
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
        xhr.open('POST', _photoServer.server+'/photoserver/validatemail');
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
        xhr.open('POST', _photoServer.server+'/photoserver/validateuser');
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
        xhr.open('POST', _photoServer.server+'/photoserver/checkuser');
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

    this.getTagList = function (langcode, callback) {
      var xhr = new XMLHttpRequest();
      var formData = 'langcode=' + encodeURIComponent(langcode);
      xhr.open('GET', _photoServer.server+'/photoserver/taglist?'+ formData);
      xhr.onreadystatechange = function (event) {
          if (xhr.readyState === 4) {
              if (xhr.status === 200) {
                  var result = JSON.parse(xhr.responseText);
                  if (result.error) {
                      callback('Error', result.error);
                  } else {
                      callback(null, result);
                  }
              } else {
                  callback ('Request error, http status: ' + xhr.status + ', statusText: ' + xhr.statusText);
              }
          }
      };
      xhr.send(formData);
    };

}; // PhotoServer

var photoServer = new PhotoServer();

var OLMap = function() {
    var _olMap = this;

    this.init = function(mapId, featureFieldName) {
        _olMap.initMap(mapId);
        _olMap.initGeoLocation();
        _olMap.initDragHandler();
        _olMap.initPanZoomHandler();
        _olMap.initClickFeatureHandler(featureFieldName);
    };

    /* define photo icons for display in map */
    // based on materialdesignicons and http://www.rapidtables.com/web/tools/svg-viewer-editor.htm
    var svg_image_area = '<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="24px" height="24px" style="width:24px;height:24px" enable-background="new 0 0 24 24" viewBox="0 0 24 24"><rect x="1" y="3" width="22" height="18" fill="white"/><path fill="green" d="M20,5A2,2 0 0,1 22,7V17A2,2 0 0,1 20,19H4C2.89,19 2,18.1 2,17V7C2,5.89 2.89,5 4,5H20M5,16H19L14.5,10L11,14.5L8.5,11.5L5,16Z" /></svg>';
    var svg_image = '<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="24px" height="24px" style="width:24px;height:24px" enable-background="new 0 0 24 24" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="white"/><path fill="orange" d="M8.5,13.5L11,16.5L14.5,12L19,18H5M21,19V5C21,3.89 20.1,3 19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19Z" /></svg>';
    var svg_image_multiple = '<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="24px" height="24px" style="width:24px;height:24px" enable-background="new 0 0 24 24" viewBox="0 0 24 24"><rect x="5" y="1" width="18" height="18" fill="white"/><path fill="red" d="M22,16V4A2,2 0 0,0 20,2H8A2,2 0 0,0 6,4V16A2,2 0 0,0 8,18H20A2,2 0 0,0 22,16M11,12L13.03,14.71L16,11L20,16H8M2,6V20A2,2 0 0,0 4,22H18V20H4V6" /></svg>';
    var svg_tree = '<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="24px" height="24px" style="width:24px;height:24px" enable-background="new 0 0 24 24" viewBox="0 0 24 24"><rect x="2" y="1" width="20" height="22" fill="green"/><path fill="white" d="M11,21V16.74C10.53,16.91 10.03,17 9.5,17C7,17 5,15 5,12.5C5,11.23 5.5,10.09 6.36,9.27C6.13,8.73 6,8.13 6,7.5C6,5 8,3 10.5,3C12.06,3 13.44,3.8 14.25,5C14.33,5 14.41,5 14.5,5A5.5,5.5 0 0,1 20,10.5A5.5,5.5 0 0,1 14.5,16C14,16 13.5,15.93 13,15.79V21H11Z" /></svg>';
    var svg_tree_fir = '<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="24px" height="24px" style="width:24px;height:24px" enable-background="new 0 0 24 24" viewBox="0 0 24 24"><rect x="2" y="1" width="20" height="22" fill="green"/><path fill="white" d="M10,21V18H3L8,13H5L10,8H7L12,3L17,8H14L19,13H16L21,18H14V21H10Z" /></svg>';
    var image_area = new Image();
    image_area.src = 'data:image/svg+xml;charset=UTF-8,' + escape(svg_image);
    var image_multiple = new Image();
    image_multiple.src = 'data:image/svg+xml;charset=UTF-8,' + escape(svg_image_multiple);

    this.styleFunction = function(feature) {
      var size = feature.get('features').length;
      var style;
      if (size !== 1) {
        style = new ol.style.Style({
          image: new ol.style.Circle({
            radius: 10,
            stroke: new ol.style.Stroke({
              color: '#fff'
            }),
            fill: new ol.style.Fill({
              color: 'green'
            })
          }),
      text: new ol.style.Text({
        text: size.toString(),
        fill: new ol.style.Fill({
          color: '#fff'
        })
      })
        });
    } else {
      var extension = feature.get('features')[0].get('filename').substr(-4,4);
      style = new ol.style.Style({
        image: new ol.style.Icon({
          img: extension === '.gif' ? image_multiple : image_area,
          imgSize: [24,24]
        })
      });
    }
      return [style];
    };

    this.initMap = function (mapId) {
        this.photoSource = photoServer.updatePhotos();
        this.clusterLayer = new ol.layer.Vector({
          source: new ol.source.Cluster({
            distance: 40,
            source: this.photoSource /*new ol.source.Vector({
              projection: 'EPSG:4326',
              url: 'https://phenology.geodan.nl' + '/photoserver/getphotos',
              format: new ol.format.GeoJSON()
            })*/
          }),
          style: _olMap.styleFunction
        });
        this.openStreetMapLayer = new ol.layer.Tile({
            source: new ol.source.OSM({
                url: 'https://saturnus.geodan.nl/mapproxy/osm/tiles/osmgrayscale_EPSG900913/{z}/{x}/{y}.png?origin=nw'
            })
        });
        this.layers = [
            this.openStreetMapLayer,
            this.clusterLayer
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
            _olMap.accuracyFeature.setGeometry(_olMap.geoLocation.getAccuracyGeometry());
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
            var coordinates = _olMap.geoLocation.getPosition();
            _olMap.positionFeature.setGeometry(coordinates ?
                new ol.geom.Point(coordinates) : null);
            if (coordinates && _olMap.mapTracking) {
                _olMap.isManualMove = false;
                _olMap.olmap.getView().setCenter(coordinates);
                setTimeout(function() {
                    _olMap.isManualMove = true;
                }, 300);
            }
            _olMap.geoLocationChangedHandler(coordinates);
        });
        new ol.layer.Vector({
            map: this.olmap,
                 source: new ol.source.Vector({
                    features: [this.accuracyFeature, this.positionFeature]
                 })
        });

        // handle geolocation error.
        this.geoLocation.on('error', function(error) {
            _olMap.geoLocationErrorHandler(error.message);
        });
    };

    this.dragStart = false;
    this.dragPrevPixel = null;

    this.dragHandler = function (status, pixel, prevpixel) {
        console.log ('dragging: ' + status + ', current: ' + JSON.stringify(pixel) + ', prevpoint: ' + JSON.stringify(prevpixel));
    };

    this.initDragHandler = function() {
      this.olmap.on('pointerdrag', function (event){ // pointerdrag is OL3 experimental
          if (!_olMap.dragStart) {
            _olMap.dragStart = true;
            _olMap.dragStartPixel = _olMap.dragPrevPixel = event.pixel;
            _olMap.dragHandler('dragstart', event.pixel, event.pixel);
          } else {
            _olMap.dragHandler('dragging', event.pixel, _olMap.dragPrevPixel);
            _olMap.dragPrevPixel = event.pixel;
          }
      });
      this.olmap.on('moveend', function (event){
          if (_olMap.dragStart) {
              _olMap.dragStart = false;
              _olMap.dragHandler('dragend', _olMap.dragPrevPixel, _olMap.dragPrevPixel);
          } else {
            _olMap.dragHandler('moveend', null, null);
          }
      });
    };

    this.panZoomHandler = function(status) {
      console.log('panzoom: ' + status);
    };

    this.initPanZoomHandler = function () {
      this.olmap.getView().on('change:resolution', function(){
          _olMap.panZoomHandler('zoom');
      });
    };

    var prevFeature = null;
    var prevFeatureIndex = 0;
    /* find feature at pixel that has featureFieldName */
    this.getFeatureFromPixel = function(pixel, featureFieldName) {
      var resultfeature = null;
      this.olmap.forEachFeatureAtPixel(pixel, function(feature, layer) {
        if (feature.get('features')) {
          // clusterfeature, set feature to next feature from cluster
          if (prevFeature === feature) {
            prevFeatureIndex++;
            if (prevFeatureIndex >= feature.get('features').length) {
              prevFeatureIndex = 0;
            }
          } else {
            prevFeature = feature;
            prevFeatureIndex = 0;
          }
          feature = feature.get('features')[prevFeatureIndex];
        }
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
                _olMap.clickFeatureHandler(_olMap.getFeatureFromPixel(_olMap.olmap.getEventPixel(event.originalEvent), featureFieldName));
            }
        });
    };
};

var olMap = new OLMap();

// main app object
var App = function() {
    // set self (geodan policy: use lowercase class name)
    var _app = this;


    this.init = function(server, mapId, isMobileDevice) {
        // update account info in drawer if available
        if (window.localStorage.email && window.localStorage.email !== '') {
          var accountinfo = document.querySelector('#gapp_account_info');
          if (window.localStorage.displayName && window.localStorage.displayName !== '') {
            accountinfo.innerHTML = _utils.escapeHTML(window.localStorage.displayName);
          } else {
            accountinfo.innerHTML = window.localStorage.email;
          }
        }
        if (window.localStorage) {
          if (window.localStorage.langcode && window.localStorage.langcode !== '') {
            this.langcode = window.localStorage.langcode;
          } else {
            /* todo: get preferred language from device, find best app match */
            this.langcode = 'en';
            window.localStorage.langcode = this.langcode;
          }
        } else {
          this.langcode = 'en';
        }

        // store setup for mobile device or web
        this.isMobileDevice = isMobileDevice;

        this.featureInfoPopupInit();
        this.cameraPopupInit();

        // initialize photoServer object
        photoServer.init(server);

        // setup handler hooks into olMap
        olMap.geoLocationErrorHandler = this.geoLocationErrorHandler;
        olMap.geoLocationChangedHandler = this.geoLocationChangedHandler;
        olMap.dragHandler = this.mapDragHandler;
        olMap.clickFeatureHandler = this.clickFeatureHandler;
        olMap.panZoomHandler = this.panZoomHandler;
        // intialise olMap
        olMap.init(mapId, 'filename');
        this.buttonLocation = document.querySelector('#gapp_button_location');
        this.buttonLocation.addEventListener('click', function(){_app.setMapTracking(!olMap.mapTracking);});

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
        var layers = olMap.olmap.getLayers();
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

    // always display legend on longest side of screen
    window.addEventListener("orientationchange", function() {
      var legendvertical = document.querySelector("#gapp_legendvertical");
      var legendhorizontal = document.querySelector("#gapp_legendhorizontal");
      if (!legendvertical.classList.contains("hidden")) {
        legendvertical.classList.add("hidden");
        legendhorizontal.classList.remove("hidden");
      } else if (!legendhorizontal.classList.contains("hidden")) {
        legendhorizontal.classList.add("hidden");
        legendvertical.classList.remove("hidden");
      }
    });

    this.navigate = function() {
        switch (window.location.hash) {
            case '#managephoto':
                _app.hideDrawer();
                if (!_app.isMobileDevice) {
                    // web version
                    if (!localStorage.email || window.localStorage.email==='' || !localStorage.hash || window.localStorage.hash==='') {
                        _app.showMessage('Web photo management requires user registration');
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
            _app.featureInfoPopup.classList.remove('hidden');
            document.addEventListener('backbutton', _app.featureInfoPopup.hide);
        };

        this.featureInfoPopup.hide = function() {
            _app.featureInfoPopup.classList.add('hidden');
            document.removeEventListener('backbutton', _app.featureInfoPopup.hide);
            _app.activeFeature = null;
        };

        this.featureInfoPopup.toggleInfo = function() {
          var infoText = document.querySelector('#gapp_featureinfo_infotext');
          var infoText2 = document.querySelector('#gapp_fullscreenphotopopup_infotext');
          if (infoText.classList.contains('hidden')) {
            infoText.classList.remove('hidden');
            infoText2.classList.remove('hidden');
          } else {
            infoText.classList.add('hidden');
            infoText2.classList.add('hidden');
          }
        };

        /* todo: zoomable fullscreen photo? http://ignitersworld.com/lab/imageViewer.html */
        this.fullscreenphotopopup = document.querySelector('#gapp_fullscreenphotopopup');
        this.fullscreenphotopopup.show = function() {
            if (typeof StatusBar !== 'undefined') {
                StatusBar.hide();
            }
            _app.fullscreenphoto = document.querySelector('#gapp_fullscreenphoto');
            var featureinfophoto = document.querySelector('#gapp_featureinfo_photo');
            _app.fullscreenphoto.src = featureinfophoto.src;
            document.removeEventListener('backbutton', _app.featureInfoPopup.hide);
            document.addEventListener('backbutton', _app.fullscreenphotopopup.hide);
            _app.fullscreenphotopopup.classList.remove('hidden');
        };
        this.fullscreenphotopopup.hide = function() {
            if (typeof StatusBar !== 'undefined') {
                StatusBar.show();
            }
            document.removeEventListener('backbutton', _app.fullscreenphotopopup.hide);
            document.addEventListener('backbutton', _app.featureInfoPopup.hide);
            _app.fullscreenphotopopup.classList.add('hidden');
        };

        var gappFeatureInfoClose = document.querySelector('#gapp_featureinfo_close');
        gappFeatureInfoClose.addEventListener('click', _app.featureInfoPopup.hide);

        var gappFeatureInfoFullScreen = document.querySelector('#gapp_featureinfo_fullscreen');
        gappFeatureInfoFullScreen.addEventListener('click', _app.fullscreenphotopopup.show);

        var gappFeatureInfo = document.querySelector('#gapp_featureinfo_info');
        gappFeatureInfo.addEventListener('click', _app.featureInfoPopup.toggleInfo);

        var gappFullScreenPhotoInfo = document.querySelector('#gapp_fullscreenphotopopup_info');
        gappFullScreenPhotoInfo.addEventListener('click', _app.featureInfoPopup.toggleInfo);

        var gappFeatureInfoFullScreenClose = document.querySelector('#gapp_fullscreenphotopopup_close');
        gappFeatureInfoFullScreenClose.addEventListener('click', _app.fullscreenphotopopup.hide);

        var buttonFeatureInfoAddPhoto = document.querySelector('#gapp_featureinfo_addphoto');
        buttonFeatureInfoAddPhoto.addEventListener('click', function(){
            photoServer.ensureDeviceRegistration(function(result) {
                if (result) {
                    var url = _app.featureInfoPhoto.url;
                    var photoid = _app.featureInfoPhoto.photoid;
                    if (url.substr(-4, 4) === '.gif') {
                    // overlay_pictue: replace animated picture with first picture
                        url = url.substr(0, url.length -4) + '.jpg';
                    }
                    _app.overlayURL = url;
                    _app.cameraPopup.show(url, photoid);
                } else {
                    // device could not be registered, offline? no window.localStorage?
                    _app.showMessage('device registration failed, try again later');
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
              _app.cameraPreviewPhoto.photoid = photoid;
              var cameraOverlayPictureFrame = document.querySelector('#gapp_camera_overlay_picture_frame');
              if (overlayURL) {
                  var cameraOverlayPicture = document.querySelector('#gapp_camera_overlay_picture');
                  cameraOverlayPicture.src = overlayURL;
                  cameraOverlayPictureFrame.classList.remove('hidden');
              } else {
                  cameraOverlayPictureFrame.classList.add('hidden');
              }
              document.addEventListener('backbutton', _app.cameraPopup.hide);
              // todo: do not reset camera when preview picture active
              window.addEventListener('orientationchange', _app.cameraPopup.resetCamera);
              document.querySelector('#mainUI').classList.add('hidden');
              _app.cameraPopup.classList.remove('hidden');
              _app.cameraPopup.startCamera();
            }, 100);
        };
        this.cameraPopup.hide = function() {
            document.removeEventListener('backbutton', _app.cameraPopup.hide);
            window.removeEventListener('orientationchange', _app.cameraPopup.resetCamera);
            _app.cameraPopup.stopCamera();
            if (typeof StatusBar !== 'undefined') {
                StatusBar.show();
            }
            document.querySelector('#mainUI').classList.remove('hidden');
            _app.cameraPopup.classList.add('hidden');
        };

        this.cameraPopup.OverlayFit = function(width, height, camWidth, camHeight, cameraAspectRatio) {
          if (_app.overlayURL) {
            var overlayPictureFrame = document.querySelector('#gapp_camera_overlay_picture_frame');
            var overlayPicture = document.querySelector('#gapp_camera_overlay_picture');
            var overlayAspectRatio = overlayPicture.naturalHeight / overlayPicture.naturalWidth;
            var overlayWidth = 0, overlayHeight = 0, overlayLeft = 0, overlayTop = 0;
            if (overlayAspectRatio > cameraAspectRatio) {
              // overlay photo taller than camera photo
              overlayWidth = camHeight / overlayAspectRatio;
              overlayHeight = camHeight;
            } else {
              // overlay photo wider than camera photo
              overlayWidth = camWidth;
              overlayHeight = camWidth * overlayAspectRatio;
            }
            overlayLeft = (width - overlayWidth) / 2;
            overlayTop = (height - overlayHeight) / 2;
            overlayPictureFrame.style.left = overlayLeft + 'px';
            overlayPictureFrame.style.top = overlayTop + 'px';
            overlayPictureFrame.style.height = overlayHeight + 'px';
            overlayPictureFrame.style.width = overlayWidth + 'px';
          }
        };

        this.cameraPopup.startCamera = function() {
            if (_app.isMobileDevice) {
                var width = _app.cameraPopup.clientWidth;
                var height = _app.cameraPopup.clientHeight;
                var tapEnabled = true;
                var dragEnabled = true;
                var toBack = true; // camera z-value can either be completely at the back or completey on top
                var cameraAspectRatio;
                var containerAspectRatio = height / width;
                var camWidth = width;
                var camHeight = height;
                var camLeft = 0;
                var camTop = 0;
                if (window.localStorage.cameraAspectRatio) {
                  cameraAspectRatio = window.localStorage.cameraAspectRatio;
                  if ((cameraAspectRatio > 1 && containerAspectRatio < 1) || (cameraAspectRatio < 1 && containerAspectRatio > 1)) {
                    cameraAspectRatio = 1 / cameraAspectRatio;
                  }
                  if (cameraAspectRatio > containerAspectRatio) {
                    // camera photo taller than container
                    camWidth = height / cameraAspectRatio;
                    camLeft = (width - camWidth) / 2;
                  } else {
                    // camera photo equal or wider than container
                    camHeight = width * cameraAspectRatio;
                    camTop = (height - camHeight) / 2;
                  }
                  _app.cameraPopup.OverlayFit(width, height, camWidth, camHeight, cameraAspectRatio);
                }
                CameraPreview.startCamera({x: camLeft, y: camTop, width: camWidth, height: camHeight, camera: 'back', tapPhoto: tapEnabled, previewDrag: dragEnabled, toBack: toBack});
                //CameraPreview.setZoom(0);

                window.plugins.insomnia.keepAwake();
                // force css recalculation
                // document.body.style.zoom=1.00001;
                // setTimeout(function(){document.body.style.zoom=1;}, 50);
                if (!window.localStorage.cameraAspectRatio) {
                  // camera aspect no yet known, read from camera when started
                  setTimeout(function() {CameraPreview.getPreviewSize(function(size){
                    cameraAspectRatio = size.height / size.width;
                    window.localStorage.cameraAspectRatio = cameraAspectRatio;
                    _app.cameraPopup.resetCamera();
                  });}, 1000);
                }
            }
        };
        this.cameraPopup.stopCamera = function() {
            if (_app.isMobileDevice) {
                CameraPreview.stopCamera();
                window.plugins.insomnia.allowSleepAgain();
            }
        };
        this.cameraPopup.resetCamera = function() {
            /* todo: replace setTimeout by wait for resize event */
            /* todo: resize: handle case where resetCamera() is called by code */
            _app.cameraPopup.stopCamera();
            setTimeout(_app.cameraPopup.startCamera, 1000);
        };
        var cameraButton = document.querySelector('#gapp_button_camera');
        cameraButton.addEventListener('click', function() {
            photoServer.ensureDeviceRegistration(function(result) {
                if (result) {
                    _app.overlayURL = null;
                    _app.cameraPopup.show();
                } else {
                    // device could not be registered, offline? no window.localStorage?
                    _app.showMessage('device registration failed, try again later');
                }
            });
        });

        /* Preview Photo taken by camera */
        /* todo: add toggle to show/hide overlay-picture with preview */
        this.cameraPreviewPhotoFrame = document.querySelector('#gapp_camera_photo_preview_frame');

        this.cameraPreviewPhotoTagList = document.querySelector('#gapp_camera_photo_form_taglist');
        this.cameraPreviewPhotoTagList.langcode = '';
        this.cameraPreviewPhotoTagList.list = null;
        this.cameraPreviewPhotoTagList.addEventListener('change', function() {
          // this handler is triggered for every changed tag checkbox
          var boxes = document.querySelectorAll('.tagbox');
          for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].value == 5) {
              // tagid for tree circumference
              var textInput = document.querySelector('#gapp_camera_photo_form_circumference');
              if (boxes[i].checked) {
                // show tree circumference input
                textInput.classList.remove('hidden');
              } else {
                // hide tree circumference input
                textInput.classList.add('hidden');
              }
            }
          }
        });

        // on change: update label on 'add description' button
        var descriptionText = document.querySelector('#gapp_camera_photo_button_adddescription_text');
        var inputDescription = document.querySelector('#gapp_camera_photo_form_input_description');
        inputDescription.addEventListener('change', function() {
          if (this.value !== '') {
            descriptionText.innerHTML = _utils.escapeHTML(this.value);
          }
        });

        this.cameraPreviewPhotoFrame.resetTagList = function(list) {
          // redraws all available tags and resets check to defaults
          var listContainer = document.querySelector('#gapp_camera_photo_form_taglist');
          var html = '<div id="gapp_camera_photo_form_tag_label">Tags <i class="material-icons">&#xE54E;<!--local_offer--></i></div>\n';
          for (var i = 0; i < list.length; i++) {
            html += '<label class="mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect" for="checkbox-' + i + '">\n' +
               '<input type="checkbox" id="checkbox-' + i + '" class="tagbox mdl-checkbox__input" value="'+list[i].tagid+'">\n' +
               '<span class="mdl-checkbox__label">'+list[i].tagtext+'</span>\n' +
               '</label>';
          }
          listContainer.innerHTML = html;
        };

        this.getTagList = function(callback) {
          if (_app.cameraPreviewPhotoTagList.list === null || _app.cameraPreviewPhotoTagList.langcode !== _app.langcode) {
            // get new tag list
            photoServer.getTagList(_app.langcode, function(err, list) {
              if (err) {
                callback(err, list);
              } else {
                _app.cameraPreviewPhotoTagList.list = list;
                _app.cameraPreviewPhotoTagList.langcode = _app.langcode;
                callback(false, list);
              }
            });
          } else {
            callback(false, _app.cameraPreviewPhotoTagList.list);
          }
        };

        this.cameraPreviewPhotoFrame.resetPhotoForm = function () {
            // hide the form
            document.querySelector('#gapp_camera_photo_form').classList.add('hidden');
            // scroll back to top
            document.querySelector('#gapp_camera_photo_form_fields').scrollTop = 0; // no effect?
            // reset text fields
            // see http://stackoverflow.com/questions/34077730/fetching-the-value-of-a-mdl-textfield/34122149
            var materialTextField = document.querySelector('#gapp_camera_photo_form_description').MaterialTextfield;
            if (materialTextField) {
              materialTextField.change('');
            }
            materialTextField = document.querySelector('#gapp_camera_photo_form_circumference').MaterialTextfield;
            if (materialTextField) {
              materialTextField.change('');
            }
            // document.querySelector('#gapp_camera_photo_form_input_description').value = null;
            // document.querySelector('#gapp_camera_photo_form_input_circumference').value = null;
            _app.getTagList(function(err, list) {
              if (!err) {
                // reset the tag list
                _app.cameraPreviewPhotoFrame.resetTagList(list);
              }
            });
        };
        this.cameraPreviewPhotoFrame.show = function () {
            document.removeEventListener('backbutton', _app.cameraPopup.hide);
            document.addEventListener('backbutton', _app.cameraPreviewPhotoFrame.hide);
            document.querySelector('#gapp_camera_photo_button_adddescription_text').innerHTML = 'Add description...';
            _app.cameraPreviewPhotoFrame.resetPhotoForm();
            _app.cameraPreviewPhotoFrame.classList.remove('hidden');
        };
        this.cameraPreviewPhotoFrame.hide = function () {
            _app.cameraPreviewPhotoFrame.classList.add('hidden');
            document.removeEventListener('backbutton', _app.cameraPreviewPhotoFrame.hide);
            document.addEventListener('backbutton', _app.cameraPopup.hide);
        };
        this.buttonPreviewPhotoClose = document.querySelector('#gapp_camera_photo_close');
        this.buttonPreviewPhotoClose.addEventListener('click', function() {
            _app.cameraPreviewPhotoFrame.hide();
            _app.cameraPopup.resetCamera();
        });
        var buttonAddDescription = document.querySelector('#gapp_camera_photo_button_adddescription');
        var descriptionForm = document.querySelector('#gapp_camera_photo_form');
        buttonAddDescription.addEventListener('click', function() {
              descriptionForm.classList.remove('hidden');
              document.querySelector('#gapp_camera_photo_form_fields').scrollTop = 0;
        });
        var buttonCloseDescription = document.querySelector('#gapp_camera_photo_form_close');
        buttonCloseDescription.addEventListener('click', function() {
            descriptionForm.classList.add('hidden');
        });

        this.getFullPhotoDescription = function() {
          return {
              description: document.querySelector('#gapp_camera_photo_form_input_description').value,
              tags: [].slice.call(document.querySelectorAll('.tagbox:checked')).map(
                  function(box){
                    var obj = {};
                    if (box.value=="5") {
                      obj[box.value] = document.querySelector('#gapp_camera_photo_form_input_circumference').value.replace(',', '.');
                    } else {
                      obj[box.value] = "";
                    }
                    return obj;
                  })
          };
        };

        this.buttonPreviewPhotoOk = document.querySelector('#gapp_camera_photo_ok');
        this.buttonPreviewPhotoOk.addEventListener('click', function() {
            _app.showMessage('uploading photo...');
            var p = _app.cameraPreviewPhoto;
            photoServer.uploadPhotoData(p.rawdata, p.photoid, p.myLocation, p.accuracy, _app.getFullPhotoDescription(), function(err, message) {
                if (err) {
                    _app.showMessage('Upload failed: ' + message);
                } else {
                    // success! Free memory and close dialog
                    p.rawdata = null;
                    _app.cameraPreviewPhoto.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
                    _app.cameraPreviewPhotoFrame.hide();
                    _app.cameraPopup.hide();
                    setTimeout (function() {
                      photoServer.resetCacheTime(); // reset cache
                      _app.photoSource = photoServer.updatePhotos();
                      olMap.clusterLayer.setSource(new ol.source.Cluster({
                          distance: 40,
                          source: _app.photoSource
                        }));
                      setTimeout(function(){
                        if (_app.overlayURL && _app.activeFeature) {
                          var url = _app.activeFeature.get('filename');
                          url = url.substr(0, url.length -4) + '.gif';
                          _app.activeFeature.set('filename', url);
                        }
                        _app.clickFeatureHandler(_app.activeFeature); // reload feature
                      }, 1000);
                    }, 5000);
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
                  _app.showMessage ('Wrong camera orientation, please adjust');
                }
            }
        });

        var cameraClose = document.querySelector('#gapp_camera_close');
        cameraClose.addEventListener('click', _app.cameraPopup.hide);
    };

    this.cordovaDeviceReady = function () {
        CameraPreview.setOnPictureTakenHandler(function(result){
            var myLocation = olMap.geoLocation.getPosition();
            if (myLocation) {
                _app.cameraPreviewPhoto.rawdata = result;
                result = null; // free memory
                _app.cameraPreviewPhoto.src = 'data:image/jpeg;base64,' + _app.cameraPreviewPhoto.rawdata;
                myLocation = ol.proj.transform(myLocation, 'EPSG:3857', 'EPSG:4326');
                var accuracy = olMap.geoLocation.getAccuracy();
                _app.cameraPreviewPhoto.myLocation = myLocation;
                _app.cameraPreviewPhoto.accuracy = accuracy;
                _app.cameraPreviewPhotoFrame.show();
            } else {
                _app.showMessage('Required photo location unknown');
            }
        });
    };

    this.geoLocationErrorHandler = function(message) {
      _app.showMessage('location: ' + message);
    };

    this.geoLocationFixed = false;
    this.geoLocationChangedHandler = function (coordinates) {
        if (!_app.geoLocationFixed && coordinates) {
            _app.geoLocationFixed = true;
            _app.buttonLocation.removeAttribute('disabled');
            _app.buttonLocation.classList.add('mdl-color--white');
            _app.buttonLocation.classList.add('mdl-color-text--blue-700');

            if (_app.isMobileDevice) {
                // enable camera button
                var cameraButton = document.querySelector('#gapp_button_camera');
                cameraButton.removeAttribute('disabled');
            }
        }
    };

    // tracking: automatically keep user location in map center on/off
    this.setMapTracking = function(enabled) {
        olMap.mapTracking = enabled;
        if (enabled) {
            _app.buttonLocation.classList.remove('inactive');
            var coordinates = olMap.geoLocation.getPosition();
            if (coordinates) {
                olMap.olmap.getView().setCenter(coordinates);
            }
        } else {
            _app.buttonLocation.classList.add('inactive');
        }
    };

    this.mapDragHandler = function (status, pixel, prevpixel) {
        switch(status) {
            case 'dragstart':
                _app.setMapTracking(false);
                break;
            case 'dragging':
                // drag info window along
                if (_app.activeFeature) {
                    _app.featureInfoPopup.style.left = (parseInt(_app.featureInfoPopup.style.left, 10) - (prevpixel[0] - pixel[0])) + 'px';
                    _app.featureInfoPopup.style.top = (parseInt(_app.featureInfoPopup.style.top, 10) - (prevpixel[1] - pixel[1])) + 'px';
                }
                break;
            case 'dragend':
            case 'moveend':
                // handle end of kinetic effect after drag
                if (_app.activeFeature) {
                    var geometry = _app.activeFeature.getGeometry();
                    var coordinates = geometry.getCoordinates();
                    var endpixel = olMap.olmap.getPixelFromCoordinate(coordinates);

                    _app.featureInfoPopup.style.left = endpixel[0] + 'px';
                    _app.featureInfoPopup.style.top = (endpixel[1] - 15) + 'px';
                }
                break;
        }
    };

    this.clickFeatureHandler = function(feature) {
        _app.featureInfoPopup.hide();
        _app.activeFeature = feature;
        if (feature) {
            var geometry = feature.getGeometry();
            var coordinates = geometry.getCoordinates();
            var pixel = olMap.olmap.getPixelFromCoordinate(coordinates);

            _app.featureInfoPopup.style.left = pixel[0] + 'px';
            _app.featureInfoPopup.style.top = (pixel[1] - 15) + 'px';

            // calculate distance between user and feature
            var userLocation = olMap.geoLocation.getPosition();
            var distance = 1000; // initialize at 1000 km
            if (userLocation) {
                distance = _utils.calculateDistance(ol.proj.transform(coordinates, 'EPSG:3857', 'EPSG:4326'), ol.proj.transform(userLocation, 'EPSG:3857', 'EPSG:4326'));
            }

            var picture_url = photoServer.bigPhotoUrl(feature.get('filename'));
            var spinner = document.querySelector('#gapp_featureinfo_spinner');
            var errorInfo = document.querySelector('#gapp_featureinfo_error');
            errorInfo.classList.add('hidden');
            _app.featureInfoPhoto = document.querySelector('#gapp_featureinfo_photo');
            _app.featureInfoPhoto.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
            _app.featureInfoPhoto.url = picture_url;
            _app.featureInfoPhoto.photoid = feature.get('id');
            spinner.classList.add('is-active');

            var description = feature.get('description');
            if (!description) {
              description = 'No description';
            }

            _app.getTagList(function (err, list) {
              if (!err) {
                var tagtext = '';
                var tags = feature.get('tags');
                if (tags.length === 0) {
                  tagtext = 'No tags';
                } else {
                  for (var i=0; i < tags.length; i++) {
                    for (var key in tags[i]) {
                      for (var k = 0; k < list.length; k++) {
                        if (key == list[k].tagid) {
                          if (tagtext !== '') {
                            tagtext += ', ';
                          }
                          tagtext += list[k].tagtext;
                          if ((tags[i])[key] !== '') {
                            tagtext += ': ' + (tags[i])[key];
                          }
                        }
                      }
                    }
                  }
                }
                var date = new Date();
                date.setTime(Date.parse(feature.get('time')));
                var dateText = date.toLocaleDateString() + ', ' + date.toLocaleTimeString();
                var infoText = _utils.escapeHTML(description) + '<br>' + _utils.escapeHTML(tagtext) + '<br>' + dateText;
                document.querySelector('#gapp_featureinfo_infotext').innerHTML = infoText;
                document.querySelector('#gapp_fullscreenphotopopup_infotext').innerHTML = infoText;
              }
            });


            var photo = new Image();
            photo.onload = function() {
                spinner.classList.remove('is-active');
                _app.featureInfoPhoto.src = _app.featureInfoPhoto.url; // not: this.src, may show delayed loading picture
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
                _app.featureInfoPopup.style.width = Math.floor(200 * aspectratio) + 'px';
                _app.featureInfoPopup.style.height = '200px';
            }
            else {
                // portrait
                _app.featureInfoPopup.style.width = '200px';
                _app.featureInfoPopup.style.height = Math.floor(200 / aspectratio) + 'px';
            }

            var addphotobutton = document.querySelector('#gapp_featureinfo_addphoto');
            if (_app.isMobileDevice && distance < 0.08) {
                addphotobutton.removeAttribute('disabled');
            }
            else {
                addphotobutton.setAttribute('disabled', '');
            }
            _app.featureInfoPopup.show();
        }
    };

    this.panZoomHandler = function(status) {
        switch (status) {
            case 'zoom':
                _app.featureInfoPopup.hide();
                _app.setMapTracking(false);
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

var app = new App();

document.addEventListener('deviceready', app.cordovaDeviceReady, false);
