// screencast overlay — load with context.addInitScript({ path }) before the first page.
// Draws a cursor and click ring from real mouse events, and a caption bar set by
// window.__rec.step(label). It never takes input (pointer-events: none), is hidden
// from assistive tech (aria-hidden), and re-attaches when the app replaces <body>.
// Screenshots hide it with: page.screenshot({ style: '#__screencast{display:none!important}' }).
(() => {
  if (window.__rec) return;
  const KEY = '__screencast_caption';
  const root = document.createElement('div');
  root.id = '__screencast';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  root.innerHTML = `
    <div data-r="cursor" style="position:fixed;left:0;top:0;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;
      background:rgba(255,80,40,.6);box-shadow:0 0 0 2px rgba(255,255,255,.9);transition:transform .05s linear;display:none"></div>
    <div data-r="ring" style="position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
      border:3px solid rgba(255,80,40,.9);opacity:0;transition:opacity .4s,transform .4s"></div>
    <div data-r="caption" style="position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:90%;
      padding:8px 14px;border-radius:8px;background:rgba(17,17,17,.82);color:#fff;font:600 15px/1.35 system-ui,sans-serif;display:none"></div>`;
  const part = (name) => root.querySelector(`[data-r="${name}"]`);
  const cursor = part('cursor');
  const ring = part('ring');
  const caption = part('caption');

  const show = (label) => {
    caption.textContent = label || '';
    caption.style.display = label ? 'block' : 'none';
  };
  const attach = () => {
    if (document.body && !root.isConnected) document.body.append(root);
  };

  addEventListener('mousemove', (e) => {
    cursor.style.display = 'block';
    cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  }, true);
  addEventListener('mousedown', (e) => {
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
    ring.style.transition = 'none';
    ring.style.opacity = '1';
    ring.style.transform = 'scale(.5)';
    requestAnimationFrame(() => {
      ring.style.transition = 'opacity .4s, transform .4s';
      ring.style.opacity = '0';
      ring.style.transform = 'scale(1.2)';
    });
  }, true);

  window.__rec = {
    step(label) {
      try { sessionStorage.setItem(KEY, label ?? ''); } catch {}
      attach();
      show(label);
    },
  };

  const init = () => {
    attach();
    try { show(sessionStorage.getItem(KEY)); } catch {}
    // Some apps replace <body> children after load, which drops the overlay; put it back.
    setInterval(attach, 100);
  };
  if (document.body) init();
  else addEventListener('DOMContentLoaded', init, { once: true });
})();
