(function () {
  var root = document.documentElement;
  var byId = function (id) { return document.getElementById(id); };
  var intro = byId('intro'), stage = byId('stage'), envelope = byId('envelope');
  var book = byId('book'), pager = byId('pager'), pipsBox = byId('pips'), status = byId('status');
  var verso = byId('verso'), rig = byId('rig');
  if (!book) return;

  var sheets = Array.prototype.slice.call(book.querySelectorAll('.sheet'));
  var prevBtn = pager && pager.querySelector('.pg-prev');
  var nextBtn = pager && pager.querySelector('.pg-next');
  var pips = [];
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var index = 0, turn = null, drag = null, opened = false, ready = false, layoutPending = false;
  var lastW = 0, lastH = 0, shift = 0;

  /* a probe for the small viewport height, so the browser bar sliding away never resizes the page */
  var probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;height:100svh;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  function viewH() { return probe.offsetHeight || window.innerHeight; }

  /* ───────── page size: one sheet of paper that fits the screen ───────── */

  function fits(list) {
    for (var i = 0; i < list.length; i++) {
      var pa = list[i].querySelector('.panel'), cs = window.getComputedStyle(pa);
      var room = pa.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (pa.firstElementChild.offsetHeight > room + 0.5) return false;
    }
    return true;
  }

  /* largest content unit (as a share of full size) at which these pages fit their canvas */
  function solve(target, name, list) {
    var set = function (v) { target.style.setProperty(name, v.toFixed(3) + 'cqw'); };
    var lo = 0.3, hi = Math.min(1, parseFloat(list[0].getAttribute('data-umax')) || 1);   /* a page with little on it is not blown up to fill the card */
    set(hi);
    if (fits(list)) return;
    for (var n = 0; n < 8; n++) {
      var mid = (lo + hi) / 2;
      set(mid);
      if (fits(list)) lo = mid; else hi = mid;
    }
    set(lo);
  }

  function layout() {
    if (turn) { layoutPending = true; return; }
    layoutPending = false;
    var vw = root.clientWidth, vh = viewH();
    lastW = vw; lastH = vh;
    var cs = window.getComputedStyle(book);
    var availH = Math.max(200, vh - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
    var spread = vw >= 1000;              /* room for the open pamphlet: two pages side by side, arrows outside */
    root.classList.toggle('spread', spread);
    /* a phone shows the open pamphlet's right page whole and keeps the turned pages as a strip down the left edge */
    var peek = 18, narrowW = vw < 520 ? vw - peek - 10 : vw - 48;
    var availW = spread ? Math.min(660, Math.floor((vw - 240) / 2)) : Math.max(200, Math.min(narrowW, 660));
    /* one canvas for every page: the printed card's proportions (1:1.41), taller on a phone to use its screen */
    var R = Math.max(1.41, Math.min(1.75, availH / availW));
    var pw = Math.floor(Math.min(availW, availH / R));
    root.style.setProperty('--pw', pw + 'px');
    root.style.setProperty('--ph', Math.round(pw * R) + 'px');
    /* how far the pages sit right of centre once the pamphlet is open (as a margin, so twice the offset) */
    shift = spread ? pw : (vw < 520 ? Math.max(0, 2 * (peek - (vw - pw) / 2)) : 0);
    root.style.setProperty('--shift', shift + 'px');

    root.classList.add('measuring');
    solve(root, '--ua', sheets.slice(0, 1));     /* the cover: on the root, so its copy in the envelope matches */
    for (var i = 1; i < sheets.length; i++) solve(sheets[i], '--u', [sheets[i]]);   /* each page as large as its canvas allows */
    root.classList.remove('measuring');
  }

  function onResize() {
    if (root.clientWidth === lastW && viewH() === lastH) return;
    layout();
  }

  /* ───────── pager state ───────── */

  function update(announce) {
    for (var i = 0; i < sheets.length; i++) {
      sheets[i].classList.toggle('is-active', i === index);
      if (pips[i]) pips[i].classList.toggle('on', i === index);
    }
    if (prevBtn) prevBtn.setAttribute('aria-disabled', index === 0 ? 'true' : 'false');
    if (nextBtn) nextBtn.setAttribute('aria-disabled', index === sheets.length - 1 ? 'true' : 'false');
    root.classList.toggle('opened', index > 0);
    if (verso) verso.firstElementChild.style.boxShadow = edges(index - 1, -1);
    if (announce && status) {
      status.textContent = 'Pagina ' + (index + 1) + ' di ' + sheets.length + ': ' + (sheets[index].getAttribute('data-title') || '');
    }
  }

  function edges(n, dir) {
    var out = [];
    for (var k = 1; k <= Math.min(n, 3); k++) {
      out.push((dir * 2 * k) + 'px ' + k + 'px 0 -0.5px #e6e4d8', (dir * 2 * k) + 'px ' + k + 'px 0 0 rgba(70, 66, 45, 0.28)');
    }
    out.push('var(--card-shadow)');
    return out.join(', ');
  }

  /* ───────── page turn ───────── */

  var easeInOut = function (k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
  var easeOut = function (k) { return 1 - Math.pow(1 - k, 3); };

  /* p = progress of the turn (0 → 1); q = how far the moving page is turned over: 0 flat, 1 lying blank side up on the left */
  function setP(p) {
    var t = turn;
    t.p = p;
    var q = t.dir > 0 ? p : 1 - p;
    if (reduced) { t.mover.style.opacity = String(1 - q); return; }
    /* opening from, or closing back to, the cover moves the whole pamphlet by half a page */
    var dxFrom = t.dir * t.S * p, dxNext = -t.dir * t.S * (1 - p);
    var dxM = t.dir > 0 ? dxFrom : dxNext, dxU = t.dir > 0 ? dxNext : dxFrom;
    t.under.style.setProperty('--shade', ((1 - q) * 0.12).toFixed(3));
    t.under.style.transform = 'translateX(' + dxU.toFixed(1) + 'px)';

    /* the turning page is a row of strips hinged to each other: each lags a little behind the one before it,
       so the page flexes slightly as it moves, like stiff card, and lies flat again at both ends */
    var n = t.strips.length, ws = t.w / n, base = 180 * q, flex = t.dir * FLEX * Math.sin(Math.PI * q);
    var X = 0, Z = 0, i, ang = [], sh = [];
    for (i = 0; i < n; i++) {
      ang[i] = Math.max(0, Math.min(180, base - flex * Math.pow(i / (n - 1), 1.5)));
      sh[i] = Math.sin(ang[i] * Math.PI / 180) * 0.2;
    }
    for (i = 0; i < n; i++) {
      var al = ang[i], rad = al * Math.PI / 180;
      var s = t.strips[i];
      s.style.transform = 'translateX(' + dxM.toFixed(1) + 'px) perspective(' + t.persp + 'px) translate3d(' + X.toFixed(2) + 'px,0,' + Z.toFixed(2) + 'px) rotateY(' + (-al).toFixed(2) + 'deg) translateX(' + (-i * ws).toFixed(2) + 'px)';
      s.firstChild.classList.toggle('flipped', al > 90);           /* past edge-on we see the back of that strip */
      s.style.setProperty('--s0', ((sh[Math.max(0, i - 1)] + sh[i]) / 2).toFixed(3));
      s.style.setProperty('--s1', ((sh[i] + sh[Math.min(n - 1, i + 1)]) / 2).toFixed(3));
      X += ws * Math.cos(rad); Z += ws * Math.sin(rad);
    }
  }

  var STRIPS = 6, FLEX = 13;   /* degrees the free edge trails the spine at mid-turn */

  function buildBend(mover, mr, oy) {
    var b = el('bend'), strips = [], ws = mr.width / STRIPS;
    var cls = mover.className.replace(/\s*\bis-[\w-]+/g, ''), u = mover.style.getPropertyValue('--u');
    b.setAttribute('aria-hidden', 'true'); b.setAttribute('inert', '');
    b.style.cssText = 'left:' + mr.left + 'px;top:' + mr.top + 'px;width:' + mr.width + 'px;height:' + mr.height + 'px;';
    for (var i = 0; i < STRIPS; i++) {
      var s = el('strip'), c = mover.cloneNode(true);
      s.style.cssText = 'left:' + (i * ws).toFixed(2) + 'px;width:' + (ws + 0.75).toFixed(2) + 'px;transform-origin:' + (-i * ws).toFixed(2) + 'px ' + oy.toFixed(1) + 'px;';
      c.className = cls; c.removeAttribute('aria-label'); c.removeAttribute('data-title');
      c.style.cssText = 'left:' + (-i * ws).toFixed(2) + 'px;width:' + mr.width + 'px;height:' + mr.height + 'px;' + (u ? '--u:' + u + ';' : '');
      var imgs = c.querySelectorAll('img');
      for (var k = 0; k < imgs.length; k++) imgs[k].decoding = 'sync';   /* already loaded: draw at once, no blank frame */
      s.appendChild(c); b.appendChild(s); strips.push(s);
    }
    document.body.appendChild(b);
    return { el: b, strips: strips };
  }

  function begin(dir) {
    if (turn || !ready) return false;
    var to = index + dir;
    if (to < 0 || to >= sheets.length) return false;
    var from = sheets[index], next = sheets[to];
    var r = from.getBoundingClientRect();
    var sy = window.pageYOffset || 0;
    var S = (index === 0 || to === 0) ? shift / 2 : 0;      /* opening or closing the cover moves the pamphlet off / back to centre */

    /* pin the page being left exactly where it is, bring the new one in at its top */
    from.style.left = r.left + 'px';
    from.style.top = r.top + 'px';
    from.classList.remove('is-active');
    from.classList.add('is-leaving');
    root.classList.toggle('opened', to > 0);
    if (S && verso) verso.classList.add('off');
    next.classList.add('is-active');
    window.scrollTo(0, 0);

    var mover = dir > 0 ? from : next, under = dir > 0 ? next : from;
    var mr = mover.getBoundingClientRect(), ur = under.getBoundingClientRect(), vh = window.innerHeight;
    mover.style.transformOrigin = '0px ' + (vh / 2 - mr.top).toFixed(1) + 'px';
    under.style.transformOrigin = '0px ' + (vh / 2 - ur.top).toFixed(1) + 'px';   /* both pages pivot on the spine */
    mover.classList.add('is-mover');
    under.classList.add('is-under');
    var bend = reduced ? null : buildBend(mover, mr, vh / 2 - mr.top);
    if (bend) mover.classList.add('is-bent');
    turn = { dir: dir, to: to, from: from, next: next, mover: mover, under: under, sy: sy, p: 0, raf: 0, S: S, w: mr.width, bend: bend && bend.el, strips: bend ? bend.strips : [], persp: Math.round(Math.max(2400, r.width * 6)) };   /* a long lens: the page turns without ballooning towards the eye */
    setP(0);
    if (nextBtn) nextBtn.classList.remove('nudge');
    return true;
  }

  function finish(complete) {
    var t = turn, els = [t.from, t.next];
    for (var i = 0; i < els.length; i++) {
      var st = els[i].style;
      st.transform = ''; st.opacity = ''; st.transformOrigin = ''; st.left = ''; st.top = '';
      st.removeProperty('--shade');
      els[i].classList.remove('is-mover', 'is-under', 'is-leaving', 'is-bent', 'flipped');
    }
    if (t.bend && t.bend.parentNode) t.bend.parentNode.removeChild(t.bend);
    turn = null;
    if (verso) verso.classList.remove('off');
    if (complete) { index = t.to; buzz(); }
    update(complete);
    if (!complete) window.scrollTo(0, t.sy);
    if (layoutPending) layout();
  }

  function settle(complete, dur, ease) {
    var t = turn, p0 = t.p, p1 = complete ? 1 : 0, t0 = null;
    if (t.raf) return;
    if (reduced) dur = 180;
    function step(now) {
      if (t0 === null) t0 = now;
      var k = Math.min(1, (now - t0) / dur);
      setP(p0 + (p1 - p0) * ease(k));
      if (k < 1) t.raf = window.requestAnimationFrame(step); else finish(complete);
    }
    t.raf = window.requestAnimationFrame(step);
  }

  function go(dir) { if (begin(dir)) settle(true, 620, easeInOut); }
  function buzz() { try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) {} }

  /* follow the finger: a sideways drag turns the page, a vertical one scrolls it */
  function onDown(e) {
    if (e.pointerType === 'mouse' || !e.isPrimary || turn || !ready || root.classList.contains('zoomed')) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, dir: 0, xs: 0, lx: e.clientX, lt: e.timeStamp, v: 0 };
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      var dir = dx < 0 ? 1 : -1;
      if (!begin(dir)) { drag = null; return; }
      drag.active = true; drag.dir = dir; drag.xs = e.clientX;
    }
    var travel = (drag.dir > 0 ? drag.xs - e.clientX : e.clientX - drag.xs);
    var width = turn.from.offsetWidth * 0.85;
    var dt = e.timeStamp - drag.lt;
    if (dt > 0) { drag.v = 0.6 * drag.v + 0.4 * ((e.clientX - drag.lx) / dt); drag.lx = e.clientX; drag.lt = e.timeStamp; }
    setP(Math.max(0, Math.min(1, travel / width)));
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (!d.active || !turn) return;
    var cancelled = e.type === 'pointercancel';
    var v = d.dir > 0 ? -d.v : d.v;                 /* px per ms, towards the turn */
    var complete = !cancelled && (v > 0.3 || (turn.p > 0.33 && v > -0.2));
    var left = complete ? 1 - turn.p : turn.p;
    settle(complete, 180 + 300 * left, easeOut);
  }

  /* ───────── the envelope ───────── */

  function el(cls) { var n = document.createElement('div'); n.className = cls; return n; }

  /* the card in the envelope is the cover itself, at its final place and size, scaled down into the pocket */
  function buildLift(floatY) {
    var r = sheets[0].getBoundingClientRect();
    var er = envelope.getBoundingClientRect();
    var ew = er.width, eh = er.height, envTop = er.top - floatY, envBottom = envTop + eh;
    var s = 0.84 * ew / r.width;
    var top0 = envTop + eh * 0.05;                       /* where the card's top edge rests inside the pocket */
    var dy = top0 - r.top;                               /* transform-origin is the card's top centre */
    var rise = Math.min(eh * 0.6, top0 - 20);
    var below = top0 + r.height * s - envBottom;         /* how much of the card hangs below the envelope: hidden in the pocket */
    var fall = window.innerHeight - envTop + eh * 0.62 + 24;   /* far enough that the open flap clears the screen too */

    var u = el('lift');
    u.setAttribute('aria-hidden', 'true');
    u.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;transform-origin:50% 0;';
    u.style.setProperty('--s', s.toFixed(4));
    u.style.setProperty('--dy', dy.toFixed(1) + 'px');
    u.style.setProperty('--rise', rise.toFixed(1) + 'px');
    u.style.setProperty('--clip-a', (Math.max(0, below) / s).toFixed(1) + 'px');
    u.style.setProperty('--clip-b', ((below - rise) / s).toFixed(1) + 'px');
    u.style.setProperty('--clip-c', ((below - rise - fall) / s).toFixed(1) + 'px');
    intro.style.setProperty('--fall', fall.toFixed(0) + 'px');
    var page = el(sheets[0].className);
    page.appendChild(sheets[0].firstElementChild.cloneNode(true));
    u.appendChild(page);
    envelope.parentNode.insertBefore(u, envelope);
    return u;
  }

  function reveal() {
    root.classList.remove('intro-active');
    root.classList.add('is-open', 'lit');
    if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
    ready = true;
    update(true);
    book.setAttribute('tabindex', '-1');
    try { book.focus({ preventScroll: true }); } catch (err) {}
  }

  function open() {
    if (opened) return;
    if (spun) { spun = false; return; }        /* that tap was the end of a spin, not a press */
    opened = true;
    startMusic();                              /* inside the tap, or phones refuse to play it */
    var away = rig ? stopSpin() : 0;
    if (away > 12 && !reduced) { window.setTimeout(start, 520); } else start();
  }

  function start() {
    buzz();
    envelope.setAttribute('aria-disabled', 'true');
    layout();
    window.scrollTo(0, 0);

    if (reduced) {
      root.classList.remove('intro-active');
      root.classList.add('is-open', 'lit');
      intro.classList.add('s-fade');
      ready = true; update(true);
      window.setTimeout(function () { if (intro.parentNode) intro.parentNode.removeChild(intro); }, 380);
      return;
    }

    /* stop the idle float where it is, then let everything settle back to rest */
    var floatY = 0;
    try { floatY = new DOMMatrixReadOnly(window.getComputedStyle(stage).transform).m42 || 0; } catch (err) {}
    stage.style.animation = 'none';
    stage.style.transform = 'translateY(' + floatY + 'px)';
    var u = buildLift(floatY);
    void stage.offsetWidth;
    stage.style.transition = 'transform 0.7s cubic-bezier(0.23, 1, 0.32, 1)';
    stage.style.transform = 'translateY(0px)';

    intro.classList.add('s-open');                                                     /* the flap lifts */
    window.setTimeout(function () { u.classList.add('rise'); }, 700);                  /* the card slides up */
    window.setTimeout(function () {                                                    /* the envelope is drawn down off it */
      intro.classList.add('s-leave');
      root.classList.add('lit');
      u.classList.remove('rise');
      u.classList.add('bare');
    }, 1450);
    window.setTimeout(function () { u.classList.remove('bare'); u.classList.add('forward'); }, 2150);   /* the card comes forward */
    window.setTimeout(reveal, 2150 + 900 + 60);
  }

  /* ───────── spin the envelope: drag to turn it round, it settles back facing you ───────── */

  var ry = 0, rx = 0, vy = 0, vx = 0, ty = 0, tx = 0, hz = 0, vz = 0, tz = 0, spinRaf = 0, grab = null, spun = false, lastT = 0, showingBack = false;
  var face = rig && rig.querySelector('.env-face'), rear = rig && rig.querySelector('.env-rear');

  function paintRig() {
    /* hover sways it flat (rotate); only a drag turns it in 3D, which makes Chrome redraw it and blink the paper grain */
    rig.style.transform = 'rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) rotate(' + hz.toFixed(2) + 'deg)';
    var back = Math.cos(ry * Math.PI / 180) * Math.cos(rx * Math.PI / 180) < 0;
    if (back !== showingBack) {
      showingBack = back;
      face.style.visibility = back ? 'hidden' : '';
      rear.style.visibility = back ? 'visible' : '';
    }
    intro.style.setProperty('--tilt', (((ry % 360) + 360) % 360 / 360 + rx / 200 + hz / 40).toFixed(4));
  }
  function spring(now) {
    var dt = Math.min(0.032, (now - (lastT || now)) / 1000 || 0.016);
    lastT = now;
    /* a soft spring with damping: carries a flick's momentum, then settles */
    vy += ((ty - ry) * 38 - vy * 7.5) * dt; ry += vy * dt;
    vx += ((tx - rx) * 60 - vx * 11) * dt; rx += vx * dt;
    vz += ((tz - hz) * 38 - vz * 7.5) * dt; hz += vz * dt;
    paintRig();
    if (Math.abs(ty - ry) < 0.05 && Math.abs(vy) < 0.5 && Math.abs(tx - rx) < 0.05 && Math.abs(vx) < 0.5 && Math.abs(tz - hz) < 0.02 && Math.abs(vz) < 0.2 && !grab) {
      ry = ty; rx = tx; hz = tz; paintRig(); spinRaf = 0; lastT = 0; return;
    }
    spinRaf = window.requestAnimationFrame(spring);
  }
  function kick() { if (!spinRaf) { lastT = 0; spinRaf = window.requestAnimationFrame(spring); } }
  function homeY() { return Math.round((ry + vy * 0.22) / 360) * 360; }
  function stopSpin() {
    if (spinRaf) window.cancelAnimationFrame(spinRaf);
    spinRaf = 0; grab = null;
    var home = Math.round(ry / 360) * 360, away = Math.abs(ry - home) + Math.abs(rx);
    ry = home; rx = 0; vy = vx = 0; hz = tz = vz = 0;
    rig.style.transition = away > 12 ? 'transform 0.5s cubic-bezier(0.23, 1, 0.32, 1)' : '';
    paintRig();
    return away;
  }

  function bindSpin() {
    if (!rig || reduced) return;
    stage.addEventListener('pointerdown', function (e) {
      if (opened || !e.isPrimary) return;
      tz = 0;
      grab = { id: e.pointerId, x: e.clientX, y: e.clientY, ry: ry, rx: rx, moved: false, lx: e.clientX, lt: e.timeStamp, v: 0 };
    });
    window.addEventListener('pointermove', function (e) {
      if (opened) return;
      if (!grab) {
        /* a mouse just hovering tilts the envelope a little towards it */
        if (e.pointerType === 'mouse') {
          tz = (e.clientX / window.innerWidth - 0.5) * 5;
          kick();
        }
        return;
      }
      if (e.pointerId !== grab.id) return;
      var dx = e.clientX - grab.x, dy = e.clientY - grab.y;
      if (!grab.moved) {
        if (Math.abs(dx) + Math.abs(dy) < 7) return;
        grab.moved = true;
        stage.classList.add('grabbing');
        try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      }
      var per = 300 / Math.max(320, Math.min(window.innerWidth, 900));   /* a swipe across the screen turns it about 300° */
      ry = grab.ry + dx * per;
      rx = Math.max(-32, Math.min(32, grab.rx - dy * 0.25));
      var dt = e.timeStamp - grab.lt;
      if (dt > 0) { grab.v = 0.65 * grab.v + 0.35 * ((e.clientX - grab.lx) * per / dt * 1000); grab.lx = e.clientX; grab.lt = e.timeStamp; }
      vy = 0; vx = 0;
      paintRig();
    }, { passive: true });
    function release(e) {
      if (!grab || e.pointerId !== grab.id) return;
      var g = grab; grab = null;
      stage.classList.remove('grabbing');
      if (!g.moved) { if (showingBack) { ty = homeY(); tx = 0; kick(); } return; }
      spun = true;                                     /* swallow the click this drag would fire */
      window.setTimeout(function () { spun = false; }, 60);
      vy = Math.max(-1400, Math.min(1400, g.v));
      ty = homeY(); tx = 0;
      kick();
    }
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    document.addEventListener('mouseleave', function () { if (!grab && !opened) { tz = 0; kick(); } });
  }

  /* ───────── start ───────── */

  if (pipsBox) {
    for (var i = 0; i < sheets.length; i++) { var pip = document.createElement('i'); pipsBox.appendChild(pip); pips.push(pip); }
  }
  for (var e = 0; e < sheets.length; e++) sheets[e].firstElementChild.style.boxShadow = edges(sheets.length - 1 - e, 1);   /* pages still to come show as edges on the right */
  if (nextBtn) nextBtn.classList.add('nudge');
  update(false);
  layout();

  /* background music (only "la festa continua" has it): fades in on the envelope tap, fades out at the end, plays once */
  var music = byId('music'), soundBtn = byId('sound'), gain = null, actx = null, muted = false, fadingOut = false;
  var LEVEL = 0.6, FADE_IN = 4, FADE_OUT = 7;
  function ramp(to, secs) {
    if (gain) {
      var t = actx.currentTime;
      gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(to, t + secs);
    } else {   /* no Web Audio: step the element's own volume (iPhones ignore it, so they just play) */
      var from = music.volume, t0 = performance.now();
      window.clearInterval(music._fade);
      music._fade = window.setInterval(function () {
        var q = Math.min(1, (performance.now() - t0) / (secs * 1000));
        music.volume = from + (to - from) * q;
        if (q >= 1) window.clearInterval(music._fade);
      }, 50);
    }
  }
  function startMusic() {
    if (!music) return;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';   /* iPhone: play even with the silent switch on, like a video */
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        actx = new AC(); gain = actx.createGain(); gain.gain.value = 0;
        actx.createMediaElementSource(music).connect(gain); gain.connect(actx.destination);
        if (actx.resume) actx.resume();
      } else music.volume = 0;
    } catch (err) { gain = null; music.volume = 0; }
    var p = music.play();
    if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError' && soundBtn) soundBtn.hidden = true; });   /* only a real refusal hides the switch; a pause from switching apps does not */
    ramp(LEVEL, FADE_IN);
    if (soundBtn) soundBtn.hidden = false;
  }
  if (music) {
    music.addEventListener('timeupdate', function () {
      var left = music.duration - music.currentTime;
      if (!fadingOut && left <= FADE_OUT) { fadingOut = true; if (!muted) ramp(0, Math.max(0.5, left - 0.2)); }
    });
    music.addEventListener('ended', function () { if (soundBtn) soundBtn.hidden = true; });
    /* switching to another app pauses it; coming back carries on, unless they muted it */
    document.addEventListener('visibilitychange', function () {
      if (!opened || music.ended) return;
      if (document.hidden) music.pause(); else if (!muted) music.play();
    });
  }
  if (soundBtn) soundBtn.addEventListener('click', function () {
    muted = !muted;
    soundBtn.setAttribute('aria-pressed', String(muted));
    soundBtn.setAttribute('aria-label', muted ? 'Attiva la musica' : 'Disattiva la musica');
    if (muted) { ramp(0, 0.4); window.setTimeout(function () { if (muted) music.pause(); }, 450); }
    else { music.play(); ramp(fadingOut ? 0 : LEVEL, 1); }
  });

  /* "Copia IBAN": copies the number and shows a tick on the button for a moment */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (ok, no) {   /* older phones, or a refused clipboard: copy through a hidden field */
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0;-webkit-user-select:text;user-select:text';
      document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
      var done = false; try { done = document.execCommand('copy'); } catch (err) {}
      document.body.removeChild(t); done ? ok() : no();
    });
  }
  book.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.copy') : null;
    if (!b) return;
    var label = b.querySelector('span');
    copyText(b.getAttribute('data-copy')).then(function () {
      if (!b.dataset.label) b.dataset.label = label.textContent;
      label.textContent = b.getAttribute('data-done');
      b.classList.add('copied');
      if (status) status.textContent = 'IBAN copiato';
      window.clearTimeout(b._t);
      b._t = window.setTimeout(function () { label.textContent = b.dataset.label; b.classList.remove('copied'); }, 2400);
    }, function () {});
  });
  /* pictures stay on the card: nothing can be dragged out, and nothing dropped in */
  document.addEventListener('dragstart', function (e) { e.preventDefault(); });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });
  if (prevBtn) prevBtn.addEventListener('click', function () { go(-1); });
  if (verso) verso.addEventListener('click', function () { go(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { go(1); });
  document.addEventListener('keydown', function (e) {
    if (!ready || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  });
  if (window.PointerEvent) {
    book.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }
  window.addEventListener('resize', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () {
    root.classList.toggle('zoomed', window.visualViewport.scale > 1.01);
  });
  window.addEventListener('orientationchange', function () { window.setTimeout(onResize, 250); });
  window.addEventListener('load', layout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

  if (!intro || !envelope || !stage) {
    root.classList.remove('intro-active');
    root.classList.add('is-open', 'lit');
    ready = true;
    update(false);
    return;
  }
  envelope.addEventListener('click', open);
  bindSpin();
})();
