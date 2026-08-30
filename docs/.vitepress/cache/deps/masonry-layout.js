import { t as __commonJSMin } from "./rolldown-runtime-BPOCksWG.js";
//#region node_modules/.pnpm/ev-emitter@1.1.1/node_modules/ev-emitter/ev-emitter.js
var require_ev_emitter = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* EvEmitter v1.1.0
	* Lil' event emitter
	* MIT License
	*/
	(function(global, factory) {
		if (typeof define == "function" && define.amd) define(factory);
		else if (typeof module == "object" && module.exports) module.exports = factory();
		else global.EvEmitter = factory();
	})(typeof window != "undefined" ? window : exports, function() {
		"use strict";
		function EvEmitter() {}
		var proto = EvEmitter.prototype;
		proto.on = function(eventName, listener) {
			if (!eventName || !listener) return;
			var events = this._events = this._events || {};
			var listeners = events[eventName] = events[eventName] || [];
			if (listeners.indexOf(listener) == -1) listeners.push(listener);
			return this;
		};
		proto.once = function(eventName, listener) {
			if (!eventName || !listener) return;
			this.on(eventName, listener);
			var onceEvents = this._onceEvents = this._onceEvents || {};
			var onceListeners = onceEvents[eventName] = onceEvents[eventName] || {};
			onceListeners[listener] = true;
			return this;
		};
		proto.off = function(eventName, listener) {
			var listeners = this._events && this._events[eventName];
			if (!listeners || !listeners.length) return;
			var index = listeners.indexOf(listener);
			if (index != -1) listeners.splice(index, 1);
			return this;
		};
		proto.emitEvent = function(eventName, args) {
			var listeners = this._events && this._events[eventName];
			if (!listeners || !listeners.length) return;
			listeners = listeners.slice(0);
			args = args || [];
			var onceListeners = this._onceEvents && this._onceEvents[eventName];
			for (var i = 0; i < listeners.length; i++) {
				var listener = listeners[i];
				if (onceListeners && onceListeners[listener]) {
					this.off(eventName, listener);
					delete onceListeners[listener];
				}
				listener.apply(this, args);
			}
			return this;
		};
		proto.allOff = function() {
			delete this._events;
			delete this._onceEvents;
		};
		return EvEmitter;
	});
}));
//#endregion
//#region node_modules/.pnpm/get-size@2.0.3/node_modules/get-size/get-size.js
var require_get_size = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/*!
	* getSize v2.0.3
	* measure size of elements
	* MIT license
	*/
	(function(window, factory) {
		if (typeof define == "function" && define.amd) define(factory);
		else if (typeof module == "object" && module.exports) module.exports = factory();
		else window.getSize = factory();
	})(window, function factory() {
		"use strict";
		function getStyleSize(value) {
			var num = parseFloat(value);
			return value.indexOf("%") == -1 && !isNaN(num) && num;
		}
		function noop() {}
		var logError = typeof console == "undefined" ? noop : function(message) {
			console.error(message);
		};
		var measurements = [
			"paddingLeft",
			"paddingRight",
			"paddingTop",
			"paddingBottom",
			"marginLeft",
			"marginRight",
			"marginTop",
			"marginBottom",
			"borderLeftWidth",
			"borderRightWidth",
			"borderTopWidth",
			"borderBottomWidth"
		];
		var measurementsLength = measurements.length;
		function getZeroSize() {
			var size = {
				width: 0,
				height: 0,
				innerWidth: 0,
				innerHeight: 0,
				outerWidth: 0,
				outerHeight: 0
			};
			for (var i = 0; i < measurementsLength; i++) {
				var measurement = measurements[i];
				size[measurement] = 0;
			}
			return size;
		}
		/**
		* getStyle, get style of element, check for Firefox bug
		* https://bugzilla.mozilla.org/show_bug.cgi?id=548397
		*/
		function getStyle(elem) {
			var style = getComputedStyle(elem);
			if (!style) logError("Style returned " + style + ". Are you running this code in a hidden iframe on Firefox? See https://bit.ly/getsizebug1");
			return style;
		}
		var isSetup = false;
		var isBoxSizeOuter;
		/**
		* setup
		* check isBoxSizerOuter
		* do on first getSize() rather than on page load for Firefox bug
		*/
		function setup() {
			if (isSetup) return;
			isSetup = true;
			/**
			* Chrome & Safari measure the outer-width on style.width on border-box elems
			* IE11 & Firefox<29 measures the inner-width
			*/
			var div = document.createElement("div");
			div.style.width = "200px";
			div.style.padding = "1px 2px 3px 4px";
			div.style.borderStyle = "solid";
			div.style.borderWidth = "1px 2px 3px 4px";
			div.style.boxSizing = "border-box";
			var body = document.body || document.documentElement;
			body.appendChild(div);
			var style = getStyle(div);
			isBoxSizeOuter = Math.round(getStyleSize(style.width)) == 200;
			getSize.isBoxSizeOuter = isBoxSizeOuter;
			body.removeChild(div);
		}
		function getSize(elem) {
			setup();
			if (typeof elem == "string") elem = document.querySelector(elem);
			if (!elem || typeof elem != "object" || !elem.nodeType) return;
			var style = getStyle(elem);
			if (style.display == "none") return getZeroSize();
			var size = {};
			size.width = elem.offsetWidth;
			size.height = elem.offsetHeight;
			var isBorderBox = size.isBorderBox = style.boxSizing == "border-box";
			for (var i = 0; i < measurementsLength; i++) {
				var measurement = measurements[i];
				var value = style[measurement];
				var num = parseFloat(value);
				size[measurement] = !isNaN(num) ? num : 0;
			}
			var paddingWidth = size.paddingLeft + size.paddingRight;
			var paddingHeight = size.paddingTop + size.paddingBottom;
			var marginWidth = size.marginLeft + size.marginRight;
			var marginHeight = size.marginTop + size.marginBottom;
			var borderWidth = size.borderLeftWidth + size.borderRightWidth;
			var borderHeight = size.borderTopWidth + size.borderBottomWidth;
			var isBorderBoxSizeOuter = isBorderBox && isBoxSizeOuter;
			var styleWidth = getStyleSize(style.width);
			if (styleWidth !== false) size.width = styleWidth + (isBorderBoxSizeOuter ? 0 : paddingWidth + borderWidth);
			var styleHeight = getStyleSize(style.height);
			if (styleHeight !== false) size.height = styleHeight + (isBorderBoxSizeOuter ? 0 : paddingHeight + borderHeight);
			size.innerWidth = size.width - (paddingWidth + borderWidth);
			size.innerHeight = size.height - (paddingHeight + borderHeight);
			size.outerWidth = size.width + marginWidth;
			size.outerHeight = size.height + marginHeight;
			return size;
		}
		return getSize;
	});
}));
//#endregion
//#region node_modules/.pnpm/desandro-matches-selector@2.0.2/node_modules/desandro-matches-selector/matches-selector.js
var require_matches_selector = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* matchesSelector v2.0.2
	* matchesSelector( element, '.selector' )
	* MIT license
	*/
	(function(window, factory) {
		"use strict";
		if (typeof define == "function" && define.amd) define(factory);
		else if (typeof module == "object" && module.exports) module.exports = factory();
		else window.matchesSelector = factory();
	})(window, function factory() {
		"use strict";
		var matchesMethod = (function() {
			var ElemProto = window.Element.prototype;
			if (ElemProto.matches) return "matches";
			if (ElemProto.matchesSelector) return "matchesSelector";
			var prefixes = [
				"webkit",
				"moz",
				"ms",
				"o"
			];
			for (var i = 0; i < prefixes.length; i++) {
				var method = prefixes[i] + "MatchesSelector";
				if (ElemProto[method]) return method;
			}
		})();
		return function matchesSelector(elem, selector) {
			return elem[matchesMethod](selector);
		};
	});
}));
//#endregion
//#region node_modules/.pnpm/fizzy-ui-utils@2.0.7/node_modules/fizzy-ui-utils/utils.js
var require_utils = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Fizzy UI utils v2.0.7
	* MIT license
	*/
	(function(window, factory) {
		if (typeof define == "function" && define.amd) define(["desandro-matches-selector/matches-selector"], function(matchesSelector) {
			return factory(window, matchesSelector);
		});
		else if (typeof module == "object" && module.exports) module.exports = factory(window, require_matches_selector());
		else window.fizzyUIUtils = factory(window, window.matchesSelector);
	})(window, function factory(window, matchesSelector) {
		"use strict";
		var utils = {};
		utils.extend = function(a, b) {
			for (var prop in b) a[prop] = b[prop];
			return a;
		};
		utils.modulo = function(num, div) {
			return (num % div + div) % div;
		};
		var arraySlice = Array.prototype.slice;
		utils.makeArray = function(obj) {
			if (Array.isArray(obj)) return obj;
			if (obj === null || obj === void 0) return [];
			if (typeof obj == "object" && typeof obj.length == "number") return arraySlice.call(obj);
			return [obj];
		};
		utils.removeFrom = function(ary, obj) {
			var index = ary.indexOf(obj);
			if (index != -1) ary.splice(index, 1);
		};
		utils.getParent = function(elem, selector) {
			while (elem.parentNode && elem != document.body) {
				elem = elem.parentNode;
				if (matchesSelector(elem, selector)) return elem;
			}
		};
		utils.getQueryElement = function(elem) {
			if (typeof elem == "string") return document.querySelector(elem);
			return elem;
		};
		utils.handleEvent = function(event) {
			var method = "on" + event.type;
			if (this[method]) this[method](event);
		};
		utils.filterFindElements = function(elems, selector) {
			elems = utils.makeArray(elems);
			var ffElems = [];
			elems.forEach(function(elem) {
				if (!(elem instanceof HTMLElement)) return;
				if (!selector) {
					ffElems.push(elem);
					return;
				}
				if (matchesSelector(elem, selector)) ffElems.push(elem);
				var childElems = elem.querySelectorAll(selector);
				for (var i = 0; i < childElems.length; i++) ffElems.push(childElems[i]);
			});
			return ffElems;
		};
		utils.debounceMethod = function(_class, methodName, threshold) {
			threshold = threshold || 100;
			var method = _class.prototype[methodName];
			var timeoutName = methodName + "Timeout";
			_class.prototype[methodName] = function() {
				var timeout = this[timeoutName];
				clearTimeout(timeout);
				var args = arguments;
				var _this = this;
				this[timeoutName] = setTimeout(function() {
					method.apply(_this, args);
					delete _this[timeoutName];
				}, threshold);
			};
		};
		utils.docReady = function(callback) {
			var readyState = document.readyState;
			if (readyState == "complete" || readyState == "interactive") setTimeout(callback);
			else document.addEventListener("DOMContentLoaded", callback);
		};
		utils.toDashed = function(str) {
			return str.replace(/(.)([A-Z])/g, function(match, $1, $2) {
				return $1 + "-" + $2;
			}).toLowerCase();
		};
		var console = window.console;
		/**
		* allow user to initialize classes via [data-namespace] or .js-namespace class
		* htmlInit( Widget, 'widgetName' )
		* options are parsed from data-namespace-options
		*/
		utils.htmlInit = function(WidgetClass, namespace) {
			utils.docReady(function() {
				var dashedNamespace = utils.toDashed(namespace);
				var dataAttr = "data-" + dashedNamespace;
				var dataAttrElems = document.querySelectorAll("[" + dataAttr + "]");
				var jsDashElems = document.querySelectorAll(".js-" + dashedNamespace);
				var elems = utils.makeArray(dataAttrElems).concat(utils.makeArray(jsDashElems));
				var dataOptionsAttr = dataAttr + "-options";
				var jQuery = window.jQuery;
				elems.forEach(function(elem) {
					var attr = elem.getAttribute(dataAttr) || elem.getAttribute(dataOptionsAttr);
					var options;
					try {
						options = attr && JSON.parse(attr);
					} catch (error) {
						if (console) console.error("Error parsing " + dataAttr + " on " + elem.className + ": " + error);
						return;
					}
					var instance = new WidgetClass(elem, options);
					if (jQuery) jQuery.data(elem, namespace, instance);
				});
			});
		};
		return utils;
	});
}));
//#endregion
//#region node_modules/.pnpm/outlayer@2.1.1/node_modules/outlayer/item.js
var require_item = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Outlayer Item
	*/
	(function(window, factory) {
		if (typeof define == "function" && define.amd) define(["ev-emitter/ev-emitter", "get-size/get-size"], factory);
		else if (typeof module == "object" && module.exports) module.exports = factory(require_ev_emitter(), require_get_size());
		else {
			window.Outlayer = {};
			window.Outlayer.Item = factory(window.EvEmitter, window.getSize);
		}
	})(window, function factory(EvEmitter, getSize) {
		"use strict";
		function isEmptyObj(obj) {
			for (var prop in obj) return false;
			return true;
		}
		var docElemStyle = document.documentElement.style;
		var transitionProperty = typeof docElemStyle.transition == "string" ? "transition" : "WebkitTransition";
		var transformProperty = typeof docElemStyle.transform == "string" ? "transform" : "WebkitTransform";
		var transitionEndEvent = {
			WebkitTransition: "webkitTransitionEnd",
			transition: "transitionend"
		}[transitionProperty];
		var vendorProperties = {
			transform: transformProperty,
			transition: transitionProperty,
			transitionDuration: transitionProperty + "Duration",
			transitionProperty: transitionProperty + "Property",
			transitionDelay: transitionProperty + "Delay"
		};
		function Item(element, layout) {
			if (!element) return;
			this.element = element;
			this.layout = layout;
			this.position = {
				x: 0,
				y: 0
			};
			this._create();
		}
		var proto = Item.prototype = Object.create(EvEmitter.prototype);
		proto.constructor = Item;
		proto._create = function() {
			this._transn = {
				ingProperties: {},
				clean: {},
				onEnd: {}
			};
			this.css({ position: "absolute" });
		};
		proto.handleEvent = function(event) {
			var method = "on" + event.type;
			if (this[method]) this[method](event);
		};
		proto.getSize = function() {
			this.size = getSize(this.element);
		};
		/**
		* apply CSS styles to element
		* @param {Object} style
		*/
		proto.css = function(style) {
			var elemStyle = this.element.style;
			for (var prop in style) {
				var supportedProp = vendorProperties[prop] || prop;
				elemStyle[supportedProp] = style[prop];
			}
		};
		proto.getPosition = function() {
			var style = getComputedStyle(this.element);
			var isOriginLeft = this.layout._getOption("originLeft");
			var isOriginTop = this.layout._getOption("originTop");
			var xValue = style[isOriginLeft ? "left" : "right"];
			var yValue = style[isOriginTop ? "top" : "bottom"];
			var x = parseFloat(xValue);
			var y = parseFloat(yValue);
			var layoutSize = this.layout.size;
			if (xValue.indexOf("%") != -1) x = x / 100 * layoutSize.width;
			if (yValue.indexOf("%") != -1) y = y / 100 * layoutSize.height;
			x = isNaN(x) ? 0 : x;
			y = isNaN(y) ? 0 : y;
			x -= isOriginLeft ? layoutSize.paddingLeft : layoutSize.paddingRight;
			y -= isOriginTop ? layoutSize.paddingTop : layoutSize.paddingBottom;
			this.position.x = x;
			this.position.y = y;
		};
		proto.layoutPosition = function() {
			var layoutSize = this.layout.size;
			var style = {};
			var isOriginLeft = this.layout._getOption("originLeft");
			var isOriginTop = this.layout._getOption("originTop");
			var xPadding = isOriginLeft ? "paddingLeft" : "paddingRight";
			var xProperty = isOriginLeft ? "left" : "right";
			var xResetProperty = isOriginLeft ? "right" : "left";
			var x = this.position.x + layoutSize[xPadding];
			style[xProperty] = this.getXValue(x);
			style[xResetProperty] = "";
			var yPadding = isOriginTop ? "paddingTop" : "paddingBottom";
			var yProperty = isOriginTop ? "top" : "bottom";
			var yResetProperty = isOriginTop ? "bottom" : "top";
			var y = this.position.y + layoutSize[yPadding];
			style[yProperty] = this.getYValue(y);
			style[yResetProperty] = "";
			this.css(style);
			this.emitEvent("layout", [this]);
		};
		proto.getXValue = function(x) {
			var isHorizontal = this.layout._getOption("horizontal");
			return this.layout.options.percentPosition && !isHorizontal ? x / this.layout.size.width * 100 + "%" : x + "px";
		};
		proto.getYValue = function(y) {
			var isHorizontal = this.layout._getOption("horizontal");
			return this.layout.options.percentPosition && isHorizontal ? y / this.layout.size.height * 100 + "%" : y + "px";
		};
		proto._transitionTo = function(x, y) {
			this.getPosition();
			var curX = this.position.x;
			var curY = this.position.y;
			var didNotMove = x == this.position.x && y == this.position.y;
			this.setPosition(x, y);
			if (didNotMove && !this.isTransitioning) {
				this.layoutPosition();
				return;
			}
			var transX = x - curX;
			var transY = y - curY;
			var transitionStyle = {};
			transitionStyle.transform = this.getTranslate(transX, transY);
			this.transition({
				to: transitionStyle,
				onTransitionEnd: { transform: this.layoutPosition },
				isCleaning: true
			});
		};
		proto.getTranslate = function(x, y) {
			var isOriginLeft = this.layout._getOption("originLeft");
			var isOriginTop = this.layout._getOption("originTop");
			x = isOriginLeft ? x : -x;
			y = isOriginTop ? y : -y;
			return "translate3d(" + x + "px, " + y + "px, 0)";
		};
		proto.goTo = function(x, y) {
			this.setPosition(x, y);
			this.layoutPosition();
		};
		proto.moveTo = proto._transitionTo;
		proto.setPosition = function(x, y) {
			this.position.x = parseFloat(x);
			this.position.y = parseFloat(y);
		};
		/**
		* @param {Object} style - CSS
		* @param {Function} onTransitionEnd
		*/
		proto._nonTransition = function(args) {
			this.css(args.to);
			if (args.isCleaning) this._removeStyles(args.to);
			for (var prop in args.onTransitionEnd) args.onTransitionEnd[prop].call(this);
		};
		/**
		* proper transition
		* @param {Object} args - arguments
		*   @param {Object} to - style to transition to
		*   @param {Object} from - style to start transition from
		*   @param {Boolean} isCleaning - removes transition styles after transition
		*   @param {Function} onTransitionEnd - callback
		*/
		proto.transition = function(args) {
			if (!parseFloat(this.layout.options.transitionDuration)) {
				this._nonTransition(args);
				return;
			}
			var _transition = this._transn;
			for (var prop in args.onTransitionEnd) _transition.onEnd[prop] = args.onTransitionEnd[prop];
			for (prop in args.to) {
				_transition.ingProperties[prop] = true;
				if (args.isCleaning) _transition.clean[prop] = true;
			}
			if (args.from) {
				this.css(args.from);
				this.element.offsetHeight;
			}
			this.enableTransition(args.to);
			this.css(args.to);
			this.isTransitioning = true;
		};
		function toDashedAll(str) {
			return str.replace(/([A-Z])/g, function($1) {
				return "-" + $1.toLowerCase();
			});
		}
		var transitionProps = "opacity," + toDashedAll(transformProperty);
		proto.enableTransition = function() {
			if (this.isTransitioning) return;
			var duration = this.layout.options.transitionDuration;
			duration = typeof duration == "number" ? duration + "ms" : duration;
			this.css({
				transitionProperty: transitionProps,
				transitionDuration: duration,
				transitionDelay: this.staggerDelay || 0
			});
			this.element.addEventListener(transitionEndEvent, this, false);
		};
		proto.onwebkitTransitionEnd = function(event) {
			this.ontransitionend(event);
		};
		proto.onotransitionend = function(event) {
			this.ontransitionend(event);
		};
		var dashedVendorProperties = { "-webkit-transform": "transform" };
		proto.ontransitionend = function(event) {
			if (event.target !== this.element) return;
			var _transition = this._transn;
			var propertyName = dashedVendorProperties[event.propertyName] || event.propertyName;
			delete _transition.ingProperties[propertyName];
			if (isEmptyObj(_transition.ingProperties)) this.disableTransition();
			if (propertyName in _transition.clean) {
				this.element.style[event.propertyName] = "";
				delete _transition.clean[propertyName];
			}
			if (propertyName in _transition.onEnd) {
				_transition.onEnd[propertyName].call(this);
				delete _transition.onEnd[propertyName];
			}
			this.emitEvent("transitionEnd", [this]);
		};
		proto.disableTransition = function() {
			this.removeTransitionStyles();
			this.element.removeEventListener(transitionEndEvent, this, false);
			this.isTransitioning = false;
		};
		/**
		* removes style property from element
		* @param {Object} style
		**/
		proto._removeStyles = function(style) {
			var cleanStyle = {};
			for (var prop in style) cleanStyle[prop] = "";
			this.css(cleanStyle);
		};
		var cleanTransitionStyle = {
			transitionProperty: "",
			transitionDuration: "",
			transitionDelay: ""
		};
		proto.removeTransitionStyles = function() {
			this.css(cleanTransitionStyle);
		};
		proto.stagger = function(delay) {
			delay = isNaN(delay) ? 0 : delay;
			this.staggerDelay = delay + "ms";
		};
		proto.removeElem = function() {
			this.element.parentNode.removeChild(this.element);
			this.css({ display: "" });
			this.emitEvent("remove", [this]);
		};
		proto.remove = function() {
			if (!transitionProperty || !parseFloat(this.layout.options.transitionDuration)) {
				this.removeElem();
				return;
			}
			this.once("transitionEnd", function() {
				this.removeElem();
			});
			this.hide();
		};
		proto.reveal = function() {
			delete this.isHidden;
			this.css({ display: "" });
			var options = this.layout.options;
			var onTransitionEnd = {};
			var transitionEndProperty = this.getHideRevealTransitionEndProperty("visibleStyle");
			onTransitionEnd[transitionEndProperty] = this.onRevealTransitionEnd;
			this.transition({
				from: options.hiddenStyle,
				to: options.visibleStyle,
				isCleaning: true,
				onTransitionEnd
			});
		};
		proto.onRevealTransitionEnd = function() {
			if (!this.isHidden) this.emitEvent("reveal");
		};
		/**
		* get style property use for hide/reveal transition end
		* @param {String} styleProperty - hiddenStyle/visibleStyle
		* @returns {String}
		*/
		proto.getHideRevealTransitionEndProperty = function(styleProperty) {
			var optionStyle = this.layout.options[styleProperty];
			if (optionStyle.opacity) return "opacity";
			for (var prop in optionStyle) return prop;
		};
		proto.hide = function() {
			this.isHidden = true;
			this.css({ display: "" });
			var options = this.layout.options;
			var onTransitionEnd = {};
			var transitionEndProperty = this.getHideRevealTransitionEndProperty("hiddenStyle");
			onTransitionEnd[transitionEndProperty] = this.onHideTransitionEnd;
			this.transition({
				from: options.visibleStyle,
				to: options.hiddenStyle,
				isCleaning: true,
				onTransitionEnd
			});
		};
		proto.onHideTransitionEnd = function() {
			if (this.isHidden) {
				this.css({ display: "none" });
				this.emitEvent("hide");
			}
		};
		proto.destroy = function() {
			this.css({
				position: "",
				left: "",
				right: "",
				top: "",
				bottom: "",
				transition: "",
				transform: ""
			});
		};
		return Item;
	});
}));
//#endregion
//#region node_modules/.pnpm/outlayer@2.1.1/node_modules/outlayer/outlayer.js
var require_outlayer = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/*!
	* Outlayer v2.1.1
	* the brains and guts of a layout library
	* MIT license
	*/
	(function(window, factory) {
		"use strict";
		if (typeof define == "function" && define.amd) define([
			"ev-emitter/ev-emitter",
			"get-size/get-size",
			"fizzy-ui-utils/utils",
			"./item"
		], function(EvEmitter, getSize, utils, Item) {
			return factory(window, EvEmitter, getSize, utils, Item);
		});
		else if (typeof module == "object" && module.exports) module.exports = factory(window, require_ev_emitter(), require_get_size(), require_utils(), require_item());
		else window.Outlayer = factory(window, window.EvEmitter, window.getSize, window.fizzyUIUtils, window.Outlayer.Item);
	})(window, function factory(window, EvEmitter, getSize, utils, Item) {
		"use strict";
		var console = window.console;
		var jQuery = window.jQuery;
		var noop = function() {};
		var GUID = 0;
		var instances = {};
		/**
		* @param {Element, String} element
		* @param {Object} options
		* @constructor
		*/
		function Outlayer(element, options) {
			var queryElement = utils.getQueryElement(element);
			if (!queryElement) {
				if (console) console.error("Bad element for " + this.constructor.namespace + ": " + (queryElement || element));
				return;
			}
			this.element = queryElement;
			if (jQuery) this.$element = jQuery(this.element);
			this.options = utils.extend({}, this.constructor.defaults);
			this.option(options);
			var id = ++GUID;
			this.element.outlayerGUID = id;
			instances[id] = this;
			this._create();
			if (this._getOption("initLayout")) this.layout();
		}
		Outlayer.namespace = "outlayer";
		Outlayer.Item = Item;
		Outlayer.defaults = {
			containerStyle: { position: "relative" },
			initLayout: true,
			originLeft: true,
			originTop: true,
			resize: true,
			resizeContainer: true,
			transitionDuration: "0.4s",
			hiddenStyle: {
				opacity: 0,
				transform: "scale(0.001)"
			},
			visibleStyle: {
				opacity: 1,
				transform: "scale(1)"
			}
		};
		var proto = Outlayer.prototype;
		utils.extend(proto, EvEmitter.prototype);
		/**
		* set options
		* @param {Object} opts
		*/
		proto.option = function(opts) {
			utils.extend(this.options, opts);
		};
		/**
		* get backwards compatible option value, check old name
		*/
		proto._getOption = function(option) {
			var oldOption = this.constructor.compatOptions[option];
			return oldOption && this.options[oldOption] !== void 0 ? this.options[oldOption] : this.options[option];
		};
		Outlayer.compatOptions = {
			initLayout: "isInitLayout",
			horizontal: "isHorizontal",
			layoutInstant: "isLayoutInstant",
			originLeft: "isOriginLeft",
			originTop: "isOriginTop",
			resize: "isResizeBound",
			resizeContainer: "isResizingContainer"
		};
		proto._create = function() {
			this.reloadItems();
			this.stamps = [];
			this.stamp(this.options.stamp);
			utils.extend(this.element.style, this.options.containerStyle);
			if (this._getOption("resize")) this.bindResize();
		};
		proto.reloadItems = function() {
			this.items = this._itemize(this.element.children);
		};
		/**
		* turn elements into Outlayer.Items to be used in layout
		* @param {Array or NodeList or HTMLElement} elems
		* @returns {Array} items - collection of new Outlayer Items
		*/
		proto._itemize = function(elems) {
			var itemElems = this._filterFindItemElements(elems);
			var Item = this.constructor.Item;
			var items = [];
			for (var i = 0; i < itemElems.length; i++) {
				var elem = itemElems[i];
				var item = new Item(elem, this);
				items.push(item);
			}
			return items;
		};
		/**
		* get item elements to be used in layout
		* @param {Array or NodeList or HTMLElement} elems
		* @returns {Array} items - item elements
		*/
		proto._filterFindItemElements = function(elems) {
			return utils.filterFindElements(elems, this.options.itemSelector);
		};
		/**
		* getter method for getting item elements
		* @returns {Array} elems - collection of item elements
		*/
		proto.getItemElements = function() {
			return this.items.map(function(item) {
				return item.element;
			});
		};
		/**
		* lays out all items
		*/
		proto.layout = function() {
			this._resetLayout();
			this._manageStamps();
			var layoutInstant = this._getOption("layoutInstant");
			var isInstant = layoutInstant !== void 0 ? layoutInstant : !this._isLayoutInited;
			this.layoutItems(this.items, isInstant);
			this._isLayoutInited = true;
		};
		proto._init = proto.layout;
		/**
		* logic before any new layout
		*/
		proto._resetLayout = function() {
			this.getSize();
		};
		proto.getSize = function() {
			this.size = getSize(this.element);
		};
		/**
		* get measurement from option, for columnWidth, rowHeight, gutter
		* if option is String -> get element from selector string, & get size of element
		* if option is Element -> get size of element
		* else use option as a number
		*
		* @param {String} measurement
		* @param {String} size - width or height
		* @private
		*/
		proto._getMeasurement = function(measurement, size) {
			var option = this.options[measurement];
			var elem;
			if (!option) this[measurement] = 0;
			else {
				if (typeof option == "string") elem = this.element.querySelector(option);
				else if (option instanceof HTMLElement) elem = option;
				this[measurement] = elem ? getSize(elem)[size] : option;
			}
		};
		/**
		* layout a collection of item elements
		* @api public
		*/
		proto.layoutItems = function(items, isInstant) {
			items = this._getItemsForLayout(items);
			this._layoutItems(items, isInstant);
			this._postLayout();
		};
		/**
		* get the items to be laid out
		* you may want to skip over some items
		* @param {Array} items
		* @returns {Array} items
		*/
		proto._getItemsForLayout = function(items) {
			return items.filter(function(item) {
				return !item.isIgnored;
			});
		};
		/**
		* layout items
		* @param {Array} items
		* @param {Boolean} isInstant
		*/
		proto._layoutItems = function(items, isInstant) {
			this._emitCompleteOnItems("layout", items);
			if (!items || !items.length) return;
			var queue = [];
			items.forEach(function(item) {
				var position = this._getItemLayoutPosition(item);
				position.item = item;
				position.isInstant = isInstant || item.isLayoutInstant;
				queue.push(position);
			}, this);
			this._processLayoutQueue(queue);
		};
		/**
		* get item layout position
		* @param {Outlayer.Item} item
		* @returns {Object} x and y position
		*/
		proto._getItemLayoutPosition = function() {
			return {
				x: 0,
				y: 0
			};
		};
		/**
		* iterate over array and position each item
		* Reason being - separating this logic prevents 'layout invalidation'
		* thx @paul_irish
		* @param {Array} queue
		*/
		proto._processLayoutQueue = function(queue) {
			this.updateStagger();
			queue.forEach(function(obj, i) {
				this._positionItem(obj.item, obj.x, obj.y, obj.isInstant, i);
			}, this);
		};
		proto.updateStagger = function() {
			var stagger = this.options.stagger;
			if (stagger === null || stagger === void 0) {
				this.stagger = 0;
				return;
			}
			this.stagger = getMilliseconds(stagger);
			return this.stagger;
		};
		/**
		* Sets position of item in DOM
		* @param {Outlayer.Item} item
		* @param {Number} x - horizontal position
		* @param {Number} y - vertical position
		* @param {Boolean} isInstant - disables transitions
		*/
		proto._positionItem = function(item, x, y, isInstant, i) {
			if (isInstant) item.goTo(x, y);
			else {
				item.stagger(i * this.stagger);
				item.moveTo(x, y);
			}
		};
		/**
		* Any logic you want to do after each layout,
		* i.e. size the container
		*/
		proto._postLayout = function() {
			this.resizeContainer();
		};
		proto.resizeContainer = function() {
			if (!this._getOption("resizeContainer")) return;
			var size = this._getContainerSize();
			if (size) {
				this._setContainerMeasure(size.width, true);
				this._setContainerMeasure(size.height, false);
			}
		};
		/**
		* Sets width or height of container if returned
		* @returns {Object} size
		*   @param {Number} width
		*   @param {Number} height
		*/
		proto._getContainerSize = noop;
		/**
		* @param {Number} measure - size of width or height
		* @param {Boolean} isWidth
		*/
		proto._setContainerMeasure = function(measure, isWidth) {
			if (measure === void 0) return;
			var elemSize = this.size;
			if (elemSize.isBorderBox) measure += isWidth ? elemSize.paddingLeft + elemSize.paddingRight + elemSize.borderLeftWidth + elemSize.borderRightWidth : elemSize.paddingBottom + elemSize.paddingTop + elemSize.borderTopWidth + elemSize.borderBottomWidth;
			measure = Math.max(measure, 0);
			this.element.style[isWidth ? "width" : "height"] = measure + "px";
		};
		/**
		* emit eventComplete on a collection of items events
		* @param {String} eventName
		* @param {Array} items - Outlayer.Items
		*/
		proto._emitCompleteOnItems = function(eventName, items) {
			var _this = this;
			function onComplete() {
				_this.dispatchEvent(eventName + "Complete", null, [items]);
			}
			var count = items.length;
			if (!items || !count) {
				onComplete();
				return;
			}
			var doneCount = 0;
			function tick() {
				doneCount++;
				if (doneCount == count) onComplete();
			}
			items.forEach(function(item) {
				item.once(eventName, tick);
			});
		};
		/**
		* emits events via EvEmitter and jQuery events
		* @param {String} type - name of event
		* @param {Event} event - original event
		* @param {Array} args - extra arguments
		*/
		proto.dispatchEvent = function(type, event, args) {
			var emitArgs = event ? [event].concat(args) : args;
			this.emitEvent(type, emitArgs);
			if (jQuery) {
				this.$element = this.$element || jQuery(this.element);
				if (event) {
					var $event = jQuery.Event(event);
					$event.type = type;
					this.$element.trigger($event, args);
				} else this.$element.trigger(type, args);
			}
		};
		/**
		* keep item in collection, but do not lay it out
		* ignored items do not get skipped in layout
		* @param {Element} elem
		*/
		proto.ignore = function(elem) {
			var item = this.getItem(elem);
			if (item) item.isIgnored = true;
		};
		/**
		* return item to layout collection
		* @param {Element} elem
		*/
		proto.unignore = function(elem) {
			var item = this.getItem(elem);
			if (item) delete item.isIgnored;
		};
		/**
		* adds elements to stamps
		* @param {NodeList, Array, Element, or String} elems
		*/
		proto.stamp = function(elems) {
			elems = this._find(elems);
			if (!elems) return;
			this.stamps = this.stamps.concat(elems);
			elems.forEach(this.ignore, this);
		};
		/**
		* removes elements to stamps
		* @param {NodeList, Array, or Element} elems
		*/
		proto.unstamp = function(elems) {
			elems = this._find(elems);
			if (!elems) return;
			elems.forEach(function(elem) {
				utils.removeFrom(this.stamps, elem);
				this.unignore(elem);
			}, this);
		};
		/**
		* finds child elements
		* @param {NodeList, Array, Element, or String} elems
		* @returns {Array} elems
		*/
		proto._find = function(elems) {
			if (!elems) return;
			if (typeof elems == "string") elems = this.element.querySelectorAll(elems);
			elems = utils.makeArray(elems);
			return elems;
		};
		proto._manageStamps = function() {
			if (!this.stamps || !this.stamps.length) return;
			this._getBoundingRect();
			this.stamps.forEach(this._manageStamp, this);
		};
		proto._getBoundingRect = function() {
			var boundingRect = this.element.getBoundingClientRect();
			var size = this.size;
			this._boundingRect = {
				left: boundingRect.left + size.paddingLeft + size.borderLeftWidth,
				top: boundingRect.top + size.paddingTop + size.borderTopWidth,
				right: boundingRect.right - (size.paddingRight + size.borderRightWidth),
				bottom: boundingRect.bottom - (size.paddingBottom + size.borderBottomWidth)
			};
		};
		/**
		* @param {Element} stamp
		**/
		proto._manageStamp = noop;
		/**
		* get x/y position of element relative to container element
		* @param {Element} elem
		* @returns {Object} offset - has left, top, right, bottom
		*/
		proto._getElementOffset = function(elem) {
			var boundingRect = elem.getBoundingClientRect();
			var thisRect = this._boundingRect;
			var size = getSize(elem);
			return {
				left: boundingRect.left - thisRect.left - size.marginLeft,
				top: boundingRect.top - thisRect.top - size.marginTop,
				right: thisRect.right - boundingRect.right - size.marginRight,
				bottom: thisRect.bottom - boundingRect.bottom - size.marginBottom
			};
		};
		proto.handleEvent = utils.handleEvent;
		/**
		* Bind layout to window resizing
		*/
		proto.bindResize = function() {
			window.addEventListener("resize", this);
			this.isResizeBound = true;
		};
		/**
		* Unbind layout to window resizing
		*/
		proto.unbindResize = function() {
			window.removeEventListener("resize", this);
			this.isResizeBound = false;
		};
		proto.onresize = function() {
			this.resize();
		};
		utils.debounceMethod(Outlayer, "onresize", 100);
		proto.resize = function() {
			if (!this.isResizeBound || !this.needsResizeLayout()) return;
			this.layout();
		};
		/**
		* check if layout is needed post layout
		* @returns Boolean
		*/
		proto.needsResizeLayout = function() {
			var size = getSize(this.element);
			return this.size && size && size.innerWidth !== this.size.innerWidth;
		};
		/**
		* add items to Outlayer instance
		* @param {Array or NodeList or Element} elems
		* @returns {Array} items - Outlayer.Items
		**/
		proto.addItems = function(elems) {
			var items = this._itemize(elems);
			if (items.length) this.items = this.items.concat(items);
			return items;
		};
		/**
		* Layout newly-appended item elements
		* @param {Array or NodeList or Element} elems
		*/
		proto.appended = function(elems) {
			var items = this.addItems(elems);
			if (!items.length) return;
			this.layoutItems(items, true);
			this.reveal(items);
		};
		/**
		* Layout prepended elements
		* @param {Array or NodeList or Element} elems
		*/
		proto.prepended = function(elems) {
			var items = this._itemize(elems);
			if (!items.length) return;
			var previousItems = this.items.slice(0);
			this.items = items.concat(previousItems);
			this._resetLayout();
			this._manageStamps();
			this.layoutItems(items, true);
			this.reveal(items);
			this.layoutItems(previousItems);
		};
		/**
		* reveal a collection of items
		* @param {Array of Outlayer.Items} items
		*/
		proto.reveal = function(items) {
			this._emitCompleteOnItems("reveal", items);
			if (!items || !items.length) return;
			var stagger = this.updateStagger();
			items.forEach(function(item, i) {
				item.stagger(i * stagger);
				item.reveal();
			});
		};
		/**
		* hide a collection of items
		* @param {Array of Outlayer.Items} items
		*/
		proto.hide = function(items) {
			this._emitCompleteOnItems("hide", items);
			if (!items || !items.length) return;
			var stagger = this.updateStagger();
			items.forEach(function(item, i) {
				item.stagger(i * stagger);
				item.hide();
			});
		};
		/**
		* reveal item elements
		* @param {Array}, {Element}, {NodeList} items
		*/
		proto.revealItemElements = function(elems) {
			var items = this.getItems(elems);
			this.reveal(items);
		};
		/**
		* hide item elements
		* @param {Array}, {Element}, {NodeList} items
		*/
		proto.hideItemElements = function(elems) {
			var items = this.getItems(elems);
			this.hide(items);
		};
		/**
		* get Outlayer.Item, given an Element
		* @param {Element} elem
		* @param {Function} callback
		* @returns {Outlayer.Item} item
		*/
		proto.getItem = function(elem) {
			for (var i = 0; i < this.items.length; i++) {
				var item = this.items[i];
				if (item.element == elem) return item;
			}
		};
		/**
		* get collection of Outlayer.Items, given Elements
		* @param {Array} elems
		* @returns {Array} items - Outlayer.Items
		*/
		proto.getItems = function(elems) {
			elems = utils.makeArray(elems);
			var items = [];
			elems.forEach(function(elem) {
				var item = this.getItem(elem);
				if (item) items.push(item);
			}, this);
			return items;
		};
		/**
		* remove element(s) from instance and DOM
		* @param {Array or NodeList or Element} elems
		*/
		proto.remove = function(elems) {
			var removeItems = this.getItems(elems);
			this._emitCompleteOnItems("remove", removeItems);
			if (!removeItems || !removeItems.length) return;
			removeItems.forEach(function(item) {
				item.remove();
				utils.removeFrom(this.items, item);
			}, this);
		};
		proto.destroy = function() {
			var style = this.element.style;
			style.height = "";
			style.position = "";
			style.width = "";
			this.items.forEach(function(item) {
				item.destroy();
			});
			this.unbindResize();
			var id = this.element.outlayerGUID;
			delete instances[id];
			delete this.element.outlayerGUID;
			if (jQuery) jQuery.removeData(this.element, this.constructor.namespace);
		};
		/**
		* get Outlayer instance from element
		* @param {Element} elem
		* @returns {Outlayer}
		*/
		Outlayer.data = function(elem) {
			elem = utils.getQueryElement(elem);
			var id = elem && elem.outlayerGUID;
			return id && instances[id];
		};
		/**
		* create a layout class
		* @param {String} namespace
		*/
		Outlayer.create = function(namespace, options) {
			var Layout = subclass(Outlayer);
			Layout.defaults = utils.extend({}, Outlayer.defaults);
			utils.extend(Layout.defaults, options);
			Layout.compatOptions = utils.extend({}, Outlayer.compatOptions);
			Layout.namespace = namespace;
			Layout.data = Outlayer.data;
			Layout.Item = subclass(Item);
			utils.htmlInit(Layout, namespace);
			if (jQuery && jQuery.bridget) jQuery.bridget(namespace, Layout);
			return Layout;
		};
		function subclass(Parent) {
			function SubClass() {
				Parent.apply(this, arguments);
			}
			SubClass.prototype = Object.create(Parent.prototype);
			SubClass.prototype.constructor = SubClass;
			return SubClass;
		}
		var msUnits = {
			ms: 1,
			s: 1e3
		};
		function getMilliseconds(time) {
			if (typeof time == "number") return time;
			var matches = time.match(/(^\d*\.?\d*)(\w*)/);
			var num = matches && matches[1];
			var unit = matches && matches[2];
			if (!num.length) return 0;
			num = parseFloat(num);
			var mult = msUnits[unit] || 1;
			return num * mult;
		}
		Outlayer.Item = Item;
		return Outlayer;
	});
}));
//#endregion
//#region node_modules/.pnpm/masonry-layout@4.2.2/node_modules/masonry-layout/masonry.js
var require_masonry = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/*!
	* Masonry v4.2.2
	* Cascading grid layout library
	* https://masonry.desandro.com
	* MIT License
	* by David DeSandro
	*/
	(function(window, factory) {
		if (typeof define == "function" && define.amd) define(["outlayer/outlayer", "get-size/get-size"], factory);
		else if (typeof module == "object" && module.exports) module.exports = factory(require_outlayer(), require_get_size());
		else window.Masonry = factory(window.Outlayer, window.getSize);
	})(window, function factory(Outlayer, getSize) {
		"use strict";
		var Masonry = Outlayer.create("masonry");
		Masonry.compatOptions.fitWidth = "isFitWidth";
		var proto = Masonry.prototype;
		proto._resetLayout = function() {
			this.getSize();
			this._getMeasurement("columnWidth", "outerWidth");
			this._getMeasurement("gutter", "outerWidth");
			this.measureColumns();
			this.colYs = [];
			for (var i = 0; i < this.cols; i++) this.colYs.push(0);
			this.maxY = 0;
			this.horizontalColIndex = 0;
		};
		proto.measureColumns = function() {
			this.getContainerWidth();
			if (!this.columnWidth) {
				var firstItem = this.items[0];
				var firstItemElem = firstItem && firstItem.element;
				this.columnWidth = firstItemElem && getSize(firstItemElem).outerWidth || this.containerWidth;
			}
			var columnWidth = this.columnWidth += this.gutter;
			var containerWidth = this.containerWidth + this.gutter;
			var cols = containerWidth / columnWidth;
			var excess = columnWidth - containerWidth % columnWidth;
			cols = Math[excess && excess < 1 ? "round" : "floor"](cols);
			this.cols = Math.max(cols, 1);
		};
		proto.getContainerWidth = function() {
			var size = getSize(this._getOption("fitWidth") ? this.element.parentNode : this.element);
			this.containerWidth = size && size.innerWidth;
		};
		proto._getItemLayoutPosition = function(item) {
			item.getSize();
			var remainder = item.size.outerWidth % this.columnWidth;
			var colSpan = Math[remainder && remainder < 1 ? "round" : "ceil"](item.size.outerWidth / this.columnWidth);
			colSpan = Math.min(colSpan, this.cols);
			var colPosMethod = this.options.horizontalOrder ? "_getHorizontalColPosition" : "_getTopColPosition";
			var colPosition = this[colPosMethod](colSpan, item);
			var position = {
				x: this.columnWidth * colPosition.col,
				y: colPosition.y
			};
			var setHeight = colPosition.y + item.size.outerHeight;
			var setMax = colSpan + colPosition.col;
			for (var i = colPosition.col; i < setMax; i++) this.colYs[i] = setHeight;
			return position;
		};
		proto._getTopColPosition = function(colSpan) {
			var colGroup = this._getTopColGroup(colSpan);
			var minimumY = Math.min.apply(Math, colGroup);
			return {
				col: colGroup.indexOf(minimumY),
				y: minimumY
			};
		};
		/**
		* @param {Number} colSpan - number of columns the element spans
		* @returns {Array} colGroup
		*/
		proto._getTopColGroup = function(colSpan) {
			if (colSpan < 2) return this.colYs;
			var colGroup = [];
			var groupCount = this.cols + 1 - colSpan;
			for (var i = 0; i < groupCount; i++) colGroup[i] = this._getColGroupY(i, colSpan);
			return colGroup;
		};
		proto._getColGroupY = function(col, colSpan) {
			if (colSpan < 2) return this.colYs[col];
			var groupColYs = this.colYs.slice(col, col + colSpan);
			return Math.max.apply(Math, groupColYs);
		};
		proto._getHorizontalColPosition = function(colSpan, item) {
			var col = this.horizontalColIndex % this.cols;
			col = colSpan > 1 && col + colSpan > this.cols ? 0 : col;
			var hasSize = item.size.outerWidth && item.size.outerHeight;
			this.horizontalColIndex = hasSize ? col + colSpan : this.horizontalColIndex;
			return {
				col,
				y: this._getColGroupY(col, colSpan)
			};
		};
		proto._manageStamp = function(stamp) {
			var stampSize = getSize(stamp);
			var offset = this._getElementOffset(stamp);
			var firstX = this._getOption("originLeft") ? offset.left : offset.right;
			var lastX = firstX + stampSize.outerWidth;
			var firstCol = Math.floor(firstX / this.columnWidth);
			firstCol = Math.max(0, firstCol);
			var lastCol = Math.floor(lastX / this.columnWidth);
			lastCol -= lastX % this.columnWidth ? 0 : 1;
			lastCol = Math.min(this.cols - 1, lastCol);
			var stampMaxY = (this._getOption("originTop") ? offset.top : offset.bottom) + stampSize.outerHeight;
			for (var i = firstCol; i <= lastCol; i++) this.colYs[i] = Math.max(stampMaxY, this.colYs[i]);
		};
		proto._getContainerSize = function() {
			this.maxY = Math.max.apply(Math, this.colYs);
			var size = { height: this.maxY };
			if (this._getOption("fitWidth")) size.width = this._getContainerFitWidth();
			return size;
		};
		proto._getContainerFitWidth = function() {
			var unusedCols = 0;
			var i = this.cols;
			while (--i) {
				if (this.colYs[i] !== 0) break;
				unusedCols++;
			}
			return (this.cols - unusedCols) * this.columnWidth - this.gutter;
		};
		proto.needsResizeLayout = function() {
			var previousWidth = this.containerWidth;
			this.getContainerWidth();
			return previousWidth != this.containerWidth;
		};
		return Masonry;
	});
}));
//#endregion
export default require_masonry();
