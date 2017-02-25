var languageTable = null;

var getJSON = function (url, callback){
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url);
  xhr.onreadystatechange = function() {
    if (xhr.readyState != 4) {
      return;
    }
    if (xhr.status == 200 || xhr.status == 304) {
      callback(JSON.parse(xhr.response));
    }
  };
  xhr.send();
};

function __(key){
  if (languageTable && key in languageTable) {
        return languageTable[key];
  }
  return key;
}

function TranslateUI()
{
  var elements = document.querySelectorAll('.translate');
  [].forEach.call(elements, function(element) {
    element.innerText = __(element.innerText);
  });
}
