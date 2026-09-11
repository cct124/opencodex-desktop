const invoke = window.__TAURI__.core.invoke;
const titles = { starting: '正在启动', ready: '正在加载界面', loaded: '代理正在运行', stopping: '正在停止代理', stopped: '代理已停止', error: '代理遇到问题', exiting: '正在退出应用' };
let currentStatus;
let importContent;
const importDialog = document.querySelector('#import-dialog');
document.querySelector('#import-existing').addEventListener('click', () => {
  importContent = undefined;
  document.querySelector('#import-description').textContent = `读取原有配置：${currentStatus?.source_config || ''}`;
  importDialog.showModal();
});
document.querySelector('#config-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 1024 * 1024) { document.querySelector('#action-error').textContent = '配置文件不能超过 1 MB。'; return; }
  importContent = await file.text();
  document.querySelector('#import-description').textContent = `使用 ${file.name} 替换桌面版配置；旧配置将自动备份。`;
  importDialog.showModal();
});
document.querySelector('#cancel-import').addEventListener('click', () => { importContent = undefined; importDialog.close(); });
document.querySelector('#confirm-import').addEventListener('click', async () => {
  importDialog.close();
  try {
    if (importContent === undefined) await invoke('desktop_action', { name: 'import-existing' });
    else await invoke('desktop_import_config', { config: importContent });
  } catch (error) { document.querySelector('#action-error').textContent = `导入失败：${String(error)}`; }
  finally { importContent = undefined; }
  await update();
});
for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    document.querySelector('#action-error').textContent = '';
    try { await invoke('desktop_action', { name: button.dataset.action }); }
    catch (error) { document.querySelector('#action-error').textContent = `操作失败：${String(error)}`; }
    finally { button.disabled = false; }
    await update();
  });
}
async function update() {
  try {
    const status = await invoke('desktop_status');
    currentStatus = status;
    document.querySelector('#mode-hint').textContent = status.persistent
      ? '设置会在退出重开后保留。点击 X 隐藏到托盘；停止代理保留桌面应用，退出应用同时停止代理。'
      : '开发预览：使用独立的临时会话，所有切换仅作用于测试配置。点击 X 后继续驻留托盘。';
    document.querySelector('#connection').hidden = !status.persistent || status.codex_attached;
    document.querySelector('#codex-home').textContent = `Codex 配置目录：${status.codex_home}`;
    document.querySelector('#data-dir').textContent = status.data_dir;
    document.querySelector('#connect-codex').disabled = !status.can_route;
    document.querySelector('#import-existing').disabled = !status.can_route;
    document.querySelector('#config-file').disabled = !status.can_route;
    document.querySelector('h1').textContent = titles[status.phase] || '桌面状态';
    document.querySelector('#message').textContent = status.message;
    document.querySelector('#log').textContent = status.log_path || '尚未创建日志文件';
    document.body.classList.toggle('failed', status.phase === 'error');
    document.body.classList.toggle('busy', status.routing_busy || ['starting', 'ready', 'stopping', 'exiting'].includes(status.phase));
    const routing = { native: '原生模式', 'opencodex-local': '通过 OpenCodex 代理' };
    document.querySelector('#routing-state').textContent = status.routing_busy ? '正在处理配置…'
      : status.persistent && !status.codex_attached ? 'Codex：尚未接入桌面代理'
      : `Codex：${routing[status.codex_routing] || '路由状态未确认'}`;
    document.querySelector('#restore').disabled = !status.can_route;
    document.querySelector('#restore-back').disabled = !status.can_route;
    document.querySelector('#start').hidden = !status.can_start;
    document.querySelector('#start').textContent = status.phase === 'error' ? '重新启动代理' : '启动代理';
    document.querySelector('#stop').disabled = !status.can_stop;
    document.querySelector('#restart').disabled = !status.can_restart;
    document.querySelector('#open').hidden = status.phase !== 'loaded';
    document.querySelector('#quit').disabled = status.phase === 'exiting';
  } catch {
    document.querySelector('#action-error').textContent = '无法读取桌面状态，请从系统托盘退出后重新打开。';
  }
}
update();
setInterval(update, 500);
