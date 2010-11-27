/* vim: sw=2 ts=2 sts=2 et filetype=javascript
 * History Reader for Voyage, read history visits in places.sqlite using asynchorous storage API and parse the result
 */
const Cc = Components.classes;
const Ci = Components.interfaces;

var EXPORTED_SYMBOLS = [ "historyReader" ];

const HS_CONTRACTID = "@mozilla.org/browser/nav-history-service;1";

/* XPCOMUtilsExtra.jsm includes defineLazyGetter and defineLazyServiceGetter patches */
Components.utils.import("resource://voyage/XPCOMUtilsExtra.jsm");

var historyReader = function() {
  /* Define getters */
  XPCOMUtilsExtra.defineLazyGetter(this, "_dbConn", function() {
    return Cc[HS_CONTRACTID].getService(Ci.nsPIPlacesDatabase).DBConnection;
  });

};

historyReader.prototype = {
  _running: false,
  _result: false,
  /* Fetch results with specific start/end time and keyword */
  fetch: function(aBeginTime, aEndTime, aKeyword, aCallback) {
    /* The following SQL string is based on: (Thanks to the complex system since 1.9.1+!)
       * PlacesSQLQueryBuilder::SelectAsVisit() from nsNavHistory.cpp
       * Patch by David Adam in Bug 320831
    */
    var query_options = "AND h.visit_count > 0 AND h.hidden <> 1 AND h.rev_host <> '.' "+
                        "AND v.visit_date >= :begin_time AND v.visit_date <= :end_time";
    var additional = 'ORDER BY 11 DESC';
    if (aKeyword) {
      // XXX: not implemented
    }
    var stmt = this._dbConn.createStatement(
    //Components.utils.reportError(
               /* Set 1 moz_places_temp <-> moz_historyvisits_temp */
               "SELECT h.id, h.url, h.title, h.rev_host, h.visit_count, h.hidden, h.last_visit_date, v.id, v.place_id, v.from_visit, v.visit_date, v.visit_type, v.session, f.url, a.content FROM moz_places_temp h " +
               "JOIN moz_historyvisits_temp v ON v.place_id = h.id " +
               "LEFT JOIN moz_favicons f ON h.favicon_id = f.id "+
               "LEFT JOIN moz_annos a ON a.place_id = h.id "+
               "AND a.anno_attribute_id IN (SELECT id FROM moz_anno_attributes WHERE name = 'voyage/thumb_image_url') "+
               "LEFT JOIN moz_anno_attributes n ON n.id = a.anno_attribute_id "+
               "WHERE 1 " +
               query_options + " " +
               "UNION ALL " +
               /* Set 2 moz_places_temp <-> moz_historyvisits */
               "SELECT h.id, h.url, h.title, h.rev_host, h.visit_count, h.hidden, h.last_visit_date, v.id, v.place_id, v.from_visit, v.visit_date, v.visit_type, v.session, f.url, a.content FROM moz_places_temp h " +
               "JOIN moz_historyvisits v ON v.place_id = h.id " +
               "LEFT JOIN moz_favicons f ON h.favicon_id = f.id "+
               "LEFT JOIN moz_annos a ON a.place_id = h.id "+
               "AND a.anno_attribute_id IN (SELECT id FROM moz_anno_attributes WHERE name = 'voyage/thumb_image_url') "+
               "WHERE 1 " +
               query_options + " " +
               "UNION ALL " +
               /* Set 3 moz_places <-> moz_historyvisits_temp */
               "SELECT h.id, h.url, h.title, h.rev_host, h.visit_count, h.hidden, h.last_visit_date, v.id, v.place_id, v.from_visit, v.visit_date, v.visit_type, v.session, f.url, a.content FROM moz_places h " +
               "JOIN moz_historyvisits_temp v ON v.place_id = h.id " +
               "LEFT JOIN moz_favicons f ON h.favicon_id = f.id "+
               "LEFT JOIN moz_annos a ON a.place_id = h.id "+
               "AND a.anno_attribute_id IN (SELECT id FROM moz_anno_attributes WHERE name = 'voyage/thumb_image_url') "+
               "WHERE h.id NOT IN (SELECT id FROM moz_places_temp) " + query_options + " " +
               "UNION ALL " +
               /* Set 4 moz_places <-> moz_historyvisits */
               "SELECT h.id, h.url, h.title, h.rev_host, h.visit_count, h.hidden, h.last_visit_date, v.id, v.place_id, v.from_visit, v.visit_date, v.visit_type, v.session, f.url, a.content FROM moz_places h " +
               "JOIN moz_historyvisits v ON v.place_id = h.id " +
               "LEFT JOIN moz_favicons f ON h.favicon_id = f.id "+
               "LEFT JOIN moz_annos a ON a.place_id = h.id "+
               "AND a.anno_attribute_id IN (SELECT id FROM moz_anno_attributes WHERE name = 'voyage/thumb_image_url') "+
               "WHERE h.id NOT IN (SELECT id FROM moz_places_temp) " + query_options + " " +
               additional
               );
    stmt.params.begin_time = parseInt(aBeginTime, 10);
    stmt.params.end_time = parseInt(aEndTime, 10);
    if (aKeyword) {
      // XXX: not implemented
    }
    
    /* Process the Asynchorous execution (Implements mozIStorageStatementCallback) */
    var callback = {
      _rows: [],
      _columns: ['v.id', 'h.id', 'v.from_visit', 'v.visit_date', 'v.visit_type', 'v.session', 'h.url', 'h.title', 'h.rev_host', 'h.visit_count', 'h.hidden', /* 'typed', */ /*'favicon_id',*/ 'h.last_visit_date', 'f.url', 'a.content'],
      _callback: {},
      /* Fetch the result */
      handleResult: function(aResultSet) {
        for (let row = aResultSet.getNextRow();  
             row;  
             row = aResultSet.getNextRow()) {  
          var rowObj = {};
          for (var i = 0; i < this._columns.length; i++) {
             rowObj[this._columns[i]] = row.getResultByName(this._columns[i]);
          }
          this._rows.push(rowObj);
        }  
      },
      /* XXX: Error is directly shown -- is this right ? */
      handleError: function(aError) {
        Components.utils.reportError(aError);
      },
      /* Report the result to the callback */
      handleCompletion: function(aReason) {
        this._callback.handleCompletion.call(this._callback, aReason, this._columns, this._rows);
      }
    };
    /* Register the callback and execute */
    callback._callback = aCallback;
    stmt.executeAsync(callback);
  },
  getHistoryDuration: function() {
    /* XXX: This works synchronously. :( */
    var stmt = this._dbConn.createStatement("SELECT visit_date FROM moz_historyvisits ORDER BY visit_date ASC LIMIT 1");
    /* Return 1 day if no record */
    if (!stmt.executeStep()) { return 1; }
    var visitDate = stmt.getUTF8String(0).valueOf();
    Components.utils.reportError((new Date().setHours(24, 0, 0, 0) - visitDate) / 86400 / 1000);
    return Math.ceil((new Date().setHours(24, 0, 0, 0) - visitDate / 1000) / 86400 / 1000);
  }
};
