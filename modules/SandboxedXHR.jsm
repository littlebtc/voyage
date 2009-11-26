/* vim: sw=2 ts=2 sts=2 et filetype=javascript 
 * Sandboxed XMLHTTPRequest, to ensure that cookies will not be exposed
 */
const Cc = Components.classes;
const Ci = Components.interfaces;

var EXPORTED_SYMBOLS = [ "sandboxedXHR" ];

function sandboxedXHR() {
  this._xhr = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
  this._observerSvc = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
  /* Implements XMLHttpRequest attributes */
  defineReadOnlyAttribute(this, 'channel');
  defineAttribute(this, 'mozBackgroundRequest');
  defineAttribute(this, 'multipart');
  defineAttribute(this, 'onreadystatechange');
  defineReadOnlyAttribute(this, 'readyState');
  defineReadOnlyAttribute(this, 'responseText');
  defineReadOnlyAttribute(this, 'responseXML');
  defineReadOnlyAttribute(this, 'status');
  defineReadOnlyAttribute(this, 'statusText');
  defineAttribute(this, 'upload');
  
  defineAttribute(this, 'onload');
  defineAttribute(this, 'onerror');
  defineAttribute(this, 'onprogress');

  /* Add event listener */
  this._xhr.addEventListener("load",  function(obj) { return function(e) { obj._transferDone.call(obj); }; }(this) , false);  
  this._xhr.addEventListener("error", function(obj) { return function(e) { obj._transferDone.call(obj); }; }(this) , false);  
  this._xhr.addEventListener("abort", function(obj) { return function(e) { obj._transferDone.call(obj); }; }(this) , false);  
  this._observerSvc.addObserver(this, "http-on-modify-request", false);
  this._observerSvc.addObserver(this, "http-on-examine-response", false);
}
sandboxedXHR.prototype = {
  /* Implements nsIObserver */
  observe: function(aSubject, aTopic, data) {
    switch (aTopic) {
      /* Do not send any cookie */
      case 'http-on-modify-request':
        if (this._xhr.channel  == aSubject) {
          aSubject.QueryInterface(Components.interfaces.nsIHttpChannel)
                  .setRequestHeader('Cookie', '', false);
        }
      break;
      /* Do not receive any cookie */
      case 'http-on-examine-response':
        if (this._xhr.channel  == aSubject) {
          aSubject.QueryInterface(Components.interfaces.nsIHttpChannel)
                  .setResponseHeader('Set-Cookie', '', false);
        }
      break;
    }
  },
  /* Remove observer when done */
  _transferDone: function() {
    this._observerSvc.removeObserver(this, "http-on-modify-request", false);
    this._observerSvc.removeObserver(this, "http-on-examine-response", false);
  },
  /* Implements XMLHttpRequest methods */
  abort: function() {
    this._xhr.abort();
  },
  getAllResponseHeaders: function() {
    return this._xhr.getAllResponseHeaders();
  },
  getResponseHeader: function(header) {
    return this._xhr.getResponseHeader(header);
  },
  open: function(method, url) {
    return this._xhr.open(method, url);
  },
  overrideMimeType: function(mimetype) {
    return this._xhr.overrideMimeType(mimetype);
  },
  send: function(body) {
    return this._xhr.send(body);
  },
  sendAsBinary: function(body) {
    return this._xhr.sendAsBinary(body);
  },
  setRequestHeader: function(header, value) {
    return this._xhr.setRequestHeader(header, value);
  },
}

function defineAttribute(obj, attrName) {
  obj.__defineGetter__(attrName, function() { return obj._xhr[attrName]; });
  obj.__defineSetter__(attrName, function(value) { obj._xhr[attrName] = value });
}
function defineReadOnlyAttribute(obj, attrName) {
  obj.__defineGetter__(attrName, function() { return obj._xhr[attrName]; });
}
