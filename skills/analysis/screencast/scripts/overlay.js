// screencast overlay — load with context.addInitScript({ path }) before the first page.
// Draws a cursor and click ring from real mouse events, and a caption bar set by
// window.__rec.step(label). It can also point at an element — __rec.highlight(el, opts) /
// __rec.unhighlight() — and show a badge, __rec.badge(text). It never takes input (pointer-events: none), is hidden
// from assistive tech (aria-hidden), and re-attaches when the app replaces <body>.
// Screenshots hide it with: page.screenshot({ style: '#__screencast{display:none!important}' }).
(() => {
  // Top frame only: a same-origin iframe would restore a stale caption from the shared sessionStorage.
  if (window.__rec || window !== window.top) return;
  const KEY = '__screencast_caption';
  const root = document.createElement('div');
  root.id = '__screencast';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  // The caption renders through ::after, so it is never DOM text a getByText locator could match.
  root.innerHTML = `
    <style>#__screencast [data-r="caption"]::after{content:attr(data-label)}</style>
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
    caption.setAttribute('data-label', label || '');
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

  // Highlight: dims the page around a target, outlines it, and points a callout at it. The
  // next highlight glides there. Callout and badge text render through ::before/::after for
  // the same reason as the caption: a getByText locator must never match overlay text.
  const hlStyle = document.createElement('style');
  hlStyle.textContent = `
    #__screencast .hl-spot,#__screencast .hl-ring{position:fixed;pointer-events:none;border-radius:12px;opacity:0;
      transition:left .6s cubic-bezier(.22,1,.36,1),top .6s cubic-bezier(.22,1,.36,1),width .6s cubic-bezier(.22,1,.36,1),height .6s cubic-bezier(.22,1,.36,1),opacity .45s ease}
    #__screencast .hl-spot{box-shadow:0 0 0 200vmax rgba(4,4,8,.58)}
    #__screencast .hl-ring{border:2.5px solid #ffb347;box-shadow:0 0 0 1px rgba(255,61,68,.6),0 0 22px rgba(255,140,60,.55)}
    #__screencast .hl-ring.on{animation:hlpulse 1.8s ease-in-out .5s infinite}
    @keyframes hlpulse{0%,100%{box-shadow:0 0 0 1px rgba(255,61,68,.6),0 0 18px rgba(255,140,60,.45)}50%{box-shadow:0 0 0 5px rgba(255,61,68,.18),0 0 34px rgba(255,140,60,.75)}}
    #__screencast .hl-call{position:fixed;pointer-events:none;opacity:0;max-width:340px;padding:12px 16px;border-radius:12px;
      background:#16161b;color:#f3f3f6;font:600 19px/1.3 system-ui,sans-serif;border:1px solid rgba(255,179,71,.55);
      box-shadow:0 10px 30px rgba(0,0,0,.55);transform:translateY(8px) scale(.96);
      transition:opacity .4s ease,transform .5s cubic-bezier(.22,1,.36,1)}
    #__screencast .hl-call.on{opacity:1;transform:none}
    #__screencast .hl-call::before{content:attr(data-kicker);display:block;margin-bottom:6px;font:600 11px/1 ui-monospace,monospace;
      letter-spacing:.1em;color:#ffb347;text-transform:uppercase}
    #__screencast .hl-call:not([data-kicker])::before{display:none}
    #__screencast .hl-call::after{content:attr(data-label)}
    #__screencast .hl-svg{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none}
    #__screencast .hl-svg path.hl-path{fill:none;stroke:#ffb347;stroke-width:3;stroke-linecap:round;filter:drop-shadow(0 0 6px rgba(255,140,60,.6))}
    #__screencast .hl-badge{position:fixed;top:18px;left:50%;pointer-events:none;opacity:0;transform:translate(-50%,-6px);
      padding:7px 14px;border-radius:999px;background:#16161b;color:#ffb347;font:600 14px/1 system-ui,sans-serif;
      letter-spacing:.04em;border:1px solid rgba(255,179,71,.55);transition:opacity .35s ease,transform .35s ease}
    #__screencast .hl-badge.on{opacity:1;transform:translate(-50%,0)}
    #__screencast .hl-badge::after{content:"\\25B6\\25B6  " attr(data-label)}`;
  const hlSpot = Object.assign(document.createElement('div'), { className: 'hl-spot' });
  const hlRing = Object.assign(document.createElement('div'), { className: 'hl-ring' });
  const hlCall = Object.assign(document.createElement('div'), { className: 'hl-call' });
  const hlBadge = Object.assign(document.createElement('div'), { className: 'hl-badge' });
  const hlSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  hlSvg.setAttribute('class', 'hl-svg');
  hlSvg.innerHTML = '<defs><marker id="hlhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ffb347" stroke="none"/></marker></defs><path class="hl-path" marker-end="url(#hlhead)"/>';
  const hlPath = hlSvg.querySelector('.hl-path');
  // Below the cursor, click ring and caption, which are later siblings and paint on top.
  root.prepend(hlStyle, hlSpot, hlRing, hlSvg, hlCall, hlBadge);

  let hlCur = null, hlOpts = {}, hlDrawn = false, hlDrawing = false, hlArmed = false, hlArmTimer = 0;
  const PAD = 8;
  const placeBox = (b) => {
    for (const n of [hlSpot, hlRing]) Object.assign(n.style, { left: `${b.x - PAD}px`, top: `${b.y - PAD}px`, width: `${b.width + PAD * 2}px`, height: `${b.height + PAD * 2}px` });
  };
  const placeCall = (b) => {
    if (!hlOpts.label || !hlArmed) return;
    const cw = hlCall.offsetWidth, ch = hlCall.offsetHeight, gap = hlOpts.gap ?? 90, side = hlOpts.side ?? 'right';
    let x, y;
    if (side === 'right') { x = b.right + gap; y = b.top + b.height / 2 - ch / 2; }
    if (side === 'left') { x = b.left - gap - cw; y = b.top + b.height / 2 - ch / 2; }
    if (side === 'bottom') { x = b.left + b.width / 2 - cw / 2; y = b.bottom + gap; }
    if (side === 'top') { x = b.left + b.width / 2 - cw / 2; y = b.top - gap - ch; }
    // Stay inside the frame and above the caption.
    x = Math.max(16, Math.min(innerWidth - cw - 16, x)); y = Math.max(16, Math.min(innerHeight - ch - 110, y));
    hlCall.style.left = `${x}px`; hlCall.style.top = `${y}px`;
    const cx = x + cw / 2, cy = y + ch / 2, midY = b.top + b.height / 2, midX = b.left + b.width / 2;
    const [sx, sy, ex, ey] = {
      right: [x, cy, b.right + PAD + 6, midY], left: [x + cw, cy, b.left - PAD - 6, midY],
      bottom: [cx, y, midX, b.bottom + PAD + 6], top: [cx, y + ch, midX, b.top - PAD - 6],
    }[side];
    const mx = (sx + ex) / 2, my = (sy + ey) / 2;
    hlPath.setAttribute('d', side === 'left' || side === 'right'
      ? `M${sx} ${sy} C${mx} ${sy} ${mx} ${ey} ${ex} ${ey}` : `M${sx} ${sy} C${sx} ${my} ${ex} ${my} ${ex} ${ey}`);
    if (!hlDrawn) {
      hlDrawn = true;
      const len = hlPath.getTotalLength();
      Object.assign(hlPath.style, { transition: 'none', strokeDasharray: `${len}`, strokeDashoffset: `${len}`, opacity: '1' });
      hlPath.getBoundingClientRect();
      Object.assign(hlPath.style, { transition: 'stroke-dashoffset .55s cubic-bezier(.22,1,.36,1) .2s', strokeDashoffset: '0' });
      hlDrawing = true;
      hlPath.addEventListener('transitionend', () => { hlDrawing = false; hlPath.style.strokeDasharray = 'none'; }, { once: true });
    } else if (!hlDrawing) Object.assign(hlPath.style, { strokeDasharray: 'none', strokeDashoffset: '0' });
  };
  // The overlay follows the element every frame, so a panel that opens or a list that loads keeps its outline.
  const hlTick = () => {
    if (hlCur?.isConnected) { const b = hlCur.getBoundingClientRect(); placeBox(b); placeCall(b); }
    requestAnimationFrame(hlTick);
  };
  requestAnimationFrame(hlTick);

  window.__rec = {
    step(label) {
      try { sessionStorage.setItem(KEY, label ?? ''); } catch {}
      attach();
      show(label);
    },
    // opts: { label, kicker, side: right|left|top|bottom, gap, grow, spot }. Returns false when
    // `grow` text matched no ancestor and the target itself was framed.
    highlight(el, opts = {}) {
      attach();
      let grown = true;
      if (opts.grow) {
        let a = el;
        while (a && !(a.textContent || '').includes(opts.grow)) a = a.parentElement;
        if (a) el = a; else grown = false;
      }
      const first = !hlCur;
      hlCur = el; hlOpts = opts; hlDrawn = false; hlDrawing = false;
      Object.assign(hlPath.style, { transition: 'none', opacity: '0' });
      hlCall.classList.remove('on');
      hlCall.removeAttribute('data-kicker');
      if (opts.kicker) hlCall.setAttribute('data-kicker', opts.kicker);
      hlCall.setAttribute('data-label', opts.label || '');
      hlCall.style.display = opts.label ? 'block' : 'none';
      if (first) {
        // Appear in place; only a second highlight glides.
        for (const n of [hlSpot, hlRing]) n.style.transition = 'none';
        placeBox(el.getBoundingClientRect()); hlSpot.getBoundingClientRect();
        for (const n of [hlSpot, hlRing]) n.style.transition = '';
      }
      hlSpot.style.opacity = opts.spot === false ? '0' : '1';
      hlRing.style.opacity = '1'; hlRing.classList.add('on');
      // The arrow and callout wait for the glide to end.
      hlArmed = false; clearTimeout(hlArmTimer);
      hlArmTimer = setTimeout(() => { hlArmed = true; placeCall(el.getBoundingClientRect()); hlCall.classList.add('on'); }, first ? 250 : 650);
      return grown;
    },
    unhighlight() {
      hlArmed = false; clearTimeout(hlArmTimer);
      hlSpot.style.opacity = '0'; hlRing.style.opacity = '0'; hlRing.classList.remove('on'); hlCall.classList.remove('on');
      Object.assign(hlPath.style, { transition: 'opacity .3s', opacity: '0' });
      setTimeout(() => { if (hlSpot.style.opacity === '0') hlCur = null; }, 500);
    },
    // A "Sped up" style badge at the top of the frame; empty text hides it.
    badge(text) {
      hlBadge.setAttribute('data-label', text || '');
      hlBadge.classList.toggle('on', !!text);
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
