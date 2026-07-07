type ToastType = 'success' | 'error' | 'info' | 'warning';

function ensureToastRoot() {
  if (typeof window === 'undefined') return null;
  let root = document.getElementById('dentalos-toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'dentalos-toast-root';
    root.dir = 'rtl';
    root.style.position = 'fixed';
    root.style.left = '18px';
    root.style.bottom = '18px';
    root.style.zIndex = '10000';
    root.style.display = 'grid';
    root.style.gap = '10px';
    root.style.maxWidth = '420px';
    root.style.width = 'calc(100vw - 36px)';
    root.style.pointerEvents = 'none';
    document.body.appendChild(root);
  }
  return root;
}

function colorForToast(type: ToastType) {
  if (type === 'error') return { border: '#fecdd3', bg: '#fff1f2', title: '#be123c' };
  if (type === 'warning') return { border: '#fed7aa', bg: '#fff7ed', title: '#c2410c' };
  if (type === 'success') return { border: '#bbf7d0', bg: '#f0fdf4', title: '#15803d' };
  return { border: '#bae6fd', bg: '#f0f9ff', title: '#0369a1' };
}

export function showToast(title: string, message?: string, type: ToastType = 'info', duration = 3800) {
  const root = ensureToastRoot();
  if (!root) return;
  const colors = colorForToast(type);
  const item = document.createElement('div');
  item.style.pointerEvents = 'auto';
  item.style.border = `1px solid ${colors.border}`;
  item.style.background = colors.bg;
  item.style.borderRadius = '20px';
  item.style.padding = '14px 16px';
  item.style.boxShadow = '0 18px 50px rgba(15, 23, 42, 0.14)';
  item.style.fontFamily = 'inherit';
  item.style.transform = 'translateY(8px)';
  item.style.opacity = '0';
  item.style.transition = 'all 180ms ease';
  item.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div style="min-width:0;text-align:right;">
        <p style="margin:0;font-size:14px;font-weight:900;color:${colors.title};">${escapeHtml(title)}</p>
        ${message ? `<p style="margin:6px 0 0;font-size:13px;font-weight:700;line-height:1.8;color:#475569;">${escapeHtml(message)}</p>` : ''}
      </div>
      <button type="button" aria-label="إغلاق" style="border:0;background:transparent;color:#64748b;font-size:18px;font-weight:900;line-height:1;cursor:pointer;padding:0;">×</button>
    </div>
  `;
  root.appendChild(item);
  const close = () => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(8px)';
    window.setTimeout(() => item.remove(), 180);
  };
  item.querySelector('button')?.addEventListener('click', close);
  window.setTimeout(() => {
    item.style.opacity = '1';
    item.style.transform = 'translateY(0)';
  }, 0);
  window.setTimeout(close, duration);
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
