/* Code snippet from https://developer.mozilla.org/En/Custom_about:_URLs */

const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function AboutVoyage() { }
AboutVoyage.prototype = {
  classDescription: "about:voyage",
  contractID: "@mozilla.org/network/protocol/about;1?what=voyage",
  classID: Components.ID("{fe258f80-9a4c-11de-8a39-0800200c9a66}"),
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule]),
  
  getURIFlags: function(aURI) {
    return Ci.nsIAboutModule.ALLOW_SCRIPT;
  },
  
  newChannel: function(aURI) {
    let ios = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
    let channel = ios.newChannel("chrome://voyage/content/voyage.xhtml",
                                 null, null);
    channel.originalURI = aURI;
    return channel;
  }
};

function NSGetModule(compMgr, fileSpec)
  XPCOMUtils.generateModule([AboutVoyage]);

