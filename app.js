"use strict";
/* 
app.js
assumes openlayers.js and proj4.js are loaded

Main objects in this module:

_utils: general utility functions
OLMap: openlayers, geolocation
App: UI and handler hooks into OLMap

*/

/* global ol */
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
    }
};

var OLMap = new function() {
    var olMap = this;
    
    this.init = function(server, mapId, featureFieldName) {
        olMap.initMap(server, mapId);
        olMap.initGeoLocation();
        olMap.initDragHandler();
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
            olMap.dragStartPixel = this.dragPrevPixel = event.pixel;
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
          }
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
    var app = this;
    
    this.init = function(server, mapId, isMobileDevice) {
        // init message popups at bottom of screen
        this.snackbarContainer = document.querySelector('#gapp-snackbar');
        // select setup for mobile device or web
        if (typeof isMobileDevice == 'undefined') {
            isMobileDevice = true; // default
        }
        if (!isMobileDevice) {
            _utils.disableElement('#gapp_button_camera');
        }
        // setup handler hooks into OLMap
        OLMap.geoLocationErrorHandler = this.geoLocationErrorHandler;
        OLMap.geoLocationChangedHandler = this.geoLocationChangedHandler;
        OLMap.dragHandler = this.mapDragHandler;
        // intialise OLMap
        OLMap.init(server, mapId, 'filename');
        this.buttonLocation = document.querySelector("#gapp_button_location");
        this.buttonLocation.addEventListener('click', function(){app.setMapTracking(!OLMap.mapTracking);});
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
                break;
            case 'dragend':
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
};