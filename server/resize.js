var gm = require('gm');

var fs = require('fs');
var Path = require('path');
var async = require("async");

function resizeImages(inputdir, outputdir)
{
	fs.readdir(inputdir, function (err, files) {
		console.log('files.length: ' + files.length);
		async.eachSeries(files, function (file, callback) {
			if (file.substr(-4, 4) == '.jpg') {
				var inputFilename = Path.join(inputdir, file);
				var outputFilename = Path.join(outputdir, Path.parse(file).base);
				gm(inputFilename).resize('640', '640', '^').write(outputFilename, function(err){
					if (err) {
						console.log('error resizing file: ' + outputFilename);
						callback(null);
					} else {
						callback(null);
					}
				});
			} else {
				callback(null);
			}		
			
		});
	});
}

resizeImages('uploads', 'uploads/preview2');



