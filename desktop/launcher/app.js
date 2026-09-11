const invoke = window.__TAURI__.core.invoke;
const titles = { starting: '正在启动', ready: '正在加载界面', loaded: '代理正在运行', stopping: '正在停止代理', stopped: '代理已停止', error: '代理遇到问题', exiting: '正在退出应用' };
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
    document.querySelector('h1').textContent = titles[status.phase] || '桌面状态';
    document.querySelector('#message').textContent = status.message;
    document.querySelector('#log').textContent = status.log_path || '尚未创建日志文件';
    document.body.classList.toggle('failed', status.phase === 'error');
    document.body.classList.toggle('busy', status.routing_busy || ['starting', 'ready', 'stopping', 'exiting'].includes(status.phase));
    const routing = { native: '原生模式', 'opencodex-local': '通过 OpenCodex 代理' };
    document.querySelector('#routing-state').textContent = status.routing_busy ? 'Codex：正在切换…' : `Codex：${routing[status.codex_routing] || '路由状态未确认'}`;
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
