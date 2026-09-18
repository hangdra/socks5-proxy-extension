/**
 * SOCKS5 代理插件 — Background Service Worker
 * - 按标签页控制代理（活动标签页近似法）
 * - 动态切换工具栏图标：绿=已启用，灰=未启用
 */

const PROXIED_TABS_KEY = 'proxiedTabs';
const PROXIES_KEY = 'proxies';

let appliedKey = undefined;
let syncChain = Promise.resolve();

/* ============ ★ 图标生成与切换 ============ */

const ICON_ON_BG = '#22c55e';
const ICON_OFF_BG = '#9ca3af';
const ICON_SIZES = [16, 32, 48, 128];
const iconCache = new Map();

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 生成图标 ImageData（圆形底 + 白色锁）
 */
function makeIconData(size, isOn) {
  const key = size + (isOn ? '-on' : '-off');
  const cached = iconCache.get(key);
  if (cached) return cached;

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const r = size / 2;

  // 圆形底色
  ctx.fillStyle = isOn ? ICON_ON_BG : ICON_OFF_BG;
  ctx.beginPath();
  ctx.arc(r, r, r - size * 0.04, 0, Math.PI * 2);
  ctx.fill();

  // 锁体（圆角矩形）
  ctx.fillStyle = '#ffffff';
  const lockW = size * 0.42;
  const lockH = size * 0.34;
  const lockX = (size - lockW) / 2;
  const lockY = size * 0.46;
  roundRectPath(ctx, lockX, lockY, lockW, lockH, size * 0.07);
  ctx.fill();

  // 锁梁（半圆）
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, size * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(r, lockY, size * 0.15, Math.PI, 0);
  ctx.stroke();

  const data = ctx.getImageData(0, 0, size, size);
  iconCache.set(key, data);
  return data;
}

function buildIconImageSet(isOn) {
  const set = {};
  for (const size of ICON_SIZES) {
    set[size] = makeIconData(size, isOn);
  }
  return set;
}

/**
 * 为指定标签页设置图标与 tooltip
 */
function setTabIcon(tabId, isOn) {
  if (tabId == null || !Number.isFinite(tabId)) return;
  try {
    chrome.action.setIcon({ tabId, imageData: buildIconImageSet(isOn) });
    chrome.action.setTitle({
      tabId,
      title: isOn ? 'SOCKS5 代理 · 已启用' : 'SOCKS5 代理 · 未启用',
    });
  } catch (err) {
    console.error('[SOCKS5 Proxy] setIcon failed:', err);
  }
}

async function refreshTabIcon(tabId) {
  if (tabId == null) return;
  const proxied = await getProxiedTabs();
  setTabIcon(tabId, !!proxied[String(tabId)]);
}

async function refreshAllTabIcons() {
  try {
    const [tabs, proxied] = await Promise.all([
      chrome.tabs.query({}),
      getProxiedTabs(),
    ]);
    for (const tab of tabs) {
      if (tab.id == null) continue;
      setTabIcon(tab.id, !!proxied[String(tab.id)]);
    }
  } catch (err) {
    console.error('[SOCKS5 Proxy] refreshAllTabIcons:', err);
  }
}

/* ============ 存储读写（同前） ============ */

async function getProxiedTabs() {
  const data = await chrome.storage.local.get(PROXIED_TABS_KEY);
  return data[PROXIED_TABS_KEY] || {};
}

async function setProxiedTabs(tabs) {
  await chrome.storage.local.set({ [PROXIED_TABS_KEY]: tabs });
}

async function getProxies() {
  const data = await chrome.storage.local.get(PROXIES_KEY);
  return data[PROXIES_KEY] || [];
}

/* ============ 底层 proxy API（同前） ============ */

function configKey(host, port, bypassList) {
  return `${host}:${port}|${(bypassList || []).join('|')}`;
}

function getActualProxyState() {
  return new Promise((resolve) => {
    chrome.proxy.settings.get({ incognito: false }, (details) => {
      const v = details && details.value;
      if (
        v && v.mode === 'fixed_servers' && v.rules &&
        v.rules.singleProxy && v.rules.singleProxy.scheme === 'socks5'
      ) {
        const p = v.rules.singleProxy;
        resolve({
          host: p.host,
          port: p.port,
          bypassList: v.rules.bypassList || [],
        });
      } else {
        resolve(null);
      }
    });
  });
}

function setGlobalProxy(host, port, bypassList) {
  return new Promise((resolve, reject) => {
    const config = {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme: 'socks5', host, port },
        bypassList:
          bypassList && bypassList.length > 0 ? bypassList : ['<local>'],
      },
    };
    chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else resolve();
    });
  });
}

function clearGlobalProxy() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.clear({ scope: 'regular' }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else resolve();
    });
  });
}

async function ensureProxy(target) {
  const targetKey = target
    ? configKey(target.host, target.port, target.bypassList)
    : null;

  if (appliedKey === undefined) {
    const actual = await getActualProxyState();
    appliedKey = actual
      ? configKey(actual.host, actual.port, actual.bypassList)
      : null;
  }

  if (appliedKey === targetKey) return;

  if (targetKey === null) await clearGlobalProxy();
  else await setGlobalProxy(target.host, target.port, target.bypassList);

  appliedKey = targetKey;
  await chrome.storage.local.set({ proxyActive: appliedKey !== null });
}

/* ============ 活动标签页同步（同前） ============ */

async function findActiveTab() {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tabs[0]) return tabs[0];
  } catch (_) {}
  try {
    const tabs = await chrome.tabs.query({ active: true });
    if (tabs[0]) return tabs[0];
  } catch (_) {}
  return null;
}

async function doSync() {
  const activeTab = await findActiveTab();

  if (!activeTab || activeTab.id == null) {
    await ensureProxy(null);
    return;
  }

  const proxied = await getProxiedTabs();
  const config = proxied[String(activeTab.id)];

  if (!config) {
    await ensureProxy(null);
    return;
  }

  const proxies = await getProxies();
  const proxy = proxies.find((p) => p.id === config.proxyId);

  if (!proxy) {
    delete proxied[String(activeTab.id)];
    await setProxiedTabs(proxied);
    await ensureProxy(null);
    // ★ 配置失效也顺手更新图标
    setTabIcon(activeTab.id, false);
    return;
  }

  await ensureProxy({
    host: proxy.host,
    port: proxy.port,
    bypassList: config.bypassList,
  });
}

function syncProxyToActiveTab() {
  syncChain = syncChain
    .then(() => doSync())
    .catch((err) => console.error('[SOCKS5 Proxy] sync failed:', err));
  return syncChain;
}

/* ============ 事件监听 ============ */

chrome.tabs.onActivated.addListener(() => {
  syncProxyToActiveTab();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    syncProxyToActiveTab();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const proxied = await getProxiedTabs();
  if (proxied[String(tabId)]) {
    delete proxied[String(tabId)];
    await setProxiedTabs(proxied);
    syncProxyToActiveTab();
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;

  // ---------- proxiedTabs 变化：只刷受影响的标签页 ----------
  if (changes[PROXIED_TABS_KEY]) {
    const oldVal = changes[PROXIED_TABS_KEY].oldValue || {};
    const newVal = changes[PROXIED_TABS_KEY].newValue || {};
    const affected = new Set([
      ...Object.keys(oldVal),
      ...Object.keys(newVal),
    ]);
    for (const tabIdStr of affected) {
      const tabId = Number(tabIdStr);
      if (!Number.isFinite(tabId)) continue;
      setTabIcon(tabId, !!newVal[tabIdStr]);
    }
  }

  // ---------- proxies 变化：清理 + 全量刷新图标 ----------
  if (changes[PROXIES_KEY]) {
    const proxies = changes[PROXIES_KEY].newValue || [];
    const validIds = new Set(proxies.map((p) => p.id));
    const proxied = await getProxiedTabs();
    let changed = false;
    for (const [tabId, cfg] of Object.entries(proxied)) {
      if (!validIds.has(cfg.proxyId)) {
        delete proxied[tabId];
        changed = true;
      }
    }
    if (changed) {
      await setProxiedTabs(proxied);
      // setProxiedTabs 会再次触发本监听器，图标会在那里被刷新，
      // 这里不需要额外做一次。
    } else {
      // 未清理任何东西，但已有代理配置可能被编辑（改 host/port），
      // 已代理的标签页图标状态虽没变，仍需确保图标在位。
      await refreshAllTabIcons();
    }
    syncProxyToActiveTab();
  }
});

/* ============ 消息处理 ============ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'enableProxyForTab': {
          const tabId = message.tabId;
          if (tabId == null) throw new Error('缺少 tabId');

          const proxies = await getProxies();
          const proxy = proxies.find((p) => p.id === message.proxyId);
          if (!proxy) throw new Error('代理配置不存在');

          const proxied = await getProxiedTabs();
          proxied[String(tabId)] = {
            proxyId: message.proxyId,
            bypassList: message.bypassList || [],
          };
          await setProxiedTabs(proxied);   // ← 图标由 storage.onChanged 负责刷新

          await syncProxyToActiveTab();
          sendResponse({ success: true });
          break;
        }

        case 'disableProxyForTab': {
          const tabId = message.tabId;
          if (tabId == null) throw new Error('缺少 tabId');

          const proxied = await getProxiedTabs();
          delete proxied[String(tabId)];
          await setProxiedTabs(proxied);   // ← 同上

          await syncProxyToActiveTab();
          sendResponse({ success: true });
          break;
        }

        case 'getTabProxyState': {
          const tabId = message.tabId;
          if (tabId == null) throw new Error('缺少 tabId');

          const proxied = await getProxiedTabs();
          const config = proxied[String(tabId)];
          if (!config) {
            sendResponse({ success: true, enabled: false });
            break;
          }
          const proxies = await getProxies();
          const proxy = proxies.find((p) => p.id === config.proxyId);
          sendResponse({
            success: true,
            enabled: true,
            proxyId: config.proxyId,
            proxy: proxy || null,
            bypassList: config.bypassList || [],
          });
          break;
        }

        default:
          sendResponse({
            success: false,
            error: '未知操作: ' + message.action,
          });
      }
    } catch (err) {
      sendResponse({
        success: false,
        error: (err && err.message) || String(err),
      });
    }
  })();
  return true;
});

/* ============ SW 启动时清理、同步、刷图标 ============ */

(async function bootstrap() {
  // 清理存储里已经消失的 tabId
  try {
    const tabs = await chrome.tabs.query({});
    const validIds = new Set(tabs.map((t) => String(t.id)));
    const proxied = await getProxiedTabs();
    let changed = false;
    for (const id of Object.keys(proxied)) {
      if (!validIds.has(id)) {
        delete proxied[id];
        changed = true;
      }
    }
    if (changed) await setProxiedTabs(proxied);
  } catch (_) {}

  // SW 重启后 Chrome 会丢失之前 setIcon 的设置，需要重刷一遍
  await refreshAllTabIcons();   // ★
  await syncProxyToActiveTab();
})();