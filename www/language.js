var languageProvider = new function()
{
  var _languageProvider = this;
  this.languageTable = null;
  this.langCode = 'nl'; // default to best language
  this.countryCode = 'NL'; //https://www.youtube.com/watch?v=ELD2AwFN9Nc pos 1:06

  this.setLanguage = function(bcp47_language)
  {
    var bcp47 = bcp47_language.split('-');
    this.langCode = bcp47[0].toLowerCase();
    if (bcp47.length > 1) {
      this.countryCode = bcp47[1].toUpperCase();
    } else {
      this.countryCode = this.langCode;
    }
    this.languageTable = null;
    this.translateUI();
  };

  this._getJSON = function (url, callback){
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.onreadystatechange = function() {
      if (xhr.readyState != 4) {
        return;
      }
      if (xhr.status == 200 || xhr.status == 304 || xhr.status == 0 /* iOs file */) {
        callback(JSON.parse(xhr.response));
      } else {
        callback({});
      }
    };
    xhr.send();
  };

  this._updateLanguageTable = function(callback)
  {
    if (_languageProvider.languageTable) {
      callback();
    } else {
      _languageProvider._getJSON('./lang/' + _languageProvider.langCode + '.json', function(table){
        _languageProvider.languageTable = table;
        callback();
      });
    }
  };

  this.translateUI = function()
  {
    _languageProvider._updateLanguageTable(function() {
      var elements = document.querySelectorAll('.translate');
      [].forEach.call(elements, function(element) {
        element.innerText = __(element.innerText);
      });
    });
  };
}();

function __(key){
  if (languageProvider.languageTable && key in languageProvider.languageTable) {
        return languageProvider.languageTable[key];
  }
  return key;
}
