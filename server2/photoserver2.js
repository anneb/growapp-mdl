var express    = require('express');        // call express
var app        = express();                 // define our app using express
var bodyParser = require('body-parser');
var cors       = require('cors');


var netconfig;
if (process.env.PS_TRUSTED_PROXIES &&
    process.env.PS_TRUSTED_IPS &&
    process.env.PS_SMTPSERVER &&
    process.env.PS_SMTPPORT &&
    process.env.PS_SMTPUSER &&
    process.env.PS_SMTPPASSWORD &&
    process.env.PS_SMTPDOMAIN)
{
    netconfig = {
      trusted_proxies: process.env.PS_TRUSTED_PROXIES,
      trusted_ips: process.env.PS_TRUSTED_IPS,
      smtpserver: process.env.PS_SMTPSERVER,
      smtpport: process.env.PS_SMTPPORT,
      smtpuser: process.env.PS_SMTPUSER,
      smtppassword: process.env.PS_SMTPPASSWORD,
      smtpdomain: process.env.PS_SMTPDOMAIN
    };
} else {
    netconfig = require('./netconfig.json');
}

var photodb    = require('./photodb')(netconfig);

// use trust proxy if configured 
if (netconfig.trusted_proxies && netconfig.trusted_proxies !== '') {
    app.set('trust proxy', netconfig.trusted_proxies);
}
  

// configure app to use bodyParser()
// this will let us get the data from a POST
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

var port = process.env.PORT || 8081;        // set our port

// ROUTES FOR OUR API
// =============================================================================
var router = express.Router();              // get an instance of the express Router

router.use(function(req, res, next) {
    // do logging
    console.log(new Date().toString() + " " + req.method + ' ' + req.originalUrl);
    next(); // make sure we go to the next routes and don't stop here
});

router.use(cors());

// test route to make sure everything is working (accessed at GET http://localhost:8080/api)
router.get('/', function(req, res) {
    res.json({ message: 'growapp server api' });   
});

function jsonError(res, error)
{
    if (error && error.name) {
        switch(error.name) {
            case "unknowndeviceerror":
            case "unknownownererror":
                res.status(403).json({"error" : {"name": error.name, "message": error.message}});
                break;
            default:
                res.status(500).json({"error" : {"name": error.name, "message": error.message}});
        }
    } else {
        res.status(500).json({"error" : {"name": "unexpected error", "message": error}});
    }
}

// more routes for our API will happen here
router.route('/photos')
  .get(function(req, res){
    photodb.getPhotos()
    .then(function(photos){
        res.json(photos);
    })
    .catch(function(error){
      jsonError(res, error);
    });
  })
  .post(function(req, res){
     photodb.storePhoto(req.body)
     .then(function(result){
         res.json(result);
     })
     .catch(function(error){
         jsonError(res, error);
     });
  });

function fixIp(ip)
{
    if (ip.substr(0, 7) === '::ffff:') {
        ip = ip.substr(7);
    }
    return ip;
}

router.route('/photos/:id')
  .get(function(req, res){
    photodb.getPhotos(req.params.id)
      .then(function(photos){
          res.json(photos);
      })
      .catch(function(error){
        jsonError(res, error);
      });
  })
  .put(function(req, res){

  })
  .delete(function(req, res){
    photodb.deletePhoto(req.params.id, req.body, fixIp(req.ip))
      .then(function(photo){
          res.json(photo);
      })
      .catch(function(error){
          jsonError(res, error);
      });
  });

router.route('/device')
   .post(function(req, res){
        var ip = fixIp(req.ip);        
        photodb.createDevice(req.body, ip)
            .then(function(deviceinfo){
                res.json(deviceinfo);
            })
            .catch(function(error){
                jsonError(res, error);
            });
   });

// REGISTER OUR ROUTES -------------------------------
// all of our routes will be prefixed with /api
app.use('/api', router);



// START THE SERVER
// =============================================================================
app.listen(port);
console.log('GrowApp photoserver listening on port ' + port);