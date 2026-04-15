(function(global) {
  function showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.cssText = 'position:fixed; top:16px; right:16px; z-index:99999; display:flex; flex-direction:column; gap:8px;';
      document.body.appendChild(container);
    }
    var colors = { success: '#10b981', error: '#e53935', info: '#2563eb', warning: '#ff9800' };
    var toast = document.createElement('div');
    toast.style.cssText = 'background:' + (colors[type] || colors.info) + '; color:#fff; padding:10px 18px; border-radius:6px; font-size:13px; box-shadow:0 2px 8px rgba(0,0,0,.2); opacity:0; transition:opacity .3s; max-width:380px;';
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(function() { toast.style.opacity = '1'; });
    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() { toast.remove(); }, 300);
    }, 3500);
  }
  global.showToast = showToast;
})(window);
