const invoke = window.__TAURI__.core.invoke;
let stopped = false;
document.querySelector('#quit').addEventListener('click', async () => {
  stopped = true;
  document.querySelector('#message').textContent = '正在停止后端并关闭应用…';
  await invoke('desktop_quit');
});
async function update() {
  if (stopped) return;
  try {
    const status = await invoke('desktop_status');
    document.querySelector('h1').textContent = status.phase === 'error' ? '启动遇到问题' : '正在启动';
    document.querySelector('#message').textContent = status.message;
    document.querySelector('#log').textContent = status.log_path || '尚未创建日志文件';
    document.body.classList.toggle('failed', status.phase === 'error');
  } catch {
    document.querySelector('#message').textContent = '无法读取启动状态，请关闭应用后重新打开。';
  }
  setTimeout(update, 500);
}
update();
