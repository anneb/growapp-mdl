var Gm = require("gm");

Gm('1.jpg').fill('#ffffff').fontSize('100px').drawText(10, 10, 'Hallo', "SouthWest").write('1.jpg', function(err){});


Gm().in('-delay', 200).in('1.jpg').in('-delay', 100).in('2.jpg').in('-delay', 300).in('3.jpg').write('output.gif', function(err){});

/* Gm().in('-delay', 100).in("1.jpg").in('-delay', 500).in("2.jpg").resize(600, 600).write("gmoutput.gif", function (err){
  if(err) throw err;
  console.log("image converted");
})*/
