/**
 * script.js — Indo Pakhtoon Tech
 *
 * FIXES IMPLEMENTED:
 * 1. Global cloud-based download counters via JSONBin
 *    - Per-app download count stored in cloud
 *    - On every Download click: fetch → increment → push back
 *    - All users worldwide see live real-time counts
 * 2. Canvas auto-resize / anti-crop for app icons & logo
 *    - "contain" fit with padding → no stretching or cropping
 *    - 150 KB size warning enforced before upload
 * 3. Background polling DISABLED for public visitors
 *    - Cloud fetch/sync only triggered by admin or download actions
 * 4. All dummy/placeholder apps removed
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════
     JSONBIN CONFIG
  ═══════════════════════════════════════════════ */
  const JSONBIN_BIN_ID  = '6ae58fe8ac6210605a60d117';
  const JSONBIN_API_KEY = '$2a$10$h8getyTZgrcWnxbja2EcGOogl3d339FaeMCoT22ehc/tckplHLlxu';
  const JSONBIN_URL     = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

  /* ═══════════════════════════════════════════════
     CONSTANTS
  ═══════════════════════════════════════════════ */
  const GOOGLE_CLIENT_ID = '319709517352-6f644og6lldls6erff3087ud6pmd3sk8.apps.googleusercontent.com';
  const AUTHORIZED_EMAIL = 'pakhtoonvisionary27@gmail.com';
  const GOOGLE_AUTH_URI  = 'https://accounts.google.com/o/oauth2/auth';
  const ADMIN_PASS_HASH  = '3e099246a91b2705dff580e1f8f4ab8f5e3a4f2a637ac79b3ced85490d0d3c3e';

  const STORAGE_APPS     = 'ipt_real_apps_v3';
  const STORAGE_LOGO     = 'ipt_logo_v2';

  const CANVAS_SIZE      = 256;   // output square px for app icons
  const CANVAS_LOGO_SIZE = 512;   // output square px for logo
  const CANVAS_PADDING   = 24;    // inner padding to prevent edge-touching
  const MAX_FILE_BYTES   = 150 * 1024;  // 150 KB hard limit
  const SYNC_DEBOUNCE_MS = 1400;

  /* ═══════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════ */
  let realApps        = [];       // array of app objects (loaded from cloud or local)
  let cloudData       = null;     // last full cloud payload
  let appIconDataUrl  = null;     // currently selected app icon (canvas-resized)
  let logoFileDataUrl = null;     // currently selected logo (canvas-resized)
  let isAdminMode     = false;    // true only after successful auth
  let isSyncing       = false;
  let syncDebounceTimer = null;
  let gsiAttempts     = 0;

  /* ═══════════════════════════════════════════════
     DOM HELPERS
  ═══════════════════════════════════════════════ */
  const $   = id  => document.getElementById(id);
  const $$  = sel => document.querySelectorAll(sel);

  const SEARCH_INPUT  = $('searchInput');
  const SEARCH_FORM   = $('searchForm');
  const SUGGESTIONS   = $('searchSuggestions');
  const SEARCH_WRAP   = $('searchWrap');
  const SEARCH_TOGGLE = $('searchToggle');
  const NO_RESULTS    = $('noResults');

  /* ═══════════════════════════════════════════════
     FIX #3 — Canvas-based image resizer
     "contain" mode: fits image inside square with
     symmetric padding. Never crops, never stretches.
     Returns a PNG data URL.
  ═══════════════════════════════════════════════ */
  const offscreenCanvas = $('iptCanvasOffscreen');

  /**
   * @param {File}   file       - image file from <input type="file">
   * @param {number} size       - output canvas size in px (e.g. 256)
   * @param {number} padding    - inner padding in px
   * @returns {Promise<string>} - PNG data URL
   */
  function resizeToSquare(file, size, padding) {
    size    = size    || CANVAS_SIZE;
    padding = padding || CANVAS_PADDING;

    return new Promise(function (resolve, reject) {
      if (file.size > MAX_FILE_BYTES) {
        reject(new Error('FILE_TOO_LARGE'));
        return;
      }

      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('FileReader failed')); };
      reader.onload  = function (e) {
        var img = new Image();
        img.onerror = function () { reject(new Error('Image load failed')); };
        img.onload  = function () {
          var canvas = offscreenCanvas;
          canvas.width  = size;
          canvas.height = size;
          var ctx = canvas.getContext('2d');

          // Clear with full transparency
          ctx.clearRect(0, 0, size, size);

          // "Contain" calculation — preserve aspect ratio
          var drawArea = size - padding * 2;
          var ratio    = Math.min(drawArea / img.width, drawArea / img.height);
          var drawW    = img.width  * ratio;
          var drawH    = img.height * ratio;
          var drawX    = (size - drawW) / 2;
          var drawY    = (size - drawH) / 2;

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, drawX, drawY, drawW, drawH);

          resolve(canvas.toDataURL('image/png', 0.92));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ═══════════════════════════════════════════════
     SHA-256 (for admin password)
  ═══════════════════════════════════════════════ */
  async function sha256(msg) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
    return Array.from(new Uint8Array(buf))
      .map(function (b) { return b.toString(16).padStart(2, '0'); })
      .join('');
  }

  /* ═══════════════════════════════════════════════
     ESCAPE HELPER
  ═══════════════════════════════════════════════ */
  function esc(s) {
    if (typeof s !== 'string') return String(s || '');
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  /* ═══════════════════════════════════════════════
     FORMAT NUMBERS
  ═══════════════════════════════════════════════ */
  function formatNum(n) {
    n = parseInt(n, 10) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M+';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'K+';
    return String(n);
  }

  /* ═══════════════════════════════════════════════
     CLOUD STATUS UI (admin-only, Fix #3)
  ═══════════════════════════════════════════════ */
  function setCloudStatus(state, msg) {
    var bar     = $('cloudStatusBar');
    var dot     = $('cloudDot');
    var text    = $('cloudStatusText');
    var admDot  = $('admCloudDot');
    var admText = $('admCloudText');

    bar.className = 'cloud-status-bar show ' + state;
    if (text) text.textContent = msg;

    if (state === 'syncing') {
      if (dot) dot.classList.add('pulse');
      if (admDot)  admDot.style.background = 'var(--accent-orange)';
      if (admText) { admText.textContent = 'Syncing…'; admText.style.color = 'var(--accent-orange)'; }
    } else if (state === 'synced') {
      if (dot) dot.classList.remove('pulse');
      if (admDot)  admDot.style.background = 'var(--accent-green)';
      if (admText) { admText.textContent = 'Synced ✓'; admText.style.color = 'var(--accent-green)'; }
    } else if (state === 'error') {
      if (dot) dot.classList.remove('pulse');
      if (admDot)  admDot.style.background = 'var(--accent-red)';
      if (admText) { admText.textContent = 'Failed'; admText.style.color = 'var(--accent-red)'; }
    } else {
      if (dot) dot.classList.remove('pulse');
      if (admDot)  admDot.style.background = 'var(--text-muted)';
      if (admText) { admText.textContent = 'Offline'; admText.style.color = 'var(--text-muted)'; }
    }

    if (state !== 'syncing') {
      setTimeout(function () { if (bar) bar.classList.remove('show'); }, 4000);
    }
  }

  /* ═══════════════════════════════════════════════
     FIX #1 — CLOUD FETCH
     Used by:
     - Admin on dashboard open (full fetch)
     - Download handler (fetch → increment → push)
     Public page load does NOT call this. (Fix #3)
  ═══════════════════════════════════════════════ */
  async function fetchCloud() {
    try {
      var res = await fetch(JSONBIN_URL + '/latest', {
        method : 'GET',
        headers: {
          'X-Master-Key': JSONBIN_API_KEY,
          'X-Bin-Meta'  : 'false'
        }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      return data;
    } catch (err) {
      console.warn('[IPT] Cloud fetch failed:', err.message);
      return null;
    }
  }

  /* FIX #1 — CLOUD PUSH */
  async function pushCloud(payload) {
    try {
      var res = await fetch(JSONBIN_URL, {
        method : 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_API_KEY
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return true;
    } catch (err) {
      console.warn('[IPT] Cloud push failed:', err.message);
      return false;
    }
  }

  /* ─── Admin cloud load (fetch + apply to local) ─── */
  async function loadFromCloud() {
    if (!isAdminMode) return;
    setCloudStatus('syncing', 'Loading from cloud…');
    var data = await fetchCloud();
    if (data) {
      cloudData = data;
      if (Array.isArray(data.apps) && data.apps.length > 0) {
        realApps = data.apps;
        saveToLocal();
      }
      if (data.logo) {
        try { localStorage.setItem(STORAGE_LOGO, JSON.stringify(data.logo)); } catch (_) {}
      }
      setCloudStatus('synced', 'Data loaded ✓');
    } else {
      realApps = loadFromLocal();
      setCloudStatus('error', 'Cloud unavailable — local data used');
    }
  }

  /* ─── Admin cloud save (debounced) ─── */
  async function saveToCloud() {
    if (!isAdminMode || isSyncing) return;
    isSyncing = true;
    setCloudStatus('syncing', 'Saving to cloud…');

    var logoData = null;
    try { logoData = JSON.parse(localStorage.getItem(STORAGE_LOGO)); } catch (_) {}

    var payload = {
      apps       : realApps,
      logo       : logoData,
      lastUpdated: new Date().toISOString()
    };

    var ok = await pushCloud(payload);
    if (ok) {
      cloudData = payload;
      setCloudStatus('synced', 'Saved ✓');
    } else {
      setCloudStatus('error', 'Save failed — stored locally');
    }
    isSyncing = false;
  }

  function debouncedSave() {
    if (!isAdminMode) return;
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(saveToCloud, SYNC_DEBOUNCE_MS);
  }

  window.manualCloudSync = async function () {
    if (!isAdminMode) return;
    var btn = $('admSyncBtn');
    if (btn) btn.disabled = true;
    await saveToCloud();
    if (btn) btn.disabled = false;
  };

  /* ═══════════════════════════════════════════════
     LOCAL STORAGE
  ═══════════════════════════════════════════════ */
  function loadFromLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_APPS) || '[]'); }
    catch (_) { return []; }
  }

  function saveToLocal() {
    try { localStorage.setItem(STORAGE_APPS, JSON.stringify(realApps)); }
    catch (_) {}
  }

  function persistData() {
    saveToLocal();
    debouncedSave();
  }

  /* ═══════════════════════════════════════════════
     FIX #1 — GLOBAL DOWNLOAD COUNTER
     Per-app download count lives in JSONBin cloud.
     Flow: fetch cloud → find app → increment count →
           push back → update UI for all users.
  ═══════════════════════════════════════════════ */

  /* Total downloads = sum of all apps' downloadCount */
  function computeTotalDownloads() {
    return realApps.reduce(function (sum, app) {
      return sum + (parseInt(app.downloadCount, 10) || 0);
    }, 0);
  }

  /**
   * Called on every Download button click.
   * Runs in background — does NOT block the actual download.
   * @param {number|string} appId - app's unique id
   */
  async function handleDownloadClick(appId) {
    /* 1. Fetch latest cloud data to get current count */
    var data = await fetchCloud();
    if (!data || !Array.isArray(data.apps)) return;

    /* 2. Find the app and increment its counter */
    var appIdx = data.apps.findIndex(function (a) { return String(a.id) === String(appId); });
    if (appIdx === -1) return;

    data.apps[appIdx].downloadCount = (parseInt(data.apps[appIdx].downloadCount, 10) || 0) + 1;
    data.lastUpdated = new Date().toISOString();

    /* 3. Push updated data back to cloud immediately */
    var ok = await pushCloud(data);
    if (!ok) return;

    /* 4. Update local state to reflect new count */
    realApps = data.apps;
    saveToLocal();

    /* 5. Refresh UI counters live */
    updateStatBadges();
    refreshDownloadCountOnCard(appId, data.apps[appIdx].downloadCount);
  }

  /* Updates a single app card's download count badge live */
  function refreshDownloadCountOnCard(appId, count) {
    var cards = $$('[data-app-id="' + appId + '"]');
    cards.forEach(function (card) {
      var badge = card.querySelector('.app-dl-count');
      if (badge) badge.textContent = formatNum(count) + ' downloads';
    });
    /* Also refresh hero stats */
    updateStatBadges();
  }

  /* ═══════════════════════════════════════════════
     STATS & CATEGORY COUNTS (Fix #1 + #2)
  ═══════════════════════════════════════════════ */
  function updateStatBadges() {
    var appsEl = $('statApps');
    var dlEl   = $('statDownloads');
    if (appsEl) appsEl.textContent = realApps.length + '+';
    if (dlEl)   dlEl.textContent   = formatNum(computeTotalDownloads());

    /* Category counts */
    var cats = ['ai','calculator','finance','productivity','education','games','health','utility'];
    cats.forEach(function (cat) {
      var el = $('catCount-' + cat);
      if (el) {
        var n = realApps.filter(function (a) { return (a.category || '') === cat; }).length;
        el.textContent = n + (n === 1 ? ' app' : ' apps');
      }
    });

    /* Admin dashboard stats */
    var admReal  = $('admStatReal');
    var admTotal = $('admStatTotal');
    var admDl    = $('admStatDl');
    if (admReal)  admReal.textContent  = realApps.length;
    if (admTotal) admTotal.textContent = realApps.length;
    if (admDl)    admDl.textContent    = formatNum(computeTotalDownloads());
  }

  /* Hero counter animation */
  function animCounter(el, target, suffix) {
    if (!el) return;
    var n    = 0;
    var step = Math.max(1, Math.ceil(target / 60));
    var t    = setInterval(function () {
      n = Math.min(n + step, target);
      el.textContent = n + (suffix || '');
      if (n >= target) clearInterval(t);
    }, 16);
  }

  function setupHeroCounterAnim() {
    var hs = document.querySelector('.hero-stats');
    if (!hs) return;
    var fired = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !fired) {
          fired = true;
          var total = computeTotalDownloads();
          animCounter($('statApps'),      realApps.length, '+');
          animCounter($('statDownloads'), total,           total >= 1000 ? '' : '');
          io.disconnect();
        }
      });
    }, { threshold: 0.4 });
    io.observe(hs);
  }

  /* ═══════════════════════════════════════════════
     RENDER — Real Apps on Page (Fix #4 — no dummies)
  ═══════════════════════════════════════════════ */
  function renderRealAppsOnPage() {
    var zone      = $('realAppsZone');
    var featZone  = $('featuredZone');
    var gamesZone = $('gamesZone');
    var emptyState = $('appsEmptyState');

    if (zone)      zone.innerHTML      = '';
    if (featZone)  featZone.innerHTML  = '';
    if (gamesZone) gamesZone.innerHTML = '';

    if (!realApps.length) {
      if (emptyState)  emptyState.style.display  = 'block';
      if (featZone)    featZone.innerHTML  = emptyHTML('🚀', 'Featured apps will appear here once published.<br/><strong>Admin can upload apps from the control panel.</strong>');
      if (gamesZone)   gamesZone.innerHTML = emptyHTML('🎮', 'Games will appear here once published.<br/><strong>Admin can upload games from the control panel.</strong>');
      updateStatBadges();
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    /* ── Featured ── */
    var featured = realApps.filter(function (a) { return a.featured; });
    if (featZone) {
      if (featured.length) {
        var fg = document.createElement('div');
        fg.className = 'featured-grid';
        featured.slice(0, 4).forEach(function (app) { fg.appendChild(createFeaturedCard(app)); });
        featZone.appendChild(fg);
      } else {
        featZone.innerHTML = emptyHTML('🚀', 'No featured apps yet. Mark an app as featured when uploading.');
      }
    }

    /* ── Games ── */
    var games = realApps.filter(function (a) { return (a.category || '') === 'games'; });
    if (gamesZone) {
      if (games.length) {
        var gg = document.createElement('div');
        gg.className = 'games-grid';
        gg.setAttribute('role', 'list');
        games.forEach(function (app) { gg.appendChild(createGameCard(app)); });
        gamesZone.appendChild(gg);
      } else {
        gamesZone.innerHTML = emptyHTML('🎮', 'No games uploaded yet.');
      }
    }

    /* ── All Apps (non-games) ── */
    var nonGames = realApps.filter(function (a) { return (a.category || '') !== 'games'; });
    if (nonGames.length && zone) {
      var hdr = document.createElement('div');
      hdr.className = 'real-apps-header';
      hdr.innerHTML = '<div style="width:14px;height:14px;border-radius:50%;background:var(--gradient-brand);flex-shrink:0;"></div>'
        + '<span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--accent-blue);">Published Apps</span>'
        + '<span class="top-badge">TOP</span>'
        + '<span style="font-size:11px;color:var(--text-muted);padding:2px 10px;background:rgba(79,142,247,0.08);border:1px solid rgba(79,142,247,0.18);border-radius:var(--radius-full);">' + nonGames.length + ' app' + (nonGames.length !== 1 ? 's' : '') + '</span>';
      zone.appendChild(hdr);

      var grid = document.createElement('div');
      grid.className = 'apps-grid';
      grid.setAttribute('role', 'list');
      nonGames.slice().reverse().forEach(function (app) { grid.appendChild(createRealCard(app)); });
      zone.appendChild(grid);
    }

    updateStatBadges();
  }

  function emptyHTML(icon, msg) {
    return '<div class="section-empty-state"><div class="empty-icon">' + icon + '</div><p>' + msg + '</p></div>';
  }

  /* ── App Card ── */
  var COLOR_POOL = ['icon-blue','icon-purple','icon-green','icon-orange','icon-cyan','icon-red','icon-pink','icon-teal'];

  function iconColor(name) {
    return COLOR_POOL[Math.abs((name || '').charCodeAt(0) || 0) % COLOR_POOL.length];
  }

  function createRealCard(app) {
    var col  = iconColor(app.name);
    var art  = document.createElement('article');
    art.className = 'app-card real-app';
    art.setAttribute('data-category', app.category || '');
    art.setAttribute('data-name',     (app.name || '').toLowerCase());
    art.setAttribute('data-desc',     (app.desc || '').toLowerCase());
    art.setAttribute('data-app-id',   String(app.id));
    art.setAttribute('role',          'listitem');
    art.setAttribute('tabindex',      '0');

    var iconHtml = app.iconDataUrl
      ? '<img src="' + esc(app.iconDataUrl) + '" alt="' + esc(app.name) + ' icon" />'
      : defaultIconSVG();

    var dlCount = parseInt(app.downloadCount, 10) || 0;

    art.innerHTML =
      '<div class="app-card-header" style="position:relative;z-index:1;">'
      +   '<div class="app-icon ' + col + '">' + iconHtml + '</div>'
      +   '<span class="badge badge-free">Free</span>'
      + '</div>'
      + '<div class="app-card-info" style="position:relative;z-index:1;">'
      +   '<h3 class="app-name">' + esc(app.name) + '</h3>'
      +   '<p class="app-desc">' + esc(app.desc || '') + '</p>'
      + '</div>'
      + '<div class="app-meta" style="position:relative;z-index:1;">'
      +   '<span class="badge badge-blue" style="font-size:10px;">' + esc(app.platform || '') + '</span>'
      +   '<span style="font-size:11px;color:var(--text-muted);">' + esc(app.version || '') + '</span>'
      +   '<span class="app-dl-count">' + (dlCount > 0 ? formatNum(dlCount) + ' downloads' : 'Be first to download') + '</span>'
      + '</div>'
      + '<div class="app-card-footer" style="position:relative;z-index:1;">'
      +   '<span class="app-size">' + esc(app.size || 'N/A') + '</span>'
      +   '<a href="' + esc(app.downloadLink) + '" class="dl-btn" target="_blank" rel="noopener noreferrer"'
      +     ' onclick="window.handleDownload('' + app.id + '', event)">'
      +     dlIconSVG() + 'Download'
      +   '</a>'
      + '</div>';

    fadeIn(art);
    return art;
  }

  /* ── Featured Card ── */
  function createFeaturedCard(app) {
    var card = document.createElement('article');
    card.className = 'featured-card';
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-app-id', String(app.id));

    var iconHtml = app.iconDataUrl
      ? '<img src="' + esc(app.iconDataUrl) + '" alt="' + esc(app.name) + '" />'
      : defaultIconSVG();

    var dlCount = parseInt(app.downloadCount, 10) || 0;

    card.innerHTML =
      '<div class="featured-card-bg" style="background:var(--gradient-brand);"></div>'
      + '<div class="featured-card-inner">'
      +   '<div class="fc-tag fc-tag-featured">⭐ Featured</div>'
      +   '<div class="fc-icon icon-blue">' + iconHtml + '</div>'
      +   '<h3 class="fc-title">' + esc(app.name) + '</h3>'
      +   '<p class="fc-desc">' + esc(app.desc || '') + '</p>'
      +   '<div class="fc-chips">'
      +     '<span class="fc-chip">' + esc(app.platform || '') + '</span>'
      +     '<span class="fc-chip">' + esc(app.category || '') + '</span>'
      +     '<span class="fc-chip">Free</span>'
      +   '</div>'
      +   '<div class="fc-dl-count app-dl-count">' + (dlCount > 0 ? '⬇ ' + formatNum(dlCount) + ' downloads' : 'Be first to download') + '</div>'
      +   '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
      +     '<a href="' + esc(app.downloadLink) + '" class="btn-primary" style="font-size:13px;padding:9px 20px;"'
      +       ' target="_blank" rel="noopener" onclick="window.handleDownload('' + app.id + '', event)">Download Free</a>'
      +   '</div>'
      + '</div>';

    return card;
  }

  /* ── Game Card ── */
  function createGameCard(app) {
    var gc = document.createElement('article');
    gc.className = 'game-card';
    gc.setAttribute('role', 'listitem');
    gc.setAttribute('tabindex', '0');
    gc.setAttribute('data-app-id', String(app.id));

    var thumbHtml = app.iconDataUrl
      ? '<img src="' + esc(app.iconDataUrl) + '" alt="' + esc(app.name) + '" style="width:100%;height:100%;object-fit:cover;" />'
      : '<span style="font-size:48px;">🎮</span>';

    var dlCount = parseInt(app.downloadCount, 10) || 0;

    gc.innerHTML =
      '<div class="game-thumb" style="background:linear-gradient(135deg,#1e3a5f,#4f8ef7);">' + thumbHtml + '</div>'
      + '<div class="game-body">'
      +   '<h3 class="game-name">' + esc(app.name) + '</h3>'
      +   '<p class="game-genre">' + esc(app.desc || 'Game') + '</p>'
      +   '<p class="app-dl-count" style="font-size:11px;color:var(--accent-green);margin-bottom:8px;">'
      +     (dlCount > 0 ? formatNum(dlCount) + ' downloads' : '') + '</p>'
      +   '<div class="game-footer">'
      +     '<span class="badge badge-free">Free</span>'
      +     '<a href="' + esc(app.downloadLink) + '" class="dl-btn" style="padding:6px 14px;font-size:12px;"'
      +       ' target="_blank" rel="noopener" onclick="window.handleDownload('' + app.id + '', event)">Get</a>'
      +   '</div>'
      + '</div>';

    return gc;
  }

  /* ─── SVG Helpers ─── */
  function defaultIconSVG() {
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
  }
  function dlIconSVG() {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.36"/></svg>';
  }

  /* ─── Fade-in entrance ─── */
  function fadeIn(el) {
    el.style.opacity   = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.style.opacity   = '1';
        el.style.transform = 'translateY(0)';
      });
    });
  }

  /* ═══════════════════════════════════════════════
     GLOBAL DOWNLOAD HANDLER
     Exposed on window so inline onclick works.
     Does NOT prevent default (lets link open).
  ═══════════════════════════════════════════════ */
  window.handleDownload = function (appId /*, event */) {
    /* Fire-and-forget in background — no UI blocking */
    handleDownloadClick(appId).catch(function (e) {
      console.warn('[IPT] Download counter error:', e.message);
    });
  };

  /* ═══════════════════════════════════════════════
     SEARCH
  ═══════════════════════════════════════════════ */
  SEARCH_FORM.addEventListener('submit', function (e) { e.preventDefault(); executeSearch(); });

  SEARCH_TOGGLE.addEventListener('click', function () {
    var open = SEARCH_WRAP.classList.toggle('mobile-open');
    SEARCH_TOGGLE.setAttribute('aria-expanded', String(open));
    if (open) SEARCH_INPUT.focus(); else hideSugg();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      SEARCH_WRAP.classList.remove('mobile-open');
      SEARCH_TOGGLE.setAttribute('aria-expanded', 'false');
      hideSugg();
    }
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 768) {
      SEARCH_WRAP.classList.remove('mobile-open');
      SEARCH_TOGGLE.setAttribute('aria-expanded', 'false');
    }
  });

  function buildSearchIndex() {
    return realApps.map(function (app) {
      return {
        id      : app.id,
        name    : (app.name     || '').toLowerCase(),
        desc    : (app.desc     || '').toLowerCase(),
        category: (app.category || '').toLowerCase()
      };
    });
  }

  function perfSearch(q) {
    q = q.trim().toLowerCase();
    var cards = $$('#realAppsZone .app-card');
    var cnt   = 0;
    cards.forEach(function (card) {
      var m = !q
        || (card.dataset.name     || '').includes(q)
        || (card.dataset.desc     || '').includes(q)
        || (card.dataset.category || '').includes(q);
      card.style.display = m ? '' : 'none';
      if (m) cnt++;
    });
    NO_RESULTS.classList.toggle('visible', cnt === 0 && q !== '' && realApps.length > 0);
    var es = $('appsEmptyState');
    if (es) es.style.display = (realApps.length === 0 && !q) ? 'block' : 'none';
  }

  SEARCH_INPUT.addEventListener('input', function () {
    perfSearch(this.value);
    showSugg(this.value.trim().toLowerCase());
  });
  SEARCH_INPUT.addEventListener('focus', function () {
    if (this.value.trim()) showSugg(this.value.trim().toLowerCase());
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.search-form')) hideSugg();
  });

  function showSugg(q) {
    if (!q) { hideSugg(); return; }
    var hits = buildSearchIndex()
      .filter(function (i) { return i.name.includes(q) || i.category.includes(q); })
      .slice(0, 6);
    if (!hits.length) { hideSugg(); return; }
    SUGGESTIONS.innerHTML = '';
    hits.forEach(function (item) {
      var btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'suggestion-item';
      btn.setAttribute('role', 'option');
      btn.innerHTML =
        '<span class="s-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>'
        + cap(item.name)
        + '<span style="margin-left:auto;font-size:10px;color:var(--text-muted);">' + cap(item.category) + '</span>';
      btn.addEventListener('click', function () {
        SEARCH_INPUT.value = item.name;
        hideSugg(); perfSearch(item.name);
        $('apps').scrollIntoView({ behavior: 'smooth' });
      });
      SUGGESTIONS.appendChild(btn);
    });
    SUGGESTIONS.classList.add('active');
  }

  function hideSugg() { SUGGESTIONS.classList.remove('active'); }

  window.executeSearch = function () {
    perfSearch(SEARCH_INPUT.value); hideSugg();
    if (SEARCH_INPUT.value.trim()) $('apps').scrollIntoView({ behavior: 'smooth' });
  };

  window.clearSearch = function () {
    SEARCH_INPUT.value = ''; perfSearch(''); hideSugg();
    $$('.filter-tab').forEach(function (t, i) {
      t.classList.toggle('active', i === 0);
      t.setAttribute('aria-selected', String(i === 0));
    });
  };

  /* ═══════════════════════════════════════════════
     THEME
  ═══════════════════════════════════════════════ */
  var themeToggle = $('themeToggle');
  var themeIcon   = $('themeIcon');
  var html        = document.documentElement;
  var moonPath    = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  var sunPath     = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';

  function setTheme(t) {
    html.setAttribute('data-theme', t);
    localStorage.setItem('ipt-theme', t);
    themeIcon.innerHTML = t === 'dark' ? moonPath : sunPath;
    themeToggle.setAttribute('aria-label', 'Switch to ' + (t === 'dark' ? 'light' : 'dark') + ' mode');
  }

  setTheme(localStorage.getItem('ipt-theme') || (window.matchMedia('(prefers-color-scheme:light)').matches ? 'light' : 'dark'));
  themeToggle.addEventListener('click', function () {
    setTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  /* ═══════════════════════════════════════════════
     SCROLL (passive — no performance hit)
  ═══════════════════════════════════════════════ */
  var mainHeader  = $('mainHeader');
  var backTop     = $('backTop');
  var scrollBar   = $('scrollProgress');

  window.addEventListener('scroll', function () {
    var sy = window.scrollY;
    var dh = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollBar) scrollBar.style.width = (dh > 0 ? (sy / dh) * 100 : 0) + '%';
    if (mainHeader) mainHeader.classList.toggle('scrolled', sy > 60);
    if (backTop)    backTop.classList.toggle('visible', sy > 400);
    updateActiveNav();
  }, { passive: true });

  function updateActiveNav() {
    var ids = ['home','store','apps','games','contact'];
    var current = 'home';
    ids.forEach(function (id) {
      var s = $(id);
      if (s && window.scrollY >= s.offsetTop - 150) current = id;
    });
    $$('.nav-link[data-nav]').forEach(function (l) {
      l.classList.toggle('active', l.dataset.nav === current);
    });
  }

  /* ═══════════════════════════════════════════════
     MOBILE NAV
  ═══════════════════════════════════════════════ */
  var hamburger     = $('hamburgerBtn');
  var mobileDrawer  = $('mobileDrawer');
  var mobileOverlay = $('mobileOverlay');

  hamburger.addEventListener('click', function () {
    mobileDrawer.classList.contains('open') ? closeMobileNav() : openMobileNav();
  });
  mobileOverlay.addEventListener('click', closeMobileNav);

  function syncBodyLock() {
    var anyOpen = !!document.querySelector('.modal-overlay.open')
      || $('adminDashboard').classList.contains('open');
    document.body.style.overflow =
      (mobileDrawer.classList.contains('open') || anyOpen) ? 'hidden' : '';
  }

  function openMobileNav() {
    hamburger.classList.add('open');    hamburger.setAttribute('aria-expanded', 'true');
    mobileDrawer.classList.add('open'); mobileDrawer.setAttribute('aria-hidden', 'false');
    mobileOverlay.classList.add('open'); mobileOverlay.setAttribute('aria-hidden', 'false');
    syncBodyLock();
  }

  window.closeMobileNav = function closeMobileNav() {
    hamburger.classList.remove('open');    hamburger.setAttribute('aria-expanded', 'false');
    mobileDrawer.classList.remove('open'); mobileDrawer.setAttribute('aria-hidden', 'true');
    mobileOverlay.classList.remove('open'); mobileOverlay.setAttribute('aria-hidden', 'true');
    syncBodyLock();
  };

  /* ═══════════════════════════════════════════════
     FILTER TABS
  ═══════════════════════════════════════════════ */
  window.filterByCategory = function (cat) {
    if (cat === 'games') {
      perfSearch('');
      $('games').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    SEARCH_INPUT.value = cat; perfSearch(cat);
    $('apps').scrollIntoView({ behavior: 'smooth' });
    $$('.filter-tab').forEach(function (t) {
      var active = t.textContent.trim().toLowerCase().includes(cat);
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    });
  };

  window.filterTab = function (btn, cat) {
    $$('.filter-tab').forEach(function (t) {
      t.classList.remove('active'); t.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
    if (cat === 'all') {
      $$('#realAppsZone .app-card').forEach(function (c) { c.style.display = ''; });
      NO_RESULTS.classList.remove('visible');
      SEARCH_INPUT.value = '';
    } else {
      SEARCH_INPUT.value = cat; perfSearch(cat);
    }
  };

  /* ═══════════════════════════════════════════════
     DONATE MODAL
  ═══════════════════════════════════════════════ */
  window.openDonateModal  = function () { $('donateModal').classList.add('open');    syncBodyLock(); };
  window.closeDonateModal = function () { $('donateModal').classList.remove('open'); syncBodyLock(); };
  $('donateModal').addEventListener('click', function (e) { if (e.target === $('donateModal')) window.closeDonateModal(); });

  /* ═══════════════════════════════════════════════
     ADMIN LOGIN MODAL
  ═══════════════════════════════════════════════ */
  function openAdminModal() {
    $('adminModal').classList.add('open'); syncBodyLock();
    setTimeout(function () { $('adminPassInput').focus(); }, 300);
  }

  window.closeAdminModal = function () {
    $('adminModal').classList.remove('open');
    $('adminPassInput').value = ''; hideAdminMsg(); syncBodyLock();
  };
  $('adminModal').addEventListener('click', function (e) { if (e.target === $('adminModal')) window.closeAdminModal(); });

  function showAdminMsg(msg, type) {
    var el = $('adminMsg'); el.textContent = msg; el.className = 'admin-msg show ' + type;
  }
  function hideAdminMsg() { var el = $('adminMsg'); el.className = 'admin-msg'; el.textContent = ''; }

  /* ═══════════════════════════════════════════════
     PASSWORD AUTH
  ═══════════════════════════════════════════════ */
  window.verifyAdminPassword = async function () {
    var val = $('adminPassInput').value;
    if (!val) { showAdminMsg('Please enter a password.', 'error'); return; }
    try {
      var h = await sha256(val);
      if (h === ADMIN_PASS_HASH) {
        showAdminMsg('Access granted. Opening dashboard…', 'success');
        setTimeout(function () { window.closeAdminModal(); openAdminDashboard('Admin'); }, 1100);
      } else {
        showAdminMsg('Incorrect password.', 'error');
        $('adminPassInput').value = ''; $('adminPassInput').focus();
      }
    } catch (_) { showAdminMsg('Auth error. Try again.', 'error'); }
  };

  $('adminPassInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') window.verifyAdminPassword();
  });

  /* ═══════════════════════════════════════════════
     GOOGLE OAUTH
  ═══════════════════════════════════════════════ */
  function initGSI() {
    if (location.protocol === 'file:') return;
    if (typeof google === 'undefined' || !google.accounts) {
      if (gsiAttempts++ < 10) setTimeout(initGSI, 1000);
      return;
    }
    try {
      google.accounts.id.initialize({
        client_id  : GOOGLE_CLIENT_ID,
        callback   : handleGoogleCred,
        auto_select: false,
        ux_mode    : 'popup'
      });
      google.accounts.id.renderButton($('googleSignInBtn'), {
        theme: 'filled_blue', size: 'large', width: 220, shape: 'pill'
      });
    } catch (_) {}
  }

  function handleGoogleCred(response) {
    if (!response || !response.credential) { showAdminMsg('Google sign-in failed.', 'error'); return; }
    try {
      var b64     = response.credential.split('.')[1];
      var pad     = '='.repeat((4 - b64.length % 4) % 4);
      var payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad));
      var email   = (payload.email || '').toLowerCase().trim();
      var name    = payload.name || 'Admin';
      if (email !== AUTHORIZED_EMAIL.toLowerCase()) {
        showAdminMsg('Access Denied: "' + email + '" is not authorized.', 'error');
        try { google.accounts.id.revoke(email, function () {}); } catch (_) {}
        return;
      }
      showAdminMsg('Authenticated as ' + name + '. Opening dashboard…', 'success');
      setTimeout(function () { window.closeAdminModal(); openAdminDashboard(name); }, 1100);
    } catch (_) { showAdminMsg('Token error.', 'error'); }
  }

  window.initiateGoogleSignIn = function () {
    if (location.protocol === 'file:') { showAdminMsg('Google sign-in requires HTTPS.', 'error'); return; }
    var params = new URLSearchParams({
      client_id    : GOOGLE_CLIENT_ID,
      redirect_uri : location.origin + '/auth/google/callback',
      response_type: 'code',
      scope        : 'openid email profile',
      prompt       : 'select_account',
      login_hint   : AUTHORIZED_EMAIL
    });
    var url   = GOOGLE_AUTH_URI + '?' + params;
    var popup = window.open(url, 'g_oauth', 'width=500,height=600');
    if (!popup || popup.closed) location.href = url;
  };

  if (document.readyState === 'complete') initGSI();
  else window.addEventListener('load', initGSI);

  /* ═══════════════════════════════════════════════
     ADMIN DASHBOARD
     Cloud fetch happens HERE (Fix #3)
  ═══════════════════════════════════════════════ */
  async function openAdminDashboard(name) {
    /* Activate admin mode — enables cloud I/O */
    isAdminMode = true;
    document.body.classList.add('admin-active');

    $('admWelcomeMsg').textContent = 'Welcome, ' + name + ' — Indo Pakhtoon Tech Control Panel';
    $('adminDashboard').classList.add('open');
    syncBodyLock();

    /* Fetch latest data from cloud NOW */
    await loadFromCloud();

    refreshStats();
    renderAdmList();
    renderRealAppsOnPage();
    updateOverviewRecent();
    restoreLogo();
    updateStatBadges();
  }

  window.closeAdminDashboard = function () {
    $('adminDashboard').classList.remove('open'); syncBodyLock();
  };
  $('adminDashboard').addEventListener('click', function (e) {
    if (e.target === $('adminDashboard')) window.closeAdminDashboard();
  });

  window.switchAdmTab = function (btn, secId) {
    $$('.adm-tab').forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    $$('.adm-section').forEach(function (s) { s.classList.remove('active'); });
    btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
    var sec = $(secId); if (sec) sec.classList.add('active');
    if (secId === 'admManage') renderAdmList();
  };

  /* ═══════════════════════════════════════════════
     FIX #2 — APP ICON PREVIEW (Canvas resize)
  ═══════════════════════════════════════════════ */
  window.previewAppIcon = async function (input) {
    var file = input.files[0]; if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      showDashAlert('uploadAlert',
        '⚠ File too large! Max allowed: 150 KB. Current: ' + (file.size / 1024).toFixed(0) + ' KB. Please resize the image and try again.',
        'error');
      input.value = '';
      appIconDataUrl = null;
      return;
    }

    try {
      var resized = await resizeToSquare(file, CANVAS_SIZE, CANVAS_PADDING);
      appIconDataUrl = resized;
      $('appIconLabelText').textContent = file.name + ' ✓ (auto-resized, no crop)';
      var prev = $('appIconPreview');
      prev.src = resized; prev.classList.add('show');
    } catch (err) {
      /* Fallback plain read */
      var reader = new FileReader();
      reader.onload = function (e) {
        appIconDataUrl = e.target.result;
        $('appIconLabelText').textContent = file.name;
        var prev = $('appIconPreview');
        prev.src = e.target.result; prev.classList.add('show');
      };
      reader.readAsDataURL(file);
    }
  };

  /* ═══════════════════════════════════════════════
     FIX #2 — LOGO PREVIEW (Canvas resize)
  ═══════════════════════════════════════════════ */
  window.previewLogoFile = async function (input) {
    var file = input.files[0]; if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      showDashAlert('brandingAlert',
        '⚠ File too large! Max allowed: 150 KB. Current: ' + (file.size / 1024).toFixed(0) + ' KB.',
        'error');
      input.value = ''; logoFileDataUrl = null; return;
    }

    try {
      var resized = await resizeToSquare(file, CANVAS_LOGO_SIZE, 32);
      logoFileDataUrl = resized;
      $('logoFileLabelText').textContent = file.name + ' ✓ (auto-resized)';
      var prev = $('logoFilePreview');
      prev.src = resized; prev.classList.add('show');
      var big = $('logoPreviewBig');
      if (big) big.innerHTML = '<img src="' + resized + '" alt="Logo preview" />';
    } catch (_) {
      var reader = new FileReader();
      reader.onload = function (e) {
        logoFileDataUrl = e.target.result;
        $('logoFileLabelText').textContent = file.name;
        var prev = $('logoFilePreview');
        prev.src = e.target.result; prev.classList.add('show');
        var big = $('logoPreviewBig');
        if (big) big.innerHTML = '<img src="' + e.target.result + '" alt="Logo preview" />';
      };
      reader.readAsDataURL(file);
    }
  };

  /* ═══════════════════════════════════════════════
     UPLOAD APP
  ═══════════════════════════════════════════════ */
  window.uploadRealApp = function () {
    var name         = $('appName').value.trim();
    var platform     = $('appPlatform').value;
    var category     = $('appCategory').value;
    var downloadLink = $('appDownloadLink').value.trim();
    var desc         = $('appDesc').value.trim();
    var size         = $('appSize').value.trim();
    var version      = $('appVersion').value.trim();
    var featured     = $('appFeatured').checked;

    if (!name)           { showDashAlert('uploadAlert', 'App Name is required.',        'error'); return; }
    if (!appIconDataUrl) { showDashAlert('uploadAlert', 'App Icon is required.',        'error'); return; }
    if (!platform)       { showDashAlert('uploadAlert', 'Platform is required.',        'error'); return; }
    if (!category)       { showDashAlert('uploadAlert', 'Category is required.',        'error'); return; }
    if (!downloadLink)   { showDashAlert('uploadAlert', 'Download Link is required.',   'error'); return; }
    if (!desc)           { showDashAlert('uploadAlert', 'Description is required.',     'error'); return; }

    try { new URL(downloadLink); }
    catch (_) { showDashAlert('uploadAlert', 'Please enter a valid download URL.', 'error'); return; }

    var app = {
      id           : Date.now(),
      name         : name,
      iconDataUrl  : appIconDataUrl,
      platform     : platform,
      category     : category,
      downloadLink : downloadLink,
      desc         : desc,
      featured     : featured,
      size         : size    || 'N/A',
      version      : version || 'v1.0',
      downloadCount: 0,
      addedAt      : new Date().toISOString()
    };

    realApps.unshift(app);
    persistData();

    renderRealAppsOnPage(); refreshStats(); renderAdmList();
    updateOverviewRecent(); updateStatBadges(); clearUploadForm();
    showDashAlert('uploadAlert', '"' + name + '" published! Syncing to cloud…', 'success');
    showToast('"' + name + '" published ☁️');
  };

  window.clearUploadForm = function () {
    ['appName','appDownloadLink','appDesc','appSize','appVersion'].forEach(function (id) { $(id).value = ''; });
    $('appPlatform').value = ''; $('appCategory').value = '';
    $('appIconFile').value = ''; $('appIconLabelText').textContent = 'Click to select image…';
    $('appIconPreview').src = ''; $('appIconPreview').classList.remove('show');
    if ($('appFeatured')) $('appFeatured').checked = false;
    appIconDataUrl = null; hideAlert('uploadAlert');
  };

  /* ═══════════════════════════════════════════════
     DELETE / MANAGE
  ═══════════════════════════════════════════════ */
  window.deleteRealApp = function (id) {
    var app = realApps.find(function (a) { return a.id === id; });
    if (!app || !confirm('Delete "' + app.name + '"?')) return;
    realApps = realApps.filter(function (a) { return a.id !== id; });
    persistData();
    renderRealAppsOnPage(); refreshStats(); renderAdmList();
    updateOverviewRecent(); updateStatBadges();
    showDashAlert('manageAlert', '"' + app.name + '" deleted & cloud updated.', 'success');
    showToast('"' + app.name + '" removed ☁️');
  };

  window.clearAllRealApps = function () {
    if (!realApps.length) { showDashAlert('manageAlert', 'No apps to remove.', 'info'); return; }
    if (!confirm('Remove all ' + realApps.length + ' app(s)?')) return;
    realApps = [];
    persistData();
    renderRealAppsOnPage(); refreshStats(); renderAdmList();
    updateOverviewRecent(); updateStatBadges();
    showDashAlert('manageAlert', 'All apps removed & cloud updated.', 'success');
  };

  function renderAdmList() {
    var list = $('admAppList');
    $('admRealCount').textContent = realApps.length;
    if (!realApps.length) {
      list.innerHTML = '<div class="adm-empty"><div class="adm-empty-icon">🔒</div><p>No apps uploaded yet.</p></div>';
      return;
    }
    list.innerHTML = '';
    realApps.slice().reverse().forEach(function (app) {
      var item = document.createElement('div');
      item.className = 'adm-app-item';
      item.innerHTML =
        '<div class="adm-app-thumb">'
        + (app.iconDataUrl ? '<img src="' + esc(app.iconDataUrl) + '" alt="' + esc(app.name) + '" />' : esc((app.name || '?').charAt(0).toUpperCase()))
        + '</div>'
        + '<div class="adm-app-info">'
        +   '<div class="adm-app-name">' + esc(app.name) + (app.featured ? ' ⭐' : '') + '</div>'
        +   '<div class="adm-app-meta">'
        +     '<span>' + esc(app.platform) + '</span><span>' + esc(app.category) + '</span>'
        +     '<span>' + esc(app.size) + '</span><span>' + esc(app.version) + '</span>'
        +     '<span>⬇ ' + formatNum(app.downloadCount || 0) + '</span>'
        +     '<span>' + new Date(app.addedAt).toLocaleDateString() + '</span>'
        +   '</div>'
        + '</div>'
        + '<div class="adm-app-actions">'
        +   '<a href="' + esc(app.downloadLink) + '" target="_blank" rel="noopener" class="adm-btn adm-btn-ghost adm-btn-sm">Test</a>'
        +   '<button class="adm-btn adm-btn-danger adm-btn-sm" onclick="deleteRealApp(' + app.id + ')">Delete</button>'
        + '</div>';
      list.appendChild(item);
    });
  }

  function refreshStats() {
    var admReal  = $('admStatReal');
    var admTotal = $('admStatTotal');
    var admDl    = $('admStatDl');
    if (admReal)  admReal.textContent  = realApps.length;
    if (admTotal) admTotal.textContent = realApps.length;
    if (admDl)    admDl.textContent    = formatNum(computeTotalDownloads());
  }

  function updateOverviewRecent() {
    var el = $('admRecentList');
    if (!realApps.length) {
      el.innerHTML = '<div class="adm-empty"><div class="adm-empty-icon">🔒</div><p>No apps uploaded yet.</p></div>';
      return;
    }
    el.innerHTML = '';
    realApps.slice().reverse().slice(0, 3).forEach(function (app) {
      var d = document.createElement('div');
      d.className = 'adm-app-item'; d.style.marginBottom = '8px';
      d.innerHTML =
        '<div class="adm-app-thumb">'
        + (app.iconDataUrl ? '<img src="' + esc(app.iconDataUrl) + '" alt="" />' : esc((app.name || '?').charAt(0).toUpperCase()))
        + '</div>'
        + '<div class="adm-app-info">'
        +   '<div class="adm-app-name">' + esc(app.name) + (app.featured ? ' ⭐' : '') + '</div>'
        +   '<div class="adm-app-meta">'
        +     '<span>' + esc(app.platform) + '</span><span>' + esc(app.category) + '</span>'
        +     '<span>⬇ ' + formatNum(app.downloadCount || 0) + '</span>'
        +     '<span>' + new Date(app.addedAt).toLocaleDateString() + '</span>'
        +   '</div>'
        + '</div>';
      el.appendChild(d);
    });
  }

  /* ═══════════════════════════════════════════════
     BRANDING — LOGO
  ═══════════════════════════════════════════════ */
  function getAllLogoIcons() {
    return [$('mainLogoIcon'), $('drawerLogoIcon'), $('footerLogoIcon')].filter(Boolean);
  }

  function applyLogoToAll(content, isImg) {
    getAllLogoIcons().forEach(function (el) {
      el.innerHTML = isImg ? '<img src="' + esc(content) + '" alt="Logo" />' : esc(content);
    });
    var big = $('logoPreviewBig');
    if (big) big.innerHTML = isImg ? '<img src="' + esc(content) + '" alt="Logo" />' : esc(content);
  }

  window.applyLogoFile = function () {
    if (!logoFileDataUrl) { showDashAlert('brandingAlert', 'Please select a logo image file first.', 'error'); return; }
    applyLogoToAll(logoFileDataUrl, true);
    try { localStorage.setItem(STORAGE_LOGO, JSON.stringify({ type: 'image', value: logoFileDataUrl })); } catch (_) {}
    debouncedSave();
    showDashAlert('brandingAlert', 'Logo applied & syncing to cloud…', 'success');
    showToast('Logo updated ☁️');
  };

  window.applyLogoText = function () {
    var val = $('logoTextInput').value.trim();
    if (!val) { showDashAlert('brandingAlert', 'Please enter text or initials.', 'error'); return; }
    applyLogoToAll(val, false);
    try { localStorage.setItem(STORAGE_LOGO, JSON.stringify({ type: 'text', value: val })); } catch (_) {}
    debouncedSave();
    showDashAlert('brandingAlert', 'Logo set to "' + val + '" & syncing…', 'success');
    showToast('Logo updated ☁️');
  };

  window.resetLogo = function () {
    applyLogoToAll('IP', false);
    try { localStorage.removeItem(STORAGE_LOGO); } catch (_) {}
    $('logoTextInput').value = '';
    $('logoFileInput').value = '';
    $('logoFileLabelText').textContent = 'Click to select logo image…';
    $('logoFilePreview').src = ''; $('logoFilePreview').classList.remove('show');
    logoFileDataUrl = null;
    debouncedSave();
    showDashAlert('brandingAlert', 'Logo reset to default "IP" & syncing…', 'success');
    showToast('Logo reset ☁️');
  };

  function restoreLogo() {
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_LOGO));
      if (!s) return;
      applyLogoToAll(s.value, s.type === 'image');
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════
     DASHBOARD ALERTS
  ═══════════════════════════════════════════════ */
  function showDashAlert(id, msg, type) {
    var el = $(id); if (!el) return;
    el.textContent = msg; el.className = 'adm-alert show ' + type;
    setTimeout(function () { hideAlert(id); }, 5500);
  }
  function hideAlert(id) { var el = $(id); if (el) el.className = 'adm-alert'; }

  /* ═══════════════════════════════════════════════
     SECRET TRIGGER — LONG PRESS 2s (footer name)
  ═══════════════════════════════════════════════ */
  var trigger = $('secretTrigger');
  var lpRing  = $('longPressRing');
  var LP_MS   = 2000;
  var lpTimer = null;
  var lpActive = false;

  function lpStart(e) {
    lpActive = true;
    var x = e.touches ? e.touches[0].clientX : e.clientX;
    var y = e.touches ? e.touches[0].clientY : e.clientY;
    lpRing.style.left = x + 'px'; lpRing.style.top = y + 'px';
    lpRing.classList.add('animating');
    lpTimer = setTimeout(function () {
      if (lpActive) { lpRing.classList.remove('animating'); openAdminModal(); }
    }, LP_MS);
  }
  function lpEnd() { lpActive = false; clearTimeout(lpTimer); lpRing.classList.remove('animating'); }

  trigger.addEventListener('mousedown',   lpStart);
  trigger.addEventListener('mouseup',     lpEnd);
  trigger.addEventListener('mouseleave',  lpEnd);
  trigger.addEventListener('touchstart',  function (e) { e.preventDefault(); lpStart(e); }, { passive: false });
  trigger.addEventListener('touchend',    lpEnd);
  trigger.addEventListener('touchcancel', lpEnd);
  trigger.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  trigger.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); openAdminModal(); }
  });

  /* ═══════════════════════════════════════════════
     CLIPBOARD
  ═══════════════════════════════════════════════ */
  window.copyText = function (text, label) {
    var fb = function () {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove();
      showToast(ok ? label + ' copied!' : 'Could not copy.');
    };
    if (!navigator.clipboard || !navigator.clipboard.writeText) { fb(); return; }
    navigator.clipboard.writeText(text)
      .then(function () { showToast(label + ' copied!'); })
      .catch(fb);
  };

  /* ═══════════════════════════════════════════════
     TOAST
  ═══════════════════════════════════════════════ */
  function showToast(msg) {
    var c = $('toastContainer');
    var t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status');
    t.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> '
      + esc(msg);
    c.appendChild(t);
    setTimeout(function () {
      t.classList.add('hide');
      setTimeout(function () { t.remove(); }, 350);
    }, 3000);
  }

  /* ═══════════════════════════════════════════════
     NEWSLETTER
  ═══════════════════════════════════════════════ */
  window.handleNewsletter = function (e) {
    e.preventDefault();
    var email = $('emailInput').value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Please enter a valid email address.'); return;
    }
    showToast("You're subscribed! Thanks for joining.");
    $('emailInput').value = '';
  };

  /* ═══════════════════════════════════════════════
     INTERSECTION OBSERVER — Card entrance animations
     (No polling loops — just passive IO. Fix #3)
  ═══════════════════════════════════════════════ */
  function observeCards() {
    var cards = $$('.feature-card, .category-card');
    cards.forEach(function (el) {
      el.style.opacity    = '0';
      el.style.transform  = 'translateY(20px)';
      el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.style.opacity   = '1';
          entry.target.style.transform = 'translateY(0)';
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
    cards.forEach(function (el) { io.observe(el); });
  }

  /* ═══════════════════════════════════════════════
     KEYBOARD ACCESSIBILITY
  ═══════════════════════════════════════════════ */
  document.querySelectorAll('.category-card').forEach(function (c) {
    c.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); }
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      window.closeMobileNav();
      window.closeDonateModal();
      window.closeAdminModal();
      window.closeAdminDashboard();
    }
  });

  /* ═══════════════════════════════════════════════
     BOOT SEQUENCE
     FIX #3: Public page — NO cloud fetch.
     Only reads localStorage → renders instantly.
     Cloud I/O happens ONLY when:
       (a) Admin logs in & opens dashboard
       (b) User clicks Download (background, non-blocking)
  ═══════════════════════════════════════════════ */
  function boot() {
    /* 1. Restore logo from localStorage (zero flicker) */
    restoreLogo();

    /* 2. Load apps from localStorage ONLY — no network (Fix #3) */
    realApps = loadFromLocal();

    /* 3. Render page with local data */
    renderRealAppsOnPage();
    updateStatBadges();

    /* 4. Setup passive animations */
    observeCards();
    setupHeroCounterAnim();

    /* 5. Empty state */
    var es = $('appsEmptyState');
    if (es) es.style.display = realApps.length === 0 ? 'block' : 'none';
  }

  boot();

})();