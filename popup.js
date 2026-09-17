/**
 * SOCKS5 代理插件 — Popup 逻辑
 * 从多代理列表中快速选择并应用
 */

document.addEventListener('DOMContentLoaded', init);

const els = {
  proxySelect: null,
  proxyHint: null,
  bypassList: null,
  btnEnable: null,
  btnDisable: null,
  statusDot: null,
  statusText: null,
  errorMsg: null,
  openOptions: null,
};

/** 内存缓存当前存储的代理列表 */
let cachedProxies = [];

function init() {
  els.proxySelect = document.getElementById('proxySelect');
  els.proxyHint = document.getElementById('proxyHint');
  els.bypassList = document.getElementById('bypassList');
  els.btnEnable = document.getElementById('btnEnable');
  els.btnDisable = document.getElementById('btnDisable');
  els.statusDot = document.getElementById('statusDot');
  els.statusText = document.getElementById('statusText');
  els.errorMsg = document.getElementById('errorMsg');
  els.openOptions = document.getElementById('openOptions');

  els.btnEnable.addEventListener('click', enableProxy);
  els.btnDisable.addEventListener('click', disableProxy);
  els.openOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // 切换下拉选项时刷新提示
  els.proxySelect.addEventListener('change', updateSelectionHint);

  loadState();

  // 监听存储变化（例如用户在 options 页面修改了列表）
  chrome.storage.onChanged.addListener(onStorageChanged);
}

/* ---------- 状态加载与渲染 ---------- */

async function loadState() {
  const state = await chrome.storage.local.get([
    'proxies',
    'activeProxyId',
    'proxyActive',
    'savedBypassList',
  ]);

  cachedProxies = state.proxies || [];

  renderProxyOptions(state.activeProxyId);
  updateStatusUI(!!state.proxyActive);

  if (state.savedBypassList) {
    els.bypassList.value = state.savedBypassList;
  } else {
    els.bypassList.value = 'localhost\n127.0.0.1\n*.local';
  }
}

function renderProxyOptions(activeId) {
  els.proxySelect.innerHTML = '';

  if (cachedProxies.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— 尚未配置 —';
    els.proxySelect.appendChild(opt);
    els.proxySelect.disabled = true;
    els.btnEnable.disabled = true;
    els.proxyHint.textContent = '请先到设置页添加代理服务器';
    els.proxyHint.classList.add('warn');
    return;
  }

  els.proxySelect.disabled = false;
  els.btnEnable.disabled = false;
  els.proxyHint.classList.remove('warn');

  for (const p of cachedProxies) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name}  (${p.host}:${p.port})`;
    if (p.id === activeId) opt.selected = true;
    els.proxySelect.appendChild(opt);
  }

  if (!els.proxySelect.value) {
    els.proxySelect.value = cachedProxies[0].id;
  }
  updateSelectionHint();
}

function updateSelectionHint() {
  const p = cachedProxies.find((x) => x.id === els.proxySelect.value);
  if (p) {
    els.proxyHint.textContent = `socks5://${p.host}:${p.port}`;
  } else {
    els.proxyHint.textContent = '选择一个代理服务器';
  }
}

function onStorageChanged(changes, area) {
  if (area !== 'local') return;
  if (changes.proxies) {
    cachedProxies = changes.proxies.newValue || [];
    renderProxyOptions(changes.activeProxyId?.newValue);
  }
  if (changes.proxyActive) {
    updateStatusUI(!!changes.proxyActive.newValue);
  }
}

/* ---------- UI 工具 ---------- */

function updateStatusUI(isActive) {
  els.statusDot.classList.toggle('active', isActive);
  els.statusText.textContent = isActive ? '代理已启用' : '未启用';
}

function showError(msg) {
  els.errorMsg.textContent = msg;
}

function clearError() {
  els.errorMsg.textContent = '';
}

/* ---------- 代理应用 ---------- */

function parseBypassList(raw) {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function enableProxy() {
  clearError();

  const proxyId = els.proxySelect.value;
  const proxy = cachedProxies.find((p) => p.id === proxyId);
  if (!proxy) {
    showError('请先选择一个代理服务器');
    return;
  }

  const bypassList = parseBypassList(els.bypassList.value);

  chrome.runtime.sendMessage(
    {
      action: 'enableProxy',
      proxy: { host: proxy.host, port: proxy.port },
      bypassList,
    },
    async (response) => {
      if (chrome.runtime.lastError) {
        showError('通信失败：' + chrome.runtime.lastError.message);
        return;
      }
      if (response?.success) {
        await chrome.storage.local.set({
          activeProxyId: proxyId,
          savedBypassList: els.bypassList.value.trim(),
        });
        updateStatusUI(true);
      } else {
        showError(response?.error || '启用失败');
      }
    }
  );
}

function disableProxy() {
  clearError();

  chrome.runtime.sendMessage({ action: 'disableProxy' }, (response) => {
    if (chrome.runtime.lastError) {
      showError('通信失败：' + chrome.runtime.lastError.message);
      return;
    }
    if (response?.success) {
      updateStatusUI(false);
    } else {
      showError(response?.error || '关闭失败');
    }
  });
}