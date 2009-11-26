/* vim: sw=2 ts=2 sts=2 et filetype=javascript
Code from mozilla-central (js/src/xpconnect/loader/XPCOMUtils.jsm)

Original Code: Mozilla code
Original Author: Netscape Communications Corporation
Contributors:
*    Alex Fritze <alex@croczilla.com> (original author)
*    Nickolay Ponomarev <asqueella@gmail.com>

This file uses the patches by Shawn Wilsher (see Bug 508850 and Bug 513710)
They are included because the patches are not on Shiretoko / Namoroka branches.
*/

const Cc = Components.classes;
const Ci = Components.interfaces;

var EXPORTED_SYMBOLS = [ "XPCOMUtilsExtra" ];

var XPCOMUtilsExtra = {
  /**
   * Defines a getter on a specified object that will be created upon first use.
   *
   * @param aObject
   *        The object to define the lazy getter on.
   * @param aName
   *        The name of the getter to define on aObject.
   * @param aLambda
   *        A function that returns what the getter should return.  This will
   *        only ever be called once.
   */
  defineLazyGetter: function XPCU_defineLazyGetter(aObject, aName, aLambda)
  {
    aObject.__defineGetter__(aName, function() {
      delete aObject[aName];
      return aObject[aName] = aLambda.apply(aObject);
    });
  },

  /**
   * Defines a getter on a specified object for a service.  The service will not
   * be obtained until first use.
   *
   * @param aObject
   *        The object to define the lazy getter on.
   * @param aName
   *        The name of the getter to define on aObject for the service.
   * @param aContract
   *        The contract used to obtain the service.
   * @param aInterfaceName
   *        The name of the interface to query the service to.
   */
  defineLazyServiceGetter: function XPCU_defineLazyServiceGetter(aObject, aName,
                                                                 aContract,
                                                                 aInterfaceName)
  {
    this.defineLazyGetter(aObject, aName, function XPCU_serviceLambda() {
      return Cc[aContract].getService(Ci[aInterfaceName]);
    });
  },


};
