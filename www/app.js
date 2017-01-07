"use strict";
/* 
app.js
assumes openlayers.js and proj4.js are loaded

Main objects in this module:

_utils: general utility functions
OLMap: openlayers, geolocation
App: UI and handler hooks into OLMap

*/

/* global ol, Image */

Number.prototype.toRad = function() { // helper
    return this * Math.PI / 180;
};

var _utils = {
    hideElement : function (selector) {
        var element = document.querySelector(selector);
        if (element) {
            element.classList.add("hidden");
        }
    },
    showElement : function(selector) {
        var element = document.querySelector(selector);
        if (element) {
            element.classList.remove("hidden");
        }
    },
    disableElement: function(selector) {
        var element = document.querySelector(selector);
        if (element) {
            element.setAttribute("disabled", "");
            // componentHandler.upgradeElement(element);
        }
    },
    enableElement: function(selector) {
        var element = document.querySelector(selector);
        if (element) {
            element.removeAttribute("disabled");
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
        var d = R * c;
        return d;
    }
};


var OLMap = new function() {
    var olMap = this;
    
    this.init = function(server, mapId, featureFieldName) {
        this.server = server;
        olMap.initMap(server, mapId);
        olMap.initGeoLocation();
        olMap.initDragHandler();
        olMap.initPanZoomHandler();
        olMap.initClickFeatureHandler(featureFieldName);
    };
    
    this.initMap = function (server, mapId) {
        this.server = server;
        this.updatePhotos();
        this.openStreetMapLayer = new ol.layer.Tile({
            source: new ol.source.OSM({
                url: "https://saturnus.geodan.nl/mapproxy/osm/tiles/osmgrayscale_EPSG900913/{z}/{x}/{y}.png?origin=nw"
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
    
    this.updatePhotos = function() {
        //adds or reloads photo positions into Photolayer
        if (this.photoLayer) {
            // update source
            this.photoLayer.setSource(
                new ol.source.Vector({
                    projection: 'EPSG:4326',
                    url: this.server + '/photoserver/getphotos?' + new Date().getTime(), // File created in node
                    format: new ol.format.GeoJSON()
                })
            );
        }
        else {
            this.photoLayer = new ol.layer.Vector({
                source: new ol.source.Vector({
                    projection: 'EPSG:4326',
                    url: this.server + '/photoserver/getphotos?0', // File created in node
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
                                color: "black",
                                width: 1
                            })
                        })
                        //image: new ol.style.Circle({ radius: 4, fill: new ol.style.Fill({color: 'red'}), stroke: new ol.style.Stroke({color: "black", width: 1})})

                })
            });
        }
    };
    
    this.dragStart = false;
    this.dragPrevPixel = null;
    
    this.dragHandler = function (status, pixel, prevpixel) {
        console.log ("dragging: " + status + ", current: " + JSON.stringify(pixel) + ", prevpoint: " + JSON.stringify(prevpixel));
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
        // init message popups at bottom of screen
        this.snackbarContainer = document.querySelector('#gapp-snackbar');
        
        this.featureInfoPopupInit();
        
        // select setup for mobile device or web
        if (typeof isMobileDevice == 'undefined') {
            isMobileDevice = true; // default
        }
        if (!isMobileDevice) {
            _utils.disableElement('#gapp_button_camera');
        } else {
            this.cameraPopupInit();
        }
        // setup handler hooks into OLMap
        OLMap.geoLocationErrorHandler = this.geoLocationErrorHandler;
        OLMap.geoLocationChangedHandler = this.geoLocationChangedHandler;
        OLMap.dragHandler = this.mapDragHandler;
        OLMap.clickFeatureHandler = this.clickFeatureHandler;
        OLMap.panZoomHandler = this.panZoomHandler;
        // intialise OLMap
        OLMap.init(server, mapId, 'filename');
        this.buttonLocation = document.querySelector("#gapp_button_location");
        this.buttonLocation.addEventListener('click', function(){app.setMapTracking(!OLMap.mapTracking);});
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
            app.fullscreenphoto = document.querySelector('#gapp_fullscreenphoto');
            var featureinfophoto = document.querySelector('#gapp_featureinfo_photo');
            app.fullscreenphoto.src = featureinfophoto.src;
            document.removeEventListener('backbutton', app.featureInfoPopup.hide);
            document.addEventListener('backbutton', app.fullscreenphotopopup.hide);
            app.fullscreenphotopopup.classList.remove('hidden');
        };
        this.fullscreenphotopopup.hide = function() {
            document.removeEventListener('backbutton', app.fullscreenphotopopup.hide);
            document.addEventListener('backbutton', app.featureInfoPopup.hide);
            app.fullscreenphotopopup.classList.add('hidden');
        };
        
        var gappFeatureInfoClose = document.querySelector("#gapp_featureinfo_close");
        gappFeatureInfoClose.addEventListener('click', app.featureInfoPopup.hide);
        
        var gappFeatureInfoFullScreen = document.querySelector('#gapp_featureinfo_fullscreen');
        gappFeatureInfoFullScreen.addEventListener('click', app.fullscreenphotopopup.show);
        
        var gappFeatureInfoFullScreenClose = document.querySelector('#gapp_fullscreenphotopopup_close');
        gappFeatureInfoFullScreenClose.addEventListener('click', app.fullscreenphotopopup.hide);
    };
    
    this.cameraPopupInit = function () {
        this.cameraPopup = document.querySelector('#gapp_camera_popup');
        this.cameraPopup.show = function() {
            document.querySelector('#mainUI').classList.add('hidden');
            app.cameraPopup.classList.remove('hidden');
        };
        this.cameraPopup.hide = function() {
            document.querySelector('#mainUI').classList.remove('hidden');
            app.cameraPopup.classList.add('hidden');
        };
        var cameraButton = document.querySelector('#gapp_button_camera');
        cameraButton.addEventListener('click', function() {
            app.cameraPopup.show();
        });
        
        var cameraClose = document.querySelector('#gapp_camera_close');
        cameraClose.addEventListener('click', app.cameraPopup.hide);
    };
    
    this.geoLocationErrorHandler = function(message) {
      app.showMessage('location: ' + message);
      // app.buttonLocation.classList.remove('mdl-color--white');
      // _utils.disableElement("#gapp_button_location");
    };
    
    this.geoLocationFixed = false;
    this.geoLocationChangedHandler = function (coordinates) {
        if (!app.geoLocationFixed && coordinates) {
            app.geoLocationFixed = true;
            app.buttonLocation.removeAttribute('disabled');
            app.buttonLocation.classList.add('mdl-color--white');
            app.buttonLocation.classList.add('mdl-color-text--blue-700');
        }
    };
    
    this.setMapTracking = function(enabled) {
        OLMap.mapTracking = enabled;
        if (enabled) {
            app.buttonLocation.classList.remove("inactive");
            var coordinates = OLMap.geoLocation.getPosition();
            if (coordinates) {
                OLMap.olmap.getView().setCenter(coordinates);
            }
        } else {
            app.buttonLocation.classList.add("inactive");
        }
    };
    
    this.mapDragHandler = function (status, pixel, prevpixel) {
        switch(status) {
            case 'dragstart':
                app.setMapTracking(false);
                break;
            case 'dragging':
                // drag info window along
                app.featureInfoPopup.style.left = (parseInt(app.featureInfoPopup.style.left, 10) - (prevpixel[0] - pixel[0])) + 'px';
                app.featureInfoPopup.style.top = (parseInt(app.featureInfoPopup.style.top, 10) - (prevpixel[1] - pixel[1])) + 'px';
                break;
            case 'dragend':
            case 'moveend':
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
        
            var picture_url = this.server + '/uploads/' + feature.get('filename');
            var spinner = document.querySelector('#gapp_featureinfo_spinner');
            var domPhoto = document.querySelector('#gapp_featureinfo_photo');
            domPhoto.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
            spinner.classList.add('is-active');
            var photo = new Image();
            photo.onload = function() {
                spinner.classList.remove('is-active');
                domPhoto.src = picture_url; // not: this.src, may show delayed loading picture
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
                app.featureInfoPopup.style.width = Math.floor(200 * aspectratio) + "px";
                app.featureInfoPopup.style.height = "200px";
            }
            else {
                // portrait
                app.featureInfoPopup.style.width = "200px";
                app.featureInfoPopup.style.height = Math.floor(200 / aspectratio) + "px";
            }
        
            var addphotobutton = document.querySelector('#gapp_featureinfo_addphoto');
            if (distance < 0.08) {
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
                break;
        }
    };
    
    this.showMessage = function(message, timeout)
    {
        if (typeof timeout == 'undefined') {
            timeout = 2000;
        }
        var data = {
            message: message,
            timeout: timeout
        };
        app.snackbarContainer.MaterialSnackbar.showSnackbar(data);
    };
}();