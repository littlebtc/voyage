/* vim: sw=2 ts=2 sts=2 et filetype=javascript
   Overlay, show the first run page and handle the "media wall"
*/
var voyage = {
  onLoad: function() {
    Components.utils.import("resource://voyage/XPCOMUtilsExtra.jsm");
    XPCOMUtilsExtra.defineLazyServiceGetter(this, "_ioService", "@mozilla.org/network/io-service;1", "nsIIOService");
    XPCOMUtilsExtra.defineLazyServiceGetter(this, "_annoService", "@mozilla.org/browser/annotation-service;1", "nsIAnnotationService");
    var appContent = document.getElementById("appcontent");   // browser
    appContent.addEventListener("DOMContentLoaded", function(event) { voyage.onPageLoad(event) }, true);
    /* Show the first run of Voyage */
    var prefBranch = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.voyage.");
    if (prefBranch.getBoolPref('firstrun')) {
      voyage.openInNewTab('about:voyage#firstRun');
      prefBranch.setBoolPref('firstrun', false);
    }
  },
  openInNewTab: function(url) {
    window.setTimeout(function(url) { return function() { gBrowser.selectedTab = gBrowser.addTab(url); }; }(url), 100);
  },

  onPageLoad: function(aEvent) {
    var doc = aEvent.originalTarget; // doc is document that triggered "onload" event
    if (!doc || !doc.location) { return; }
    var url = doc.location.href;
    /* Handle http/https only */
    if (url.indexOf("http://") != 0 && url.indexOf("https://") != 0) {
      return;
    }

    /* Doing URI dependent URL fetching
       XXX: This should have an API
    */
    var thumbUrl = "";
    if (url.match(/^http:\/\/www\.flickr\.com\/photos\/[0-9a-z\-\_]+\/[0-9]+/i)) {
      /* Flickr */
      var imageSrc = doc.querySelector("link[rel='image_src']");
      if (imageSrc) {
        thumbUrl = imageSrc.href;
        thumbUrl = thumbUrl.replace(/\_m\.jpg$/, '_s.jpg');
      } 
    } else if (url.indexOf('http://www.youtube.com/watch') == 0) {
      /* YouTube */
      var videoIDMatch = url.match(/(\?|\&)v\=([^\&]+)/); /* Matches: ?v=xxxxx and &v=xxxxx */
      if (videoIDMatch) {
        var videoID = videoIDMatch[2];
        thumbUrl = 'http://img.youtube.com/vi/'+videoID+'/2.jpg';
      }
    } else if (url.indexOf('http://www.wretch.cc/album/show.php') == 0) {
      /* wretch.cc */
      var displayImage = doc.getElementById('DisplayImage');
      if (displayImage && displayImage.tagName.match(/img/i)) {
        thumbUrl = displayImage.getAttribute('src').replace(/\/([0-9]+)\.jpg$/, '/thumbs/t$1.jpg');
      }
    } else if (url.match(/^http:\/\/[0-9A-Za-z\-]+\.pixnet\.net\/album\/photo\//)) {
      /* Pixnet */
      var image = doc.querySelector("#imageFrame img");
      if (image) {
        thumbUrl = image.getAttribute('src').replace(/\/([0-9a-z]+)\.jpg$/, '/thumb_$1.jpg').replace(/\/normal\_([0-9a-z]+)\.jpg$/, '/thumb_$1.jpg');
      }
    } else if (url.match(/^http:\/\/(www|tw|es|de)\.nicovideo\.jp\/watch\/[a-z]{2}([0-9]+)/)) {
      /* Nico Nico Douga */
      var videoID = url.match(/^http:\/\/(www|tw|es|de)\.nicovideo\.jp\/watch\/[a-z]{2}([0-9]+)/)[2]; 
      var rand = Math.floor(Math.random() * 3) + 1;
      thumbUrl = "http://tn-skr"+rand+".smilevideo.jp/smile?i="+videoID;
    }
    /* Store into the Annotation */
    if (thumbUrl) {
      var uri = this._ioService.newURI(url, null, null);
      this._annoService.setPageAnnotation(uri, "voyage/thumb_image_url", thumbUrl, 0, this._annoService.EXPIRE_WITH_HISTORY);
    }
  }
};

window.addEventListener("load", function() {voyage.onLoad();}, false);
