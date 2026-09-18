/**
 * Popup — 针对当前标签页启用/取消代理
 */

document.addEventListener('DOMContentLoaded', init);

const els = {};
let currentTabId = null;
let cachedProxies = [];

async function init() {
  els.proxySelect = document.getElementById('proxySelect');
  els.proxyHint = document.getElementById('proxyHint');
  els.bypassList = document.getElementById('bypassList');
  els.btnEnable = document.getElementById('btnEnable');
  els.btnDisable = document.getElementById('btnDisable');
  els.statusDot = document.getElementById('statusDot');
  els.statusText = document.getElementById('statusText');
  els.errorMsg = document.getElementById('errorMsg');
  els.openOptions = document.getElementById('openOptions');

  els.btnEnable.addEventListener('click', onEnable);
  els.btnDisable.addEventListener('click', onDisable);
  els.openOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });
  els.proxySelect.addEventListener('change', updateSelectionHint);

  // 拿当前标签页
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab || tab.id == null) {
    showError('无法获取当前标签页');
    return;
  }
  currentTabId = tab.id;

  await loadState();
    // ★ 顺序 / 内容变化时实时刷新下拉框
  chrome.storage.onChanged.addListener(onStorageChanged);
}

async function loadState() {
  const data = await chrome.storage.local.get(['proxies', 'savedBypassList']);
  cachedProxies = data.proxies || [];

  renderProxyOptions();

  // 默认 bypass 规则
  els.bypassList.value =
    data.savedBypassList || 'localhost\n127.0.0.1\n*.local';

  // 查询当前标签页的代理状态
  chrome.runtime.sendMessage(
    { action: 'getTabProxyState', tabId: currentTabId },
    (res) => {
      if (chrome.runtime.lastError) return;
      if (!res || !res.success) return;

      if (res.enabled) {
        updateStatusUI(true);
        if (res.proxyId) els.proxySelect.value = res.proxyId;
        if (res.bypassList && res.bypassList.length) {
          els.bypassList.value = res.bypassList.join('\n');
        }
        els.btnEnable.textContent = '更新此标签页代理';
        els.btnDisable.disabled = false;
      } else {
        updateStatusUI(false);
        els.btnEnable.textContent = '为此标签页启用代理';
        els.btnDisable.disabled = true;
      }
      updateSelectionHint();
    }
  );
}

function renderProxyOptions() {
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
    els.proxySelect.appendChild(opt);
  }
  if (!els.proxySelect.value && cachedProxies[0]) {
    els.proxySelect.value = cachedProxies[0].id;
  }
}

function updateSelectionHint() {
  const p = cachedProxies.find((x) => x.id === els.proxySelect.value);
  els.proxyHint.textContent = p
    ? `socks5://${p.host}:${p.port}`
    : '选择一个代理服务器';
}

function updateStatusUI(isActive) {
  els.statusDot.classList.toggle('active', isActive);
  els.statusText.textContent = isActive
    ? '此标签页已启用代理'
    : '此标签页未启用代理';
}

function showError(msg) { els.errorMsg.textContent = msg; }
function clearError() { els.errorMsg.textContent = ''; }

function parseBypassList(raw) {
  return raw.split('\n').map((l) => l.trim()).filter(Boolean);
}

function onEnable() {
  clearError();
  const proxyId = els.proxySelect.value;
  if (!proxyId) { showError('请先选择一个代理服务器'); return; }
  const bypassList = parseBypassList(els.bypassList.value);

  chrome.runtime.sendMessage(
    { action: 'enableProxyForTab', tabId: currentTabId, proxyId, bypassList },
    (res) => {
      if (chrome.runtime.lastError) {
        showError('通信失败：' + chrome.runtime.lastError.message); return;
      }
      if (res && res.success) {
        chrome.storage.local.set({ savedBypassList: els.bypassList.value.trim() });
        updateStatusUI(true);
        els.btnEnable.textContent = '更新此标签页代理';
        els.btnDisable.disabled = false;
      } else {
        showError((res && res.error) || '启用失败');
      }
    }
  );
}

function onDisable() {
  clearError();
  chrome.runtime.sendMessage(
    { action: 'disableProxyForTab', tabId: currentTabId },
    (res) => {
      if (chrome.runtime.lastError) {
        showError('通信失败：' + chrome.runtime.lastError.message); return;
      }
      if (res && res.success) {
        updateStatusUI(false);
        els.btnEnable.textContent = '为此标签页启用代理';
        els.btnDisable.disabled = true;
      } else {
        showError((res && res.error) || '关闭失败');
      }
    }
  );
}

/**
 * options 页拖动排序或增删代理时，popup 若开着也同步刷新
 */
function onStorageChanged(changes, area) {
  if (area !== 'local' || !changes.proxies) return;

  const prevSelected = els.proxySelect.value;
  cachedProxies = changes.proxies.newValue || [];

  renderProxyOptions();

  // 尽量保留用户当前的选择
  if (prevSelected && cachedProxies.some((p) => p.id === prevSelected)) {
    els.proxySelect.value = prevSelected;
  }
  updateSelectionHint();
}