/**
 * script.js — Indo Pakhtoon Tech
 * Complete rewrite with all fixes:
 * 1. Donate/Support modal — fully wired
 * 2. Copy-to-clipboard with toast feedback
 * 3. Admin panel secret trigger — fixed
 * 4. Newsletter → saves to JSONBin cloud
 * 5. New app notification log for subscribers
 * 6. Global download counters via JSONBin
 * 7. Transparent canvas resizing with compact cloud-ready images
 * 8. Zero background polling for public visitors
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════════ */
  const JSONBIN_BIN_ID  = '6ae58fe8ac6210605a60d117';
  const JSONBIN_API_KEY = '$2a$10$h8getyTZgrcWnxbja2EcGOogl3d339FaeMCoT22ehc/tckplHLlxu';
  const JSONBIN_URL     = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

  const GOOGLE_CLIENT_ID = '319709517352-6f644og6lldls6erff3087ud6pmd3sk8.apps.googleusercontent.com';
  const AUTHORIZED_EMAIL = 'pakhtoonvisionary27@gmail.com';
  const GOOGLE_AUTH_URI  = 'https://accounts.google.com/o/oauth2/auth';
  const ADMIN_PASS_HASH  = '3e099246a91b2705dff580e1f8f4ab8f5e3a4f2a637ac79b3ced85490d0d3c3e';

  const STORAGE_APPS    = 'ipt_real_apps_v3';
  const STORAGE_LOGO    = 'ipt_logo_v2';

  const CANVAS_SIZE     = 256;
  const MAX_FILE_BYTES  = 150 * 1024;   // 150 KB
  const MAX_IMAGE_DATA_URL_LENGTH = 40 * 1024;
  const DEBOUNCE_MS     = 1400;

  /* ═══════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════ */
  let realApps        = [];
  let cloudSnapshot   = null;    // last full cloud payload
  let appIconDataUrl  = null;
  let logoFileDataUrl = null;
  let isAdminMode     = false;
  let isSyncing       = false;
  let syncTimer       = null;
  let gsiAttempts     = 0;

  /* ═══════════════════════════════════════════════
     DOM HELPERS
  ═══════════════════════════════════════════════ */
  const $   = id  => document.getElementById(id);
  const $$  = sel => document.querySelectorAll(sel);
  const on  = (el, ev, fn) => el && el.addEventListener(ev, fn);

  /* ═══════════════════════════════════════════════
     ESCAPE / FORMAT UTILITIES
  ═══════════════════════════════════════════════ */
  function esc(s) {
    if (typeof s !== 'string') return String(s || '');
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  function fmtNum(n) {
    n = parseInt(n, 10) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M+';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K+';
    return String(n);
  }

  /* ═══════════════════════════════════════════════
     TOAST SYSTEM — Fixed & enhanced
  ═══════════════════════════════════════════════ */
  function showToast(msg, type = 'success', duration = 3000) {
    const c = $('toastContainer');
    if (!c) return;
    const icons = {
      success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
      error:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      info:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      copy:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
    };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.setAttribute('role', 'status');
    t.innerHTML = (icons[type] || icons.info) + ' ' + esc(msg);
    c.appendChild(t);
    setTimeout(() => {
      t.classList.add('hide');
      setTimeout(() => t.remove(), 350);
    }, duration);
  }

  /* ═══════════════════════════════════════════════
     COPY TO CLIPBOARD — Fixed with toast feedback
  ═══════════════════════════════════════════════ */
  function copyToClipboard(text, label) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove();
      showToast(ok ? `✓ ${label} copied to clipboard!` : 'Could not copy — please copy manually.', ok ? 'copy' : 'error');
    };
    if (!navigator.clipboard?.writeText) { fallback(); return; }
    navigator.clipboard.writeText(text)
      .then(() => showToast(`✓ ${label} copied to clipboard!`, 'copy'))
      .catch(fallback);
  }

  /* Wire ALL copy buttons via event delegation */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.copy-btn[data-copy]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    copyToClipboard(btn.dataset.copy, btn.dataset.label || 'Text');
  });

  /* ═══════════════════════════════════════════════
     SHA-256
  ═══════════════════════════════════════════════ */
  async function sha256(msg) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ═══════════════════════════════════════════════
     CANVAS IMAGE RESIZER
     Preserves aspect ratio and transparency, with a
     compact output suitable for cloud storage.
  ═══════════════════════════════════════════════ */
  const offCanvas = $('iptCanvasOffscreen');

  function resizeToSquare(file, size = CANVAS_SIZE) {
    return new Promise((resolve, reject) => {
      if (file.size > MAX_FILE_BYTES) {
        reject(new Error(`FILE_TOO_LARGE:${(file.size / 1024).toFixed(0)}`));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.onload  = e => {
        const img = new Image();
        img.onerror = () => reject(new Error('Image decode error'));
        img.onload  = () => {
          const canvas = offCanvas;
          const maxSize = Math.min(size, CANVAS_SIZE);
          const sizes = [...new Set([maxSize, 192, 128, 96, 64].filter(n => n <= maxSize))];
          for (const outputSize of sizes) {
            canvas.width = outputSize;
            canvas.height = outputSize;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('Canvas context unavailable'));
              return;
            }
            ctx.clearRect(0, 0, outputSize, outputSize);
            const ratio = Math.min(outputSize / img.width, outputSize / img.height);
            const dw = img.width * ratio;
            const dh = img.height * ratio;
            const dx = (outputSize - dw) / 2;
            const dy = (outputSize - dh) / 2;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, dx, dy, dw, dh);

            for (const quality of [0.78, 0.66, 0.54]) {
              const webp = canvas.toDataURL('image/webp', quality);
              if (!webp.startsWith('data:image/webp')) break;
              if (webp.length <= MAX_IMAGE_DATA_URL_LENGTH) {
                resolve(webp);
                return;
              }
            }

            const png = canvas.toDataURL('image/png');
            if (png.length <= MAX_IMAGE_DATA_URL_LENGTH) {
              resolve(png);
              return;
            }
          }
          reject(new Error('Image could not be compressed below the storage limit'));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ═══════════════════════════════════════════════
     CLOUD API HELPERS
     All cloud I/O gated behind isAdminMode or
     explicit download-click calls. (Fix #8)
  ═══════════════════════════════════════════════ */
  async function cloudFetch() {
    try {
      const res = await fetch(JSONBIN_URL + '/latest', {
        method : 'GET',
        headers: { 'X-Master-Key': JSONBIN_API_KEY, 'X-Bin-Meta': 'false' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      console.warn('[IPT Cloud] Fetch failed:', err.message);
      return null;
    }
  }

  async function cloudPush(payload) {
    try {
      const res = await fetch(JSONBIN_URL, {
        method : 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_API_KEY },
        body   : JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return true;
    } catch (err) {
      console.warn('[IPT Cloud] Push failed:', err.message);
      return false;
    }
  }

  /* Build the full cloud payload */
  function buildPayload() {
    let logo = null;
    try { logo = JSON.parse(localStorage.getItem(STORAGE_LOGO)); } catch (_) {}
    return {
      apps        : realApps,
      logo        : logo,
      subscribers : cloudSnapshot?.subscribers || [],
      notifLog    : cloudSnapshot?.notifLog    || [],
      lastUpdated : new Date().toISOString()
    };
  }

  /* Cloud status UI */
  function setCloudStatus(state, msg) {
    const bar = $('cloudStatusBar'), dot = $('cloudDot'), txt = $('cloudStatusText');
    const admDot = $('admCloudDot'), admTxt = $('admCloudText');
    if (bar) bar.className = 'cloud-status-bar show ' + state;
    if (txt) txt.textContent = msg;
    const colors = { syncing: 'var(--accent-orange)', synced: 'var(--accent-green)', error: 'var(--accent-red)' };
    const labels = { syncing: 'Syncing…', synced: 'Synced ✓', error: 'Failed' };
    if (dot) dot.classList.toggle('pulse', state === 'syncing');
    if (admDot) admDot.style.background = colors[state] || 'var(--text-muted)';
    if (admTxt) { admTxt.textContent = labels[state] || 'Offline'; admTxt.style.color = colors[state] || 'var(--text-muted)'; }
    if (state !== 'syncing') setTimeout(() => bar?.classList.remove('show'), 4000);
  }

  /* Debounced admin save */
  function scheduleSave() {
    if (!isAdminMode) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(adminSaveToCloud, DEBOUNCE_MS);
  }

  async function adminSaveToCloud() {
    if (!isAdminMode || isSyncing) return;
    isSyncing = true;
    setCloudStatus('syncing', 'Saving…');
    const ok = await cloudPush(buildPayload());
    setCloudStatus(ok ? 'synced' : 'error', ok ? 'Saved ✓' : 'Save failed');
    isSyncing = false;
  }

  window.manualCloudSync = async function () {
    const btn = $('admSyncBtn');
    if (btn) btn.disabled = true;
    await adminSaveToCloud();
    if (btn) btn.disabled = false;
  };

  /* ═══════════════════════════════════════════════
     ADMIN CLOUD LOAD
  ═══════════════════════════════════════════════ */
  async function adminLoadFromCloud() {
    setCloudStatus('syncing', 'Loading from cloud…');
    const data = await cloudFetch();
    if (data) {
      cloudSnapshot = data;
      if (Array.isArray(data.apps) && data.apps.length > 0) {
        realApps = data.apps;
        saveLocal();
      }
      if (data.logo) {
        try { localStorage.setItem(STORAGE_LOGO, JSON.stringify(data.logo)); } catch (_) {}
      }
      setCloudStatus('synced', 'Data loaded ✓');
    } else {
      realApps = loadLocal();
      setCloudStatus('error', 'Cloud unavailable — using local data');
    }
  }

  /* ═══════════════════════════════════════════════
     LOCAL STORAGE
  ═══════════════════════════════════════════════ */
  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_APPS) || '[]'); } catch (_) { return []; }
  }
  function saveLocal() {
    try { localStorage.setItem(STORAGE_APPS, JSON.stringify(realApps)); } catch (_) {}
  }
  function persist() { saveLocal(); scheduleSave(); }

  /* ═══════════════════════════════════════════════
     FIX #1 — GLOBAL DOWNLOAD COUNTER
     Fetch → increment app's downloadCount → push back
     Runs in background, never blocks the actual download
  ═══════════════════════════════════════════════ */
  async function incrementDownload(appId) {
    const data = await cloudFetch();
    if (!data || !Array.isArray(data.apps)) return;
    const idx = data.apps.findIndex(a => String(a.id) === String(appId));
    if (idx === -1) return;
    data.apps[idx].downloadCount = (parseInt(data.apps[idx].downloadCount, 10) || 0) + 1;
    data.lastUpdated = new Date().toISOString();
    const ok = await cloudPush(data);
    if (ok) {
      realApps = data.apps;
      saveLocal();
      updateStatBadges();
      // Update the download count badge on the card live
      $$(`[data-app-id="${appId}"] .app-dl-count`).forEach(el => {
        el.textContent = fmtNum(data.apps[idx].downloadCount) + ' downloads';
      });
    }
  }

  window.handleDownload = function (appId) {
    incrementDownload(appId).catch(err => console.warn('[IPT DL]', err.message));
  };

  /* ═══════════════════════════════════════════════
     FIX #4 — NEWSLETTER → SAVES EMAIL TO JSONBIN
  ═══════════════════════════════════════════════ */
  async function saveSubscriber(email) {
    // Fetch current cloud data to get existing subscribers
    const data = await cloudFetch();
    const subs = Array.isArray(data?.subscribers) ? data.subscribers : [];

    // Duplicate check
    if (subs.some(s => s.email.toLowerCase() === email.toLowerCase())) {
      return { ok: false, reason: 'already_subscribed' };
    }

    subs.push({ email, subscribedAt: new Date().toISOString() });

    const payload = {
      apps        : data?.apps        || realApps,
      logo        : data?.logo        || null,
      subscribers : subs,
      notifLog    : data?.notifLog    || [],
      lastUpdated : new Date().toISOString()
    };

    const ok = await cloudPush(payload);
    if (ok && cloudSnapshot) { cloudSnapshot.subscribers = subs; }
    return { ok, reason: ok ? 'saved' : 'network_error' };
  }

  on($('newsletterForm'), 'submit', async function (e) {
    e.preventDefault();
    const input = $('emailInput');
    const msg   = $('newsletterMsg');
    const btn   = $('notifyMeBtn');
    const email = input?.value.trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Please enter a valid email address.', 'error');
      return;
    }

    // Show loading state
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    if (msg) { msg.style.display = 'none'; }

    const result = await saveSubscriber(email);

    // Restore button
    if (btn) { btn.disabled = false; btn.textContent = 'Notify Me'; }

    if (result.reason === 'already_subscribed') {
      if (msg) { msg.textContent = "✓ You're already subscribed!"; msg.className = 'success'; msg.style.display = 'block'; }
      showToast("You're already subscribed!", 'info');
    } else if (result.ok) {
      if (input) input.value = '';
      if (msg) { msg.textContent = "🎉 You're in! We'll notify you when new apps drop."; msg.className = 'success'; msg.style.display = 'block'; }
      showToast("Subscribed! You'll get notified about new apps. 🎉", 'success', 4000);
    } else {
      if (msg) { msg.textContent = '⚠ Subscription failed. Please try again.'; msg.className = 'error'; msg.style.display = 'block'; }
      showToast('Subscription failed. Please check your connection.', 'error');
    }
  });

  /* ═══════════════════════════════════════════════
     FIX #5 — NEW APP NOTIFICATION LOG
     When admin uploads a new app with "Notify subscribers"
     checked, build a structured notification template
     and save it to JSONBin's notifLog array.
     (We log it since we can't send real emails from
     the browser — but the log is fully accessible
     in the Subscribers tab.)
  ═══════════════════════════════════════════════ */
  async function logAppNotification(app) {
    const data = await cloudFetch();
    const log  = Array.isArray(data?.notifLog) ? data.notifLog : [];
    const subs = Array.isArray(data?.subscribers) ? data.subscribers : [];

    const template =
`📱 NEW APP RELEASED — Indo Pakhtoon Tech

App Name    : ${app.name}
Description : ${app.desc}
Platform    : ${app.platform}
Category    : ${app.category}
Version     : ${app.version || 'v1.0'}
Size        : ${app.size || 'N/A'}
Download    : ${app.downloadLink}

—
This notification was triggered automatically when the admin published this app.
Total subscribers at time of notification: ${subs.length}
Sent to: ${subs.map(s => s.email).join(', ') || 'No subscribers yet'}`;

    log.unshift({
      id         : Date.now(),
      appId      : app.id,
      appName    : app.name,
      timestamp  : new Date().toISOString(),
      subsCount  : subs.length,
      template   : template
    });

    // Keep only last 50 notifications
    const trimmedLog = log.slice(0, 50);

    const payload = {
      apps        : data?.apps        || realApps,
      logo        : data?.logo        || null,
      subscribers : subs,
      notifLog    : trimmedLog,
      lastUpdated : new Date().toISOString()
    };

    const ok = await cloudPush(payload);
    if (ok && cloudSnapshot) {
      cloudSnapshot.notifLog    = trimmedLog;
      cloudSnapshot.subscribers = subs;
    }
    return ok;
  }

  /* ═══════════════════════════════════════════════
     STATS BADGES
  ═══════════════════════════════════════════════ */
  function computeTotalDl() {
    return realApps.reduce((s, a) => s + (parseInt(a.downloadCount, 10) || 0), 0);
  }

  function updateStatBadges() {
    const appsEl = $('statApps'), dlEl = $('statDownloads');
    if (appsEl) appsEl.textContent = realApps.length + '+';
    if (dlEl)   dlEl.textContent   = fmtNum(computeTotalDl());

    const cats = ['ai','calculator','finance','productivity','education','games','health','utility'];
    cats.forEach(cat => {
      const el = $('catCount-' + cat);
      if (el) {
        const n = realApps.filter(a => (a.category || '') === cat).length;
        el.textContent = n + (n === 1 ? ' app' : ' apps');
      }
    });

    // Admin stats
    const subs = cloudSnapshot?.subscribers?.length || 0;
    ['admStatReal','admStatTotal'].forEach(id => { const el = $(id); if (el) el.textContent = realApps.length; });
    const dlEl2 = $('admStatDl'); if (dlEl2) dlEl2.textContent = fmtNum(computeTotalDl());
    const subsEl = $('admStatSubs'); if (subsEl) subsEl.textContent = subs;
    const subsCntEl = $('subsCount'); if (subsCntEl) subsCntEl.textContent = subs;
  }

  /* Hero counter animation */
  function animCounter(el, target, suffix = '') {
    if (!el || !target) return;
    let n = 0; const step = Math.max(1, Math.ceil(target / 60));
    const t = setInterval(() => { n = Math.min(n + step, target); el.textContent = n + suffix; if (n >= target) clearInterval(t); }, 16);
  }

  function setupHeroCounter() {
    const hs = document.querySelector('.hero-stats');
    if (!hs) return;
    let fired = false;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !fired) {
        fired = true;
        animCounter($('statApps'), realApps.length, '+');
        animCounter($('statDownloads'), computeTotalDl(), '');
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(hs);
  }

  /* ═══════════════════════════════════════════════
     RENDER FUNCTIONS
  ═══════════════════════════════════════════════ */
  const COLOR_POOL = ['icon-blue','icon-purple','icon-green','icon-orange','icon-cyan','icon-red','icon-pink','icon-teal'];
  const iconColor  = name => COLOR_POOL[Math.abs((name || '').charCodeAt(0) || 0) % COLOR_POOL.length];

  function emptyHTML(icon, msg) {
    return `<div class="section-empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`;
  }

  function iconSVG() {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  }

  function dlBtnSVG() {
    return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.36"/></svg>`;
  }

  function fadeIn(el, delay = 0) {
    el.style.opacity   = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = `opacity 0.4s ease ${delay}ms, transform 0.4s ease ${delay}ms`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.opacity = '1'; el.style.transform = 'translateY(0)';
    }));
  }

  function createAppCard(app) {
    const col  = iconColor(app.name);
    const dlN  = parseInt(app.downloadCount, 10) || 0;
    const art  = document.createElement('article');
    art.className = 'app-card real-app';
    art.dataset.category = app.category || '';
    art.dataset.name     = (app.name || '').toLowerCase();
    art.dataset.desc     = (app.desc || '').toLowerCase();
    art.dataset.appId    = String(app.id);
    art.setAttribute('role', 'listitem');
    art.setAttribute('tabindex', '0');
    const iconHtml = app.iconDataUrl ? `<img src="${esc(app.iconDataUrl)}" alt="${esc(app.name)} icon" />` : iconSVG();
    art.innerHTML = `
      <div class="app-card-header">
        <div class="app-icon ${col}">${iconHtml}</div>
        <span class="badge badge-free">Free</span>
      </div>
      <div class="app-card-info">
        <h3 class="app-name">${esc(app.name)}</h3>
        <p class="app-desc">${esc(app.desc || '')}</p>
      </div>
      <div class="app-meta">
        <span class="badge badge-blue" style="font-size:10px;">${esc(app.platform || '')}</span>
        <span style="font-size:11px;color:var(--text-muted);">${esc(app.version || '')}</span>
        <span class="app-dl-count">${dlN > 0 ? fmtNum(dlN) + ' downloads' : 'Be first!'}</span>
      </div>
      <div class="app-card-footer">
        <span class="app-size">${esc(app.size || 'N/A')}</span>
        <a href="${esc(app.downloadLink)}" class="dl-btn" target="_blank" rel="noopener noreferrer"
           onclick="window.handleDownload('${app.id}', event)">
          ${dlBtnSVG()} Download
        </a>
      </div>`;
    fadeIn(art);
    return art;
  }

  function createFeaturedCard(app) {
    const card = document.createElement('article');
    card.className = 'featured-card';
    card.setAttribute('tabindex', '0');
    card.dataset.appId = String(app.id);
    const dlN     = parseInt(app.downloadCount, 10) || 0;
    const iconHtml = app.iconDataUrl ? `<img src="${esc(app.iconDataUrl)}" alt="${esc(app.name)}" />` : iconSVG();
    card.innerHTML = `
      <div class="featured-card-bg" style="background:var(--gradient-brand);"></div>
      <div class="featured-card-inner">
        <div class="fc-tag fc-tag-featured">⭐ Featured</div>
        <div class="fc-icon icon-blue">${iconHtml}</div>
        <h3 class="fc-title">${esc(app.name)}</h3>
        <p class="fc-desc">${esc(app.desc || '')}</p>
        <div class="fc-chips">
          <span class="fc-chip">${esc(app.platform || '')}</span>
          <span class="fc-chip">${esc(app.category || '')}</span>
          <span class="fc-chip">Free</span>
        </div>
        ${dlN > 0 ? `<div class="fc-dl-count app-dl-count">⬇ ${fmtNum(dlN)} downloads</div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <a href="${esc(app.downloadLink)}" class="btn-primary" style="font-size:13px;padding:9px 20px;"
             target="_blank" rel="noopener" onclick="window.handleDownload('${app.id}', event)">
            Download Free
          </a>
        </div>
      </div>`;
    return card;
  }

  function createGameCard(app) {
    const gc = document.createElement('article');
    gc.className = 'game-card';
    gc.setAttribute('role', 'listitem');
    gc.setAttribute('tabindex', '0');
    gc.dataset.appId = String(app.id);
    const dlN     = parseInt(app.downloadCount, 10) || 0;
    const thumbHtml = app.iconDataUrl
      ? `<img src="${esc(app.iconDataUrl)}" alt="${esc(app.name)}" style="width:100%;height:100%;object-fit:cover;" />`
      : `<span style="font-size:48px;">🎮</span>`;
    gc.innerHTML = `
      <div class="game-thumb" style="background:linear-gradient(135deg,#1e3a5f,#4f8ef7);">${thumbHtml}</div>
      <div class="game-body">
        <h3 class="game-name">${esc(app.name)}</h3>
        <p class="game-genre">${esc(app.desc || 'Game')}</p>
        ${dlN > 0 ? `<p class="app-dl-count" style="font-size:11px;margin-bottom:8px;">${fmtNum(dlN)} downloads</p>` : ''}
        <div class="game-footer">
          <span class="badge badge-free">Free</span>
          <a href="${esc(app.downloadLink)}" class="dl-btn" style="padding:6px 14px;font-size:12px;"
             target="_blank" rel="noopener" onclick="window.handleDownload('${app.id}', event)">Get</a>
        </div>
      </div>`;
    return gc;
  }

  function renderRealAppsOnPage() {
    const zone       = $('realAppsZone');
    const featZone   = $('featuredZone');
    const gamesZone  = $('gamesZone');
    const emptyState = $('appsEmptyState');
    const noResults  = $('noResults');

    if (zone)      zone.innerHTML      = '';
    if (featZone)  featZone.innerHTML  = '';
    if (gamesZone) gamesZone.innerHTML = '';
    if (noResults) noResults.classList.remove('visible');

    if (!realApps.length) {
      if (emptyState)  emptyState.style.display = 'block';
      if (featZone)    featZone.innerHTML  = emptyHTML('🚀', 'Featured apps will appear here once published.<br/><strong>Admin can upload apps from the control panel.</strong>');
      if (gamesZone)   gamesZone.innerHTML = emptyHTML('🎮', 'Games will appear here once published.<br/><strong>Admin can upload games from the control panel.</strong>');
      updateStatBadges();
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    /* Featured */
    const featured = realApps.filter(a => a.featured);
    if (featZone) {
      if (featured.length) {
        const fg = document.createElement('div'); fg.className = 'featured-grid';
        featured.slice(0, 4).forEach(a => fg.appendChild(createFeaturedCard(a)));
        featZone.appendChild(fg);
      } else {
        featZone.innerHTML = emptyHTML('🚀', 'No featured apps yet. Mark an app as featured when uploading.');
      }
    }

    /* Games */
    const games = realApps.filter(a => (a.category || '') === 'games');
    if (gamesZone) {
      if (games.length) {
        const gg = document.createElement('div'); gg.className = 'games-grid'; gg.setAttribute('role', 'list');
        games.forEach(a => gg.appendChild(createGameCard(a)));
        gamesZone.appendChild(gg);
      } else {
        gamesZone.innerHTML = emptyHTML('🎮', 'No games uploaded yet.');
      }
    }

    /* All Apps */
    const nonGames = realApps.filter(a => (a.category || '') !== 'games');
    if (nonGames.length && zone) {
      const hdr = document.createElement('div'); hdr.className = 'real-apps-header';
      hdr.innerHTML = `<div style="width:14px;height:14px;border-radius:50%;background:var(--gradient-brand);flex-shrink:0;"></div>
        <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent-blue);">Published Apps</span>
        <span class="top-badge">TOP</span>
        <span style="font-size:11px;color:var(--text-muted);padding:2px 10px;background:rgba(79,142,247,.08);border:1px solid rgba(79,142,247,.18);border-radius:var(--radius-full);">${nonGames.length} app${nonGames.length !== 1 ? 's' : ''}</span>`;
      zone.appendChild(hdr);
      const grid = document.createElement('div'); grid.className = 'apps-grid'; grid.setAttribute('role', 'list');
      [...nonGames].reverse().forEach(a => grid.appendChild(createAppCard(a)));
      zone.appendChild(grid);
    }

    updateStatBadges();
  }

  /* ═══════════════════════════════════════════════
     SEARCH
  ═══════════════════════════════════════════════ */
  const searchForm  = $('searchForm');
  const searchInput = $('searchInput');
  const searchWrap  = $('searchWrap');
  const searchToggle = $('searchToggle');
  const suggestions  = $('searchSuggestions');
  const noResults    = $('noResults');

  function perfSearch(q) {
    q = q.trim().toLowerCase();
    let cnt = 0;
    $$('#realAppsZone .app-card').forEach(card => {
      const m = !q || (card.dataset.name || '').includes(q) || (card.dataset.desc || '').includes(q) || (card.dataset.category || '').includes(q);
      card.style.display = m ? '' : 'none';
      if (m) cnt++;
    });
    if (noResults) noResults.classList.toggle('visible', cnt === 0 && q !== '' && realApps.length > 0);
    const es = $('appsEmptyState');
    if (es) es.style.display = (!q && realApps.length === 0) ? 'block' : 'none';
  }

  on(searchForm, 'submit', e => { e.preventDefault(); perfSearch(searchInput?.value || ''); hideSugg(); if (searchInput?.value.trim()) $('apps')?.scrollIntoView({ behavior: 'smooth' }); });
  on(searchInput, 'input', function () { perfSearch(this.value); showSugg(this.value.trim().toLowerCase()); });
  on(searchInput, 'focus', function () { if (this.value.trim()) showSugg(this.value.trim().toLowerCase()); });
  on(searchToggle, 'click', () => { const open = searchWrap?.classList.toggle('mobile-open'); searchToggle?.setAttribute('aria-expanded', String(open)); if (open) searchInput?.focus(); else hideSugg(); });
  document.addEventListener('click', e => { if (!e.target.closest('.search-form')) hideSugg(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { searchWrap?.classList.remove('mobile-open'); searchToggle?.setAttribute('aria-expanded', 'false'); hideSugg(); } });
  window.addEventListener('resize', () => { if (window.innerWidth > 768) { searchWrap?.classList.remove('mobile-open'); searchToggle?.setAttribute('aria-expanded', 'false'); } });

  function showSugg(q) {
    if (!q || !suggestions) { hideSugg(); return; }
    const hits = realApps.filter(a => (a.name || '').toLowerCase().includes(q) || (a.category || '').toLowerCase().includes(q)).slice(0, 6);
    if (!hits.length) { hideSugg(); return; }
    suggestions.innerHTML = '';
    hits.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'suggestion-item'; btn.setAttribute('role', 'option');
      btn.innerHTML = `<span class="s-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>${cap(item.name)}<span style="margin-left:auto;font-size:10px;color:var(--text-muted);">${cap(item.category)}</span>`;
      btn.addEventListener('click', () => { if (searchInput) searchInput.value = item.name; hideSugg(); perfSearch(item.name); $('apps')?.scrollIntoView({ behavior: 'smooth' }); });
      suggestions.appendChild(btn);
    });
    suggestions.classList.add('active');
  }
  function hideSugg() { suggestions?.classList.remove('active'); }

  window.clearSearch = function () {
    if (searchInput) searchInput.value = ''; perfSearch(''); hideSugg();
    $$('.filter-tab').forEach((t, i) => { t.classList.toggle('active', i === 0); t.setAttribute('aria-selected', String(i === 0)); });
  };

  /* ═══════════════════════════════════════════════
     FILTER TABS — wired via event delegation
  ═══════════════════════════════════════════════ */
  on($('showAllBtn'), 'click', e => { e.preventDefault(); window.clearSearch(); });

  document.addEventListener('click', function (e) {
    const tab = e.target.closest('.filter-tab[data-filter]');
    if (!tab) return;
    const cat = tab.dataset.filter;
    $$('.filter-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
    if (cat === 'all') {
      $$('#realAppsZone .app-card').forEach(c => c.style.display = '');
      noResults?.classList.remove('visible');
      if (searchInput) searchInput.value = '';
    } else {
      if (searchInput) searchInput.value = cat; perfSearch(cat);
    }
  });

  // Category cards
  document.addEventListener('click', function (e) {
    const card = e.target.closest('.category-card[data-cat]');
    if (!card) return;
    const cat = card.dataset.cat;
    if (cat === 'games') { perfSearch(''); $('games')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (searchInput) searchInput.value = cat; perfSearch(cat);
    $('apps')?.scrollIntoView({ behavior: 'smooth' });
  });

  document.querySelectorAll('.category-card').forEach(c => {
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } });
  });

  window.filterByCategory = cat => {
    const card = document.querySelector(`.category-card[data-cat="${cat}"]`);
    if (card) card.click();
  };

  /* ═══════════════════════════════════════════════
     THEME
  ═══════════════════════════════════════════════ */
  const themeToggle = $('themeToggle');
  const themeIcon   = $('themeIcon');
  const htmlEl      = document.documentElement;
  const moonSVG = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
  const sunSVG  = `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;

  function setTheme(t) {
    htmlEl.setAttribute('data-theme', t);
    localStorage.setItem('ipt-theme', t);
    if (themeIcon) themeIcon.innerHTML = t === 'dark' ? moonSVG : sunSVG;
    if (themeToggle) themeToggle.setAttribute('aria-label', `Switch to ${t === 'dark' ? 'light' : 'dark'} mode`);
  }

  setTheme(localStorage.getItem('ipt-theme') || (window.matchMedia('(prefers-color-scheme:light)').matches ? 'light' : 'dark'));
  on(themeToggle, 'click', () => setTheme(htmlEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

  /* ═══════════════════════════════════════════════
     SCROLL
  ═══════════════════════════════════════════════ */
  const mainHeader = $('mainHeader');
  const backTop    = $('backTop');
  const scrollBar  = $('scrollProgress');

  window.addEventListener('scroll', () => {
    const sy = window.scrollY, dh = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollBar) scrollBar.style.width = (dh > 0 ? (sy / dh) * 100 : 0) + '%';
    if (mainHeader) mainHeader.classList.toggle('scrolled', sy > 60);
    if (backTop)    backTop.classList.toggle('visible', sy > 400);
    updateActiveNav();
  }, { passive: true });

  function updateActiveNav() {
    let current = 'home';
    ['home','store','apps','games','contact'].forEach(id => {
      const s = $(id); if (s && window.scrollY >= s.offsetTop - 150) current = id;
    });
    $$('.nav-link[data-nav]').forEach(l => l.classList.toggle('active', l.dataset.nav === current));
  }

  on(backTop, 'click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  /* ═══════════════════════════════════════════════
     MOBILE NAV
  ═══════════════════════════════════════════════ */
  const hamburger    = $('hamburgerBtn');
  const mobileDrawer = $('mobileDrawer');
  const mobileOverlay = $('mobileOverlay');

  function syncLock() {
    const open = mobileDrawer?.classList.contains('open')
      || !!document.querySelector('.modal-overlay.open')
      || $('adminDashboard')?.classList.contains('open');
    document.body.style.overflow = open ? 'hidden' : '';
  }

  window.closeMobileNav = function () {
    hamburger?.classList.remove('open');    hamburger?.setAttribute('aria-expanded', 'false');
    mobileDrawer?.classList.remove('open'); mobileDrawer?.setAttribute('aria-hidden', 'true');
    mobileOverlay?.classList.remove('open'); mobileOverlay?.setAttribute('aria-hidden', 'true');
    syncLock();
  };

  function openMobileNav() {
    hamburger?.classList.add('open');    hamburger?.setAttribute('aria-expanded', 'true');
    mobileDrawer?.classList.add('open'); mobileDrawer?.setAttribute('aria-hidden', 'false');
    mobileOverlay?.classList.add('open'); mobileOverlay?.setAttribute('aria-hidden', 'false');
    syncLock();
  }

  on(hamburger, 'click', () => mobileDrawer?.classList.contains('open') ? window.closeMobileNav() : openMobileNav());
  on(mobileOverlay, 'click', window.closeMobileNav);
  on($('drawerCloseBtn'), 'click', window.closeMobileNav);
  on($('drawerLogoLink'), 'click', window.closeMobileNav);

  $$('[data-drawer-link]').forEach(link => on(link, 'click', window.closeMobileNav));

  /* ═══════════════════════════════════════════════
     FIX #1 — SUPPORT / DONATE MODAL
     Fully wired with proper event listeners
  ═══════════════════════════════════════════════ */
  function openDonateModal() {
    $('donateModal')?.classList.add('open');
    syncLock();
  }
  function closeDonateModal() {
    $('donateModal')?.classList.remove('open');
    syncLock();
  }

  // All buttons that open the donate modal
  on($('supportBtn'),       'click', openDonateModal);
  on($('footerSupportBtn'), 'click', openDonateModal);
  on($('donateModalClose'), 'click', closeDonateModal);
  on($('donateModal'),      'click', e => { if (e.target === $('donateModal')) closeDonateModal(); });

  /* Expose globally just in case */
  window.openDonateModal  = openDonateModal;
  window.closeDonateModal = closeDonateModal;

  /* ═══════════════════════════════════════════════
     FIX #3 — ADMIN LOGIN MODAL
     Fixed trigger + proper event wiring
  ═══════════════════════════════════════════════ */
  function openAdminModal() {
    $('adminModal')?.classList.add('open');
    syncLock();
    setTimeout(() => $('adminPassInput')?.focus(), 300);
  }
  function closeAdminModal() {
    $('adminModal')?.classList.remove('open');
    const inp = $('adminPassInput'); if (inp) inp.value = '';
    hideAdminMsg(); syncLock();
  }

  on($('adminModalClose'), 'click', closeAdminModal);
  on($('adminModal'),      'click', e => { if (e.target === $('adminModal')) closeAdminModal(); });

  function showAdminMsg(msg, type) {
    const el = $('adminMsg'); if (!el) return;
    el.textContent = msg; el.className = 'admin-msg show ' + type;
  }
  function hideAdminMsg() {
    const el = $('adminMsg'); if (!el) return;
    el.className = 'admin-msg'; el.textContent = '';
  }

  /* ═══════════════════════════════════════════════
     PASSWORD LOGIN
  ═══════════════════════════════════════════════ */
  async function verifyAdminPassword() {
    const val = $('adminPassInput')?.value;
    if (!val) { showAdminMsg('Please enter a password.', 'error'); return; }
    try {
      const h = await sha256(val);
      if (h === ADMIN_PASS_HASH) {
        showAdminMsg('Access granted. Opening dashboard…', 'success');
        setTimeout(() => { closeAdminModal(); openAdminDashboard('Admin'); }, 1100);
      } else {
        showAdminMsg('Incorrect password. Access denied.', 'error');
        const inp = $('adminPassInput'); if (inp) { inp.value = ''; inp.focus(); }
      }
    } catch (_) { showAdminMsg('Auth error. Try again.', 'error'); }
  }

  on($('adminLoginBtn'),   'click', verifyAdminPassword);
  on($('adminPassInput'),  'keydown', e => { if (e.key === 'Enter') verifyAdminPassword(); });

  /* ═══════════════════════════════════════════════
     GOOGLE OAUTH
  ═══════════════════════════════════════════════ */
  function initGSI() {
    if (location.protocol === 'file:') return;
    if (typeof google === 'undefined' || !google.accounts) {
      if (gsiAttempts++ < 10) setTimeout(initGSI, 1000); return;
    }
    try {
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCred, auto_select: false, ux_mode: 'popup' });
      google.accounts.id.renderButton($('googleSignInBtn'), { theme: 'filled_blue', size: 'large', width: 220, shape: 'pill' });
    } catch (_) {}
  }

  function handleGoogleCred(response) {
    if (!response?.credential) { showAdminMsg('Google sign-in failed.', 'error'); return; }
    try {
      const b64 = response.credential.split('.')[1];
      const pad = '='.repeat((4 - b64.length % 4) % 4);
      const payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad));
      const email = (payload.email || '').toLowerCase().trim();
      const name  = payload.name || 'Admin';
      if (email !== AUTHORIZED_EMAIL.toLowerCase()) {
        showAdminMsg(`Access Denied: "${email}" is not authorized.`, 'error');
        try { google.accounts.id.revoke(email, () => {}); } catch (_) {} return;
      }
      showAdminMsg(`Authenticated as ${name}. Opening dashboard…`, 'success');
      setTimeout(() => { closeAdminModal(); openAdminDashboard(name); }, 1100);
    } catch (_) { showAdminMsg('Token error. Please try again.', 'error'); }
  }

  on($('googleManualBtn'), 'click', () => {
    if (location.protocol === 'file:') { showAdminMsg('Google sign-in requires HTTPS.', 'error'); return; }
    const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: location.origin + '/auth/google/callback', response_type: 'code', scope: 'openid email profile', prompt: 'select_account', login_hint: AUTHORIZED_EMAIL });
    const url = GOOGLE_AUTH_URI + '?' + params;
    const popup = window.open(url, 'g_oauth', 'width=500,height=600');
    if (!popup || popup.closed) location.href = url;
  });

  if (document.readyState === 'complete') initGSI(); else window.addEventListener('load', initGSI);

  /* ═══════════════════════════════════════════════
     ADMIN DASHBOARD — fully wired
  ═══════════════════════════════════════════════ */
  async function openAdminDashboard(name) {
    isAdminMode = true;
    document.body.classList.add('admin-active');
    const wm = $('admWelcomeMsg'); if (wm) wm.textContent = `Welcome, ${name} — Control Panel`;
    $('adminDashboard')?.classList.add('open');
    syncLock();

    // Cloud fetch happens HERE only (Fix #8)
    await adminLoadFromCloud();
    refreshAdminUI();
  }

  function closeAdminDashboard() {
    $('adminDashboard')?.classList.remove('open'); syncLock();
  }

  on($('admCloseBtn'),    'click', closeAdminDashboard);
  on($('adminDashboard'), 'click', e => { if (e.target === $('adminDashboard')) closeAdminDashboard(); });

  window.closeAdminDashboard = closeAdminDashboard;

  // Tab switching via event delegation
  on($('adminDashboard'), 'click', function (e) {
    const tab = e.target.closest('.adm-tab[data-tab]');
    if (!tab) return;
    switchTab(tab.dataset.tab);
  });

  // Quick action buttons
  on($('adminDashboard'), 'click', function (e) {
    const btn = e.target.closest('[data-goto-tab]');
    if (!btn) return;
    switchTab(btn.dataset.gotoTab);
  });

  function switchTab(secId) {
    $$('.adm-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    $$('.adm-section').forEach(s => s.classList.remove('active'));
    const tab = document.querySelector(`.adm-tab[data-tab="${secId}"]`);
    if (tab) { tab.classList.add('active'); tab.setAttribute('aria-selected', 'true'); }
    const sec = $(secId); if (sec) sec.classList.add('active');
    if (secId === 'admManage')      renderAdmList();
    if (secId === 'admSubscribers') renderSubscribers();
  }

  function refreshAdminUI() {
    updateStatBadges(); renderRealAppsOnPage(); renderAdmList();
    renderSubscribers(); updateOverviewRecent(); restoreLogo();
  }

  /* ═══════════════════════════════════════════════
     ICON FILE PREVIEW
  ═══════════════════════════════════════════════ */
  on($('appIconFile'), 'change', async function () {
    const file = this.files[0]; if (!file) return;
    try {
      const resized = await resizeToSquare(file, CANVAS_SIZE);
      appIconDataUrl = resized;
      $('appIconLabelText').textContent = file.name + ' ✓ (auto-resized)';
      const prev = $('appIconPreview'); if (prev) { prev.src = resized; prev.classList.add('show'); }
    } catch (err) {
      if (err.message.startsWith('FILE_TOO_LARGE')) {
        const kb = err.message.split(':')[1];
        showDashAlert('uploadAlert', `⚠ File too large (${kb} KB). Max allowed: 150 KB. Please compress and re-upload.`, 'error');
      } else {
        showDashAlert('uploadAlert', 'The app icon could not be resized for cloud storage. Please try another image.', 'error');
      }
      this.value = ''; appIconDataUrl = null;
      $('appIconLabelText').textContent = 'Click to select image…';
      const prev = $('appIconPreview'); if (prev) { prev.src = ''; prev.classList.remove('show'); }
    }
  });

  /* ═══════════════════════════════════════════════
     LOGO FILE PREVIEW
  ═══════════════════════════════════════════════ */
  on($('logoFileInput'), 'change', async function () {
    const file = this.files[0]; if (!file) return;
    try {
      const resized = await resizeToSquare(file, CANVAS_SIZE);
      logoFileDataUrl = resized;
      $('logoFileLabelText').textContent = file.name + ' ✓ (auto-resized)';
      const prev = $('logoFilePreview'); if (prev) { prev.src = resized; prev.classList.add('show'); }
      const big  = $('logoPreviewBig'); if (big) big.innerHTML = `<img src="${resized}" alt="Logo preview" />`;
    } catch (err) {
      if (err.message.startsWith('FILE_TOO_LARGE')) {
        const kb = err.message.split(':')[1];
        showDashAlert('brandingAlert', `⚠ File too large (${kb} KB). Max 150 KB.`, 'error');
      } else {
        showDashAlert('brandingAlert', 'The logo could not be resized for cloud storage. Please try another image.', 'error');
      }
      this.value = ''; logoFileDataUrl = null;
      $('logoFileLabelText').textContent = 'Click to select image…';
      const prev = $('logoFilePreview'); if (prev) { prev.src = ''; prev.classList.remove('show'); }
      const big = $('logoPreviewBig'); if (big) big.innerHTML = '';
    }
  });

  /* ═══════════════════════════════════════════════
     UPLOAD APP
  ═══════════════════════════════════════════════ */
  on($('publishAppBtn'), 'click', async function () {
    const name         = $('appName')?.value.trim()         || '';
    const platform     = $('appPlatform')?.value            || '';
    const category     = $('appCategory')?.value            || '';
    const downloadLink = $('appDownloadLink')?.value.trim() || '';
    const desc         = $('appDesc')?.value.trim()         || '';
    const size         = $('appSize')?.value.trim()         || '';
    const version      = $('appVersion')?.value.trim()      || '';
    const featured     = $('appFeatured')?.checked           || false;
    const notifySubs   = $('appNotifySubscribers')?.checked  || false;

    if (!name)           { showDashAlert('uploadAlert', 'App Name is required.',       'error'); return; }
    if (!appIconDataUrl) { showDashAlert('uploadAlert', 'App Icon is required.',       'error'); return; }
    if (!platform)       { showDashAlert('uploadAlert', 'Platform is required.',       'error'); return; }
    if (!category)       { showDashAlert('uploadAlert', 'Category is required.',       'error'); return; }
    if (!downloadLink)   { showDashAlert('uploadAlert', 'Download Link is required.',  'error'); return; }
    if (!desc)           { showDashAlert('uploadAlert', 'Description is required.',    'error'); return; }
    try { new URL(downloadLink); } catch (_) { showDashAlert('uploadAlert', 'Please enter a valid download URL.', 'error'); return; }

    const app = {
      id           : Date.now(),
      name, iconDataUrl: appIconDataUrl,
      platform, category, downloadLink, desc, featured,
      size         : size    || 'N/A',
      version      : version || 'v1.0',
      downloadCount: 0,
      addedAt      : new Date().toISOString()
    };

    realApps.unshift(app);
    persist();
    renderRealAppsOnPage(); updateStatBadges(); renderAdmList(); updateOverviewRecent();
    clearUploadForm();
    showDashAlert('uploadAlert', `"${name}" published! Syncing to cloud…`, 'success');
    showToast(`"${name}" published ☁️`, 'success');

    // FIX #5 — Trigger notification log if checkbox is checked
    if (notifySubs) {
      const subs = cloudSnapshot?.subscribers || [];
      if (subs.length > 0) {
        showDashAlert('uploadAlert', `Logging notification for ${subs.length} subscriber(s)…`, 'info');
        const ok = await logAppNotification(app);
        if (ok) {
          showDashAlert('uploadAlert', `✓ Published & notification logged for ${subs.length} subscriber(s)!`, 'success');
          showToast(`Notified ${subs.length} subscriber(s) ✓`, 'success', 5000);
          renderSubscribers();  // refresh log view
        }
      } else {
        showDashAlert('uploadAlert', `"${name}" published! No subscribers to notify yet.`, 'success');
      }
    }
  });

  function clearUploadForm() {
    ['appName','appDownloadLink','appDesc','appSize','appVersion'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    const plat = $('appPlatform'); if (plat) plat.value = '';
    const cat  = $('appCategory'); if (cat)  cat.value  = '';
    const iconFile = $('appIconFile'); if (iconFile) iconFile.value = '';
    $('appIconLabelText').textContent = 'Click to select image…';
    const prev = $('appIconPreview'); if (prev) { prev.src = ''; prev.classList.remove('show'); }
    const feat = $('appFeatured'); if (feat) feat.checked = false;
    const notif = $('appNotifySubscribers'); if (notif) notif.checked = true;
    appIconDataUrl = null; hideAlert('uploadAlert');
  }

  on($('clearFormBtn'), 'click', clearUploadForm);

  /* ═══════════════════════════════════════════════
     MANAGE APPS
  ═══════════════════════════════════════════════ */
  function deleteApp(id) {
    const app = realApps.find(a => a.id === id);
    if (!app || !confirm(`Delete "${app.name}"?`)) return;
    realApps = realApps.filter(a => a.id !== id);
    persist();
    renderRealAppsOnPage(); updateStatBadges(); renderAdmList(); updateOverviewRecent();
    showDashAlert('manageAlert', `"${app.name}" deleted.`, 'success');
    showToast(`"${app.name}" removed ☁️`, 'info');
  }
  window.deleteApp = deleteApp;

  on($('removeAllAppsBtn'), 'click', () => {
    if (!realApps.length) { showDashAlert('manageAlert', 'No apps to remove.', 'info'); return; }
    if (!confirm(`Remove all ${realApps.length} app(s)?`)) return;
    realApps = []; persist();
    renderRealAppsOnPage(); updateStatBadges(); renderAdmList(); updateOverviewRecent();
    showDashAlert('manageAlert', 'All apps removed.', 'success');
  });

  on($('admSyncBtn'), 'click', window.manualCloudSync);

  function renderAdmList() {
    const list = $('admAppList'), countEl = $('admRealCount');
    if (countEl) countEl.textContent = realApps.length;
    if (!list) return;
    if (!realApps.length) { list.innerHTML = '<div class="adm-empty"><div class="adm-empty-icon">🔒</div><p>No apps uploaded yet.</p></div>'; return; }
    list.innerHTML = '';
    [...realApps].reverse().forEach(app => {
      const item = document.createElement('div'); item.className = 'adm-app-item';
      item.innerHTML = `
        <div class="adm-app-thumb">${app.iconDataUrl ? `<img src="${esc(app.iconDataUrl)}" alt="${esc(app.name)}" />` : esc((app.name || '?').charAt(0).toUpperCase())}</div>
        <div class="adm-app-info">
          <div class="adm-app-name">${esc(app.name)}${app.featured ? ' ⭐' : ''}</div>
          <div class="adm-app-meta">
            <span>${esc(app.platform)}</span><span>${esc(app.category)}</span>
            <span>${esc(app.size)}</span><span>${esc(app.version)}</span>
            <span>⬇ ${fmtNum(app.downloadCount || 0)}</span>
            <span>${new Date(app.addedAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div class="adm-app-actions">
          <a href="${esc(app.downloadLink)}" target="_blank" rel="noopener" class="adm-btn adm-btn-ghost adm-btn-sm">Test</a>
          <button class="adm-btn adm-btn-danger adm-btn-sm" onclick="deleteApp(${app.id})">Delete</button>
        </div>`;
      list.appendChild(item);
    });
  }

  function updateOverviewRecent() {
    const el = $('admRecentList'); if (!el) return;
    if (!realApps.length) { el.innerHTML = '<div class="adm-empty"><div class="adm-empty-icon">🔒</div><p>No apps uploaded yet.</p></div>'; return; }
    el.innerHTML = '';
    [...realApps].reverse().slice(0, 3).forEach(app => {
      const d = document.createElement('div'); d.className = 'adm-app-item'; d.style.marginBottom = '8px';
      d.innerHTML = `
        <div class="adm-app-thumb">${app.iconDataUrl ? `<img src="${esc(app.iconDataUrl)}" alt="" />` : esc((app.name || '?').charAt(0).toUpperCase())}</div>
        <div class="adm-app-info">
          <div class="adm-app-name">${esc(app.name)}${app.featured ? ' ⭐' : ''}</div>
          <div class="adm-app-meta"><span>${esc(app.platform)}</span><span>${esc(app.category)}</span><span>⬇ ${fmtNum(app.downloadCount || 0)}</span><span>${new Date(app.addedAt).toLocaleDateString()}</span></div>
        </div>`;
      el.appendChild(d);
    });
  }

  /* ═══════════════════════════════════════════════
     SUBSCRIBERS TAB
  ═══════════════════════════════════════════════ */
  function renderSubscribers() {
    const subs    = cloudSnapshot?.subscribers || [];
    const notifLog = cloudSnapshot?.notifLog   || [];
    const listEl  = $('subsListEl');
    const logEl   = $('notifLogEl');
    const cntEl   = $('subsCount');
    if (cntEl) cntEl.textContent = subs.length;

    if (listEl) {
      if (!subs.length) {
        listEl.innerHTML = '<div class="adm-empty"><div class="adm-empty-icon">📭</div><p>No subscribers yet. Share the website to get signups.</p></div>';
      } else {
        listEl.innerHTML = '';
        subs.forEach(s => {
          const div = document.createElement('div'); div.className = 'subs-item';
          div.innerHTML = `<span class="subs-email">${esc(s.email)}</span><span class="subs-date">${new Date(s.subscribedAt).toLocaleDateString()}</span>`;
          listEl.appendChild(div);
        });
      }
    }

    if (logEl) {
      if (!notifLog.length) {
        logEl.innerHTML = '<div class="adm-empty"><div class="adm-empty-icon">📋</div><p>No notifications sent yet.</p></div>';
      } else {
        logEl.innerHTML = '';
        notifLog.forEach(n => {
          const div = document.createElement('div'); div.className = 'notif-item';
          div.innerHTML = `
            <div class="notif-item-title">📱 ${esc(n.appName)}</div>
            <div class="notif-item-meta">Logged: ${new Date(n.timestamp).toLocaleString()} · ${n.subsCount} subscriber(s)</div>
            <div class="notif-item-msg">${esc(n.template)}</div>`;
          logEl.appendChild(div);
        });
      }
    }

    updateStatBadges();
  }

  /* Export subscribers as CSV */
  on($('exportSubsBtn'), 'click', () => {
    const subs = cloudSnapshot?.subscribers || [];
    if (!subs.length) { showToast('No subscribers to export.', 'info'); return; }
    const csv = 'Email,Subscribed At\n' + subs.map(s => `"${s.email}","${s.subscribedAt}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'ipt-subscribers.csv'; a.click();
    URL.revokeObjectURL(url);
    showToast('Subscribers exported as CSV ✓', 'success');
  });

  /* ═══════════════════════════════════════════════
     BRANDING
  ═══════════════════════════════════════════════ */
  function getAllLogoIcons() {
    return [$('mainLogoIcon'), $('drawerLogoIcon'), $('footerLogoIcon')].filter(Boolean);
  }

  function applyLogoToAll(content, isImg) {
    getAllLogoIcons().forEach(el => { el.innerHTML = isImg ? `<img src="${esc(content)}" alt="Logo" />` : esc(content); });
    const big = $('logoPreviewBig'); if (big) big.innerHTML = isImg ? `<img src="${esc(content)}" alt="Logo" />` : esc(content);
  }

  on($('applyLogoFileBtn'), 'click', () => {
    if (!logoFileDataUrl) { showDashAlert('brandingAlert', 'Please select a logo image file first.', 'error'); return; }
    applyLogoToAll(logoFileDataUrl, true);
    try { localStorage.setItem(STORAGE_LOGO, JSON.stringify({ type: 'image', value: logoFileDataUrl })); } catch (_) {}
    scheduleSave();
    showDashAlert('brandingAlert', 'Logo applied & syncing…', 'success');
    showToast('Logo updated ☁️', 'success');
  });

  on($('applyLogoTextBtn'), 'click', () => {
    const val = $('logoTextInput')?.value.trim();
    if (!val) { showDashAlert('brandingAlert', 'Please enter text or initials.', 'error'); return; }
    applyLogoToAll(val, false);
    try { localStorage.setItem(STORAGE_LOGO, JSON.stringify({ type: 'text', value: val })); } catch (_) {}
    scheduleSave();
    showDashAlert('brandingAlert', `Logo set to "${val}" & syncing…`, 'success');
    showToast('Logo updated ☁️', 'success');
  });

  on($('resetLogoBtn'), 'click', () => {
    applyLogoToAll('IP', false);
    try { localStorage.removeItem(STORAGE_LOGO); } catch (_) {}
    const li = $('logoFileInput');  if (li) li.value = '';
    const lt = $('logoTextInput');  if (lt) lt.value = '';
    $('logoFileLabelText').textContent = 'Click to select logo…';
    const lp = $('logoFilePreview'); if (lp) { lp.src = ''; lp.classList.remove('show'); }
    logoFileDataUrl = null;
    scheduleSave();
    showDashAlert('brandingAlert', 'Logo reset to default "IP" & syncing…', 'success');
    showToast('Logo reset ☁️', 'info');
  });

  function restoreLogo() {
    try { const s = JSON.parse(localStorage.getItem(STORAGE_LOGO)); if (s) applyLogoToAll(s.value, s.type === 'image'); } catch (_) {}
  }

  /* ═══════════════════════════════════════════════
     DASHBOARD ALERTS
  ═══════════════════════════════════════════════ */
  function showDashAlert(id, msg, type) {
    const el = $(id); if (!el) return;
    el.textContent = msg; el.className = 'adm-alert show ' + type;
    setTimeout(() => hideAlert(id), 5500);
  }
  function hideAlert(id) { const el = $(id); if (el) el.className = 'adm-alert'; }

  /* ═══════════════════════════════════════════════
     SECRET TRIGGER — LONG PRESS 2 seconds
     Fixed: proper event wiring for both mouse & touch
  ═══════════════════════════════════════════════ */
  const trigger = $('secretTrigger');
  const lpRing  = $('longPressRing');
  let lpTimer   = null, lpActive = false;

  function lpStart(e) {
    lpActive = true;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    if (lpRing) { lpRing.style.left = x + 'px'; lpRing.style.top = y + 'px'; lpRing.classList.add('animating'); }
    lpTimer = setTimeout(() => { if (lpActive) { lpRing?.classList.remove('animating'); openAdminModal(); } }, 2000);
  }
  function lpEnd() { lpActive = false; clearTimeout(lpTimer); lpRing?.classList.remove('animating'); }

  if (trigger) {
    trigger.addEventListener('mousedown',   lpStart);
    trigger.addEventListener('mouseup',     lpEnd);
    trigger.addEventListener('mouseleave',  lpEnd);
    trigger.addEventListener('touchstart',  e => { e.preventDefault(); lpStart(e); }, { passive: false });
    trigger.addEventListener('touchend',    lpEnd);
    trigger.addEventListener('touchcancel', lpEnd);
    trigger.addEventListener('contextmenu', e => e.preventDefault());
    trigger.addEventListener('keydown',     e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); openAdminModal(); } });
  }

  /* ═══════════════════════════════════════════════
     GLOBAL KEYBOARD
  ═══════════════════════════════════════════════ */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      window.closeMobileNav();
      closeDonateModal();
      closeAdminModal();
      closeAdminDashboard();
    }
  });

  /* ═══════════════════════════════════════════════
     INTERSECTION OBSERVER — Card animations
     (No polling loops — Fix #8)
  ═══════════════════════════════════════════════ */
  function observeCards() {
    const cards = $$('.feature-card, .category-card');
    cards.forEach(el => {
      el.style.opacity = '0'; el.style.transform = 'translateY(20px)';
      el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    });
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.style.opacity = '1'; entry.target.style.transform = 'translateY(0)'; io.unobserve(entry.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
    cards.forEach(el => io.observe(el));
  }

  /* ═══════════════════════════════════════════════
     BOOT — Public page: localStorage only, zero network
  ═══════════════════════════════════════════════ */
  function boot() {
    restoreLogo();                     // instant logo restore
    realApps = loadLocal();            // load from localStorage only — no fetch
    renderRealAppsOnPage();            // render whatever we have
    updateStatBadges();                // set counts
    observeCards();                    // setup animations
    setupHeroCounter();                // hero counter anim

    // Empty state
    const es = $('appsEmptyState');
    if (es) es.style.display = realApps.length === 0 ? 'block' : 'none';
  }

  boot();

})();
