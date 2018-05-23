// Copyright 2013 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. You may obtain a copy of
// the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations under
// the License.

/**
 * @fileoverview JavaScript shim for the liblouis Native Client wrapper.
 * @author jbroman@google.com (Jeremy Roman)
 */

goog.provide('cvox.braille.LibLouisNativeClient');

/**
 * Encapsulates a liblouis Native Client instance in the page.
 * @constructor
 * @param {string} nmfPath Path to .nmf file for the module.
 * @param {string=} opt_tablesDir Path to tables directory.
 */
cvox.braille.LibLouisNativeClient = function(nmfPath, opt_tablesDir) {
  /**
   * Path to .nmf file for the module.
   * @private {string}
   */
  this.nmfPath_ = nmfPath;

  /**
   * Path to translation tables.
   * @private {?string}
   */
  this.tablesDir_ = goog.isDef(opt_tablesDir) ? opt_tablesDir : null;

  /**
   * Native Client <embed> element.
   * {@code null} when no <embed> is attached to the DOM.
   * @private {NaClEmbedElement}
   */
  this.embedElement_ = null;

  /**
   * The state of the instance.
   * @private {cvox.braille.LibLouisNativeClient.InstanceState}
   */
  this.instanceState_ =
      cvox.braille.LibLouisNativeClient.InstanceState.NOT_LOADED;

  /**
   * Pending requests to construct translators.
   * @private {!Array.<{tableName: string,
   *   callback: function(cvox.braille.LibLouisNativeClient.Translator)}>}
   */
  this.pendingTranslators_ = [];

  /**
   * Pending RPC callbacks. Maps from message IDs to callbacks.
   * @private {!Object.<string, function(!Object)>}
   */
  this.pendingRpcCallbacks_ = {};

  /**
   * Next message ID to be used. Incremented with each sent message.
   * @private {number}
   */
  this.nextMessageId_ = 1;
};

/**
 * Describes the loading state of the instance.
 * @enum {number}
 */
cvox.braille.LibLouisNativeClient.InstanceState = {
  NOT_LOADED: 0,
  LOADING: 1,
  LOADED: 2,
  ERROR: -1
};

/**
 * Attaches the Native Client wrapper to the DOM as a child of the provided
 * element, assumed to already be in the document.
 * @param {!Element} elem Desired parent element of the instance.
 */
cvox.braille.LibLouisNativeClient.prototype.attachToElement = function(elem) {
  if (this.isAttached()) {
    throw Error('instance already attached');
  }

  var embed = document.createElement('embed');
  embed.src = this.nmfPath_;
  embed.type = 'application/x-nacl';
  embed.width = 0;
  embed.height = 0;
  if (!goog.isNull(this.tablesDir_)) {
    embed.setAttribute('tablesdir', this.tablesDir_);
  }
  embed.addEventListener('load', goog.bind(this.onInstanceLoad_, this),
      false /* useCapture */);
  embed.addEventListener('error', goog.bind(this.onInstanceError_, this),
      false /* useCapture */);
  embed.addEventListener('message', goog.bind(this.onInstanceMessage_, this),
      false /* useCapture */);
  elem.appendChild(embed);

  this.embedElement_ = /** @type {!NaClEmbedElement} */ (embed);
  this.instanceState_ = cvox.braille.LibLouisNativeClient.InstanceState.LOADING;
};

/**
 * Detaches the Native Client instance from the DOM.
 */
cvox.braille.LibLouisNativeClient.prototype.detach = function() {
  if (!this.isAttached()) {
    throw Error('cannot detach unattached instance');
  }

  this.embedElement_.parentNode.removeChild(this.embedElement_);
  this.embedElement_ = null;
  this.instanceState_ =
      cvox.braille.LibLouisNativeClient.InstanceState.NOT_LOADED;
};

/**
 * Determines whether the Native Client instance is attached.
 * @return {boolean} {@code true} if the <embed> element is attached to the DOM.
 */
cvox.braille.LibLouisNativeClient.prototype.isAttached = function() {
  return this.embedElement_ !== null;
};

/**
 * Returns a translator for the desired table, asynchronously.
 * @param {string} tableName Braille table name for liblouis.
 * @param {function(cvox.braille.LibLouisNativeClient.Translator)} callback
 *     Callback which will receive the translator, or {@code null} on failure.
 */
cvox.braille.LibLouisNativeClient.prototype.getTranslator =
    function(tableName, callback) {
  switch (this.instanceState_) {
    case cvox.braille.LibLouisNativeClient.InstanceState.NOT_LOADED:
    case cvox.braille.LibLouisNativeClient.InstanceState.LOADING:
      this.pendingTranslators_.push(
          { tableName: tableName, callback: callback });
      return;
    case cvox.braille.LibLouisNativeClient.InstanceState.ERROR:
      callback(null /* translator */);
      return;
    case cvox.braille.LibLouisNativeClient.InstanceState.LOADED:
      this.rpc_('CheckTable', { 'table_name': tableName },
          goog.bind(function(reply) {
        if (reply['success']) {
          var translator = new cvox.braille.LibLouisNativeClient.Translator(
              this, tableName);
          callback(translator);
        } else {
          callback(null /* translator */);
        }
      }, this));
      return;
  }
};

/**
 * Dispatches a message to the remote end and returns the reply asynchronously.
 * A message ID will be automatically assigned (as a side-effect).
 * @param {string} command Command name to be sent.
 * @param {!Object} message JSONable message to be sent.
 * @param {function(!Object)} callback Callback to receive the reply.
 * @private
 */
cvox.braille.LibLouisNativeClient.prototype.rpc_ =
    function(command, message, callback) {
  if (this.instanceState_ !==
      cvox.braille.LibLouisNativeClient.InstanceState.LOADED) {
    throw Error('cannot send RPC: liblouis instance not loaded');
  }
  var messageId = '' + this.nextMessageId_++;
  message['message_id'] = messageId;
  message['command'] = command;
  var json = JSON.stringify(message);
  if (goog.DEBUG) {
    window.console.debug('RPC -> ' + json);
  }
  this.embedElement_.postMessage(json);
  this.pendingRpcCallbacks_[messageId] = callback;
};

/**
 * Invoked when the Native Client instance successfully loads.
 * @param {Event} e Event dispatched after loading.
 * @private
 */
cvox.braille.LibLouisNativeClient.prototype.onInstanceLoad_ = function(e) {
  window.console.info('loaded liblouis Native Client instance');
  this.instanceState_ = cvox.braille.LibLouisNativeClient.InstanceState.LOADED;
  this.pendingTranslators_.forEach(goog.bind(function(record) {
    this.getTranslator(record.tableName, record.callback);
  }, this));
  this.pendingTranslators_.length = 0;
};

/**
 * Invoked when the Native Client instance fails to load.
 * @param {Event} e Event dispatched after loading failure.
 * @private
 */
cvox.braille.LibLouisNativeClient.prototype.onInstanceError_ = function(e) {
  window.console.error('failed to load liblouis Native Client instance');
  this.instanceState_ = cvox.braille.LibLouisNativeClient.InstanceState.ERROR;
  this.pendingTranslators_.forEach(goog.bind(function(record) {
    this.getTranslator(record.tableName, record.callback);
  }, this));
  this.pendingTranslators_.length = 0;
};

/**
 * Invoked when the Native Client instance posts a message.
 * @param {Event} e Event dispatched after the message was posted.
 * @private
 */
cvox.braille.LibLouisNativeClient.prototype.onInstanceMessage_ = function(e) {
  if (goog.DEBUG) {
    window.console.debug('RPC <- ' + e.data);
  }
  var message = /** @type {!Object} */ (JSON.parse(e.data));
  var messageId = message['in_reply_to'];
  if (!goog.isDef(messageId)) {
    window.console.warn('liblouis Native Client module sent message with no ID',
        message);
    return;
  }
  if (goog.isDef(message['error'])) {
    window.console.error('liblouis Native Client error', message['error']);
  }
  var callback = this.pendingRpcCallbacks_[messageId];
  if (goog.isDef(callback)) {
    delete this.pendingRpcCallbacks_[messageId];
    callback(message);
  }
};

/**
 * Braille translator which uses a Native Client instance of liblouis.
 * @constructor
 * @param {!cvox.braille.LibLouisNativeClient} instance The instance wrapper.
 * @param {string} tableName The table name to be passed to liblouis.
 */
cvox.braille.LibLouisNativeClient.Translator = function(instance, tableName) {
  /**
   * The instance wrapper.
   * @private {!cvox.braille.LibLouisNativeClient}
   */
  this.instance_ = instance;

  /**
   * The table name.
   * @private {string}
   */
  this.tableName_ = tableName;
};

/**
 * Translates text into braille cells.
 * @param {string} text Text to be translated.
 * @param {Object} extras Extra parameters for translation.
 * @param {function(ArrayBuffer, Object)} callback Callback for result.
 */
cvox.braille.LibLouisNativeClient.Translator.prototype.translate =
    function(text, extras, callback) {
  var message = { 'table_name': this.tableName_, 'text': text };
  if (goog.isDef(extras.cursorPosition)) {
    message['cursor_position'] = extras.cursorPosition;
  }
  this.instance_.rpc_('Translate', message, goog.bind(function(reply) {
    if (reply['success'] && goog.isString(reply['cells'])) {
      var cells = this.decodeHexString_(reply['cells']);
      var extras = {};
      if (goog.isDef(reply['text_to_braille'])) {
        extras.textToBraille = reply['text_to_braille'];
      }
      if (goog.isDef(reply['braille_to_text'])) {
        extras.brailleToText = reply['braille_to_text'];
      }
      if (goog.isDef(reply['cursor_position'])) {
        extras.cursorPosition = reply['cursor_position'];
      }
      callback(cells, extras);
    } else {
      callback(null /* cells */, null /* extras */);
    }
  }, this));
};

/**
 * Translates braille cells into text.
 * @param {!ArrayBuffer} cells Cells to be translated.
 * @param {Object} extras Extra parameters for translation.
 * @param {function(?string, Object)} callback Callback for result.
 */
cvox.braille.LibLouisNativeClient.Translator.prototype.backTranslate =
    function(cells, extras, callback) {
  var message = {
    'table_name': this.tableName_,
    'cells': this.encodeHexString_(cells)
  };
  this.instance_.rpc_('BackTranslate', message, function(reply) {
    if (reply['success'] && goog.isString(reply['text'])) {
      callback(reply['text'], {} /* extras */);
    } else {
      callback(null /* text */, null /* extras */);
    }
  });
};

/**
 * Decodes a hexadecimal string to an {@code ArrayBuffer}.
 * @param {string} hex Hexadecimal string.
 * @return {!ArrayBuffer} Decoded binary data.
 * @private
 */
cvox.braille.LibLouisNativeClient.Translator.prototype.decodeHexString_ =
    function(hex) {
  if (!/^([0-9a-f]{2})*$/i.test(hex)) {
    throw Error('invalid hexadecimal string');
  }
  var array = new Uint8Array(hex.length / 2);
  var idx = 0;
  for (var i = 0; i < hex.length; i += 2) {
    array[idx++] = parseInt(hex.substring(i, i + 2), 16);
  }
  return array.buffer;
};

/**
 * Encodes an {@code ArrayBuffer} in hexadecimal.
 * @param {!ArrayBuffer} arrayBuffer Binary data.
 * @return {string} Hexadecimal string.
 * @private
 */
cvox.braille.LibLouisNativeClient.Translator.prototype.encodeHexString_ =
    function(arrayBuffer) {
  var array = new Uint8Array(arrayBuffer);
  var hex = '';
  for (var i = 0; i < array.length; i++) {
    var b = array[i];
    hex += (b < 0x10 ? '0' : '') + b.toString(16);
  }
  return hex;
};
