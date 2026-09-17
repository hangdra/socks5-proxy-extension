/**
 * SOCKS5 代理插件 — Background Service Worker
 * 负责调用 chrome.proxy API 应用/清除代理设置
 */

// ---------- 应用代理 ----------

/**
 * 设置 SOCKS5 代理
 * @param {string} host - 代理服务器地址
 * @param {number} port - 代理服务器端口
 * @param {string[]} bypassList - 绕过代理的地址列表
 * @returns {Promise<void>}
 */
function setSocks5Proxy(host, port, bypassList = []) {
  return new Promise((resolve, reject) => {
    // Chrome proxy API 配置对象
    // fixed_servers 模式：所有流量走固定代理
    // fallbackProxy 指定兜底代理为 socks5
    const config = {
      mode: 'fixed_servers',
      rules: {
        // 单一代理覆盖所有协议，避免 HTTP/HTTPS/FTP 分流遗漏
        singleProxy: {
          scheme: 'socks5',
          host: host,
          port: port,
        },
        // 绕过列表：这些地址不走代理，直接连接
        bypassList: bypassList.length > 0 ? bypassList : ['<local>'],
      },
    };

    chrome.proxy.settings.set(
      { value: config, scope: 'regular' },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          // 标记代理已激活
          chrome.storage.local.set({ proxyActive: true });
          resolve();
        }
      }
    );
  });
}

// ---------- 清除代理 ----------

/**
 * 恢复为直连模式（清除代理设置）
 * @returns {Promise<void>}
 */
function clearProxy() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.clear({ scope: 'regular' }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        chrome.storage.local.set({ proxyActive: false });
        resolve();
      }
    });
  });
}

// ---------- 消息处理 ----------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'enableProxy') {
    const { host, port } = message.proxy;
    const bypassList = message.bypassList || [];

    setSocks5Proxy(host, port, bypassList)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));

    // 返回 true 表示异步 sendResponse
    return true;
  }

  if (message.action === 'disableProxy') {
    clearProxy()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));

    return true;
  }
});

// ---------- 扩展启动时恢复代理状态 ----------

// Service Worker 被激活时检查上次状态
chrome.storage.local.get(['proxyActive'], (result) => {
  if (result.proxyActive) {
    // 代理标记仍为激活，但浏览器重启后代理设置可能已重置
    // 这里不做自动恢复，由用户手动启用更安全
    chrome.storage.local.set({ proxyActive: false });
  }
});