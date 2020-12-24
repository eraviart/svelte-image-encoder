(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.ImageEncoder = factory());
}(this, (function () { 'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function null_to_empty(value) {
        return value == null ? '' : value;
    }
    function action_destroyer(action_result) {
        return action_result && is_function(action_result.destroy) ? action_result.destroy : noop;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    var prefixMap = {
      pointerdown: 'MSPointerDown',
      pointerup: 'MSPointerUp',
      pointercancel: 'MSPointerCancel',
      pointermove: 'MSPointerMove',
      pointerover: 'MSPointerOver',
      pointerout: 'MSPointerOut',
      pointerenter: 'MSPointerEnter',
      pointerleave: 'MSPointerLeave',
      gotpointercapture: 'MSGotPointerCapture',
      lostpointercapture: 'MSLostPointerCapture',
      maxTouchPoints: 'msMaxTouchPoints'
    };

    /*
     * detectPointerEvents object structure
     * const detectPointerEvents = {
     *   hasApi: boolean,
     *   requiresPrefix: boolean,
     *   hasTouch: boolean,
     *   maxTouchPoints: number,
     *   update() {...},
     *   prefix(value) {return value, value will only have prefix if requiresPrefix === true},
     * }
     */
    var detectPointerEvents = {
      update: function update() {
        if (typeof window !== 'undefined') {
          // reference for detection https://msdn.microsoft.com/en-us/library/dn433244(v=vs.85).aspx
          if ('PointerEvent' in window) {
            detectPointerEvents.hasApi = true;
            detectPointerEvents.requiresPrefix = false;

            // reference for detection https://msdn.microsoft.com/library/hh673557(v=vs.85).aspx
          } else if (window.navigator && 'msPointerEnabled' in window.navigator) {
            detectPointerEvents.hasApi = true;
            detectPointerEvents.requiresPrefix = true;
          } else {
            detectPointerEvents.hasApi = false;
            detectPointerEvents.requiresPrefix = undefined;
          }
          detectPointerEvents.maxTouchPoints = detectPointerEvents.hasApi && window.navigator && window.navigator[detectPointerEvents.prefix('maxTouchPoints')] || undefined;
          detectPointerEvents.hasTouch = detectPointerEvents.hasApi ? detectPointerEvents.maxTouchPoints > 0 : undefined;
        }
      },
      prefix: function prefix(value) {
        return detectPointerEvents.requiresPrefix && prefixMap[value] || value;
      }
    };

    detectPointerEvents.update();
    var _default = detectPointerEvents;

    // Firefox resets some properties in stored/cached
    // Event objects when new events are fired so
    // we have to store a clone.
    // TODO: Should we store the original object when using Chrome?
    function iterationCopy(src) {
        let target = {};
        for (let prop in src) {
            target[prop] = src[prop];
        }
        return target;
    }
    function updateScale(transform, s, x, y) {
        const minScale = transform.getMinScale();
        const scale = transform.getScale();
        if (s < minScale)
            s = minScale;
        let offsetX = transform.getOffsetX();
        let offsetY = transform.getOffsetY();
        offsetX = s * (offsetX + x) / scale - x;
        offsetY = s * (offsetY + y) / scale - y;
        transform.setOffsetX(offsetX);
        transform.setOffsetY(offsetY);
        transform.setScale(s);
    }
    function simpleDragZoom(e, scaleOrigin, transform) {
        if (e.shiftKey) { //scale
            if (!scaleOrigin)
                scaleOrigin = { x: e.offsetX, y: e.offsetY, s: transform.getScale() };
            updateScale(transform, scaleOrigin.s + (scaleOrigin.y - e.offsetY) / 50, scaleOrigin.x, scaleOrigin.y);
        }
        else { //drag
            scaleOrigin = null;
            let offsetX = transform.getOffsetX();
            let offsetY = transform.getOffsetY();
            offsetX -= e.movementX;
            offsetY -= e.movementY;
            transform.setOffsetX(offsetX);
            transform.setOffsetY(offsetY);
        }
        return scaleOrigin;
    }
    function withPointers(node, transform) {
        function rescaleWithWheel(e) {
            e.preventDefault();
            e.cancelBubble = true;
            const delta = Math.sign(e.deltaY);
            updateScale(transform, transform.getScale() - delta / 10, e.offsetX, e.offsetY);
        }
        // pointer event cache
        const pointers = [];
        function storeEvent(ev) {
            for (var i = 0; i < pointers.length; i++) {
                if (pointers[i].pointerId === ev.pointerId) {
                    const ev2 = iterationCopy(ev);
                    pointers[i] = ev2;
                    break;
                }
            }
            if (i === pointers.length)
                pointers.push(ev);
        }
        function removeEvent(ev) {
            for (var i = 0; i < pointers.length; i++) {
                if (pointers[i].pointerId === ev.pointerId) {
                    pointers.splice(i, 1);
                    break;
                }
            }
        }
        let scaleOrigin = null;
        function startDrag(e) {
            node.setPointerCapture(e.pointerId);
            if (!transform.getDragging()) {
                node.addEventListener(_default.prefix('pointermove'), drag, true);
                transform.setDragging(true);
            }
            e.preventDefault();
            e.cancelBubble = true;
            storeEvent(e);
        }
        function drag(e) {
            if (pointers.length === 1) {
                scaleOrigin = simpleDragZoom(e, scaleOrigin, transform);
            }
            else if (pointers.length === 2) { //scale
                const x0 = pointers[0].offsetX;
                const y0 = pointers[0].offsetY;
                const x1 = pointers[1].offsetX;
                const y1 = pointers[1].offsetY;
                const x2 = e.offsetX;
                const y2 = e.offsetY;
                const dx = x0 - x1;
                const dy = y0 - y1;
                const l1 = Math.sqrt(dx * dx + dy * dy);
                let dx1, dy1;
                if (e.pointerId === pointers[0].pointerId) {
                    dx1 = x2 - x1;
                    dy1 = y2 - y1;
                }
                else {
                    dx1 = x2 - x0;
                    dy1 = y2 - y0;
                }
                var l2 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
                updateScale(transform, transform.getScale() * l2 / l1, x2, y2);
            }
            e.preventDefault();
            e.cancelBubble = true;
            storeEvent(e);
        }
        function stopDrag(e) {
            e.preventDefault();
            e.cancelBubble = true;
            removeEvent(e);
            node.releasePointerCapture(e.pointerId);
            if (pointers.length === 0) {
                transform.setDragging(false);
                node.removeEventListener(_default.prefix('pointermove'), drag, true);
                scaleOrigin = null;
            }
        }
        node.addEventListener(_default.prefix('pointerdown'), startDrag, true);
        node.addEventListener(_default.prefix('pointerup'), stopDrag, true);
        node.addEventListener('wheel', rescaleWithWheel, true);
        return {
            destroy: () => {
                node.removeEventListener(_default.prefix('pointerdown'), startDrag, true);
                node.removeEventListener(_default.prefix('pointerup'), stopDrag, true);
                node.removeEventListener('wheel', rescaleWithWheel, true);
            },
        };
    }
    function withMouse(node, transform) {
        function rescaleWithWheel(e) {
            e.preventDefault();
            e.cancelBubble = true;
            const delta = Math.sign(e.deltaY);
            updateScale(transform, transform.getScale() - delta / 10, e.offsetX, e.offsetY);
        }
        let scaleOrigin = null;
        function startDrag(e) {
            if (typeof node.setCapture === 'function')
                node.setCapture();
            if (!transform.getDragging()) {
                node.addEventListener('mousemove', drag, true);
                window.addEventListener('mouseup', stopDrag, true);
                transform.setDragging(true);
            }
            e.preventDefault();
            e.cancelBubble = true;
        }
        function drag(e) {
            scaleOrigin = simpleDragZoom(e, scaleOrigin, transform);
            e.preventDefault();
            e.cancelBubble = true;
        }
        function stopDrag(e) {
            e.preventDefault();
            e.cancelBubble = true;
            if (typeof node.releaseCapture === 'function')
                node.releaseCapture();
            transform.setDragging(false);
            node.removeEventListener('mousemove', drag, true);
            window.removeEventListener('mouseup', stopDrag, true);
            scaleOrigin = null;
        }
        node.addEventListener('mousedown', startDrag, true);
        node.addEventListener('mouseup', stopDrag, true);
        node.addEventListener('wheel', rescaleWithWheel, true);
        return {
            destroy: () => {
                node.removeEventListener('mousedown', startDrag, true);
                node.removeEventListener('mouseup', stopDrag, true);
                node.removeEventListener('wheel', rescaleWithWheel, true);
            },
        };
    }
    const runningInBrowser = typeof window !== 'undefined';
    const usePointerEvents = runningInBrowser && !!_default.maxTouchPoints;
    const panHandler = usePointerEvents ? withPointers : withMouse;

    /* src/ImgEncoder.svelte generated by Svelte v3.31.0 */

    function add_css() {
    	var style = element("style");
    	style.id = "svelte-1phn27w-style";
    	style.textContent = "canvas.svelte-1phn27w{touch-action:none;position:relative}";
    	append(document.head, style);
    }

    function create_fragment(ctx) {
    	let canvas_1;
    	let canvas_1_class_value;
    	let panHandler_action;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			canvas_1 = element("canvas");
    			attr(canvas_1, "width", /*width*/ ctx[0]);
    			attr(canvas_1, "height", /*height*/ ctx[1]);
    			attr(canvas_1, "class", canvas_1_class_value = "" + (null_to_empty(/*classes*/ ctx[2]) + " svelte-1phn27w"));
    		},
    		m(target, anchor) {
    			insert(target, canvas_1, anchor);
    			/*canvas_1_binding*/ ctx[15](canvas_1);

    			if (!mounted) {
    				dispose = action_destroyer(panHandler_action = panHandler.call(null, canvas_1, /*transform*/ ctx[4]));
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*width*/ 1) {
    				attr(canvas_1, "width", /*width*/ ctx[0]);
    			}

    			if (dirty & /*height*/ 2) {
    				attr(canvas_1, "height", /*height*/ ctx[1]);
    			}

    			if (dirty & /*classes*/ 4 && canvas_1_class_value !== (canvas_1_class_value = "" + (null_to_empty(/*classes*/ ctx[2]) + " svelte-1phn27w"))) {
    				attr(canvas_1, "class", canvas_1_class_value);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(canvas_1);
    			/*canvas_1_binding*/ ctx[15](null);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	
    	let { src = "" } = $$props;
    	let { url = "" } = $$props;
    	let { quality = 0.5 } = $$props;
    	let { width = 256 } = $$props;
    	let { height = 256 } = $$props;
    	let { realTime = false } = $$props;
    	let { crossOrigin = false } = $$props;
    	let { classes = "" } = $$props;

    	//export let showResult = true;
    	//TODO: add support for optionally showing compressed result instead of original
    	let canvas;

    	let img;
    	let ctx;
    	let offsetX = 0;
    	let offsetY = 0;
    	let scale = 1;
    	let minScale = 1;
    	let dragging = false;

    	// not a POJO because getters/setters are instrumentable by Svelte
    	// and `transform` is updated by imported functions
    	let transform = {
    		getMinScale() {
    			return minScale;
    		},
    		getScale() {
    			return scale;
    		},
    		setScale(s) {
    			$$invalidate(14, scale = s);
    		},
    		getOffsetX() {
    			return offsetX;
    		},
    		getOffsetY() {
    			return offsetY;
    		},
    		setOffsetX(ox) {
    			$$invalidate(12, offsetX = ox);
    		},
    		setOffsetY(oy) {
    			$$invalidate(13, offsetY = oy);
    		},
    		setDragging(d) {
    			if (!realTime && d === false) $$invalidate(5, url = canvas.toDataURL("image/jpeg", quality));
    			dragging = d;
    		},
    		getDragging() {
    			return dragging;
    		}
    	};

    	function redraw(img, ctx, quality, width, height, offsetXUpdate, offsetYUpdate, scale) {
    		if (!img || !ctx) return;
    		$$invalidate(12, offsetX = offsetXUpdate < 0 ? 0 : offsetXUpdate);
    		$$invalidate(13, offsetY = offsetYUpdate < 0 ? 0 : offsetYUpdate);
    		let limit = img.width * scale - width;
    		if (offsetX > limit) $$invalidate(12, offsetX = limit);
    		limit = img.height * scale - height;
    		if (offsetY > limit) $$invalidate(13, offsetY = limit);
    		ctx.resetTransform();
    		ctx.clearRect(0, 0, width, height);
    		ctx.translate(-offsetX, -offsetY);
    		ctx.scale(scale, scale);
    		ctx.drawImage(img, 0, 0);
    		if (realTime || !dragging) $$invalidate(5, url = canvas.toDataURL("image/jpeg", quality));
    	}

    	onMount(() => {
    		$$invalidate(11, ctx = canvas.getContext("2d"));
    		$$invalidate(10, img = new Image());

    		$$invalidate(
    			10,
    			img.onload = function () {
    				$$invalidate(12, offsetX = 0);
    				$$invalidate(13, offsetY = 0);
    				$$invalidate(14, scale = minScale = Math.max(width / img.width, height / img.height));
    			},
    			img
    		);
    	});

    	function canvas_1_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			canvas = $$value;
    			$$invalidate(3, canvas);
    		});
    	}

    	$$self.$$set = $$props => {
    		if ("src" in $$props) $$invalidate(6, src = $$props.src);
    		if ("url" in $$props) $$invalidate(5, url = $$props.url);
    		if ("quality" in $$props) $$invalidate(7, quality = $$props.quality);
    		if ("width" in $$props) $$invalidate(0, width = $$props.width);
    		if ("height" in $$props) $$invalidate(1, height = $$props.height);
    		if ("realTime" in $$props) $$invalidate(8, realTime = $$props.realTime);
    		if ("crossOrigin" in $$props) $$invalidate(9, crossOrigin = $$props.crossOrigin);
    		if ("classes" in $$props) $$invalidate(2, classes = $$props.classes);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*img, crossOrigin*/ 1536) {
    			 img && $$invalidate(10, img.crossOrigin = crossOrigin ? "anonymous" : null, img);
    		}

    		if ($$self.$$.dirty & /*img, src*/ 1088) {
    			 img && $$invalidate(10, img.src = src, img);
    		}

    		if ($$self.$$.dirty & /*img, ctx, quality, width, height, offsetX, offsetY, scale*/ 31875) {
    			 redraw(img, ctx, quality, width, height, offsetX, offsetY, scale);
    		}
    	};

    	return [
    		width,
    		height,
    		classes,
    		canvas,
    		transform,
    		url,
    		src,
    		quality,
    		realTime,
    		crossOrigin,
    		img,
    		ctx,
    		offsetX,
    		offsetY,
    		scale,
    		canvas_1_binding
    	];
    }

    class ImgEncoder extends SvelteComponent {
    	constructor(options) {
    		super();
    		if (!document.getElementById("svelte-1phn27w-style")) add_css();

    		init(this, options, instance, create_fragment, safe_not_equal, {
    			src: 6,
    			url: 5,
    			quality: 7,
    			width: 0,
    			height: 1,
    			realTime: 8,
    			crossOrigin: 9,
    			classes: 2
    		});
    	}
    }

    return ImgEncoder;

})));
//# sourceMappingURL=index.umd.js.map
