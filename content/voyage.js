const Cc = Components.classes;
const Ci = Components.interfaces;

var voyage = {
  inPrivate: false,
  /* Determine the time range in a bubble, in minutes */
  _bubbleRange: 10,
  _timelineRange: 30,
  /* A point for bubbles in time order */
  _bubbles: [],
  _medias:[],
  _sizePerBlock: 50,
  _daysToShow: 3,
  _visits: {},
  /* Store the "reversed" host and the "bubble"'s date range.
     String reverse may take a lot of time, so I choose to store the reversed result as in the database */
  _hosts: {},

  onLoad: function() {
    Components.utils.import("resource://voyage/XPCOMUtilsExtra.jsm");
    Components.utils.import('resource://voyage/HistoryReader.jsm');
    XPCOMUtilsExtra.defineLazyGetter(this, "_prefBranch", function() {
      return Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.voyage.");
    });
    XPCOMUtilsExtra.defineLazyServiceGetter(this, "_faviconService", "@mozilla.org/browser/favicon-service;1", "nsIFaviconService");

    /* Find out if we are in private browsing mode, if true, display error message */
    var privateSvc = Cc["@mozilla.org/privatebrowsing;1"].getService(Ci.nsIPrivateBrowsingService);  
    this.inPrivate = privateSvc.privateBrowsingEnabled;  
  },
  onDOMReady: function() {
    if (this.inPrivate) {
      $('#container').remove();
      $('#privateBrowsingError').show();
      //voyage.timeline.onDOMReady();
      return;
    }
    voyage.timeline.init();
    voyage.twitter.onDOMReady();
 
    /* Bind DOM Evnets */
    
    /* Make it timeline/mediawall scrollable by scroll wheel on mouse */
    document.getElementById('timeline').addEventListener('MozMousePixelScroll', function(e) {
      if (e.axis == e.VERTICAL_AXIS) {
        document.getElementById('timeline').scrollLeft += e.detail;
      }
    }, false
    );
    document.getElementById('mediaWall').addEventListener('MozMousePixelScroll', function(e) {
      if (e.axis == e.VERTICAL_AXIS) {
        document.getElementById('mediaWall').scrollLeft += e.detail;
        $('#mediaWallSliderContainer div').slider('value', document.getElementById('mediaWall').scrollLeft);
      }
    }, false
    );
    document.addEventListener("keydown", function(e) {
      if (e.target.tagName == "input") { return; }
      if (e.keyCode == 39/* DOM_VK_RIGHT */) {
        document.getElementById("timeline").scrollLeft += 100;
      }
      if (e.keyCode == 37/* DOM_VK_LEFT */) {
        document.getElementById("timeline").scrollLeft -= 100;
      }
    }, false
    );
    document.getElementById('timeline').addEventListener("scroll", function(e) {
      voyage.removeBubbleTip();
    }, false
    );
    document.getElementById('timeline').addEventListener("mouseover", function(e) {
      if (!e.target.id || e.target.id.indexOf('timeline') != 0) { return; }
      voyage.removeBubbleTip();
    }, false
    );
    document.getElementById('mediaWall').addEventListener("mouseover", function(e) {
      if (e.target.tagName.match(/^a$/i)) { return; }
      voyage.removeBubbleTip();
    }, false
    );
    $('#detailPopup').dialog({ autoOpen: false, width: '90%', height: 500, modal: true });
    $('#twitterAuth').dialog({ autoOpen: false, width: 600, height: 300, modal: true });
    var buttons = {};
    buttons[voyage.strings.getString('firstRunButton')] =  function() { $(this).dialog("close"); }
    $('#firstRun').dialog({ buttons: buttons,   autoOpen: false, width: 600, height: 400, modal: true });
    /* Check the first run to show the message */
    if(document.location.href.indexOf('#firstRun') != -1) {
      $('#firstRun').dialog('open');
    }
  },
  /* Call the historyReader to read the history */
  readHistory: function(beginTime, endTime, keyword) {
    this._visits = [];
    this._bubbles = [];
    this._hosts = {};
    this._medias = [];
    this._reader = new historyReader();
    this._reader.fetch(beginTime, endTime, keyword, this);
  },
  /* After reader fetch the history records asynchrously, read the result and collect the bubble */
  handleCompletion: function(aReason, aColumns, aRows) {
    
    var bubbleNum = 0;
    /* Process the "visit" results, phase 1 */
    for (var i = 0; i < aRows.length; i++) {
      /* Add visits' simple index mapping */
      this._visits[aRows[i]['v.id']] = aRows[i];
    }
    /* Filter out "redirects"
       XXX: Performance
    */
    if (!this._prefBranch.getBoolPref('showredirect')) {
      for (var i = 0; i < aRows.length; i++) {
        if (!aRows[i]) { continue; }
        if (aRows[i]['v.visit_type'] == 5 /* TRANSITION_REDIRECT_PERMANENT */ || aRows[i]['v.visit_type'] == 6 /* TRANSITION_REDIRECT_TEMPORARY */ ) {
          var doubleFrom = 0;
          if (this._visits[aRows[i]['v.from_visit']]) {
            doubleFrom = this._visits[aRows[i]['v.from_visit']]['v.from_visit'];
            var index = aRows.indexOf(this._visits[aRows[i]['v.from_visit']]);
            this._visits[aRows[i]['v.from_visit']] = null;
            aRows[index] = null;
          }
          aRows[i]['v.from_visit'] = doubleFrom;
        }
      }
    }
    for (var i = 0; i < aRows.length; i++) {
      /* Not consiner filtered result */
      if (!aRows[i]) { continue; }
      /* Prepare "visit links" */
      aRows[i]['v.to_visits'] = [];
      
      /* Annotation */
      if (aRows[i]['a.content']) {
        this._medias.push({id: aRows[i]['v.id'], src: aRows[i]['a.content']});
      }
      
      /* Determine the bubble */
      var hostBubbles = this._hosts[aRows[i]['h.rev_host']];
      if (hostBubbles) {
        /* If this host has some "bubble", and we will check the time range to check whether to create new one */
        var lastIndex = hostBubbles.length - 1;
        var nearestBubble  = hostBubbles[lastIndex];
        if (nearestBubble.endTime - aRows[i]['v.visit_date'] / 1000 > this._bubbleRange * 60000) {
          var newLen = hostBubbles.push( { revHost: aRows[i]['h.rev_host'],
                                           endTime: aRows[i]['v.visit_date'] / 1000,
                                           startTime: aRows[i]['v.visit_date'] / 1000,
                                           avgTime: aRows[i]['v.visit_date'] / 1000,
                                           visits: [aRows[i]['v.id']], from: [], to:[] } );
          this._bubbles.push(hostBubbles[(newLen - 1)]);
          aRows[i].bubble = hostBubbles[(newLen - 1)];
          bubbleNum++;
        } else {
          /* Modify start/average time */
          nearestBubble.startTime = aRows[i]['v.visit_date'];
          nearestBubble.avgTime = (nearestBubble.avgTime * nearestBubble.visits.length + aRows[i]['v.visit_date'] / 1000)
                                  / (nearestBubble.visits.length + 1);
          nearestBubble.visits.push(aRows[i]['v.id']);
          aRows[i].bubble = nearestBubble;
        }
      } else {
        /* If this host has no "bubble"... */
        this._hosts[aRows[i]['h.rev_host']] = new Array();
        hostBubbles = this._hosts[aRows[i]['h.rev_host']];
        var newLen = hostBubbles.push( { revHost: aRows[i]['h.rev_host'],
                                         endTime: aRows[i]['v.visit_date'] / 1000,
                                         startTime: aRows[i]['v.visit_date'] / 1000,
                                         avgTime: aRows[i]['v.visit_date'] / 1000,
                                         visits: [aRows[i]['v.id']], from: [], to:[] } );
        this._bubbles.push(hostBubbles[(newLen - 1)]);
        aRows[i].bubble = hostBubbles[(newLen - 1)];
        bubbleNum++;
      }
      
      //$('#timeline').append('<p>URL: ' + this.htmlEntities(aRows[i].url) + ' Time:' + new Date(aRows[i].visit_date / 1000).toString() + '</p>');
    } 
    /* Process the "visit" results, phase 2, test from/to visits */
    for (var i = 0; i < aRows.length; i++) {
      /* Not consiner filtered result */
      if (!aRows[i]) { continue; }
      var toVisit = aRows[i];
      var fromVisit = this._visits[aRows[i]['v.from_visit']];
      if (fromVisit) {
        fromVisit['v.to_visits'].push(toVisit['v.id']);
        
        /* Create relationship for bubbles */
        var bubble = fromVisit.bubble;
        if (bubble.to.indexOf(toVisit.bubble) == -1) {
          bubble.to.push(toVisit.bubble);
        }
        bubble = toVisit.bubble;
        if (bubble.from.indexOf(fromVisit.bubble) == -1) {
          bubble.from.push(fromVisit.bubble);
        }
      }
    }
    /* Re-sort bubbles to display in avgTime order */
    this._bubbles.sort( function(a, b) {
      return(b.avgTime - a.avgTime);
    });
    if (!voyage.twitter.hasToken() || voyage.twitter._error) {
      /* Show directly if Twitter is not enabled */
      voyage.timeline.displayTimeline(false);
    } else if (voyage.twitter._ready) {
      /* Timeline will be first loaded when it is ready, so for the first time, do not need to load from here */
      voyage.timeline.displayTimeline(voyage.twitter._ready);
    }
    /* Draw the Media Wall */
    for (var i = 0 ; i < this._medias.length; i++) {
      var visit = this._visits[this._medias[i].id] ;
      $('#mediaWall').append(
        $('<a />').attr(
                         {
                         "href": visit['h.url'],
                         "title": visit['h.title'],
                         "id": "media-" + visit['v.id'],
                         "target": "_blank"
                         }
                        )
                  .css({ 'background': 'url('+this._medias[i].src+') 0' })
                  .addClass('mediaWallItem')
                  .mouseover( function(visit) {
                     return function() { voyage.focusBubbleTip(voyage._bubbles.indexOf(visit.bubble)); };
                  }(visit))
      );
    }
    if (this._medias.length < 1) {
      $('#mediaWall').append($('<p />').html(voyage.strings.getString('noMedia')).css({
      'text-align': 'center', 'width': '100%', 'height': '75px', 'display': 'inline-block', 'padding-top': '25px'
      }));
    }
    var mediaWallScrollRange = Math.max(document.getElementById('mediaWall').scrollWidth - document.getElementById('mediaWall').offsetWidth, 0);
    $('#mediaWallSliderContainer').empty().append($('<div />').slider( {
      min: 0,
      max: mediaWallScrollRange,
      step: 79,
      slide: function(e, ui) { document.getElementById('mediaWall').scrollLeft = ui.value; },
      change: function(e, ui) { document.getElementById('mediaWall').scrollLeft = ui.value; }
    }
    ));
    var canvas = document.getElementById('bubbleLinker');
    canvas.width = document.getElementById('timeline').offsetWidth;
    canvas.height = document.getElementById('timeline').offsetHeight;
    /* Reset the media wall slider after resize */
    window.addEventListener('resize', function(e) {
      var mediaWallScrollRange = Math.max(document.getElementById('mediaWall').scrollWidth - document.getElementById('mediaWall').offsetWidth, 0);
      var mediaWallScrollValue = Math.min($('#mediaWallSliderContainer > div').slider('option', 'value'), mediaWallScrollRange);
      $('#mediaWallSliderContainer > div').show().slider('option', 'max', mediaWallScrollRange).slider('option', 'value', mediaWallScrollValue);
      var canvas = document.getElementById('bubbleLinker');
      canvas.width = document.getElementById('timeline').offsetWidth;
      canvas.height = document.getElementById('timeline').offsetHeight;
    }, false);
  },
  /************************/
  /* UI-related functions */
  /************************/
  cropTitle: function(title) {
    if (title.length > 50) {
      title = title.substring(0, 50) + voyage.strings.getString('titleCroppedMark');
    }
    return title;
  }
  ,
  /* Find a appropriate favicon to show for a bubble */
  getFaviconForBubble: function(bubbleId) {
    var UriToSearch = this._faviconService.defaultFavicon;
    var visits = this._bubbles[bubbleId].visits; 
    /* Find favicons between pages until we found one that can use */
    for (var j = 0; j < visits.length ; j++) {
      if (voyage._visits[visits[j]]['f.url']) {
        UriToSearch = Components.classes["@mozilla.org/network/io-service;1"]
                                .getService(Components.interfaces.nsIIOService)
                                .newURI(voyage._visits[visits[j]]['f.url'], null, null);
      }
    }
    return this._faviconService.getFaviconLinkForIcon(UriToSearch).spec;
  },
  /* Convert single favicon url to moz-anno URL */
  getFaviconForUrl: function(url) {
    var UriToSearch = this._faviconService.defaultFavicon;
    if (url) {
      UriToSearch = Components.classes["@mozilla.org/network/io-service;1"]
                              .getService(Components.interfaces.nsIIOService)
                              .newURI(url, null, null);
    }
    return this._faviconService.getFaviconLinkForIcon(UriToSearch).spec;
  },
  /* Display a dialog to show the detail of the bubble */
  showBubbleDetail: function(bubbleId) {
    var bubble = this._bubbles[bubbleId];
    var revHost = bubble.revHost;
    var host = revHost.split('').reverse().join('') /* Reverse */
               .substring(1); /* Remove dot */
    $('#detailPopup').dialog('open');
    $('#detailPopupInfo').empty();
    $('#detailPopupMediaList > div').empty();
    $('#detailPopupFromBubble > ul').empty();
    $('#detailPopupToBubble > ul').empty();
    $('#detailPopupFromVisit > ul').empty();
    $('#detailPopupToVisit > ul').empty();
    
    /* Info */
    $('#detailPopupInfo').append($('<img class="littleBubbleIcon" />').attr('src', this.getFaviconForBubble(bubbleId)))
                         .append($('<strong />').text(host));
 
    /* Medias */
    $('#detailPopupMediaList').hide();
    for (var i = 0 ; i < this._medias.length; i++) {
      var visit = this._visits[this._medias[i].id] ;
      if (visit.bubble == bubble) {
        $('#detailPopupMediaList').show();
        $('#detailPopupMediaList div').append(
          $('<a />').attr(
             {"href": visit['h.url'],
              "title": visit['h.title'],
              "target": "_blank"
             }
             )
             .css({
            'background': 'url('+this._medias[i].src+') 0',
          }).addClass('mediaWallItem')
        );
      }
    }

    var detailTableBody = $('#detailPopupTable tbody');
    detailTableBody.empty();
    var documentFragment = document.createDocumentFragment();
    var visits = bubble.visits;
    for (var i = 0; i < visits.length; i++) {
      var visit = this._visits[visits[i]];
      var lineBlock = document.createElement('tr');
      /* Title column */
      var titleCol = document.createElement('td');
      var titleLink = document.createElement('a');
      titleLink.href = visit['h.url'];
      titleLink.setAttribute('visitId', visit['v.id'])
      if (!visit['h.title']) {
        titleLink.textContent = this.cropTitle(visit['h.url']);
      } else {
        titleLink.textContent = this.cropTitle(visit['h.title']);
      }
      titleLink.target = '_blank';
      /* Favicon */
      var faviconImage = document.createElement('img');
      faviconImage.className = 'favicon';
      faviconImage.style.marginRight = '3px';
      faviconImage.src = this.getFaviconForUrl(visit['f.url']);
      $(titleLink).prepend(faviconImage);
      titleCol.appendChild(titleLink);
      /* Time column */
      var timeCol = document.createElement('td');
      var visitDate = new Date(visit['v.visit_date'] / 1000);
      timeCol.textContent = voyage.timeline._dateService.FormatTime("",
                                                                    voyage.timeline._dateService.timeFormatSeconds,//NoSeconds,
                                                                    visitDate.getHours(),
                                                                    visitDate.getMinutes(),
                                                                    visitDate.getSeconds());
      /* Go and append */
      lineBlock.appendChild(titleCol);
      lineBlock.appendChild(timeCol);
      documentFragment.appendChild(lineBlock);
    }
    $(detailTableBody).append(documentFragment);
    /* From and To */
    var from = bubble.from;
    var to = bubble.to;
    for (var i = 0; i < from.length; i++) {
      var fromId = this._bubbles.indexOf(from[i]);
      var revHost = from[i].revHost;
      var host = revHost.split('').reverse().join('') /* Reverse */
                 .substring(1); /* Remove dot */
      var listItem = document.createElement('li');
      listItem.id = 'detailPopupFromBubble-' + fromId;
      var listLink = document.createElement('a');
      listLink.href = 'about:voyage';
      if (fromId == bubbleId) {
        listLink.textContent = voyage.strings.getString('thisBubble');
      } else {
        listLink.textContent = host;
      }
      listLink.addEventListener('click', (function(bubbleId) {
        return function(e) {
          voyage.showBubbleDetail.call(voyage, bubbleId);
          e.preventDefault();
          e.stopPropagation();
        }
      })(fromId), false);
      $(listLink).prepend($('<img class="littleBubbleIcon" />').attr('src', this.getFaviconForBubble(fromId)));
      $(listItem).append(listLink);
      $('#detailPopupFromBubble > ul').append(listItem);
    }
    if (from.length < 1) {
      $('#detailPopupFromBubble').hide();
    } else {
      $('#detailPopupFromBubble').show();
    }
    for (var i = 0; i < to.length; i++) {
      var toId = this._bubbles.indexOf(to[i]);
      var revHost = to[i].revHost;
      var host = revHost.split('').reverse().join('') /* Reverse */
                 .substring(1); /* Remove dot */
      var listItem = document.createElement('li');
      listItem.id = 'detailPopupToBubble-' + toId;
      var listLink = document.createElement('a');
      listLink.href = 'about:voyage';
      if (toId == bubbleId) {
        listLink.textContent = voyage.strings.getString('thisBubble');
      } else {
        listLink.textContent = host;
      }
      listLink.addEventListener('click', (function(bubbleId) {
        return function(e) {
          voyage.showBubbleDetail.call(voyage, bubbleId);
          e.preventDefault();
          e.stopPropagation();
        }
      })(toId), false);
      $(listLink).prepend($('<img class="littleBubbleIcon" />').attr('src', this.getFaviconForBubble(toId)));
      $(listItem).append(listLink);
      $('#detailPopupToBubble > ul').append(listItem);
    }
    if (to.length < 1) {
      $('#detailPopupToBubble').hide();
    } else {
      $('#detailPopupToBubble').show();
    }
  },
  /* Remove tooltip and related bubbles */
  removeBubbleTip: function() {
    $('#bubbleTip').remove();
    $('#timeline').removeClass('spotlighted');
    $('#mediaWall').removeClass('spotlighted');
    $('.bubble-related-from').removeClass('bubble-related-from');
    $('.bubble-related-to').removeClass('bubble-related-to');
    $('.bubble-selected').removeClass('bubble-selected');
    $('.mediaWallItem-selected').removeClass('mediaWallItem-selected');
    /* Clean canvas lines */
    var canvas = document.getElementById('bubbleLinker');
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  },
  /* Show the tooltip for bubble and highlight related bubbles on the timeline */
  displayBubbleTip: function(bubbleId, me) {
    this.removeBubbleTip();
    $('#timeline').addClass('spotlighted');
    $('#mediaWall').addClass('spotlighted');
    var bubble = this._bubbles[bubbleId];
    var revHost = bubble.revHost;
    var host = revHost.split('').reverse().join('') /* Reverse */
               .substring(1); /* Remove dot */
    var tipBlock = document.createElement('div');
    tipBlock.id = 'bubbleTip';
    $(tipBlock).css( {
      position: 'absolute',
      top: me.offsetTop + me.offsetHeight * 0.7  + document.getElementById('timeline').offsetTop,
      left: Math.min(me.offsetLeft + me.offsetWidth * 0.7 - document.getElementById('timeline').scrollLeft + me.parentNode.offsetLeft, document.getElementById('timeline').offsetWidth - 320),
    }
    ).append($('<h3 />').text(host)).append($('<p />').text(voyage.strings.getString('latestVisits')));

    /* List some visits */
    var listBlock = document.createElement('ul');
    var documentFragment = document.createDocumentFragment();
    var visits = bubble.visits;
    for (var i = 0; i < visits.length; i++) {
      var visit = this._visits[visits[i]];
      /* Highlight related media */
      if (visit['a.content']) {
        $('#media-' + visit['v.id']).addClass('mediaWallItem-selected');
      }
      /* Tooltip, display last 3 visits in text only */
      if (i < 3) {
        var itemBlock = document.createElement('li');
        var itemLink = document.createElement('a');
        itemLink.href = visit['h.url'];
        itemLink.target = '_blank';
        if (!visit['h.title']) {
          itemLink.textContent = this.cropTitle(visit['h.url']);
        } else {
          itemLink.textContent = this.cropTitle(visit['h.title']);
        }
        itemBlock.appendChild(itemLink);
        documentFragment.appendChild(itemBlock);
      }
    }
    if (visits.length > 3) {
      var moreLink = document.createElement('p');
      moreLink.textContent = voyage.strings.getFormattedString('moreVisitsCount', [visits.length - 3]);
      documentFragment.appendChild(moreLink);
    }
    $(listBlock).append(documentFragment);
    $(tipBlock).append(listBlock);
    $(document.body).append(tipBlock);
    
    /* Highlight and draw the lines between relationship details */
    var canvas = document.getElementById('bubbleLinker');
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(62, 96, 111, 0.6)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1;
    $('#bubble-' + bubbleId).addClass('bubble-selected');
    var from = bubble.from;
    var to = bubble.to;
    for (var i = 0; i < from.length; i++) {
      var fromId = this._bubbles.indexOf(from[i]);
      if (fromId != bubbleId)
        var fromElement = document.getElementById('bubble-'+fromId);
        var timelineBlock = document.getElementById('timeline');
        /* Draw bubble relationship */
        if (fromElement) {
          ctx.beginPath();
          ctx.moveTo(me.offsetLeft + me.offsetWidth * 0.5 - timelineBlock.scrollLeft + me.parentNode.offsetLeft, me.offsetTop + me.offsetHeight * 0.5 - timelineBlock.scrollTop + me.parentNode.offsetTop);
          ctx.lineTo(fromElement.offsetLeft + fromElement.offsetWidth * 0.5 - timelineBlock.scrollLeft + fromElement.parentNode.offsetLeft, fromElement.offsetTop + fromElement.offsetHeight * 0.5 - timelineBlock.scrollTop + fromElement.parentNode.offsetTop);
          ctx.closePath();
          ctx.stroke();
          $(fromElement).addClass('bubble-related-from');
        }
      }
    for (var i = 0; i < to.length; i++) {
      var toId = this._bubbles.indexOf(to[i]);
      if (toId != bubbleId)
        var toElement = document.getElementById('bubble-'+toId);
        var timelineBlock = document.getElementById('timeline');
        /* Draw bubble relationship */
        if (toElement) {
          ctx.beginPath();
          ctx.moveTo(me.offsetLeft + me.offsetWidth * 0.5 - timelineBlock.scrollLeft + me.parentNode.offsetLeft, me.offsetTop + me.offsetHeight * 0.5 - timelineBlock.scrollTop + me.parentNode.offsetTop);
          ctx.lineTo(toElement.offsetLeft + toElement.offsetWidth * 0.5 - timelineBlock.scrollLeft + toElement.parentNode.offsetLeft, toElement.offsetTop + toElement.offsetHeight * 0.5 - timelineBlock.scrollTop + toElement.parentNode.offsetTop);
          ctx.closePath();
          ctx.stroke();
          $(toElement).addClass('bubble-related-to');
        }
    }
  },
  /* For media, It will scroll to the appropriate bubble (focus), than display the tip */
  focusBubbleTip: function(bubbleId) {
    var bubbleBlock = document.getElementById('bubble-' + bubbleId);
    if (!bubbleBlock) { return; }
    var timelineBlock = document.getElementById('timeline');
    if (bubbleBlock.parentNode.offsetLeft + bubbleBlock.offsetLeft < timelineBlock.scrollLeft ||
        bubbleBlock.parentNode.offsetLeft + bubbleBlock.offsetLeft > timelineBlock.scrollLeft + timelineBlock.offsetWidth)
      timelineBlock.scrollLeft = bubbleBlock.parentNode.offsetLeft + bubbleBlock.offsetLeft - timelineBlock.offsetWidth * 0.5;
    window.setTimeout(function(bubbleId, bubbleBlock) {
      return function() {
        voyage.displayBubbleTip(bubbleId, bubbleBlock);
      }
    }(bubbleId, bubbleBlock) , 100);
  },
  openSanitizeDialog: function() {
    /* sanitize.xul is app-modal on mac but window-modal on other platforms. 
       So OS-dependent code is required :(
       See also Sanitizer.showUI function on source/browser/base/content/sanitize.js, mozilla-central
    */
    /* If the platform is not Mac, find the main window */
    var mainWindow = null;

    if (navigator.platform.indexOf('Mac') == -1)  {
      mainWindow = window.QueryInterface(Ci.nsIInterfaceRequestor)
                  .getInterface(Ci.nsIWebNavigation)
                  .QueryInterface(Ci.nsIDocShellTreeItem)
                  .rootTreeItem
                  .QueryInterface(Ci.nsIInterfaceRequestor)
                  .getInterface(Ci.nsIDOMWindow); 
    }

    /* Open sanitize window */
    var winWatcher = Cc["@mozilla.org/embedcomp/window-watcher;1"]
                    .getService(Ci.nsIWindowWatcher);

    winWatcher.openWindow(mainWindow,
                          "chrome://browser/content/sanitize.xul",
                          "Sanitize",
                          "chrome,titlebar,dialog,centerscreen,modal",
                          null);
    /* Re-read timeline after sanitize */
    voyage.timeline.readTimeline(voyage.timeline._endTime);
  }
};

/* Twitter Module */
voyage.twitter = {
  /* Blocking multiple connections */
  _running: false,
  /* Record current nsIHttpChannel in use (to eat cookie) */
  _channels: [],
  _oAuthConf: {
    consumerKey   : "vt835TNxBImTkI9Q4uNw",
    consumerSecret: "cIi7EXG815oz3HDHq4yQM22R1ezse6nPYndUFwZM",
    signatureMethod: "HMAC-SHA1",
    requestTokenURL: "http://twitter.com/oauth/request_token",
    userAuthorizationURL: "http://twitter.com/oauth/authorize",
    accessTokenURL: "http://twitter.com/oauth/access_token"
  },
  /* Store user's data read from API */
  _userData: {},
  /* Store statuses' file cache */
  _cachedTweets: [],
  /* Actual cache */
  _newTweets: [],
  /* Store nsIFile for file cache */
  _cacheFile: null,
  /* Is the result ready for use? */
  _ready: false,
  /* Is their any error occoured? */
  _error: false,
  onLoad: function() {
    XPCOMUtilsExtra.defineLazyGetter(this, "_profileDir", function() {
      return Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties).get("ProfD", Ci.nsIFile);
    });
  },
  onDOMReady: function() {
    Components.utils.import("resource://voyage/SandboxedXHR.jsm");
    $.ajaxSetup( {
      xhr: function() {
        /* Set mozBackgroundRequest, to prevent simple authorization prompts user to enter id/password */
        var xhr = new sandboxedXHR();//new XMLHttpRequest();
        xhr.mozBackgroundRequest = true;
        return xhr;
      }
    } );
    /* Do nothing if cache cannot be initialized */
    this.getUserData();
  },
  onUnload: function() {
  },
  /* Cache read/write */
  /* Initialize the cache file links */
  initCache: function() {
    try {
      var voyageDir = this._profileDir.clone();
      voyageDir.append('Voyage');
      /* We need to create a folder, so "Voyage" should not be a file */
      if (voyageDir.exists() && !voyageDir.isDirectory()) {
        return false;
      } else if (!voyageDir.exists()) {
        voyageDir.create(Ci.nsIFile.DIRECTORY_TYPE, 0777);
      }
      this._cacheFile = voyageDir.clone();
      this._cacheFile.QueryInterface(Ci.nsILocalFile);
      this._cacheFile.append('twitterCache.json')
                     
      return true;
    } catch(e) {
      Components.utils.reportError(e);
      return false;
    }
  },
  /* Read JSON cache, return false when fail */
  readCache: function() {
    try {
      /* Initialize */
      if (!this._cacheFile) {
        if (!this.initCache()) {
          return false;
        }
      }
      /* If cache is not available, skip */
      if (!this._cacheFile.exists()) {
        this._cachedTweets = [];
        return true;
      }
      /* Read the cache */
      var inputStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
      inputStream.init(this._cacheFile, -1, 0, 0);
      var nativeJSON = Cc["@mozilla.org/dom/json;1"].createInstance(Ci.nsIJSON);
      /* To ensure we will close input stream, another try/catch... */
      try {
        this._cachedTweets = nativeJSON.decodeFromStream(inputStream, inputStream.available());
      } catch(e) {
        inputStream.close();
        throw(e);
      }
      inputStream.close();
      /* It should be an array */
      if (Object.prototype.toString.call(this._cachedTweets) != '[object Array]') {
        this._cachedTweets = [];
        return false;
      }
      return true;
    } catch(e) {
      Components.utils.reportError(e);
      return false;
    }
  },
  writeCache: function(value) {
    try {
      /* It should be an array */
      if (Object.prototype.toString.call(value) != '[object Array]') {
        return false;
     }
      /* Initialize */
      if (!this._cacheFile) {
        if (!this.initCache()) {
          return false;
        }
      }
      /* Originally I think I can ...
         nativeJSON.encodeToStream(outputStream, 'UTF-8', false, value);
         But IT DOES NOT WORK AT ALL :( So:
      */
      /* Stringify the result */
      var nativeJSON = Cc["@mozilla.org/dom/json;1"].createInstance(Ci.nsIJSON);
      var valueString = nativeJSON.encode(value);
      
      /* Write to cache */
      var outputStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      outputStream.init(this._cacheFile, 0x04 | 0x08 | 0x20, -1, 0); // write, create, truncate
      var converter = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
      converter.init(outputStream, "UTF-8", 0, 0);
      converter.writeString(valueString);
      converter.close();

      /* If the object is unsafe, nsIJSON will throw a exception, so the following step is safe */
      this._cachedTweets = value;
      return true;
    } catch(e) {
      Components.utils.reportError(e);
      return false;
    }
  },
  /* Delete the cache file */
  clearCache: function() {
    try {
      /* Initialize */
      if (!this._cacheFile) {
        if (!this.initCache()) {
          return false;
        }
      }
      this._cacheFile.remove(false);
      this._cachedTweets = [];
    } catch(e) {
      Components.utils.reportError(e);
      alert('Cannot remove cache file!');
    }
  },
  /* OAuth API */
  hasToken: function() {
    if (voyage._prefBranch.prefHasUserValue('twitter.accesstoken') && voyage._prefBranch.prefHasUserValue('twitter.accesstokensecret')) {
      return true;
    }
    return false;
  },
  /* Get "Request Token" */
  getRequestToken: function() {
    if (this._running) { return; }
    this._running = true;
    var accessor = {
      consumerSecret: this._oAuthConf.consumerSecret,
      tokenSecret: ''
    };
    var message = {
      action: this._oAuthConf.requestTokenURL,
      method: 'GET',
      parameters: {
       oauth_signature_method: this._oAuthConf.signatureMethod,
       oauth_consumer_key: this._oAuthConf.consumerKey
      }
    };
    OAuth.setTimestampAndNonce(message);
    OAuth.SignatureMethod.sign(message, accessor);
    var parameterMap = OAuth.getParameterMap(message.parameters);
    var authHeader = OAuth.getAuthorizationHeader("http://twitter.com/", parameterMap);
    $.ajax( {
      url: message.action,
      type: message.method,
      beforeSend: function(xhr) {
        xhr.setRequestHeader("Authorization", authHeader);
      },
      dataType: 'text',
      success: function(data, stat) { voyage.twitter.successCallbackForRequestToken(data); },
      error: function() { voyage.twitter.errorCallbackForRequestToken(); }
    } );
  },
  /* Process the result for request of "Request Token" */
  successCallbackForRequestToken: function(data) {
    this._running = false;
    var decodedResult = OAuth.decodeFormToAssoc(data);
    if(!decodedResult['oauth_token'] || !decodedResult['oauth_token_secret']) {
      Components.utils.reportError('OAuth Error');
      return;
    } else {
      this._requestToken = decodedResult['oauth_token'];
      this._requestTokenSecret = decodedResult['oauth_token_secret'];
      this.openInNewTab('http://twitter.com/oauth/authorize?oauth_token='+encodeURIComponent(this._requestToken)+'&oauth_callback=oob');
      this.displayAuthStep2();
    }
//    if (decodedResult[0][0] != '')
  },
  errorCallbackForRequestToken: function() {
    this._running = false;
    alert(voyage.strings.getString('requestTokenError'));
  },
  /* Get "Access Token" */
  getAccessToken: function(verifier) {
    if (this._running) { return; }
    this._running = true;
    var accessor = {
      consumerSecret: this._oAuthConf.consumerSecret,
      tokenSecret: this._requestTokenSecret
    };
    var message = {
      action: this._oAuthConf.accessTokenURL,
      method: 'GET',
      parameters: {
       oauth_signature_method: this._oAuthConf.signatureMethod,
       oauth_consumer_key: this._oAuthConf.consumerKey,
       oauth_token: this._requestToken,
       oauth_verifier: verifier
      }
    };
    OAuth.setTimestampAndNonce(message);
    OAuth.SignatureMethod.sign(message, accessor);
    var parameterMap = OAuth.getParameterMap(message.parameters);
    var authHeader = OAuth.getAuthorizationHeader("http://twitter.com/", parameterMap);
    $.ajax( {
      url: message.action,
      type: message.method,
      beforeSend: function(xhr) {
        xhr.setRequestHeader("Authorization", authHeader);
      },
      dataType: 'text',
      success: function(data, stat) { voyage.twitter.successCallbackForAccessToken(data); },
      error: function() { voyage.twitter.errorCallbackForAccessToken(); }
    } );
  },
  /* Process the result for request of "Access Token" */
  successCallbackForAccessToken: function(data) {
    this._running = false;
    var decodedResult = OAuth.decodeFormToAssoc(data);
    if(!decodedResult['oauth_token'] || !decodedResult['oauth_token_secret'] || !decodedResult['screen_name']) {
      Components.utils.reportError('OAuth Error');
      return;
    } else {
      this._accessToken = decodedResult['oauth_token'];
      this._accessTokenSecret = decodedResult['oauth_token_secret'];
      this._username = decodedResult['screen_name'];
      voyage._prefBranch.setCharPref('twitter.accesstoken', this._accessToken);
      voyage._prefBranch.setCharPref('twitter.accesstokensecret', this._accessTokenSecret);
      voyage._prefBranch.setCharPref('twitter.username', this._username);
      /* Reload the UI and load necessary information via getUserData() */
      $('#twitterAuth').dialog('close');
      this.getUserData();
    }
  },
  errorCallbackForAccessToken: function() {
    this._running = false;
    alert(voyage.strings.getString('accessTokenError'));
    this.displayAuthStep1();
  },
  /* Authorize from Twitter and get user information if we have tokens */
  getUserData: function() {
    /* Token not available */
    if (!this.hasToken()) { 
      $('#twitterUserData').html($('<a href="about:voyage#linkTwitter" />').text(voyage.strings.getString('enableTwitter')).click(function(e) {
      voyage.twitter.displayAuthStep1(); 
      e.preventDefault();
      e.stopPropagation();
      }));
      return; 
    }
    $('#twitterUserData').text(voyage.strings.getString('connectingToTwitter'));
    if (this._running) { return; }
    this._running = true;

    this._accessToken = voyage._prefBranch.getCharPref('twitter.accesstoken');
    this._accessTokenSecret = voyage._prefBranch.getCharPref('twitter.accesstokensecret');
    var accessor = {
      consumerSecret: this._oAuthConf.consumerSecret,
      tokenSecret: this._accessTokenSecret
    };
    var message = {
      action: 'http://twitter.com/account/verify_credentials.json',
      method: 'GET',
      parameters: {
       oauth_signature_method: this._oAuthConf.signatureMethod,
       oauth_consumer_key: this._oAuthConf.consumerKey,
       oauth_token: this._accessToken,
      }
    };
    OAuth.setTimestampAndNonce(message);
    OAuth.SignatureMethod.sign(message, accessor);
    var parameterMap = OAuth.getParameterMap(message.parameters);
    var authHeader = OAuth.getAuthorizationHeader("http://twitter.com/", parameterMap);
    $.ajax( {
      url: message.action,
      type: message.method,
      beforeSend: function(xhr) {
        xhr.setRequestHeader("Authorization", authHeader);
      },
      /* Still use text to make benifit from JSON.parse() */
      dataType: 'text',
      success: function(data, stat) { voyage.twitter.successCallbackForUserData(data); },
      error: function() { voyage.twitter.errorCallbackForUserData(); }
    } );
  },
  successCallbackForUserData: function(data) {
    this._running = false;
    this._userData = JSON.parse(data);
    /* Access the cache and get new tweets */
    if (!this.readCache()) {
      alert(voyage.strings.getString('cacheBroken'));
      $('#twitterUserData').text(voyage.strings.getString('offlineTwitter')).append(
        $('<a href="about:voyage#unlinkTwitter" />').click(function(e) {
          voyage.twitter.unlink();
          e.preventDefault();
          e.stopPropagation();
        }).text(voyage.strings.getString('disableTwitter'))
       );
      return;
    }
    /* If id is not match, clear the cache */
    if (this._cachedTweets.length > 0) {
      if (this._cachedTweets[0].user.id != this._userData.id) {
        this.clearCache();
      }
    }
    /* XXX: time-based control */
    this.getTweets(-1);
  },
  errorCallbackForUserData: function() {
    this._running = false;
    /* Show a UI to display possible reason for this */
    alert(voyage.strings.getString('userDataError'));
    $('#twitterUserData').text(voyage.strings.getString('offlineTwitter')).append(
      $('<a href="about:voyage#unlinkTwitter" />').click(function(e) {
        voyage.twitter.unlink();
        e.preventDefault();
        e.stopPropagation();
      }).text(voyage.strings.getString('disableTwitter'))
    );
    this._error = true;
    voyage.timeline.displayTimeline(false);
  },
  /* Delete any token and cache from Twitter */
  unlink: function() {
    /* UI Cleanup */
    $('.tweet').remove();
    $('#twitterUserAvatar').attr('src', 'chrome://voyage/skin/bird.png');
    voyage._prefBranch.clearUserPref('twitter.accesstoken', this._accessToken);
    voyage._prefBranch.clearUserPref('twitter.accesstokensecret', this._accessTokenSecret);
    voyage._prefBranch.clearUserPref('twitter.username', this._username);
    this._userData = {}; 
    /* Clean cache */
    this.clearCache();
    /* Reload the UI via getUserData() */
    this.getUserData();
  },
  /* Get Tweets for a specific ID range */
  getTweets: function(maxID) {
    /* Ensure the loading screen to be shown */
    $('#loading').show();
    $('#timeline').css('opacity', '0.1');
    if (this._running) { return; }
    this._running = true;
    
    if (!this._userData) {
      return;
    }
    /* If he has no tweet, there is no need to get them */
    if (!this._userData.status) {
      return;
    }
    /* If cache is available, get since ID from it */
    var sinceID = -1;
    if (this._cachedTweets.length > 0) {
      sinceID = this._cachedTweets[0].id;
    }

    this._accessToken = voyage._prefBranch.getCharPref('twitter.accesstoken');
    this._accessTokenSecret = voyage._prefBranch.getCharPref('twitter.accesstokensecret');
    var accessor = {
      consumerSecret: this._oAuthConf.consumerSecret,
      tokenSecret: this._accessTokenSecret
    };
    var message = {
      action: 'http://twitter.com/statuses/user_timeline.json',
      method: 'GET',
      parameters: {
       oauth_signature_method: this._oAuthConf.signatureMethod,
       oauth_consumer_key: this._oAuthConf.consumerKey,
       oauth_token: this._accessToken,
      }
    };
    var dataObj = {
      count: 100, /* XXX: Should be configurable */
    }
    if (sinceID > 0) {
      dataObj.since_id = sinceID;
    }
    if (maxID > 0) {
      dataObj.max_id = maxID;
    }
    OAuth.setTimestampAndNonce(message);
    OAuth.SignatureMethod.sign(message, accessor);
    var parameterMap = OAuth.getParameterMap(message.parameters);
    var authHeader = OAuth.getAuthorizationHeader("http://twitter.com/", parameterMap);
    $.ajax( {
      url: message.action,
      type: message.method,
      data: dataObj,
      beforeSend: function(xhr) {
        xhr.setRequestHeader("Authorization", authHeader);
      },
      /* Still use text to make benifit from JSON.parse() */
      dataType: 'text',
      success: function(data, stat) { voyage.twitter.successCallbackForGetTweets(data); },
      error: function(xhr, text, error) { voyage.twitter.errorCallbackForGetTweets(xhr); }
    } );
  },
  successCallbackForGetTweets: function(data) { 
    this._running = false;
    var dataArray = JSON.parse(data);
    this._newTweets = this._newTweets.concat(dataArray);
    /* Check if we need more tweets */
    if (this._newTweets.length > 0) {
      var lastTweet = this._newTweets[(this._newTweets.length - 1)]; 
      var lastTweetTime = new Date(lastTweet.created_at).getTime();
      var now = voyage._appStartAt.getTime();
      if (this._newTweets.length > voyage._prefBranch.getIntPref('twitter.maxCacheNum') || (now - lastTweetTime) > voyage._expireDays * 86400 * 1000 || dataArray.length == 0) {
        /* Finalize */
        /* Combine with file cache */
        this._newTweets = this._newTweets.concat(this._cachedTweets);
        /* Expire items */
        for (var i = (this._newTweets.length - 1); i >= 0; i--) {
          lastTweetTime = new Date(this._newTweets[i].created_at).getTime();
          if  ((now - lastTweetTime) > voyage._expireDays * 86400 * 1000) {
            this._newTweets.pop();
          } else {
            break;
          }
        }
        if (!this.writeCache(this._newTweets.concat())) {
          alert(voyage.strings.getString('cacheBroken'));
          $('#twitterUserData').text(voyage.strings.getString('offlineTwitter')).append(
            $('<a href="about:voyage#unlinkTwitter" />').click(function(e) {
              voyage.twitter.unlink();
              e.preventDefault();
              e.stopPropagation();
            }).text(voyage.strings.getString('disableTwitter'))
          );
          return;
        }
        /* Show results */
        this._ready = true;
        voyage.timeline.displayTimeline(true);
        return;
      } else {
        this.getTweets(lastTweet.id - 1);
      }
    } else {
      /* No new tweets available, show results directly */
      this._ready = true;
      voyage.timeline.displayTimeline(true);
    }
  },
  errorCallbackForGetTweets: function(xhr) { 
    this._running = false;
    /* Rate limit! */
    if (xhr.status == 400) {
      var reset = xhr.getResponseHeader('X-RateLimit-Reset');
      if (reset) {
        var resetTime = new Date(reset * 1000);
        alert(voyage.strings.getFormattedString('rateLimitReached', [resetTime.toLocaleString()]))
        return;
      }
    }
    alert(voyage.strings.getString('getTweetsError'));
  },

  
  /* UI */
  displayAuthStep1: function () {
    var loginButton = $(document.createElement('p')).append(
                        $(document.createElement('a'))
                        .click(function() { voyage.twitter.getRequestToken(); })
                        .append(
                          $('<img src="chrome://voyage/skin/Sign-in-with-Twitter-lighter.png" />').css("border", 0)
                        )
                      );
    
    $('#twitterAuth').empty()
                     .dialog('option', 'title', voyage.strings.getString('twitterAuthStep1Title'))
                     .append( $('<p />').text(voyage.strings.getString('twitterAuthStep1Description1')) )
                     .append(loginButton)
                     .append( $('<p />').text(voyage.strings.getString('twitterAuthStep1Description2')) )
                     .dialog('open');
  },
  displayAuthStep2 :function () {
    var pinCodeForm = document.createElement('form');
    pinCodeForm.action = 'about:voyage';
    pinCodeForm.method = 'GET';
    pinCodeForm.addEventListener('submit', function(e) {
      var pin = document.getElementById('pinCodeText').value.trim();
      if (!pin || !pin.match(/^[0-9]{7}$/)) {
        alert(voyage.strings.getString('pinCodeWrongFormat'));
      } else {
        voyage.twitter.getAccessToken(pin);
      }
      e.preventDefault();
      e.stopPropagation();
    }, false);
    var pinCodeText = document.createElement('input');
    pinCodeText.style.width = '8em';
    pinCodeText.style.fontSize = '125%';
    pinCodeText.id = 'pinCodeText';
    var submitButton = document.createElement('input');
    submitButton.type = 'submit';
    submitButton.value = voyage.strings.getString('twitterAuthStep2Button');
    $(pinCodeForm).append('PIN code: ').append(pinCodeText).append(submitButton);
    $('#twitterAuth').empty()
                     .dialog('option', 'title', voyage.strings.getString('twitterAuthStep2Title'))
                     .append( $('<p />').text(voyage.strings.getString('twitterAuthStep2Description')) )
                     .append(pinCodeForm);

  },
  openInNewTab: function(url) {
    var wm = Cc["@mozilla.org/appshell/window-mediator;1"]
            .getService(Ci.nsIWindowMediator);
    var mainWindow = wm.getMostRecentWindow("navigator:browser");
   
    if (!mainWindow) {
      window.open();
      mainWindow = wm.getMostRecentWindow("navigator:browser");
      mainWindow.getBrowser().selectedBrowser.contentDocument.location.href=url;
    } else {
      mainWindow.getBrowser().selectedTab = mainWindow.getBrowser().addTab(url);
    }
  }
};

/* Handle timeline (re)render */
voyage.timeline = {
  _beginTime: 0,
  _endTime: 0,
  init: function() {
    XPCOMUtilsExtra.defineLazyServiceGetter(this, "_dateService", "@mozilla.org/intl/scriptabledateformat;1", "nsIScriptableDateFormat");
    XPCOMUtilsExtra.defineLazyGetter(this, "_expireDays", function() {
      return Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("browser.").getIntPref('history_expire_days_min');
    });
    this.readTimeline(new Date(voyage._appStartAt.getTime()).setHours(24, 0, 0, 0));
  },
  readTimeline: function(endTime) {
    $('#timeline').empty().css('opacity', '0.1');
    $('#mediaWall').empty();
    this._endTime = endTime;
    this._beginTime = this._endTime - 86400 * 1000 * /*XXX*/1;
    this.displayDate();
    $('#shownDays > a').click( function(e) { voyage.timeline.showDatePicker(e); 
    });
    var keyword = '';
    this.drawTimelineBlocks(this._beginTime, this._endTime);
    /* Dirty hack: not include tomorrow */
    voyage.readHistory(this._beginTime * 1000, (this._endTime * 1000 - 1), keyword);
  },
  drawTimelineBlocks: function(beginTime, endTime) {
    /* XXX: Fix Prepend / Append */
    var processTime = this.getRefTime(endTime);
    var i = 0;
    while (processTime >= beginTime) {
      var processDate = new Date(processTime);
      var timeLabel = '';
      //if (processDate.getMinutes() % 60 == 0) {
      timeLabel = this._dateService.FormatTime("", this._dateService.timeFormatNoSeconds, processDate.getHours(), processDate.getMinutes(), processDate.getSeconds());
      //}
      $('#timeline').append(
        $('<div />').attr('id', 'timelineBlock-' + processTime).addClass('timelineBlock').append($('<span />').text(timeLabel)));
      processTime -= voyage._timelineRange * 60 * 1000;
      i++;
    }
    
  },
  displayTimeline: function(withTweets) {
    $('#timeline .bubble').remove();
    $('#timeline .tweet').remove();
    var currentLeft = 0;
    var previousAvgTime = -1;
    var previousRefTime = -1;
    var timelineElements = voyage._bubbles.concat();
    /* Use shuffle technique */
    var defaultShuffle = [0, 1, 2, 3, 4];
    var currentShuffle = defaultShuffle.concat();
    currentShuffle.sort(function() { { return Math.random() - 0.5; } })
    /* Cache the bubbleId */
    for (var i = 0; i < timelineElements.length; i++) {
      timelineElements[i].bubbleId = i;
    }

    /* If we need tweets as a element, add tweets as elements */
    if (withTweets) {
      for (var i = 0; i < voyage.twitter._cachedTweets.length; i++) {
        var tweet = voyage.twitter._cachedTweets[i];
        var avgTime = new Date(tweet.created_at).getTime();
        if (avgTime < this._endTime && avgTime >= this._beginTime) {
          timelineElements.push( {
            avgTime: avgTime,
            tweet: tweet
          } );
        }
      }
      /* Sort by avgTime, again */
      timelineElements.sort( function(a, b) {
        return(b.avgTime - a.avgTime);
      });
    }
    
    for (var i = 0; i < timelineElements.length; i++) {
      var element = timelineElements[i];
      /* Determine the density of the timeline */
      var refTime = this.getRefTime(element.avgTime);
      if (previousRefTime != refTime) {
        currentLeft = 0;
        previousAvgTime = refTime;
      }
      
      previousRefTime = refTime;
      
      if (previousAvgTime > -1) {
        var minuteDistance = (previousAvgTime - (element.avgTime)) / 1000 / 60;
        if (minuteDistance < 5) { minuteDistance = 5;}
        if (minuteDistance > 20) { minuteDistance = 20;}
        currentLeft += minuteDistance * 10;
      }
      previousAvgTime = element.avgTime;

      if (element.tweet) {
        /* This is a tweet */
        var tweet = element.tweet;
        if (!$('#timelineBlock-' + refTime).get(0)) {
          continue;
        }
        $('#timelineBlock-' + refTime).append($(document.createElement('a'))
                  .css({
                      'position': 'absolute',
                      'left': (currentLeft)+ 'px',
                      'top': '10px',
                    })
                .addClass('tweet timelineElement')
                .text(tweet.text.replace(/\&lt\;/g, '<').replace(/\&gt\;/g, '>'))
                .attr('href', 'http://twitter.com/'+tweet.user.screen_name+'/status/'+tweet.id)
                .attr('target', '_blank'));
      } else {
        /* This is a bubble */
        var bubble = element;
        bubbleId = bubble.bubbleId;
        
        var revHost = bubble.revHost;
        var host = revHost.split('').reverse().join('') /* Reverse */
                   .substring(1); /* Remove dot */
        var visits = bubble.visits;
        var faviconUrl = voyage.getFaviconForBubble(bubbleId);
        var faviconImage = document.createElement('img');
        faviconImage.src = faviconUrl;
        faviconImage.className = 'favicon';
        var bubbleBlock = document.createElement('div');
        bubbleBlock.className = 'bubble timelineElement';
        bubbleBlock.id = 'bubble-'+bubbleId;
        bubbleBlock.addEventListener('mouseover', (function(bubbleId, that) {
          return function(e) {
            voyage.displayBubbleTip.call(voyage, bubbleId, that);
          }
        })(bubbleId, bubbleBlock), false);
        bubbleBlock.addEventListener('click', (function(bubbleId) {
          return function(e) {
            voyage.showBubbleDetail.call(voyage, bubbleId);
          }
        })(bubbleId), false);
        /* Determine the position by pop the shuffle result, and re-shuffle if out of slot */
        var currentPos = currentShuffle.pop();
        var currentTop = (currentPos / 5 * (document.getElementById('timeline').offsetHeight - 90) + 30) ;
        if (withTweets) {
          currentTop = (currentPos / 5 * (document.getElementById('timeline').offsetHeight - 150) + 90); 
        }
        if (currentShuffle.length < 1) {
          var currentShuffle = defaultShuffle.concat();
          currentShuffle.sort(function() { { return Math.random() - 0.5; } })
        }
        $(bubbleBlock).css({
                          'left': (currentLeft)+ 'px',//timeDistance * 30 + 'em',
                          'top': (currentTop) + 'px',
                          'cursor': 'pointer'
                          })
                      .append(faviconImage);
        /* Radius will be 20px ~ 40px */
        var bubbleRadius = Math.min(Math.ceil((bubble.from.length + bubble.to.length + bubble.visits.length) / 2) * 4 + 16, 40);
        bubbleBlock.style.width = bubbleRadius * 2 + 'px';
        bubbleBlock.style.height = bubbleRadius * 2 + 'px';
        bubbleBlock.style.lineHeight = bubbleRadius * 2 + 'px';
        bubbleBlock.style.textAlign = 'center';
        /* Border width concerned */
        bubbleBlock.style.MozBorderRadius = bubbleRadius + 2 + 'px';
        bubbleBlock.style.borderRadius = bubbleRadius + 2 + 'px';
      
        if (!$('#timelineBlock-' + refTime).get(0)) {
          /* This should not happend */ 
          break;
        }
        $('#timelineBlock-' + refTime).append(bubbleBlock);
      }
    }
    this.resizeHorizontal();
    $('#timeline').css('opacity', '1');
    $('#loading').hide();
  },
  getRefTime: function(time) {
    /* Ceil the time to the half hours, correspoding to local time */
    var refTime = new Date(time);
    /* Find the nearest timeline (ceiling) */
    refTime.setMinutes(Math.ceil((refTime.getMinutes() + refTime.getSeconds() / 60 + refTime.getMilliseconds() / 60000) / voyage._timelineRange) * voyage._timelineRange, 0, 0);
    return refTime.getTime();
  },
  /* Determine the size of time blocks */
  resizeHorizontal: function() {
    $('#timeline > div').each( function() { 
      if ($(this).children('.timelineElement').size() > 0) {
        $(this).css('width', parseInt($(this).find('.timelineElement:last').css('left'), 10) + $(this).find('.timelineElement:last').get(0).offsetWidth + 10);
      } else {
        $(this).find('span').remove();
      }
    } );
    /* Display Twitter info */
    if (voyage.twitter._userData.status) {
      $('#twitterUserAvatar').attr('src', voyage.twitter._userData.profile_image_url);
      $('#twitterUserData').text(voyage.twitter._userData.screen_name).append(' ').append($('<a href="about:voyage#unlinkTwitter" />').click(function(e) {
        voyage.twitter.unlink();
        e.preventDefault();
        e.stopPropagation();
      }).text(voyage.strings.getString('disableTwitterLoggedIn')));
    }  
  },
  /* XXX: TODO */
  resizeVertical: function() {
  },
  displayDate: function() {
    var beginDate = new Date(this._beginTime);
    $('#shownDays > a > span').text(this._dateService.FormatDate("", 
                                                                 this._dateService.dateFormatLong,
                                                                 beginDate.getFullYear(),
                                                                 beginDate.getMonth() + 1,
                                                                 beginDate.getDate()
                                                                )
                            );
  },
  showDatePicker: function(e) {
    $(this).datepicker('dialog',
                        '',
                        function(dateText, inst){
                          voyage.timeline.readTimeline(parseInt(dateText, 10) + 86400 * 1000 * 1);
                        },
                        {minDate: -1 * voyage.timeline._expireDays, maxDate: 0, defaultDate: new Date(voyage.timeline._beginTime), dateFormat: '@'}, e); 
    e.preventDefault();
    e.stopPropagation();
  }
};

voyage.strings = {
  bundle: null, 
  init: function() {
   var bundle_service = Cc['@mozilla.org/intl/stringbundle;1'].getService(Ci.nsIStringBundleService);
   this.bundle = bundle_service.createBundle('chrome://voyage/locale/voyage.properties');
  }, 
  getString: function(str) {
    if (this.bundle === null) this.init();
    return this.bundle.GetStringFromName(str);
  },
  getFormattedString: function (key, arr) {
    if (this.bundle === null) this.init();
    if (Object.prototype.toString.call(arr) !== "[object Array]") {return '';} // Technology from jQuery
    return this.bundle.formatStringFromName(key, arr, arr.length);
  }
};

/* Hook onLoad; use a anonymous function to prevent "this" to be set to HTMLDocument */
voyage._appStartAt = new Date();
voyage.onLoad();
voyage.twitter.onLoad();
$(document).ready(function() { 
  voyage.onDOMReady();
});
$(window).unload(function() { voyage.twitter.onUnload(); });
