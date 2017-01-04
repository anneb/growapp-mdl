"use strict";
/* 
app.js
assumes openlayers.js and proj4.js are loaded

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
    
    this.loadMap = function (server, mapId) {
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
    };/* loadMap */
    
    this.geoLocationErrorHandler = function(message) {
        console.warn('unhandled geolocation Error: ' + message);
    };
    
    this.loadGeoLocation = function ()
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
    }
    
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
};

var App = new function() {
    var app = this;
    
    this.toggleButtonLocation =  function()
    {
        /* temp */
        app.showMessage("geklikt!");
    };
    
    this.init = function(server, mapId, isMobileDevice) {
        if (typeof isMobileDevice == 'undefined') {
            isMobileDevice = true; // default
        }
        if (!isMobileDevice) {
            _utils.disableElement('#gapp_button_camera');
        }
        OLMap.loadMap(server, mapId);
        OLMap.loadGeoLocation();
        this.buttonLocation = document.querySelector("#gapp_button_location");
        this.buttonLocation.addEventListener('click', this.toggleButtonLocation);
        this.snackbarContainer = document.querySelector('#gapp-snackbar');
        OLMap.geoLocationErrorHandler = this.geoLocationErrorHandler;
    };
    
    this.geoLocationErrorHandler = function(message) {
      app.showMessage(message);
      app.buttonLocation.classList.remove('mdl-color--white');
      _utils.disableElement("#gapp_button_location");
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