export const INSPECTOR_SCRIPT = `<script data-hudai-inspector>
(function() {
  var active = false;

  // Create highlight overlay
  var overlay = document.createElement('div');
  overlay.id = '__hudai_overlay';
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3a7ca5;background:rgba(58,124,165,0.12);display:none;transition:all 60ms ease-out;';
  document.documentElement.appendChild(overlay);

  // Create label
  var label = document.createElement('div');
  label.id = '__hudai_label';
  label.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#0a0e17ee;color:#7ec8e3;font:600 11px/1.4 monospace;padding:2px 7px;border-radius:3px;border:1px solid #3a7ca540;display:none;white-space:nowrap;';
  document.documentElement.appendChild(label);

  function getReactFiber(el) {
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) {
        return el[keys[i]];
      }
    }
    return null;
  }

  function getComponentName(el) {
    var fiber = getReactFiber(el);
    if (!fiber) return null;
    var node = fiber;
    while (node) {
      if (node.type && typeof node.type === 'function') {
        return node.type.displayName || node.type.name || null;
      }
      if (node.type && typeof node.type === 'object' && node.type.$$typeof) {
        var inner = node.type.render || node.type.type;
        if (inner && (inner.displayName || inner.name)) {
          return inner.displayName || inner.name;
        }
      }
      node = node.return;
    }
    return null;
  }

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    var parts = [];
    var current = el;
    for (var depth = 0; depth < 3 && current && current !== document.body; depth++) {
      var tag = current.tagName.toLowerCase();
      if (current.className && typeof current.className === 'string') {
        var cls = current.className.trim().split(/\\s+/).slice(0, 2).join('.');
        if (cls) tag += '.' + cls;
      }
      parts.unshift(tag);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getTextPreview(el) {
    var text = (el.textContent || '').trim();
    return text.length > 80 ? text.substring(0, 80) + '...' : text;
  }

  // Mousemove: highlight + label
  document.addEventListener('mousemove', function(e) {
    if (!active) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === label) {
      overlay.style.display = 'none';
      label.style.display = 'none';
      return;
    }
    var rect = el.getBoundingClientRect();
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';

    var comp = getComponentName(el);
    var tag = el.tagName.toLowerCase();
    label.textContent = comp ? '<' + comp + '> (' + tag + ')' : '<' + tag + '>';
    label.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
    label.style.top = Math.max(0, rect.top - 22) + 'px';
    label.style.display = 'block';
  }, true);

  // Right-click: send inspect data to parent
  document.addEventListener('contextmenu', function(e) {
    if (!active) return;
    e.preventDefault();
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === label) return;
    var rect = el.getBoundingClientRect();
    var comp = getComponentName(el);
    window.parent.postMessage({
      type: '__hudai_inspect',
      componentName: comp || null,
      selector: getSelector(el),
      tag: el.tagName.toLowerCase(),
      text: getTextPreview(el),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }, '*');
  }, true);

  // Listen for toggle from parent
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === '__hudai_inspect_toggle') {
      active = !!e.data.active;
      if (!active) {
        overlay.style.display = 'none';
        label.style.display = 'none';
      }
    }
  });
})();
</script>`;
