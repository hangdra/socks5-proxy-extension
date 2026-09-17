/**
 * SOCKS5 代理插件 — Options 逻辑
 * 负责多代理服务器的增删改查
 */

document.addEventListener('DOMContentLoaded', init);

const els = {};
let editingId = null;

function init() {
  els.form = document.getElementById('proxyForm');
  els.formTitle = document.getElementById('formTitle');
  els.editId = document.getElementById('editId');
  els.name = document.getElementById('name');
  els.host = document.getElementById('host');
  els.port = document.getElementById('port');
  els.btnSave = document.getElementById('btnSave');
  els.btnCancel = document.getElementById('btnCancel');
  els.formError = document.getElementById('formError');
  els.list = document.getElementById('proxyList');
  els.countBadge = document.getElementById('countBadge');
  els.toast = document.getElementById('toast');

  els.form.addEventListener('submit', onSubmit);
  els.btnCancel.addEventListener('click', resetForm);
  els.list.addEventListener('click', onListClick);

  // 实时同步：popup 切换代理时更新“使用中”标记
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.proxies) {
      renderList();
    }
  });

  renderList();
}

/* ---------- 存储读写 ---------- */

async function getProxies() {
  const { proxies } = await chrome.storage.local.get('proxies');
  return proxies || [];
}

async function setProxies(proxies) {
  await chrome.storage.local.set({ proxies });
}

async function getActiveId() {
  const { activeProxyId } = await chrome.storage.local.get('activeProxyId');
  return activeProxyId || null;
}

/* ---------- 表单处理 ---------- */

function validate({ name, host, port }) {
  if (!name) return '请填写名称';
  if (!host) return '请填写代理地址';
  // 简单校验 host，不含空格或斜杠
  if (/[\s/]/.test(host)) return '代理地址不能包含空格或斜杠';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return '端口必须是 1~65535 之间的整数';
  }
  return null;
}

async function onSubmit(e) {
  e.preventDefault();
  els.formError.textContent = '';

  const name = els.name.value.trim();
  const host = els.host.value.trim();
  const port = parseInt(els.port.value, 10);

  const err = validate({ name, host, port });
  if (err) {
    els.formError.textContent = err;
    return;
  }

  const proxies = await getProxies();

  if (editingId) {
    // 更新现有条目
    const idx = proxies.findIndex((p) => p.id === editingId);
    if (idx === -1) {
      els.formError.textContent = '该条目已不存在，请刷新重试';
      return;
    }
    proxies[idx] = { id: editingId, name, host, port };
    await setProxies(proxies);
    showToast('已更新：' + name);
  } else {
    // 新增
    const newProxy = {
      id: crypto.randomUUID(),
      name,
      host,
      port,
    };
    proxies.push(newProxy);
    await setProxies(proxies);
    showToast('已添加：' + name);
  }

  resetForm();
  renderList();
}

function resetForm() {
  editingId = null;
  els.form.reset();
  els.editId.value = '';
  els.formTitle.textContent = '添加代理服务器';
  els.btnSave.textContent = '添加';
  els.btnCancel.classList.add('hidden');
  els.formError.textContent = '';
}

function startEdit(id) {
  const proxy = findProxyInCache(id);
  if (!proxy) return;

  editingId = id;
  els.name.value = proxy.name;
  els.host.value = proxy.host;
  els.port.value = proxy.port;
  els.editId.value = id;
  els.formTitle.textContent = '编辑代理服务器';
  els.btnSave.textContent = '保存修改';
  els.btnCancel.classList.remove('hidden');
  els.formError.textContent = '';
  els.name.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- 列表渲染 ---------- */

let listCache = [];

async function renderList() {
  listCache = await getProxies();
  const activeId = await getActiveId();

  els.countBadge.textContent = listCache.length;

  if (listCache.length === 0) {
    els.list.innerHTML =
      '<div class="empty">暂无代理服务器，请在上方添加</div>';
    return;
  }

  els.list.innerHTML = '';
  for (const proxy of listCache) {
    // const isActive = proxy.id === activeId;
    const item = document.createElement('div');
    item.className = 'proxy-item';
    item.dataset.id = proxy.id;

    const info = document.createElement('div');
    info.className = 'proxy-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'proxy-name';
    nameEl.textContent = proxy.name;
    // if (isActive) {
    //   const tag = document.createElement('span');
    //   tag.className = 'tag-active';
    //   tag.textContent = '使用中';
    //   nameEl.appendChild(tag);
    // }

    const addr = document.createElement('div');
    addr.className = 'proxy-addr';
    addr.textContent = `socks5://${proxy.host}:${proxy.port}`;

    info.appendChild(nameEl);
    info.appendChild(addr);

    const actions = document.createElement('div');
    actions.className = 'proxy-actions';

    const btnEdit = document.createElement('button');
    btnEdit.className = 'btn-icon edit';
    btnEdit.dataset.action = 'edit';
    btnEdit.textContent = '编辑';

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-icon delete';
    btnDelete.dataset.action = 'delete';
    btnDelete.textContent = '删除';

    actions.appendChild(btnEdit);
    actions.appendChild(btnDelete);

    item.appendChild(info);
    item.appendChild(actions);
    els.list.appendChild(item);
  }
}

function findProxyInCache(id) {
  return listCache.find((p) => p.id === id);
}

/* ---------- 列表交互 ---------- */

async function onListClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const item = btn.closest('.proxy-item');
  const id = item.dataset.id;
  const action = btn.dataset.action;

  if (action === 'edit') {
    startEdit(id);
  } else if (action === 'delete') {
    await deleteProxy(id);
  }
}

async function deleteProxy(id) {
  const proxy = findProxyInCache(id);
  if (!proxy) return;

  const ok = confirm(`确定要删除「${proxy.name}」吗？`);
  if (!ok) return;

  let proxies = await getProxies();
  proxies = proxies.filter((p) => p.id !== id);
  await setProxies(proxies);

  // 如果删除的是当前正在使用的代理，同时清除激活状态
  // const activeId = await getActiveId();
  // if (activeId === id) {
  //   await chrome.storage.local.set({ activeProxyId: null });
  //   // 通知后台关闭代理，避免指向已删除的配置
  //   chrome.runtime.sendMessage({ action: 'disableProxy' });
  // }

  // 若当前正在编辑该条目，重置表单
  if (editingId === id) resetForm();

  showToast('已删除：' + proxy.name);
  renderList();
}

/* ---------- Toast ---------- */

let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 1800);
}