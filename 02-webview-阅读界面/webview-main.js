// @ts-check
/**
 * YAML Reader — 左树右源码 + 实用增强
 * - 复制路径 / 值 / JSON
 * - 格式化、换行、记忆分栏宽度
 * - ⌘/Ctrl+F 聚焦搜索
 */
(function () {
  'use strict';

  var vscodeApi =
    typeof acquireVsCodeApi === 'function'
      ? acquireVsCodeApi()
      : {
          postMessage: function () {},
          setState: function () {},
          getState: function () {
            return undefined;
          },
        };

  var saved = vscodeApi.getState() || {};

  var sourceEl = document.getElementById('yaml-source');
  var treeEl = document.getElementById('yaml-tree');
  var errorEl = document.getElementById('yaml-error');
  var searchEl = document.getElementById('yaml-search');
  var searchClear = document.getElementById('yaml-search-clear');
  var metaEl = document.getElementById('yaml-meta');
  var toolbarEl = document.getElementById('yaml-toolbar');
  var breadcrumbEl = document.getElementById('yaml-breadcrumb');
  var expandBtn = document.getElementById('yaml-expand-all');
  var collapseBtn = document.getElementById('yaml-collapse-all');
  var formatBtn = document.getElementById('yaml-format');
  var wrapBtn = document.getElementById('yaml-wrap');
  var splitter = document.getElementById('yaml-splitter');
  var mainEl = document.getElementById('yaml-main');
  var tabButtons = document.querySelectorAll('.yaml-tabs [data-mode]');

  /** @type {'split' | 'source' | 'tree'} */
  var mode = 'split';
  /** @type {any} */
  var lastParse = null;
  /** @type {any} */
  var lastGoodParse = null;
  var defaultExpandDepth = 2;
  var sourceEditTimer = null;
  var applyingSource = false;
  /** @type {Set<string>} */
  var collapsedIds = new Set();
  var expandAllOverride = false;
  var collapseAllOverride = false;
  var selectedId = '';
  var wrapOn = !!saved.wrap;

  if (typeof saved.splitLeft === 'number') {
    document.documentElement.style.setProperty('--split-left', saved.splitLeft + '%');
  }

  function persist() {
    var pct = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--split-left')
    );
    vscodeApi.setState({
      wrap: wrapOn,
      splitLeft: Number.isFinite(pct) ? pct : 42,
    });
  }

  function applyWrap() {
    if (!sourceEl) return;
    sourceEl.wrap = wrapOn ? 'soft' : 'off';
    sourceEl.classList.toggle('is-wrap', wrapOn);
    if (wrapBtn) {
      wrapBtn.classList.toggle('is-active', wrapOn);
      wrapBtn.title = wrapOn ? '关闭自动换行' : '源码自动换行';
    }
  }

  function normalizeMode(raw) {
    if (raw === 'source') return 'source';
    if (raw === 'tree' || raw === 'preview') return 'tree';
    if (raw === 'split' || raw === 'both') return 'split';
    return null;
  }

  function setMode(next, opts) {
    var normalized = normalizeMode(next);
    if (!normalized) return;
    mode = normalized;
    opts = opts || {};
    document.body.setAttribute('data-mode', mode);

    // 源码模式仍显示工具条（格式化/换行），搜索区用 CSS 弱化
    if (toolbarEl) toolbarEl.style.display = '';

    tabButtons.forEach(function (btn) {
      var m = btn.getAttribute('data-mode');
      var active = m === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    if (!opts.silent) {
      vscodeApi.postMessage({ type: 'setMode', mode: mode });
    }
  }

  function filterTree(nodes, query) {
    var q = (query || '').trim().toLowerCase();
    if (!q) return nodes;

    function clone(n) {
      return {
        id: n.id,
        key: n.key,
        type: n.type,
        valueText: n.valueText,
        path: n.path,
        children: (n.children || []).map(clone),
        childCount: n.childCount,
        truncated: n.truncated,
        range: n.range,
      };
    }

    function match(n) {
      var kids = (n.children || []).map(match).filter(Boolean);
      var self =
        (n.key && n.key.toLowerCase().indexOf(q) >= 0) ||
        (n.valueText && n.valueText.toLowerCase().indexOf(q) >= 0) ||
        (n.path && n.path.toLowerCase().indexOf(q) >= 0);
      if (self || kids.length) {
        var out = clone(n);
        out.children = self ? (n.children || []).map(clone) : kids;
        out._match = self;
        return out;
      }
      return null;
    }

    return (nodes || []).map(match).filter(Boolean);
  }

  function isContainer(type) {
    return type === 'object' || type === 'array' || type === 'document';
  }

  function shouldExpand(node, depth) {
    if (collapseAllOverride) return false;
    if (expandAllOverride) return true;
    if (collapsedIds.has(node.id)) return false;
    // 搜索时自动展开匹配链
    if (searchEl && searchEl.value.trim()) return true;
    return depth < defaultExpandDepth;
  }

  function setBreadcrumb(path) {
    if (!breadcrumbEl) return;
    if (!path) {
      breadcrumbEl.textContent = '';
      return;
    }
    breadcrumbEl.innerHTML = '';
    var parts = path.replace(/\[/g, '.[').split('.').filter(Boolean);
    parts.forEach(function (p, i) {
      if (i) {
        var sep = document.createElement('span');
        sep.textContent = ' › ';
        breadcrumbEl.appendChild(sep);
      }
      var seg = document.createElement('span');
      seg.className = 'seg';
      seg.textContent = p;
      breadcrumbEl.appendChild(seg);
    });
  }

  function revealInSource(range) {
    if (!sourceEl || !range || typeof range.start !== 'number') return;
    var start = Math.max(0, range.start);
    var end = Math.max(start, range.end || start);
    var len = sourceEl.value.length;
    start = Math.min(start, len);
    end = Math.min(end, len);
    try {
      sourceEl.focus();
      sourceEl.setSelectionRange(start, end);
      var before = sourceEl.value.slice(0, start);
      var lines = before.split('\n').length;
      sourceEl.scrollTop = Math.max(0, (lines - 4) * 19.5);
    } catch (_) {
      /* ignore */
    }
  }

  /** 树节点 → JS（与 host yamlParser.nodeToJs 对齐，供复制 JSON） */
  function nodeToJs(n) {
    if (n.type === 'object' || n.type === 'document') {
      var o = {};
      (n.children || []).forEach(function (c) {
        o[c.key] = nodeToJs(c);
      });
      return o;
    }
    if (n.type === 'array') {
      return (n.children || []).map(nodeToJs);
    }
    if (n.type === 'null') return null;
    if (n.type === 'boolean') return n.valueText === 'true';
    if (n.type === 'number') {
      var num = Number(n.valueText);
      return isFinite(num) ? num : n.valueText;
    }
    return n.valueText;
  }

  function copyPath(path) {
    if (!path) return;
    vscodeApi.postMessage({ type: 'copyPath', path: path });
  }

  function copyText(text, label) {
    vscodeApi.postMessage({ type: 'copyText', text: text, label: label || '已复制' });
  }

  function makeCopyMenu(node) {
    var wrap = document.createElement('span');
    wrap.className = 'yaml-copy-group';

    function addBtn(label, title, fn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'yaml-copy';
      b.title = title;
      b.textContent = label;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        fn();
      });
      wrap.appendChild(b);
    }

    if (node.path) {
      addBtn('路径', '复制路径', function () {
        copyPath(node.path);
      });
    }
    if (!isContainer(node.type) && node.type !== 'error') {
      addBtn('值', '复制值', function () {
        copyText(node.valueText, '已复制值');
      });
    }
    if (node.type !== 'error') {
      addBtn('JSON', '复制为 JSON', function () {
        try {
          copyText(JSON.stringify(nodeToJs(node), null, 2), '已复制 JSON');
        } catch (_) {
          copyText(String(node.valueText || ''), '已复制');
        }
      });
    }
    return wrap;
  }

  function renderNode(node, depth) {
    var container = isContainer(node.type);
    var expanded = container && shouldExpand(node, depth);
    var hasKids = container && node.children && node.children.length > 0;

    var li = document.createElement('li');
    li.className = 'yaml-node';
    li.setAttribute('role', 'treeitem');
    li.setAttribute('data-id', node.id);

    var row = document.createElement('div');
    row.className =
      'yaml-row' +
      (selectedId === node.id ? ' is-selected' : '') +
      (node._match ? ' is-match' : '');
    row.style.paddingLeft = depth * 12 + 4 + 'px';

    var twisty = document.createElement('button');
    twisty.type = 'button';
    twisty.className = 'yaml-twisty' + (container ? '' : ' is-leaf');
    twisty.tabIndex = -1;
    twisty.textContent = container ? (expanded ? '▼' : '▶') : '·';
    if (container) {
      twisty.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleCollapse(node.id);
      });
    }

    var keySpan = document.createElement('span');
    keySpan.className = 'yaml-key';
    keySpan.textContent = node.key;

    var typeSpan = document.createElement('span');
    typeSpan.className = 'yaml-type t-' + (node.type || 'unknown');
    typeSpan.textContent = node.type || '?';

    row.appendChild(twisty);
    row.appendChild(keySpan);
    row.appendChild(typeSpan);

    if (!container) {
      var colon = document.createElement('span');
      colon.className = 'yaml-colon';
      colon.textContent = ':';
      row.appendChild(colon);
      var valSpan = document.createElement('span');
      valSpan.className = 'yaml-value t-' + (node.type || 'unknown');
      valSpan.textContent =
        node.type === 'string' ? JSON.stringify(node.valueText) : node.valueText;
      row.appendChild(valSpan);
    } else {
      var countSpan = document.createElement('span');
      countSpan.className = 'yaml-count';
      var n = node.childCount != null ? node.childCount : (node.children || []).length;
      countSpan.textContent =
        (node.type === 'array' ? '[' : '{') +
        n +
        (node.type === 'array' ? ']' : '}') +
        (node.truncated ? '…' : '');
      row.appendChild(countSpan);
    }

    row.appendChild(makeCopyMenu(node));

    row.addEventListener('click', function () {
      selectedId = node.id;
      setBreadcrumb(node.path || node.key);
      document.querySelectorAll('.yaml-row.is-selected').forEach(function (el) {
        el.classList.remove('is-selected');
      });
      row.classList.add('is-selected');
      if (node.range) revealInSource(node.range);
    });

    row.addEventListener('dblclick', function (e) {
      if (container) {
        e.preventDefault();
        toggleCollapse(node.id);
      } else if (node.path) {
        copyPath(node.path);
      }
    });

    li.appendChild(row);

    if (container && hasKids && expanded) {
      var ul = document.createElement('ul');
      ul.className = 'yaml-children';
      ul.setAttribute('role', 'group');
      node.children.forEach(function (ch) {
        ul.appendChild(renderNode(ch, depth + 1));
      });
      li.appendChild(ul);
    }

    return li;
  }

  function toggleCollapse(id) {
    expandAllOverride = false;
    collapseAllOverride = false;
    if (collapsedIds.has(id)) collapsedIds.delete(id);
    else collapsedIds.add(id);
    rerenderTree();
  }

  function expandAll() {
    expandAllOverride = true;
    collapseAllOverride = false;
    collapsedIds.clear();
    rerenderTree();
  }

  function collapseAll() {
    expandAllOverride = false;
    collapseAllOverride = true;
    collapsedIds.clear();
    rerenderTree();
  }

  function updateSearchClear() {
    if (!searchClear || !searchEl) return;
    var has = !!searchEl.value.trim();
    searchClear.hidden = !has;
  }

  function rerenderTree() {
    if (!treeEl) return;
    treeEl.innerHTML = '';
    updateSearchClear();

    if (!lastParse && !lastGoodParse) {
      treeEl.innerHTML =
        '<div class="yaml-empty"><strong>结构</strong>打开 YAML 后在此浏览</div>';
      return;
    }

    if (lastParse && !lastParse.ok) {
      if (errorEl) {
        errorEl.hidden = false;
        var loc =
          lastParse.line != null
            ? ' (行 ' +
              lastParse.line +
              (lastParse.column != null ? ', 列 ' + lastParse.column : '') +
              ')'
            : '';
        errorEl.textContent =
          'YAML 解析失败' + loc + '：' + (lastParse.error || 'unknown');
      }
      if (metaEl) metaEl.textContent = lastGoodParse ? '解析失败 · 显示上次成功' : '解析失败';
      if (!lastGoodParse) {
        treeEl.innerHTML =
          '<div class="yaml-empty"><strong>无法解析</strong>请在右侧修正源码</div>';
        return;
      }
    } else if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }

    var treeSource = lastParse && lastParse.ok ? lastParse : lastGoodParse;
    if (!treeSource || !treeSource.ok) return;

    var query = searchEl ? searchEl.value : '';
    var roots = filterTree(treeSource.roots || [], query);

    if (!roots.length) {
      var empty = document.createElement('div');
      empty.className = 'yaml-empty';
      empty.innerHTML = query
        ? '<strong>无匹配</strong>试试其它关键字'
        : '<strong>空文档</strong>在右侧编辑源码';
      treeEl.appendChild(empty);
    } else {
      var ul = document.createElement('ul');
      ul.className = 'yaml-root';
      ul.setAttribute('role', 'group');
      roots.forEach(function (n) {
        ul.appendChild(renderNode(n, 0));
      });
      treeEl.appendChild(ul);
    }

    if (metaEl && lastParse && lastParse.ok) {
      var parts = ['节点 ' + (lastParse.nodeCount || 0)];
      if (lastParse.documentCount > 1) parts.push('文档 ' + lastParse.documentCount);
      if (lastParse.truncated) parts.push('已截断');
      if (query) parts.push('过滤中');
      metaEl.textContent = parts.join(' · ');
    }
  }

  function applyDocument(msg) {
    if (typeof msg.source === 'string' && sourceEl && !applyingSource) {
      if (sourceEl.value !== msg.source) {
        applyingSource = true;
        var st = sourceEl.selectionStart;
        var en = sourceEl.selectionEnd;
        var top = sourceEl.scrollTop;
        sourceEl.value = msg.source;
        try {
          if (document.activeElement === sourceEl) {
            var L = sourceEl.value.length;
            sourceEl.selectionStart = Math.min(st, L);
            sourceEl.selectionEnd = Math.min(en, L);
            sourceEl.scrollTop = top;
          }
        } catch (_) {}
        applyingSource = false;
      }
    }
    if (typeof msg.defaultExpandDepth === 'number') {
      defaultExpandDepth = msg.defaultExpandDepth;
    }
    lastParse = msg.parse;
    if (lastParse && lastParse.ok) lastGoodParse = lastParse;
    if (msg.mode) setMode(msg.mode, { silent: true });
    expandAllOverride = false;
    collapseAllOverride = false;
    collapsedIds.clear();
    rerenderTree();
  }

  function initSplitter() {
    if (!splitter || !mainEl) return;
    var dragging = false;

    function onMove(e) {
      if (!dragging) return;
      var rect = mainEl.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var pct = (x / rect.width) * 100;
      pct = Math.max(18, Math.min(70, pct));
      document.documentElement.style.setProperty('--split-left', pct + '%');
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-resizing');
      splitter.classList.remove('is-dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      persist();
    }

    splitter.addEventListener('mousedown', function (e) {
      e.preventDefault();
      dragging = true;
      document.body.classList.add('is-resizing');
      splitter.classList.add('is-dragging');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setMode(btn.getAttribute('data-mode'));
    });
  });

  if (sourceEl) {
    sourceEl.addEventListener('input', function () {
      if (applyingSource) return;
      if (sourceEditTimer) clearTimeout(sourceEditTimer);
      sourceEditTimer = setTimeout(function () {
        vscodeApi.postMessage({ type: 'sourceEdit', source: sourceEl.value });
      }, 180);
    });
  }

  if (searchEl) {
    searchEl.addEventListener('input', function () {
      rerenderTree();
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', function () {
      if (searchEl) searchEl.value = '';
      rerenderTree();
      if (searchEl) searchEl.focus();
    });
  }
  if (expandBtn) expandBtn.addEventListener('click', expandAll);
  if (collapseBtn) collapseBtn.addEventListener('click', collapseAll);
  if (formatBtn) {
    formatBtn.addEventListener('click', function () {
      vscodeApi.postMessage({
        type: 'formatYaml',
        source: sourceEl ? sourceEl.value : '',
      });
    });
  }
  if (wrapBtn) {
    wrapBtn.addEventListener('click', function () {
      wrapOn = !wrapOn;
      applyWrap();
      persist();
    });
  }

  // ⌘/Ctrl+F → 搜索；⌘/Ctrl+S 不拦截（交给宿主）
  window.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'f' || e.key === 'F')) {
      if (searchEl && mode !== 'source') {
        e.preventDefault();
        searchEl.focus();
        searchEl.select();
      }
    }
    if (mod && (e.key === 'l' || e.key === 'L') && e.shiftKey) {
      // Ctrl+Shift+L 格式化
      e.preventDefault();
      if (formatBtn) formatBtn.click();
    }
  });

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'updateDocument':
        applyDocument(msg);
        break;
      case 'setMode':
        setMode(msg.mode, { silent: true });
        break;
      case 'updateTheme':
        if (msg.themeClass) {
          document.body.classList.remove(
            'vscode-dark',
            'vscode-light',
            'vscode-high-contrast',
            'vscode-high-contrast-light'
          );
          document.body.classList.add(msg.themeClass);
        }
        break;
    }
  });

  applyWrap();
  initSplitter();
  setMode(document.body.getAttribute('data-mode') || 'split', { silent: true });
  vscodeApi.postMessage({ type: 'webviewReady' });

  window.YamlReaderWebview = {
    setMode: setMode,
    filterTree: filterTree,
    rerenderTree: rerenderTree,
    expandAll: expandAll,
    collapseAll: collapseAll,
    applyDocument: applyDocument,
    nodeToJs: nodeToJs,
    getLastParse: function () {
      return lastParse;
    },
  };
})();
