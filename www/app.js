'use strict';
/*
app.js
assumes openlayers.js, proj4.js and language.js are loaded

HTML5 only, no JQuery, Angular, Underscore, ReactJS etc.
ECMAScript 5 for phone browser compatibility
Targets Android 4.4+ (API 19+), iOS, web
Should work with Crosswalk on Android 4.0 .. 4.399

Main objects in this module:

_utils: general utility functions
OLMap: openlayers, geolocation
PhotoServer: communication with remote geographic photo server
App: UI and handler hooks into OLMap

*/

/* global window, document, console, ol, Image, CameraPreview, StatusBar,
   localStorage, XMLHttpRequest, setTimeout, __, navigator, languageProvider,
   escape
*/

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
     str = str + '';
     var out = '';
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

  this.resetHashTags = function(hashtags) {
    _photoServer.resetCacheTime();
    _photoServer.hashTags = hashtags;
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

  this.getGeoJSON = function (url, callback){
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) {
        return;
      }
      if (xhr.status === 200 || xhr.status === 304) {
        callback(JSON.parse(xhr.response));
      }
    };
    xhr.send();
  };

  this.featureFilter =  function (features, callback) {
    /*
    // filter by description
    features = features.filter(function(feature) {
      var description = feature.get('description');
      return (description !== null && description !== '');
    });
    */
    /*
    // filter by tag keys 1 or 5
    features = features.filter(function(feature){
      return feature.get('tags').filter(function(tag) {
        return ('1' in tag) || ('5' in tag);
      }).length > 0;
    });
    */
    callback(features);
  };

  this.photoSource = null;
  this.updatePhotos = function() {
    //adds or reloads photo positions into photoSource
    _photoServer.photoSource = new ol.source.Vector({
        /* projection: 'EPSG:4326',
        url: _photoServer.server + '/photoserver/getphotos?' + _photoServer.getCacheTime(), // File created in node
        format: new ol.format.GeoJSON() */
        loader: function () {
          var format = new ol.format.GeoJSON();
          var source = this;
          var params = '';
          if (_photoServer.hashTags && _photoServer.hashTags != '') {
            params = "hashtags=" + encodeURIComponent(photoServer.hashTags) + "&";
          }
          _photoServer.getGeoJSON(_photoServer.server + '/photoserver/getphotos?' + params + _photoServer.getCacheTime(), function(response){
            var features = format.readFeatures(response, { featureProjection: 'EPSG:3857'});
            _photoServer.featureFilter(features, function(filteredFeatures){
              source.addFeatures(filteredFeatures);
            });
          });
        }
    });
    return _photoServer.photoSource;
  };

  this.getPhotoSet = function(feature, callback) {
    if (feature.photoset) {
      callback(null, feature.photoset);
    } else {
      if (feature.get('isroot') === false) {
        callback(null, []);
      } else {
        var photoid = feature.get('id');
        var xhr = new XMLHttpRequest();
        var formData = 'photoid=' + photoid;
        xhr.open('POST', _photoServer.server+'/photoserver/getphotoset');
        xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
        // xhr.responseType = 'json'; // DOES NOT WORK ON ANDROID 4.4!
        xhr.onreadystatechange = function (event) {
           if (xhr.readyState === 4) {
               if (xhr.status === 200) {
                 var result = JSON.parse(xhr.responseText);
                 callback(false, result);
               } else {
                 callback(true, __('Error retrieving photoset') + ': ' + xhr.status + ' ' + xhr.statusText);
                 console.log ('Error : ' + xhr.status + ' ' + xhr.statusText);
               }
           }
        };
        xhr.send(formData);
      }
    }
  };

  // return url to large version of photo
  this.fullPhotoUrl = function(photofile, size) {
    // size expected to be either 'small' or 'medium' or 'full'
    if (photofile.substr(-4, 4) === '.gif') {
      photofile = photofile.substr(0, photofile.length - 4) + '.jpg';
    }
    if (size === 'medium' || size === 'small' ) {
      return _photoServer.server + '/uploads/' + size + '/' + photofile;
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
                     console.log (__('Error registering device')+ ': ' + xhr.statusText);
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
                    callback(false, __('mail sent, please check your email...'));
                } else {
                    callback(true, __('Error') + xhr.statusText);
                }
            }
        };
        xhr.send(formData);
    };

    this.validateuser = function(email, code, deviceid, devicehash, allowmailing, callback)
    {
        var xhr = new XMLHttpRequest();
        var formData = 'email=' + encodeURIComponent(email) + '&validationcode=' + encodeURIComponent(code)  + '&deviceid=' + encodeURIComponent(localStorage.deviceid) + '&devicehash=' + encodeURIComponent(localStorage.devicehash) + '&allowmailing=' + encodeURIComponent(allowmailing);
        xhr.open('POST', _photoServer.server+'/photoserver/validateuser');
        xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
        xhr.onreadystatechange = function (event) {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    if (xhr.responseText.length !== 32) {
                        callback (true, __('Validation failed') + ': ' + xhr.responseText);
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
    //var svg_image_area = '<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="24px" height="24px" style="width:24px;height:24px" enable-background="new 0 0 24 24" viewBox="0 0 24 24"><rect x="1" y="3" width="22" height="18" fill="white"/><path fill="green" d="M20,5A2,2 0 0,1 22,7V17A2,2 0 0,1 20,19H4C2.89,19 2,18.1 2,17V7C2,5.89 2.89,5 4,5H20M5,16H19L14.5,10L11,14.5L8.5,11.5L5,16Z" /></svg>';
    var svg_image = '<?xml version="1.0" encoding="UTF-8"?><svg width="21px" height="21px" viewBox="0 0 21 21" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><!-- Generator: Sketch 42 (36781) - http://www.bohemiancoding.com/sketch --><title>singlemarker copy 7</title><desc>Created with Sketch.</desc><defs><circle id="path-1" cx="4.5" cy="4.5" r="4.5"></circle><filter x="-50%" y="-50%" width="200%" height="200%" filterUnits="objectBoundingBox" id="filter-2"><feMorphology radius="1.5" operator="dilate" in="SourceAlpha" result="shadowSpreadOuter1"></feMorphology><feOffset dx="0" dy="0" in="shadowSpreadOuter1" result="shadowOffsetOuter1"></feOffset><feGaussianBlur stdDeviation="2" in="shadowOffsetOuter1" result="shadowBlurOuter1"></feGaussianBlur><feComposite in="shadowBlurOuter1" in2="SourceAlpha" operator="out" result="shadowBlurOuter1"></feComposite><feColorMatrix values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0  0 0 0 0.364470109 0" type="matrix" in="shadowBlurOuter1"></feColorMatrix></filter></defs><g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g id="iPad-Portrait-Copy" transform="translate(-588.000000, -521.000000)"><g id="Mappoints" transform="translate(126.000000, 321.000000)"><g id="Green-map-icons"><g id="Mapmarkers"><g id="singlemarker" transform="translate(468.000000, 206.000000)"><g id="Oval-Copy-19"><use fill="black" fill-opacity="1" filter="url(#filter-2)" xlink:href="#path-1"></use><use stroke="#FFFFFF" stroke-width="2" fill="#44C783" fill-rule="evenodd" xlink:href="#path-1"></use></g></g></g></g></g></g></g></svg>';
    var svg_image_multiple = '<?xml version="1.0" encoding="UTF-8"?><svg width="33px" height="33px" viewBox="0 0 33 33" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><!-- Generator: Sketch 42 (36781) - http://www.bohemiancoding.com/sketch --><title>playmarker</title><desc>Created with Sketch.</desc><defs><circle id="path-1" cx="10.5" cy="10.5" r="10.5"></circle><filter x="-50%" y="-50%" width="200%" height="200%" filterUnits="objectBoundingBox" id="filter-2"><feMorphology radius="2" operator="dilate" in="SourceAlpha" result="shadowSpreadOuter1"></feMorphology><feOffset dx="0" dy="1" in="shadowSpreadOuter1" result="shadowOffsetOuter1"></feOffset><feGaussianBlur stdDeviation="1.5" in="shadowOffsetOuter1" result="shadowBlurOuter1"></feGaussianBlur><feComposite in="shadowBlurOuter1" in2="SourceAlpha" operator="out" result="shadowBlurOuter1"></feComposite><feColorMatrix values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0  0 0 0 0.1856601 0" type="matrix" in="shadowBlurOuter1"></feColorMatrix></filter></defs><g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g id="iPad-Portrait-Copy" transform="translate(-428.000000, -583.000000)"><g id="Mappoints" transform="translate(126.000000, 321.000000)"><g id="Green-map-icons"><g id="Playmarkers-Copy-4" transform="translate(302.000000, 262.000000)"><g id="playmarker" transform="translate(6.000000, 5.000000)"><g id="Group-Copy-3"><g id="Oval-Copy-5"><use fill="black" fill-opacity="1" filter="url(#filter-2)" xlink:href="#path-1"></use><use stroke="#FFFFFF" stroke-width="2" fill="#44C783" fill-rule="evenodd" xlink:href="#path-1"></use></g><path d="M8.12080168,13.9766451 C7.91278232,13.9766451 7.744128,13.8079907 7.744128,13.5999714 L7.744128,7.00823495 C7.744128,6.80021558 7.91278232,6.63157895 8.12080168,6.63157895 L14.241696,10.0215891 C14.241696,10.0215891 14.5242013,10.3040943 14.241696,10.5866173 C13.9591907,10.8691048 8.12080168,13.9766451 8.12080168,13.9766451 Z" id="Shape" fill="#FFFFFF" fill-rule="nonzero"></path></g></g></g></g></g></g></g></svg>';
    //var svg_tree = '<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="24px" height="24px" style="width:24px;height:24px" enable-background="new 0 0 24 24" viewBox="0 0 24 24"><rect x="2" y="1" width="20" height="22" fill="green"/><path fill="white" d="M11,21V16.74C10.53,16.91 10.03,17 9.5,17C7,17 5,15 5,12.5C5,11.23 5.5,10.09 6.36,9.27C6.13,8.73 6,8.13 6,7.5C6,5 8,3 10.5,3C12.06,3 13.44,3.8 14.25,5C14.33,5 14.41,5 14.5,5A5.5,5.5 0 0,1 20,10.5A5.5,5.5 0 0,1 14.5,16C14,16 13.5,15.93 13,15.79V21H11Z" /></svg>';
    //var svg_tree_fir = '<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="24px" height="24px" style="width:24px;height:24px" enable-background="new 0 0 24 24" viewBox="0 0 24 24"><rect x="2" y="1" width="20" height="22" fill="green"/><path fill="white" d="M10,21V18H3L8,13H5L10,8H7L12,3L17,8H14L19,13H16L21,18H14V21H10Z" /></svg>';
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
      var isMultiPhoto = feature.get('features')[0].get('isroot');
      style = new ol.style.Style({
        image: new ol.style.Icon({
          img: isMultiPhoto ? image_multiple : image_area,
          imgSize: [28,28]
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
                center: ol.proj.transform([7.913024, 52.34223], 'EPSG:4326', 'EPSG:3857'),
                zoom: 4
            })
        });
    };/* initMap */

    this.geoLocationErrorHandler = function(message) {
        console.warn('unhandled geolocation Error: ' + message);
    };

    this.geoLocationChangedHandler = function(coordinates) {
        console.warn('unhandled geolocation Changed handler');
    };

    this.zoom = function(levels) {
      var zoomlevel = _olMap.olmap.getView().getZoom();
      if (typeof zoomlevel !== undefined) {
        zoomlevel += levels;
      }
      _olMap.olmap.getView().setZoom(zoomlevel);
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
          var features = feature.get('features');
          if (prevFeature === features[0].get('id')) {
            prevFeatureIndex++;
            if (prevFeatureIndex >= features.length) {
              prevFeatureIndex = 0;
            }
          } else {
            prevFeature = features[0].get('id');
            prevFeatureIndex = 0;
          }
          feature = features[prevFeatureIndex];
        }
        if (feature.get(featureFieldName)) {
            resultfeature = feature;
            return true; // feature found
        } else {
            return false; // try next feature
        }
      }, {hitTolerance: 5}); // forEachFeatureAtPixel
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
        var language;
        if (window.localStorage && window.localStorage.language) {
          language = window.localStorage.language;
        } else {
          language = navigator.language || navigator.userLanguage;
        }
        languageProvider.setLanguage(language);
        _app.langCode = languageProvider.langCode;

        // store setup for mobile device or web
        this.isMobileDevice = isMobileDevice;
        if (isMobileDevice) {
          // hide zoombuttons
          document.querySelector('#gapp_map_zoom_bar').classList.add('hidden');
        }

        // update account info in drawer if available
        if (window.localStorage.email && window.localStorage.email !== '') {
          var accountinfo = document.querySelector('#gapp_account_info');
          if (window.localStorage.displayName && window.localStorage.displayName !== '') {
            accountinfo.innerHTML = _utils.escapeHTML(window.localStorage.displayName);
          } else {
            accountinfo.innerHTML = window.localStorage.email;
          }
        }


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
        document.querySelector('#gapp_map_zoom_in').addEventListener('click', function() {
          olMap.zoom(1);
        });
        document.querySelector('#gapp_map_zoom_out').addEventListener('click', function() {
          olMap.zoom(-1);
        });

        window.addEventListener('hashchange', this.navigate.bind(this), false);
        this.navigate(); // handle any hashes passed to the URL
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
                    element.innerHTML = __('January');
                });
                [].forEach.call(legendmax, function (element) {
                    element.innerHTML = __('December');
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
    window.addEventListener('orientationchange', function() {
      var legendvertical = document.querySelector('#gapp_legendvertical');
      var legendhorizontal = document.querySelector('#gapp_legendhorizontal');
      if (!legendvertical.classList.contains('hidden')) {
        legendvertical.classList.add('hidden');
        legendhorizontal.classList.remove('hidden');
      } else if (!legendhorizontal.classList.contains('hidden')) {
        legendhorizontal.classList.add('hidden');
        legendvertical.classList.remove('hidden');
      }
    });

    this.navigate = function() {
        switch (window.location.hash.split('=')[0]) {
            case '#managephoto':
                _app.hideDrawer();
                if (!_app.isMobileDevice) {
                    // web version
                    if (!localStorage.email || window.localStorage.email==='' || !localStorage.hash || window.localStorage.hash==='') {
                        _app.showMessage(__('Web photo management requires user registration'));
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
                window.location = __('help.html');
                break;
            case '#info':
                window.location.hash='';
                window.location = __('info.html');
                break;
            case '#hashtags':
                var hashtags = decodeURIComponent(window.location.hash.split('=')[1]);
                photoServer.resetHashTags(hashtags);
                _app.photoSource = photoServer.updatePhotos();
                olMap.clusterLayer.setSource(new ol.source.Cluster({
                    distance: 40,
                    source: _app.photoSource
                  }));
                window.location.hash='';
        }
    };

    this.fitRectangleToDisplay = function(rectangleAspect, displayWidth, displayHeight, fitInside, rectBefore, rectAfter)
    {
      var rectangle = {};
      var displayAspect = displayWidth / displayHeight;
      if ((fitInside && displayAspect > rectangleAspect) || (!fitInside && displayAspect < rectangleAspect)) {
        // fit to height
        rectangle.height = displayHeight;
        rectangle.width = displayHeight * rectangleAspect;
      } else {
        // fit to width
        rectangle.width = displayWidth;
        rectangle.height = displayWidth / rectangleAspect;
      }
      rectangle.left = Math.round((displayWidth - rectangle.width) / 2);
      rectangle.top = Math.round((displayHeight - rectangle.height) / 2);
      if (rectangle.left > 0 && (rectBefore || rectAfter)) {
        // fit rectBefore/rectAfter to height
        if (rectBefore) {
          rectBefore.left = 0;
          rectBefore.top = 0;
          rectBefore.width = rectangle.left;
          rectBefore.height = displayHeight;
        }
        if (rectAfter) {
          rectAfter.top = 0;
          rectAfter.left = rectangle.left + rectangle.width;
          rectAfter.width = rectangle.left;
          rectAfter.height = displayHeight;
        }
      } else if (rectangle.top > 0 && (rectBefore || rectAfter)) {
        if (rectBefore) {
          rectBefore.top  = 0;
          rectBefore.left = 0;
          rectBefore.width = displayWidth;
          rectBefore.height = rectangle.top;
        }
        if (rectAfter) {
          rectAfter.top = rectangle.top + rectangle.height;
          rectAfter.left = 0;
          rectAfter.width = displayWidth;
          rectAfter.height = rectangle.top;
        }
      }
      return rectangle;
    };

    this.setElementStyleToRect = function(element, rect) {
      element.style.left = rect.left + 'px';
      element.style.top = rect.top + 'px';
      element.style.width = rect.width + 'px';
      element.style.height = rect.height + 'px';
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

        this.photoFrameContainerFit = function()
        {
          var rect = _app.fitRectangleToDisplay(_app.activeFeature.get('width')/_app.activeFeature.get('height'),
              _app.fullscreenphotopopup.clientWidth, _app.fullscreenphotopopup.clientHeight, true);
          var frameContainerElement = document.querySelector('#gapp_fullscreenphotopop_frame_container');
          _app.setElementStyleToRect(frameContainerElement, rect);
          var animationFrame = frameContainerElement.querySelector('.gapp_photo_frame');
          animationFrame.style.left = animationFrame.style.top = 0;
          animationFrame.style.width = animationFrame.style.height = '100%';
        };


        /* todo: zoomable fullscreen photo? http://ignitersworld.com/lab/imageViewer.html */
        this.fullscreenphotopopup = document.querySelector('#gapp_fullscreenphotopopup');

        window.addEventListener('resize', function(){
          if (!_app.fullscreenphotopopup.classList.contains('hidden')){
              _app.photoFrameContainerFit();
          }
        });

        this.fullscreenphotopopup.show = function() {
            if (typeof StatusBar !== 'undefined') {
                StatusBar.hide();
                StatusBar.overlaysWebView(true);
            }
            _app.fullscreenphoto = document.querySelector('#gapp_fullscreenphoto');
            if (_app.isMobileDevice) {
              _app.fullscreenphoto.src = photoServer.fullPhotoUrl(_app.activeFeature.get('filename'), 'medium');
            } else {
              _app.fullscreenphoto.src = photoServer.fullPhotoUrl(_app.activeFeature.get('filename'), 'full');
            }
            document.removeEventListener('backbutton', _app.featureInfoPopup.hide);
            document.addEventListener('backbutton', _app.fullscreenphotopopup.hide);
            var frameContainer = document.querySelector('#gapp_fullscreenphotopop_frame_container');
            _app.animationTargetElement = frameContainer;
            _app.fullscreenphotopopup.classList.remove('hidden');
            setTimeout(function() {
                _app.photoFrameContainerFit();
              }, 100);
        };

        this.fullscreenphotopopup.hide = function() {
            if (typeof StatusBar !== 'undefined') {
                StatusBar.overlaysWebView(false);
                StatusBar.show();
            }
            document.removeEventListener('backbutton', _app.fullscreenphotopopup.hide);
            document.addEventListener('backbutton', _app.featureInfoPopup.hide);
            _app.animationTargetElement = _app.featureInfoPopup;
            if (_app.animating) {
              _app.playAnimation();
            }
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

        document.querySelector('#gapp_fullscreenphotopopup_first').onclick = function() {
          _app.photoIndex = 0;
        };
        document.querySelector('#gapp_fullscreenphotopopup_previous').onclick = function() {
          if (_app.photoIndex > 0) {
            _app.photoIndex--;
          } else {
            _app.photoIndex = _app.activeFeature.get('photoset').length -1;
          }
        };
        document.querySelector('#gapp_fullscreenphotopopup_next').onclick = function() {
          if (_app.photoIndex < _app.activeFeature.get('photoset').length - 1) {
            _app.photoIndex++;
          } else {
            _app.photoIndex = 0;
          }
        };
        document.querySelector('#gapp_fullscreenphotopopup_last').onclick = function() {
          _app.photoIndex = _app.activeFeature.get('photoset').length - 1;
        };

        var gappFeatureInfoFullScreenClose = document.querySelector('#gapp_fullscreenphotopopup_close');
        gappFeatureInfoFullScreenClose.addEventListener('click', _app.fullscreenphotopopup.hide);

        var buttonFeatureInfoAddPhoto = document.querySelector('#gapp_featureinfo_addphoto');
        buttonFeatureInfoAddPhoto.addEventListener('click', function(){
            photoServer.ensureDeviceRegistration(function(result) {
                if (result) {
                    var url = _app.featureInfoPhoto.url;
                    var photoid = _app.featureInfoPhoto.photoid;
                    _app.overlayURL = url;
                    _app.cameraPopup.show(url, photoid);
                } else {
                    // device could not be registered, offline? no window.localStorage?
                    _app.showMessage(__('device registration failed, try again later'));
                }
            });
        });

        this.playButton = document.querySelector('#gapp_fullscreenphotopopup_play');
        this.playBar = document.querySelector('#gapp_fullscreenphotopopup_play_bar');
        this.pauseButton = document.querySelector('#gapp_fullscreenphotopopup_pause');
    };

    /* camera window */
    this.cameraPopupInit = function () {
        this.cameraPopup = document.querySelector('#gapp_camera_popup');
        this.cameraPreviewPhoto = document.querySelector('#gapp_camera_photo_img');
        this.cameraPopup.show = function(overlayURL, photoid) {
          document.querySelector('#mainUI').classList.add('hidden');
          if (typeof StatusBar !== 'undefined') {
               StatusBar.hide();
               StatusBar.overlaysWebView(true);
          }
          if (typeof overlayURL === 'undefined') {
              overlayURL = null;
              photoid = 0;
          }
          _app.cameraPreviewPhoto.photoid = photoid;
          var cameraOverlayPictureFrame = document.querySelector('#gapp_camera_overlay_frame');
          if (overlayURL) {
              var cameraOverlayPicture = document.querySelector('#gapp_camera_overlay');
              cameraOverlayPicture.src = overlayURL;
              cameraOverlayPictureFrame.classList.remove('hidden');
              document.querySelector('#gapp_camera_opacity_bar').classList.remove('hidden');
              // load medium resolution overlay
              var image = new Image();
              image.onload = function () {cameraOverlayPicture.src = image.src;};
              image.src = photoServer.fullPhotoUrl(_app.activeFeature.get('filename'), 'medium');
          } else {
              cameraOverlayPictureFrame.classList.add('hidden');
              document.querySelector('#gapp_camera_opacity_bar').classList.add('hidden');
          }
          document.addEventListener('backbutton', _app.cameraPopup.hide);
          window.addEventListener('orientationchange', _app.cameraPopup.resetCamera);
          document.querySelector('body').style.backgroundColor = 'transparent';
          setTimeout(function() { // wait for hidden statusBar
            _app.cameraPopup.classList.remove('hidden');
            _app.cameraPopup.startCamera();
          }, 100);
        };
        this.cameraPopup.hide = function() {
            document.removeEventListener('backbutton', _app.cameraPopup.hide);
            window.removeEventListener('orientationchange', _app.cameraPopup.resetCamera);
            _app.cameraPopup.stopCamera();
            if (typeof StatusBar !== 'undefined') {
                StatusBar.overlaysWebView(false);
                StatusBar.show();
            }
            document.querySelector('#mainUI').classList.remove('hidden');
            document.querySelector('body').style.backgroundColor = 'lightgray';
            _app.cameraPopup.classList.add('hidden');
            olMap.olmap.updateSize();
        };

        this.cameraPopup.shutterEffect = function()
        {
          var cameraFrame = document.querySelector('#gapp_camera_frame');
          cameraFrame.classList.add('shutteron');
          setTimeout(function() {
            cameraFrame.classList.remove('shutteron');
          }, 300);
        };

        this.cameraPhoto = document.querySelector('#gapp_camera_photo');
        this.cameraPhotoFrame = document.querySelector('#gapp_camera_photo_frame');

        this.cameraPopup.startCamera = function() {
            if (_app.isMobileDevice) {
                var width = _app.cameraPopup.clientWidth;
                var height = _app.cameraPopup.clientHeight;
                var tapEnabled = false;
                var dragEnabled = false;
                var toBack = true; // camera z-value can either be completely at the back or completey on top
                var cameraAspectRatio;
                var containerAspectRatio = width / height;
                var camRect = {left: 0, top: 0, width: width, height: height};
                //if (window.localStorage.cameraAspectRatio) {
                  //cameraAspectRatio = window.localStorage.cameraAspectRatio;
                  cameraAspectRatio = 4/3;
                  if ((cameraAspectRatio > 1 && containerAspectRatio < 1) || (cameraAspectRatio < 1 && containerAspectRatio > 1)) {
                    cameraAspectRatio = 1 / cameraAspectRatio;
                  }
                  camRect = _app.fitRectangleToDisplay(cameraAspectRatio, width, height, true);
                  var cameraFrame = document.querySelector('#gapp_camera_frame');
                  _app.setElementStyleToRect(cameraFrame, camRect);

                  /* update preview photo rect */
                  if (_app.cameraPhoto.classList.contains('hidden')) {
                    _app.cameraPhoto.camRect = camRect; // store current camera width/height
                  }
                  var rectBefore = {}, rectAfter = {};
                  var frameRect = _app.fitRectangleToDisplay(
                    _app.cameraPhoto.camRect.width/_app.cameraPhoto.camRect.height,
                    width, height, true, rectBefore, rectAfter);
                  _app.setElementStyleToRect(_app.cameraPhotoFrame, frameRect);
                  _app.setElementStyleToRect(document.querySelector('#gapp_camera_bar_before'), rectBefore);
                  _app.setElementStyleToRect(document.querySelector('#gapp_camera_bar_after'), rectAfter);

                  if (_app.overlayURL) {
                    var overlayRect = _app.fitRectangleToDisplay(
                      _app.activeFeature.get('width') / _app.activeFeature.get('height'),
                      camRect.width, camRect.height, false);
                    var overlayPictureFrame = document.querySelector('#gapp_camera_overlay_frame');
                    _app.setElementStyleToRect(overlayPictureFrame, overlayRect);
                    _app.setElementStyleToRect(document.querySelector('#gapp_camera_photo_overlay_frame'), overlayRect);
                  }
                //}
                CameraPreview.startCamera({x: camRect.left, y: camRect.top, width: camRect.width, height: camRect.height, camera: 'back', tapPhoto: tapEnabled, previewDrag: dragEnabled, toBack: toBack});
                //CameraPreview.setZoom(0);

                window.plugins.insomnia.keepAwake();
                // force css recalculation
                document.body.style.zoom=1.00001;
                setTimeout(function(){document.body.style.zoom=1;}, 50);
/*
                if (!window.localStorage.cameraAspectRatio) {
                  // camera aspect not yet known, read from camera when started
                  setTimeout(function() {
                    var clientAspect = width / height;
                    if (clientAspect < 1) {
                      clientAspect = 1 / clientAspect;
                    }
                    var bestPictureAspect = 0;
                    var difference = 1000;

                    CameraPreview.getSupportedPictureSizes(function(sizes){
                      sizes.forEach(function(size){
                          var pictureAspect = (size.width / size.height);
                          var nextDifference = Math.abs(clientAspect - pictureAspect);
                          if (nextDifference < difference) {
                            difference = nextDifference;
                            bestPictureAspect = pictureAspect;
                          }
                          if (bestPictureAspect === 0) {
                            // none found, assume 4 : 3
                            bestPictureAspect = 4 / 3;
                          }
                          window.localStorage.cameraAspectRatio = bestPictureAspect;
                          _app.cameraPopup.resetCamera(true);
                      });
                    });
                  }, 1000);
                }
*/
            }
        };
        this.cameraPopup.stopCamera = function() {
            if (_app.isMobileDevice) {
                CameraPreview.stopCamera();
                window.plugins.insomnia.allowSleepAgain();
            }
        };
        this.cameraPopup.resetCamera = function(force) {
            var waitForResize = function() {
              window.removeEventListener('resize', waitForResize);
              _app.cameraPopup.startCamera();
            };
            _app.cameraPopup.stopCamera();
            if (force) {
              setTimeout(_app.cameraPopup.startCamera, 1000);
            } else {
              // resetCamera called by orientationchange, wait for resize
              window.addEventListener('resize', waitForResize);
            }
        };
        var cameraButton = document.querySelector('#gapp_button_camera');
        cameraButton.addEventListener('click', function() {
            photoServer.ensureDeviceRegistration(function(result) {
                if (result) {
                    _app.overlayURL = null;
                    _app.cameraPopup.show();
                } else {
                    // device could not be registered, offline? no window.localStorage?
                    _app.showMessage(__('device registration failed, try again later'));
                }
            });
        });

        /* Preview Photo taken by camera */
        this.cameraPhotoTagList = document.querySelector('#gapp_camera_photo_form_taglist');
        this.cameraPhotoTagList.language = '';
        this.cameraPhotoTagList.list = null;
        this.cameraPhotoTagList.addEventListener('change', function() {
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

        this.cameraPhoto.resetTagList = function(list) {
          // redraws all available tags and resets check to defaults
          var listContainer = document.querySelector('#gapp_camera_photo_form_taglist');
          var html = ''; //'<div id="gapp_camera_photo_form_tag_label">Tags <i class="material-icons">&#xE54E;<!--local_offer--></i></div>\n';
          for (var i = 0; i < list.length; i++) {
            if (list[i].active) {
              html += '<label class="mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect" for="checkbox-' + i + '">\n' +
                 '<input type="checkbox" id="checkbox-' + i + '" class="tagbox mdl-checkbox__input" value="'+list[i].tagid+'">\n' +
                 '<span class="mdl-checkbox__label">'+list[i].tagtext+'</span>\n' +
                 '</label>';
            }
          }
          listContainer.innerHTML = html;
        };

        this.getTagList = function(callback) {
          if (_app.cameraPhotoTagList.list === null || _app.cameraPhotoTagList.language !== _app.langCode) {
            // get new tag list
            photoServer.getTagList(_app.langCode, function(err, list) {
              if (err) {
                callback(err, list);
              } else {
                _app.cameraPhotoTagList.list = list;
                _app.cameraPhotoTagList.language = _app.langCode;
                callback(false, list);
              }
            });
          } else {
            callback(false, _app.cameraPhotoTagList.list);
          }
        };

        this.cameraPhoto.resetPhotoForm = function () {
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
                _app.cameraPhoto.resetTagList(list);
              }
            });
        };

        // opacity buttons on camera overlay
        this.cameraOverlay = document.querySelector('#gapp_camera_overlay');

        this.cameraOverlayOpacity80 = document.querySelector('#gapp_camera_overlay_opacity80');
        this.cameraOverlayOpacity80.addEventListener('click', function() {
          _app.cameraOverlay.style.opacity = 0.8;
        });
        this.cameraOverlayOpacity50 = document.querySelector('#gapp_camera_overlay_opacity50');
        this.cameraOverlayOpacity50.addEventListener('click', function() {
          _app.cameraOverlay.style.opacity = 0.5;
        });
        this.cameraOverlayOpacity20 = document.querySelector('#gapp_camera_overlay_opacity20');
        this.cameraOverlayOpacity20.addEventListener('click', function() {
          _app.cameraOverlay.style.opacity = 0.2;
        });

        // opacity buttons for photo preview overlay
        this.cameraPhotoOverlay = document.querySelector('#gapp_camera_photo_overlay');

        this.cameraPhotoOverlayOpacity100 = document.querySelector('#gapp_camera_photo_overlay_opacity100');
        this.cameraPhotoOverlayOpacity100.addEventListener('click', function() {
          _app.cameraPhotoOverlay.style.opacity = 0;
        });
        this.cameraPhotoOverlayOpacity50 = document.querySelector('#gapp_camera_photo_overlay_opacity50');
        this.cameraPhotoOverlayOpacity50.addEventListener('click', function() {
          _app.cameraPhotoOverlay.style.opacity = 0.5;
        });
        this.cameraPhotoOverlayOpacity20 = document.querySelector('#gapp_camera_photo_overlay_opacity20');
        this.cameraPhotoOverlayOpacity20.addEventListener('click', function() {
          _app.cameraPhotoOverlay.style.opacity = 0.8;
        });
        this.cameraPhotoFrame.overlay = document.querySelector('#gapp_camera_photo_overlay_frame');
        this.cameraPhotoFrame.overlay.show = function() {
          if (_app.overlayURL) {
            // copy settings from cam overlay
            var srcOverlay = document.querySelector('#gapp_camera_overlay_frame');
            var destOverlay = _app.cameraPhotoFrame.overlay;
            destOverlay.style.left = srcOverlay.style.left;
            destOverlay.style.top = srcOverlay.style.top;
            destOverlay.style.width = srcOverlay.style.width;
            destOverlay.style.height = srcOverlay.style.height;
            _app.cameraPhotoOverlay.src = _app.overlayURL;
            _app.cameraPhotoOverlay.style.opacity = 0;
            // _app.opacitySlider.value = 100;
            destOverlay.classList.remove('hidden');
            document.querySelector('#gapp_camera_overlay_opacity_bar').classList.remove('hidden');
          } else {
            _app.cameraPhotoFrame.overlay.hide();
          }
        };
        this.cameraPhotoFrame.overlay.hide = function() {
          _app.cameraPhotoFrame.overlay.classList.add('hidden');
          document.querySelector('#gapp_camera_overlay_opacity_bar').classList.add('hidden');
        };
        this.cameraPhoto.show = function () {
            document.removeEventListener('backbutton', _app.cameraPopup.hide);
            document.addEventListener('backbutton', _app.cameraPhoto.hide);
            document.querySelector('#gapp_camera_photo_button_adddescription_text').innerHTML = __('Add description...');
            _app.cameraPhoto.resetPhotoForm();
            _app.buttonSendPhoto.removeAttribute('disabled');
            _app.cameraPhoto.classList.remove('hidden');
            _app.cameraPhotoFrame.overlay.show();
        };
        this.cameraPhoto.hide = function () {
            _app.cameraPhoto.classList.add('hidden');
            document.removeEventListener('backbutton', _app.cameraPhoto.hide);
            document.addEventListener('backbutton', _app.cameraPopup.hide);
            _app.cameraPhotoFrame.overlay.hide();
        };
        this.buttonPhotoClose = document.querySelector('#gapp_camera_photo_close');
        this.buttonPhotoClose.addEventListener('click', function() {
            _app.cameraPhoto.hide();
            /* todo: camera still running while viewing photo? */
            _app.cameraPopup.resetCamera(true);
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
                    if (box.value==='5') {
                      obj[box.value] = document.querySelector('#gapp_camera_photo_form_input_circumference').value.replace(',', '.');
                    } else {
                      obj[box.value] = '';
                    }
                    return obj;
                  })
          };
        };

        this.buttonSendPhoto = document.querySelector('#gapp_camera_photo_send');
        this.buttonSendPhoto.addEventListener('click', function() {
            _app.buttonSendPhoto.setAttribute('disabled', '');
            _app.showMessage(__('uploading photo...'));
            var p = _app.cameraPreviewPhoto;
            photoServer.uploadPhotoData(p.rawdata, p.photoid, p.myLocation, p.accuracy, _app.getFullPhotoDescription(), function(err, message) {
                _app.buttonSendPhoto.removeAttribute('disabled');
                if (err) {
                    _app.showMessage(__('Upload failed') + ': ' + message);
                } else {
                    // success! Free memory and close dialog
                    p.rawdata = null;
                    _app.cameraPhoto.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
                    _app.cameraPhoto.hide();
                    _app.cameraPopup.hide();
                    setTimeout (function() {
                      /* todo: spinner while waiting for update? */
                      photoServer.resetCacheTime(); // reset cache
                      _app.photoSource = photoServer.updatePhotos();
                      olMap.clusterLayer.setSource(new ol.source.Cluster({
                          distance: 40,
                          source: _app.photoSource
                        }));
                      setTimeout(function(){
                        if (_app.overlayURL && !_app.activeFeature.get('isroot')) {
                          // change activeFeature to animated
                          _app.activeFeature.set('isroot', true);
                        }
                        _app.clickFeatureHandler(_app.activeFeature); // reload feature
                        _app.showMessage(__('Photo is now publicly visible on map'), 5000);
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

                var orientationOk = true;
                var cameraOverlayPictureFrame = document.querySelector('#gapp_camera_overlay_frame');
                if (!cameraOverlayPictureFrame.classList.contains('hidden')) {
                  var cameraOverlayPicture = document.querySelector('#gapp_camera_overlay');
                  if (window.innerWidth > window.innerHeight) {
                    if (cameraOverlayPicture.width < cameraOverlayPicture.height) {
                      orientationOk = false;
                    }
                  } else if (cameraOverlayPicture.width > cameraOverlayPicture.height) {
                    orientationOk = false;
                  }
                }
                if (orientationOk) {
                  CameraPreview.takePicture({width: 2048, height: 2048}, _app.takePictureHandler, function(reason)
                  {
                      _app.showMessage(reason);
                  });
                  _app.cameraPopup.shutterEffect();
                } else {
                  _app.showMessage (__('Wrong camera orientation, please adjust'));
                }
            }
        });

        var cameraClose = document.querySelector('#gapp_camera_close');
        cameraClose.addEventListener('click', _app.cameraPopup.hide);
    };

    this.takePictureHandler = function(base64PictureData) {
      var myLocation = olMap.geoLocation.getPosition();
      if (myLocation) {
          _app.cameraPreviewPhoto.rawdata = base64PictureData;
          _app.cameraPreviewPhoto.src = 'data:image/jpeg;base64,' + _app.cameraPreviewPhoto.rawdata;
          myLocation = ol.proj.transform(myLocation, 'EPSG:3857', 'EPSG:4326');
          var accuracy = olMap.geoLocation.getAccuracy();
          _app.cameraPreviewPhoto.myLocation = myLocation;
          _app.cameraPreviewPhoto.accuracy = accuracy;
          _app.cameraPhoto.show();
      } else {
          _app.showMessage('Required photo geo-location unknown');
      }
    };

    this.cordovaDeviceReady = function () {

    };

    this.geoLocationErrorHandler = function(message) {
      _app.showMessage('location: ' + message);
    };

    this.geoLocationFixed = false;
    this.geoLocationChangedHandler = function (coordinates) {
        if (!_app.geoLocationFixed && coordinates) {
            _app.geoLocationFixed = true;
            olMap.olmap.getView().setZoom(16); // default start zoom level for geoLocation
            setTimeout(function(){_app.setMapTracking(true);}, 100);
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

    this.loopInterval = 500;
    this.animationTargetElement = null;
    this.animationPaused = false;

    this.pauseAnimation = function() {
      _app.pauseButton.classList.add('hidden');
      _app.playBar.classList.remove('hidden');
      _app.animationPaused = true;
    };

    this.playAnimation = function() {
      _app.playBar.classList.add('hidden');
      _app.pauseButton.classList.remove('hidden');
      _app.animationPaused = false;
    };

    this.enablePlayPause = function(enabled)
    {
      if (enabled) {
        _app.pauseButton.classList.remove('hidden');
        _app.pauseButton.addEventListener('click', _app.pauseAnimation);
        _app.playButton.addEventListener('click', _app.playAnimation);
      } else {
        _app.playBar.classList.add('hidden');
        _app.pauseButton.classList.add('hidden');
        _app.pauseButton.removeEventListener('click', _app.pauseAnimation);
        _app.playButton.removeEventListener('click', _app.playAnimation);
        _app.animationPaused = false;
      }
    };

    this.showOnePhoto = function(basePhotoURL, width, height, targetElement, infoText, done)
    {
      var rect = _app.fitRectangleToDisplay(width/height,
        targetElement.clientWidth, targetElement.clientHeight, true);
      var photoframe = targetElement.querySelector('.gapp_photo_frame');
      _app.setElementStyleToRect(photoframe, rect);

      var errorInfo = document.querySelector('#gapp_featureinfo_error');
      var photo = new Image();
      var image = photoframe.querySelector('img');
      photo.onload = function() {
        errorInfo.classList.add('hidden');
        _app.setInfoText(infoText);
        image.src = photo.src;
        done();
      };
      photo.onerror = function() {
          errorInfo.classList.remove('hidden');
          _app.setInfoText('');
          done();
      };
      photo.src = basePhotoURL;
    };

    this.NextFeatureInfo = function(nextFeature, photoIndex, callback) {
      if (nextFeature.infoText) {
        callback(nextFeature.infoText);
      } else {
        _app.getFeatureInfoText(nextFeature.description, nextFeature.tags, nextFeature.time, photoIndex, function(err, result) {
          nextFeature.infoText = result;
          callback(result);
        });
      }
    };

    this.animating = false;

    this.doAnimation = function(feature)
    {
      var photoset = feature.get('photoset');
      if (!photoset || photoset.length === 0) {
        return;
      }
      _app.photoIndex = -1;
      var nextFeature;

      function loopPhotos() {
        if (feature !== _app.activeFeature || !_app.animating) {
          // end animation loop
          _app.enablePlayPause(false);
          _app.animating = false;
          return;
        }
        if (!_app.animationPaused) {
          _app.photoIndex++;
        }
        if (_app.photoIndex >= photoset.length || _app.photoIndex < 0) {
          _app.photoIndex = 0;
        }
        nextFeature = photoset[_app.photoIndex];
        _app.NextFeatureInfo(nextFeature, _app.photoIndex + 1, function(infoText){
          var fullUrl;
          if (_app.animationTargetElement === _app.featureInfoPopup) {
            fullUrl = photoServer.fullPhotoUrl(nextFeature.filename, 'small');
          } else {
            if (_app.isMobileDevice) {
              fullUrl = photoServer.fullPhotoUrl(nextFeature.filename, 'medium');
            } else {
              fullUrl = photoServer.fullPhotoUrl(nextFeature.filename, 'full');
            }
          }
          _app.showOnePhoto(fullUrl, nextFeature.width, nextFeature.height,
               _app.animationTargetElement, infoText, function() {
            setTimeout(loopPhotos, _app.loopInterval);
          });
        });
      }
      if (_app.animating) {
        // stop previous animations, before starting anew
        _app.animating = false;
        setTimeout(function(){
          _app.animating = true;
          _app.enablePlayPause(true);
          loopPhotos();
        }, _app.loopInterval * 2);
      } else {
        _app.animating = true;
        _app.enablePlayPause(true);
        loopPhotos();
      }
    };

    this.getFeatureInfoText = function(description, tags, time, photoIndex, callback)
    {
      if (photoIndex && photoIndex !== '') {
        photoIndex = photoIndex + '<br>';
      } else {
        photoIndex = '';
      }
      if (description && description !== '') {
        description = _utils.escapeHTML(description) + '<br>';
      } else {
        description = '';
      }
      if (!tags) {
        tags = [];
      }
      _app.getTagList(function (err, list) {
        if (err) {
          callback(true, 'getTagList failed');
        } else  {
          var tagtext = '';
          if (tags.length > 0) {
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
          if (tagtext !== '') {
            tagtext = _utils.escapeHTML(tagtext) + '<br>';
          }
          var date = new Date();
          date.setTime(Date.parse(time));
          var dateText = date.toISOString().replace('T', ' ').split('.')[0];

          callback(null, photoIndex + description + tagtext + dateText);
        }
      });
    };

    this.setInfoText = function(infoText)
    {
      document.querySelector('#gapp_featureinfo_infotext').innerHTML = infoText;
      document.querySelector('#gapp_fullscreenphotopopup_infotext').innerHTML = infoText;
    };

    this.clickFeatureHandler = function(feature) {
        _app.featureInfoPopup.hide();
        _app.activeFeature = feature;
        if (feature) {
            photoServer.getPhotoSet(feature, function(err, photoset) {
              if (err) {
                _app.showMessage(photoset);
              } else {
                feature.set('photoset', photoset);
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

                var picture_url = photoServer.fullPhotoUrl(feature.get('filename'), 'small');

                var spinner = document.querySelector('#gapp_featureinfo_spinner');
                var errorInfo = document.querySelector('#gapp_featureinfo_error');
                errorInfo.classList.add('hidden');
                _app.featureInfoPhoto = document.querySelector('#gapp_featureinfo_photo');
                _app.featureInfoPhoto.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
                _app.featureInfoPhoto.url = picture_url;
                _app.featureInfoPhoto.photoid = feature.get('id');
                spinner.classList.remove('hidden');
                spinner.classList.add('is-active');

                _app.getFeatureInfoText(feature.get('description'), feature.get('tags'), feature.get('time'), null, function(err, infoText){
                  _app.setInfoText(infoText);
                });

                var photoframe = _app.featureInfoPopup.querySelector('.gapp_photo_frame');
                photoframe.style.left = '0';
                photoframe.style.top = '0';
                var picture_width = feature.get('width');
                var picture_height = feature.get('height');
                var aspectratio = 1.0;
                if (picture_height && picture_width) {
                    aspectratio = picture_width / picture_height;
                }
                if (aspectratio >= 1) {
                    // landscape
                    _app.featureInfoPopup.style.width = photoframe.style.width = Math.floor(200 * aspectratio) + 'px';
                    _app.featureInfoPopup.style.height = photoframe.style.height = '200px';
                }
                else {
                    // portrait
                    _app.featureInfoPopup.style.width = photoframe.style.width = '200px';
                    _app.featureInfoPopup.style.height = photoframe.style.height = Math.floor(200 / aspectratio) + 'px';
                }

                var addphotobutton = document.querySelector('#gapp_featureinfo_addphoto');
                if (_app.isMobileDevice && distance < 0.08) {
                    addphotobutton.removeAttribute('disabled');
                }
                else {
                    addphotobutton.setAttribute('disabled', '');
                }
                _app.featureInfoPopup.show();
                var photo = new Image();
                photo.onload = function() {
                    spinner.classList.remove('is-active');
                    spinner.classList.add('hidden');
                    _app.featureInfoPhoto.src = _app.featureInfoPhoto.url; // not: this.src, may show delayed loading picture
                    if (photoset && photoset.length > 0) {
                      _app.animationTargetElement = _app.featureInfoPopup;
                      _app.doAnimation(feature);
                    } else {
                      _app.enablePlayPause(false);
                    }
                };
                photo.onerror = function() {
                    spinner.classList.remove('is-active');
                    errorInfo.classList.remove('hidden');
                };
                photo.src = picture_url;
              }
          });
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
