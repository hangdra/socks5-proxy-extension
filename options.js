/**
 * SOCKS5 代理插件 — Options 逻辑
 * 负责多代理服务器的增删改查 + 拖拽排序
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

  // ★ 拖拽排序
  els.list.addEventListener('dragstart', onDragStart);
  els.list.addEventListener('dragover', onDragOver);
  els.list.addEventListener('drop', onDrop);
  els.list.addEventListener('dragend', onDragEnd);

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
    // 更新现有条目（保持原位置不变）
    const idx = proxies.findIndex((p) => p.id === editingId);
    if (idx === -1) {
      els.formError.textContent = '该条目已不存在，请刷新重试';
      return;
    }
    proxies[idx] = { ...proxies[idx], id: editingId, name, host, port };
    await setProxies(proxies);
    showToast('已更新：' + name);
  } else {
    // 新增（追加到末尾）
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
    const item = document.createElement('div');
    item.className = 'proxy-item';
    item.dataset.id = proxy.id;

    // ★ 拖拽手柄（只有手柄可拖）
    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.draggable = true;
    handle.title = '按住拖动调整顺序';
    handle.textContent = '⠿';

    const info = document.createElement('div');
    info.className = 'proxy-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'proxy-name';
    nameEl.textContent = proxy.name;

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

    item.appendChild(handle);
    item.appendChild(info);
    item.appendChild(actions);
    els.list.appendChild(item);
  }
}

function findProxyInCache(id) {
  return listCache.find((p) => p.id === id);
}

/* ---------- ★ 拖拽排序 ---------- */

let dragItem = null;

function onDragStart(e) {
  const handle = e.target.closest && e.target.closest('.drag-handle');
  if (!handle) {
    // 非手柄区域的拖拽一律禁止
    e.preventDefault();
    return;
  }
  const item = handle.closest('.proxy-item');
  if (!item) return;

  dragItem = item;
  item.classList.add('dragging');

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    // 某些浏览器要求必须 setData 才认为拖拽有效
    e.dataTransfer.setData('text/plain', item.dataset.id);
    try {
      const rect = item.getBoundingClientRect();
      e.dataTransfer.setDragImage(
        item,
        Math.max(0, e.clientX - rect.left),
        Math.max(0, e.clientY - rect.top)
      );
    } catch (_) { /* 忽略 */ }
  }
}

function onDragOver(e) {
  if (!dragItem) return;
  e.preventDefault(); // 必须阻止默认行为才能 drop / 实时重排
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

  const after = getDragAfterElement(e.clientY);
  if (after == null) {
    if (els.list.lastElementChild !== dragItem) {
      els.list.appendChild(dragItem);
    }
  } else if (after !== dragItem) {
    els.list.insertBefore(dragItem, after);
  }
}

function onDrop(e) {
  if (dragItem) e.preventDefault();
}

/**
 * 找出「应该插入到它前面」的元素：
 * 所有中心点在指针下方、且离指针最近的那一个。
 * 返回 null 表示应放到末尾。
 */
function getDragAfterElement(y) {
  const items = Array.from(
    els.list.querySelectorAll('.proxy-item:not(.dragging)')
  );
  let closest = null;
  let closestOffset = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    const offset = y - rect.top - rect.height / 2;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = item;
    }
  }
  return closest;
}

async function onDragEnd() {
  if (!dragItem) return;
  dragItem.classList.remove('dragging');
  dragItem = null;
  await persistOrder();
}

/**
 * 把当前 DOM 顺序写回 storage。
 * 写入后会触发 storage.onChanged -> renderList()，DOM 会以新顺序重建。
 */
async function persistOrder() {
  const ids = Array.from(els.list.querySelectorAll('.proxy-item'))
    .map((el) => el.dataset.id);

  const proxies = await getProxies();
  const byId = new Map(proxies.map((p) => [p.id, p]));

  const ordered = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p) {
      ordered.push(p);
      byId.delete(id);
    }
  }
  // 兜底：DOM 中缺失的条目追加到末尾
  for (const p of byId.values()) ordered.push(p);

  // 顺序没变化就不写
  const same =
    ordered.length === proxies.length &&
    ordered.every((p, i) => p.id === proxies[i].id);
  if (same) return;

  listCache = ordered;
  await setProxies(ordered);
  showToast('顺序已保存');
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