/* ============================================================
 * Yorimichi Map — Application Logic
 * ------------------------------------------------------------
 * - Pure client-side. No backend.
 * - Stack: Leaflet (BSD-2) + OpenStreetMap (ODbL) + Nominatim + Overpass
 * - Travel-time estimation done locally (Haversine × mode speed)
 * - State persisted in URL hash for sharing
 * ============================================================ */

(function () {
  'use strict';

  // ---------- Constants ----------

  const APP_NAME = 'YorimichiMap/0.1 (https://github.com/seiji/yorimichi-map; learning project)';

  // ============================================================
  // Global error reporting (silent → /api/errors)
  // ============================================================
  // window.onerror / onunhandledrejection を捕捉してバックエンドに送る
  // 個人情報は送らず、message / stack / source / user_id のみ
  const _errorReportEndpoint = 'https://yorimichi-api-1028920472559.asia-northeast1.run.app/api/errors';
  let _errorReportCount = 0;
  function reportClientError(payload) {
    if (_errorReportCount > 10) return; // 同一セッションで10回まで
    _errorReportCount += 1;
    try {
      let userId = '';
      try { userId = localStorage.getItem('yorimichi-user-id') || ''; } catch (e) {}
      const body = JSON.stringify({ ...payload, user_id: userId });
      // sendBeacon でページ離脱時も送れるようにする
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(_errorReportEndpoint, blob);
      } else {
        fetch(_errorReportEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch (e) {
      // 報告失敗時に無限ループしないよう何もしない
    }
  }
  window.addEventListener('error', (e) => {
    reportClientError({
      message: String(e.message || 'error'),
      source: String(e.filename || ''),
      line: e.lineno,
      col: e.colno,
      stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 2000) : '',
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    reportClientError({
      message: 'unhandledrejection: ' + String(reason && reason.message ? reason.message : reason),
      stack: reason && reason.stack ? String(reason.stack).slice(0, 2000) : '',
    });
  });

  // 致命的エラー時に表示するフォールバックUI
  function showFatalErrorBanner(message) {
    if (document.getElementById('fatal-error-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'fatal-error-banner';
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;background:#ef4444;color:white;padding:12px 16px;' +
      'z-index:10000;font-size:14px;font-weight:600;text-align:center;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.2);';
    banner.innerHTML =
      `⚠️ ${message || '一時的なエラーが発生しました'} ` +
      `<button style="margin-left:8px;padding:6px 12px;border-radius:8px;border:0;background:white;color:#ef4444;font-weight:700;cursor:pointer">🔄 再読み込み</button>`;
    banner.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(banner);
  }

  // ============================================================
  // i18n (basic)
  // ============================================================
  const I18N = {
    ja: {
      brandName: '街歩きガチャ',
      brandTagline: 'あと◯分あったら、どこ寄る？',
      tabCourse: '📖 既存コース',
      tabRoute: '🎯 自由ルート',
      tabStroll: '🌿 散歩',
      todayLabel: '✨ 今日のおすすめ',
      todayCta: '歩く →',
      filtersLabel: '🔍 絞り込み',
      filterArea: 'エリア',
      filterTags: '気分タグ',
      gachaTitleCourse: 'コースガチャを回す',
      gachaTitleFree: '寄り道ガチャを回す',
      colCourse: 'コース図鑑',
      colCollection: 'コレクション',
      share: '共有',
      walkStartCourse: 'このコースを歩き始める',
      walkStartFree: 'このルートを歩き始める',
    },
    en: {
      brandName: 'Machiaruki Gacha',
      brandTagline: 'Got a few extra minutes? Where to stop by?',
      tabCourse: '📖 Curated',
      tabRoute: '🎯 Free Route',
      tabStroll: '🌿 Stroll',
      todayLabel: '✨ Today\'s Pick',
      todayCta: 'Walk →',
      filtersLabel: '🔍 Filter',
      filterArea: 'Area',
      filterTags: 'Mood tags',
      gachaTitleCourse: 'Spin the Course Gacha',
      gachaTitleFree: 'Spin the Detour Gacha',
      colCourse: 'Course Dex',
      colCollection: 'Collection',
      share: 'Share',
      walkStartCourse: 'Start walking this course',
      walkStartFree: 'Start walking this route',
    },
  };
  let currentLang = 'ja';
  function loadLang() {
    try {
      currentLang = localStorage.getItem('yorimichi-lang') || (navigator.language?.startsWith('en') ? 'en' : 'ja');
    } catch (e) {}
  }
  function t(key) { return I18N[currentLang]?.[key] || I18N.ja[key] || key; }
  function applyLang() {
    document.documentElement.lang = currentLang;
    const map = {
      '.brand-name': t('brandName'),
      '.brand-tagline': t('brandTagline'),
      '#tab-course': t('tabCourse'),
      '#tab-route': t('tabRoute'),
      '#tab-stroll': t('tabStroll'),
    };
    Object.entries(map).forEach(([sel, val]) => {
      const el = document.querySelector(sel);
      if (el) el.textContent = val;
    });
    // Refresh dynamic content
    if (typeof setMode === 'function' && state.mode) setMode(state.mode);
    if (typeof buildAreaSelector === 'function') buildAreaSelector();
    if (typeof renderTodaysPick === 'function') renderTodaysPick();
    if (typeof renderCoursePreview === 'function') renderCoursePreview();
  }
  function setLang(lang) {
    currentLang = lang;
    try { localStorage.setItem('yorimichi-lang', lang); } catch (e) {}
    applyLang();
  }

  // Course/stop field accessor with language fallback
  function tField(obj, field) {
    if (!obj) return '';
    const localized = obj[field + '_' + currentLang];
    if (localized) return localized;
    return obj[field] || '';
  }
  const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 };
  const KICHIJOJI = { lat: 35.7029, lng: 139.5800 };

  const SPEED_KMH = { walk: 4.5, bike: 15, car: 30 };
  const STAY_MIN = 10; // default stay time at a detour spot

  // POI categories: emoji + Overpass query fragment
  const CATEGORIES = [
    {
      id: 'cafe',
      label: 'カフェ',
      emoji: '☕',
      query: 'node["amenity"="cafe"]',
    },
    {
      id: 'park',
      label: '公園',
      emoji: '🌳',
      query: 'node["leisure"="park"];way["leisure"="park"]',
      isArea: true,
    },
    {
      id: 'bookstore',
      label: '書店',
      emoji: '📚',
      query: 'node["shop"="books"]',
    },
    {
      id: 'shrine',
      label: '神社・寺',
      emoji: '⛩️',
      query: 'node["amenity"="place_of_worship"]',
    },
    {
      id: 'viewpoint',
      label: '展望台',
      emoji: '🌅',
      query: 'node["tourism"="viewpoint"]',
    },
    {
      id: 'bakery',
      label: 'ベーカリー',
      emoji: '🥐',
      query: 'node["shop"="bakery"]',
    },
    {
      id: 'sento',
      label: '銭湯',
      emoji: '♨️',
      query: 'node["leisure"="sauna"];node["amenity"="public_bath"]',
    },
    {
      id: 'art',
      label: 'アート',
      emoji: '🎨',
      query: 'node["tourism"="artwork"];node["tourism"="museum"]',
    },
    {
      id: 'sweets',
      label: 'スイーツ',
      emoji: '🍰',
      query: 'node["shop"="confectionery"];node["shop"="pastry"]',
    },
  ];

  // ---------- State ----------

  const state = {
    mode: 'course',
    travel: 'walk',
    budgetMin: 15,
    activeCategories: new Set(['cafe', 'park']),
    activeArea: null,
    activeTags: new Set(),
    origin: null,
    dest: null,
    candidates: [],
    selected: [],
    map: null,
    markers: { origin: null, dest: null, pois: [] },
    routeLines: { direct: null, detour: null },
    sortMode: 'near',
    overpassCache: new Map(),
    discoveredCourses: new Set(),
    completedCourses: new Set(),         // 100% walked at least once
    favoriteCourses: new Set(),           // ❤️ user-saved courses
    completedStops: {},                   // { courseId: Set(stopIdx) } — current walk progress
    walkCounts: {},                       // { courseId: number } — completion count
    coinClaimedDate: '',                  // last date daily bonus was claimed
    sessionPullCount: 0,                  // current session reroll counter
    walkHistory: [],                      // [{ courseId, date: 'YYYY-MM-DD', stops: number, completed: bool }]
    activeWalk: null,                     // { courseId, route, stopsTotal, stopsDone, gpsWatchId }
    userMarker: null,
    loginStreak: 0,
    lastLoginDate: '',
  };

  // ---------- DOM helpers ----------

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ===== Toast queue =====
  // 連発時に上書きで消えてしまわないよう、順番に表示するキュー
  const _toastQueue = [];
  let _toastShowing = false;
  function _showNextToast() {
    if (_toastShowing) return;
    const next = _toastQueue.shift();
    if (!next) return;
    _toastShowing = true;
    const t = $('#toast');
    if (!t) { _toastShowing = false; return; }
    t.textContent = next.msg;
    t.className = 'toast ' + next.type;
    t.hidden = false;
    // フェードイン用：1tick後にopacity
    requestAnimationFrame(() => {
      t.classList.add('toast-visible');
    });
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.classList.remove('toast-visible');
      // フェードアウト後にhide
      setTimeout(() => {
        t.hidden = true;
        _toastShowing = false;
        // キューに次があれば連続表示
        _showNextToast();
      }, 200);
    }, next.duration);
    const sr = $('#sr-live');
    if (sr) sr.textContent = next.msg;
  }

  function showToast(msg, type = 'info', duration = 2400) {
    if (!msg) return;
    // 直前と同じメッセージの重複は無視（5秒以内）
    const last = _toastQueue[_toastQueue.length - 1];
    if (last && last.msg === msg) return;
    _toastQueue.push({ msg, type, duration });
    // キューが長すぎる場合は古いものを切る
    while (_toastQueue.length > 5) _toastQueue.shift();
    _showNextToast();
  }

  function showLoader(text = '読み込み中...') {
    $('#loader-text').textContent = text;
    $('#loader').hidden = false;
  }
  function hideLoader() { $('#loader').hidden = true; }

  function renderSkeletonList(count = 4) {
    const list = $('#results-list');
    if (!list) return;
    const empty = $('#empty-state');
    if (empty) empty.hidden = true;
    list.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const li = document.createElement('li');
      li.className = 'skeleton-card';
      li.innerHTML = `
        <div class="skel-thumb"></div>
        <div class="skel-body">
          <div class="skel-line medium"></div>
          <div class="skel-line short"></div>
        </div>
      `;
      list.appendChild(li);
    }
  }

  // ---------- Math ----------

  function haversineKm(a, b) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function travelMinutes(km) {
    const speed = SPEED_KMH[state.travel];
    return (km / speed) * 60;
  }

  // Estimated extra time to detour via point P between A and B
  // = (dist(A->P) + dist(P->B) - dist(A->B)) / speed + stay
  function detourMinutes(origin, dest, point) {
    if (!dest) {
      // Stroll mode: round trip from origin
      return travelMinutes(haversineKm(origin, point) * 2) + STAY_MIN;
    }
    const direct = haversineKm(origin, dest);
    const via = haversineKm(origin, point) + haversineKm(point, dest);
    const extraKm = Math.max(0, via - direct);
    return travelMinutes(extraKm) + STAY_MIN;
  }

  // ---------- Map setup ----------

  const MAP_STYLES = {
    osm: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      maxZoom: 19,
    },
    dark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd',
    },
    watercolor: {
      // CartoDB Voyager: gentle, postcard-like (replaces broken jawg)
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd',
    },
    terrain: {
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxZoom: 17,
      subdomains: 'abc',
    },
  };

  function initMap() {
    const initialCenter = state.mode === 'course' ? KICHIJOJI : TOKYO_STATION;
    const map = L.map('map', {
      center: [initialCenter.lat, initialCenter.lng],
      zoom: 14,
      zoomControl: true,
      attributionControl: true,
    });
    state.map = map;
    state.previewMarkers = [];

    // Restore saved style
    let savedStyle = 'osm';
    try { savedStyle = localStorage.getItem('yorimichi-mapstyle') || 'osm'; } catch (e) {}
    setMapStyle(savedStyle);
  }

  // Render preview markers for unrevealed courses (mystery pins)
  // Auto-clusters at low zoom by grouping by area
  function renderCoursePreview() {
    if (state.mode !== 'course') {
      clearPreviewMarkers();
      return;
    }
    if (state.activeWalk || state.selected.length > 0) {
      clearPreviewMarkers();
      return;
    }
    clearPreviewMarkers();
    if (!state.previewVisible) return;

    const zoom = state.map.getZoom();
    const courses = getCourseCandidates();

    // At low zoom, cluster by area
    if (zoom < 13) {
      const byArea = {};
      courses.forEach(c => {
        if (!byArea[c.area]) byArea[c.area] = [];
        byArea[c.area].push(c);
      });
      Object.entries(byArea).forEach(([areaId, list]) => {
        const area = (window.YORIMICHI_AREAS || []).find(a => a.id === areaId);
        if (!area) return;
        // Average position
        const avg = list.reduce((acc, c) => ({ lat: acc.lat + c.origin.lat, lng: acc.lng + c.origin.lng }), { lat: 0, lng: 0 });
        avg.lat /= list.length;
        avg.lng /= list.length;
        const discoveredCount = list.filter(c => state.discoveredCourses.has(c.id)).length;
        const html = `<span class="cprev-cluster"><span class="cprev-emoji">${area.icon}</span><span class="cprev-count">${discoveredCount}/${list.length}</span></span>`;
        const marker = L.marker([avg.lat, avg.lng], {
          icon: makeIcon(html, 'preview-marker cluster', 48),
          title: `${area.name}（${list.length}コース）`,
          zIndexOffset: 50,
        }).addTo(state.map);
        marker.on('click', () => {
          // Zoom to the area
          state.map.flyTo([avg.lat, avg.lng], 14, { duration: 0.6 });
          state.activeArea = areaId;
          buildAreaSelector();
          if (typeof updateFilterStat === 'function') updateFilterStat();
          state.currentPlans = [];
        });
        state.previewMarkers.push(marker);
      });
      return;
    }

    // At higher zoom, show individual pins
    courses.forEach(course => {
      const isDiscovered = state.discoveredCourses.has(course.id);
      const rarity = RARITY[course.rarity || 'r'];
      const html = isDiscovered
        ? `<span class="cprev-emoji">${course.themeIcon || course.areaIcon || '📍'}</span>`
        : `<span class="cprev-emoji">？</span>`;
      const cls = 'preview-marker ' + rarity.cls + (isDiscovered ? ' discovered' : '');
      const marker = L.marker([course.origin.lat, course.origin.lng], {
        icon: makeIcon(html, cls, 32),
        title: isDiscovered ? course.name : 'コースガチャで開放',
        zIndexOffset: 50,
      }).addTo(state.map);
      marker.on('click', () => {
        if (isDiscovered) {
          showCourseDetail(course);
        } else {
          showToast('🎰 コースガチャで開放されます！', 'info', 2500);
        }
      });
      state.previewMarkers.push(marker);
    });
  }

  function clearPreviewMarkers() {
    if (!state.previewMarkers) return;
    state.previewMarkers.forEach(m => m.remove());
    state.previewMarkers = [];
  }

  function setupPreviewZoomListener() {
    if (!state.map) return;
    state.previewVisible = true; // default on
    state.map.on('zoomend', () => {
      if (state.mode === 'course' && !state.activeWalk && state.selected.length === 0) {
        renderCoursePreview();
      }
    });
  }

  function setMapStyle(styleId) {
    const cfg = MAP_STYLES[styleId] || MAP_STYLES.osm;
    if (state.tileLayer) {
      state.tileLayer.remove();
    }
    const opts = {
      maxZoom: cfg.maxZoom || 19,
      attribution: cfg.attribution,
    };
    if (cfg.subdomains) opts.subdomains = cfg.subdomains;
    state.tileLayer = L.tileLayer(cfg.url, opts);

    // Track tile load errors and auto-fallback to OSM after several failures
    let errorCount = 0;
    state.tileLayer.on('tileerror', (err) => {
      errorCount++;
      if (errorCount > 5 && styleId !== 'osm') {
        console.warn('Tile load failures, reverting to OSM');
        setMapStyle('osm');
        showToast('⚠ マップタイル読込失敗、標準スタイルに戻しました', 'info', 3000);
      }
    });

    state.tileLayer.addTo(state.map);
    state.mapStyleId = styleId;
    try { localStorage.setItem('yorimichi-mapstyle', styleId); } catch (e) {}
    $$('.mapstyle-card').forEach(c => c.classList.toggle('active', c.dataset.style === styleId));
  }

  function makeIcon(html, className = 'poi-marker', size = 36) {
    return L.divIcon({
      html,
      className,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function setEndpointMarker(which, point) {
    const map = state.map;
    if (state.markers[which]) {
      state.markers[which].remove();
      state.markers[which] = null;
    }
    if (!point) return;
    const isOrigin = which === 'origin';
    const icon = makeIcon(isOrigin ? '出' : '着', 'endpoint-marker ' + (isOrigin ? 'origin' : 'dest'), 28);
    const m = L.marker([point.lat, point.lng], { icon, title: point.label || which }).addTo(map);
    state.markers[which] = m;
  }

  function clearPoiMarkers() {
    state.markers.pois.forEach(m => m.remove());
    state.markers.pois = [];
  }

  function clearRoutes() {
    if (state.routeLines.direct) { state.routeLines.direct.remove(); state.routeLines.direct = null; }
    // detour can be a single layer or array of layers
    if (state.routeLines.detour) {
      if (Array.isArray(state.routeLines.detour)) {
        state.routeLines.detour.forEach(l => l.remove && l.remove());
      } else {
        state.routeLines.detour.remove();
      }
      state.routeLines.detour = null;
    }
    if (state.routeLines.detourBg) { state.routeLines.detourBg.remove(); state.routeLines.detourBg = null; }
  }

  function fitToEndpoints() {
    const points = [];
    if (state.origin) points.push([state.origin.lat, state.origin.lng]);
    if (state.dest) points.push([state.dest.lat, state.dest.lng]);
    state.selected.forEach(p => points.push([p.lat, p.lng]));
    if (points.length === 0) return;
    if (points.length === 1) {
      state.map.setView(points[0], 15);
    } else {
      state.map.fitBounds(points, { padding: [60, 60] });
    }
  }

  // Render numbered markers + name labels for selected stops
  function renderSelectedMarkers() {
    clearPoiMarkers();
    const courseId = state.activeWalk?.courseId;
    const visited = courseId ? (state.completedStops[courseId] || new Set()) : new Set();
    const skipped = courseId ? (state.skippedStops?.[courseId] || new Set()) : new Set();
    // 「現在の目標」= ウォーク中のときだけ。最初の未訪問スポットを current にする
    let currentIdx = -1;
    if (state.activeWalk) {
      for (let i = 0; i < state.selected.length; i++) {
        if (!visited.has(i)) { currentIdx = i; break; }
      }
    }
    state.selected.forEach((stop, i) => {
      const emoji = stop.emoji || (categoryById(stop.cat) || { emoji: '📍' }).emoji;
      const isVisited = visited.has(i);
      const isSkipped = skipped.has(i);
      const isCurrent = (i === currentIdx);
      const display = isSkipped ? '⏭' : (isVisited ? '✓' : emoji);
      const html = `
        <span class="poi-num">${i + 1}</span>
        <span class="poi-emo">${display}</span>
        <span class="poi-name-label">${escapeHtml(stop.name)}</span>
        ${isCurrent ? '<span class="poi-current-badge">📍次</span>' : ''}
      `;
      let cls = 'poi-marker numbered';
      if (isSkipped) cls += ' skipped';
      else if (isVisited) cls += ' visited';
      else if (isCurrent) cls += ' current';
      else cls += ' upcoming';
      const marker = L.marker([stop.lat, stop.lng], {
        icon: makeIcon(html, cls, 44),
        title: stop.name,
        zIndexOffset: isCurrent ? 500 : (100 + i),
      }).addTo(state.map);
      marker.on('click', () => {
        showSelectedStopDetail(stop, i);
      });
      state.markers.pois.push(marker);
    });
  }

  function showSelectedStopDetail(stop, idx) {
    const card = $('#detail-card');
    const content = $('#detail-content');
    const cat = categoryById(stop.cat) || { emoji: stop.emoji || '📍', label: 'スポット' };
    const emoji = stop.emoji || cat.emoji;

    // Lookup the original course stop data for extra fields (photoBg, bestTime, budget, tags, stayMin)
    let extra = stop;
    if (state.activeWalk || state.selected.includes(stop)) {
      // Find original course definition by stop name
      for (const c of (window.YORIMICHI_COURSES || [])) {
        const found = c.stops.find(s => s.name === stop.name);
        if (found) { extra = { ...found, ...stop }; break; }
      }
    }

    const photoUrl = (window.YORIMICHI_PHOTOS || {})[stop.name];
    const photoBg = extra.photoBg || 'linear-gradient(135deg, var(--brand-soft), var(--surface-2))';
    // 提携締結済み（status: 'live'）の特典のみ表示。'pending' は景表法対策で非表示
    const _rawPerk = (window.YORIMICHI_PERKS || {})[stop.name];
    const perk = (_rawPerk && _rawPerk.status === 'live') ? _rawPerk : null;
    const courseId = state.activeWalk?.courseId;
    const isVisited = courseId && state.completedStops[courseId]?.has(idx);

    const photoStyle = photoUrl
      ? `background-image: url('${photoUrl}'); background-size: cover; background-position: center;`
      : `background: ${photoBg};`;

    content.innerHTML = `
      <div class="detail-photo" style="${photoStyle}">
        ${!photoUrl ? `<span class="photo-emoji">${emoji}</span>` : ''}
        ${perk ? `<span class="perk-badge" title="${escapeHtml(perk.desc)}">🎫 ${escapeHtml(perk.label)}</span>` : ''}
        ${isVisited ? '<span style="position:absolute;top:8px;right:8px;background:#16a34a;color:white;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:800">✓ 訪問済</span>' : ''}
      </div>
      ${perk ? `<div class="perk-detail">🎫 <strong>完走特典</strong>：${escapeHtml(perk.label)}<br><small>${escapeHtml(perk.desc)} ・ <em>${escapeHtml(perk.partner)}</em></small></div>` : ''}
      <h3>${idx + 1}. ${escapeHtml(stop.name)}</h3>
      <div class="detail-info-grid">
        ${extra.bestTime ? `<div class="info-cell"><span class="info-label">🕐 ベスト</span><span class="info-val">${escapeHtml(extra.bestTime)}</span></div>` : ''}
        ${extra.budget ? `<div class="info-cell"><span class="info-label">💴 予算</span><span class="info-val">${escapeHtml(extra.budget)}</span></div>` : ''}
        ${extra.stayMin ? `<div class="info-cell"><span class="info-label">⏱ 所要</span><span class="info-val">約${extra.stayMin}分</span></div>` : ''}
        <div class="info-cell"><span class="info-label">🏷 種類</span><span class="info-val">${escapeHtml(cat.label || 'スポット')}</span></div>
      </div>
      ${extra.tags && extra.tags.length ? `<div class="detail-tags">${extra.tags.map(t => `<span class="detail-tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      ${stop.desc ? `<p class="desc">${escapeHtml(stop.desc)}</p>` : ''}
      <div class="ai-spot-guide" id="ai-spot-guide" hidden>
        <div class="aig-loading">✨ AIガイド読み込み中…</div>
      </div>
      <div class="actions">
        <button class="add-btn" id="detail-fly">📍 地図でズーム</button>
        <a class="add-btn wiki-btn" id="detail-nav" target="_blank" rel="noopener">📱 ナビ起動</a>
      </div>
      ${state.activeWalk && !isVisited ? `<button class="add-btn" id="detail-checkin" style="background:#16a34a;margin-top:8px;width:100%">✓ チェックイン</button>` : ''}
    `;
    // AIスポットガイドを非同期取得（キャッシュあり）
    requestSpotGuide(stop.name, state.origin?.shortLabel || '', cat?.label || '').then(g => {
      const el = $('#ai-spot-guide');
      if (!el || !g) return;
      el.hidden = false;
      el.innerHTML = `
        <div class="aig-row"><span class="aig-icon">📸</span><span>${escapeHtml(g.photo)}</span></div>
        <div class="aig-row"><span class="aig-icon">📖</span><span>${escapeHtml(g.trivia)}</span></div>
        <div class="aig-row"><span class="aig-icon">💡</span><span>${escapeHtml(g.enjoy)}</span></div>
        <div class="aig-credit">✨ AIガイド (Gemini)</div>
      `;
    });
    card.hidden = false;
    $('#detail-fly').onclick = () => {
      state.map.flyTo([stop.lat, stop.lng], 17, { duration: 0.6 });
    };
    // Navigation link to single stop
    const navBtn = $('#detail-nav');
    if (navBtn) {
      const mode = state.travel === 'walk' ? 'walking' : state.travel === 'bike' ? 'bicycling' : 'driving';
      navBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=${mode}`;
    }
    const checkinBtn = $('#detail-checkin');
    if (checkinBtn) {
      checkinBtn.onclick = () => {
        checkInStop(idx, true);
        $('#detail-card').hidden = true;
      };
    }
  }

  // ---------- Geocoding (Nominatim) ----------

  let geocodeTimer = null;
  let geocodeCtrl = null;

  async function geocode(query) {
    if (!query || query.trim().length < 2) return [];
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '5');
    url.searchParams.set('accept-language', 'ja');
    url.searchParams.set('countrycodes', 'jp');

    if (geocodeCtrl) geocodeCtrl.abort();
    geocodeCtrl = new AbortController();

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: geocodeCtrl.signal,
    });
    if (!res.ok) throw new Error('geocode failed');
    const data = await res.json();
    return data.map(d => ({
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
      label: d.display_name,
      shortLabel: shortenLabel(d.display_name),
    }));
  }

  function shortenLabel(s) {
    if (!s) return '';
    const parts = s.split(',').map(p => p.trim());
    return parts.slice(0, 2).join(', ');
  }

  function setupAddressInput(inputId, suggestionsId, onSelect) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(suggestionsId);

    let activeIdx = -1;
    let currentSuggestions = [];

    function render(items) {
      list.innerHTML = '';
      currentSuggestions = items;
      activeIdx = -1;
      items.forEach((item, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.innerHTML = `<span class="suggest-icon">📍</span><span>${escapeHtml(item.shortLabel)}</span>`;
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(i);
        });
        list.appendChild(li);
      });
    }

    function choose(i) {
      const item = currentSuggestions[i];
      if (!item) return;
      input.value = item.shortLabel;
      list.innerHTML = '';
      onSelect(item);
    }

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(geocodeTimer);
      if (!q) { list.innerHTML = ''; return; }
      geocodeTimer = setTimeout(async () => {
        try {
          const items = await geocode(q);
          render(items);
        } catch (e) {
          if (e.name !== 'AbortError') console.warn('geocode', e);
        }
      }, 350);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, currentSuggestions.length - 1);
        updateActive();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        updateActive();
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0) {
          e.preventDefault();
          choose(activeIdx);
        }
      } else if (e.key === 'Escape') {
        list.innerHTML = '';
      }
    });

    function updateActive() {
      $$(`#${suggestionsId} li`).forEach((li, i) => {
        li.classList.toggle('active', i === activeIdx);
      });
    }

    input.addEventListener('blur', () => {
      setTimeout(() => { list.innerHTML = ''; }, 200);
    });
  }

  // ---------- Geolocation ----------

  function getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation unsupported'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: '現在地',
          shortLabel: '現在地',
        }),
        (err) => reject(err),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  async function reverseGeocode(point) {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.searchParams.set('lat', point.lat);
      url.searchParams.set('lon', point.lng);
      url.searchParams.set('format', 'json');
      url.searchParams.set('accept-language', 'ja');
      const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return null;
      const d = await res.json();
      return d.display_name ? shortenLabel(d.display_name) : null;
    } catch { return null; }
  }

  // ---------- Overpass (POI) ----------

  function buildOverpassQuery(bbox, categories) {
    const [s, w, n, e] = bbox;
    const blocks = categories.map(cat => {
      const fragments = cat.query.split(';');
      return fragments.map(frag => `${frag}(${s},${w},${n},${e});`).join('\n');
    }).join('\n');
    return `[out:json][timeout:25];(${blocks});out center tags 80;`;
  }

  function bboxAroundEndpoints(origin, dest, marginKm = 0.5) {
    let pts = [origin];
    if (dest) pts.push(dest);
    const lats = pts.map(p => p.lat);
    const lngs = pts.map(p => p.lng);
    const dLat = marginKm / 111;
    const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const dLng = marginKm / (111 * Math.cos(meanLat * Math.PI / 180));
    return [
      Math.min(...lats) - dLat,
      Math.min(...lngs) - dLng,
      Math.max(...lats) + dLat,
      Math.max(...lngs) + dLng,
    ];
  }

  async function fetchPois(origin, dest, categories, budgetMin) {
    // Margin scales with budget so we capture more POIs for larger budgets
    const margin = Math.max(0.4, budgetMin / 30);
    const bbox = bboxAroundEndpoints(origin, dest, margin);
    const cacheKey = JSON.stringify([bbox, categories.map(c => c.id).sort()]);
    if (state.overpassCache.has(cacheKey)) {
      return state.overpassCache.get(cacheKey);
    }

    const q = buildOverpassQuery(bbox, categories);
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];

    let lastErr;
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(q),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        if (!res.ok) throw new Error('overpass ' + res.status);
        const data = await res.json();
        const elements = data.elements || [];
        const pois = elements.map(el => normalizePoi(el)).filter(Boolean);
        state.overpassCache.set(cacheKey, pois);
        return pois;
      } catch (e) {
        lastErr = e;
        console.warn('overpass endpoint failed', ep, e);
      }
    }
    throw lastErr || new Error('overpass failed');
  }

  function normalizePoi(el) {
    let lat, lng;
    if (el.type === 'node') { lat = el.lat; lng = el.lon; }
    else if (el.center) { lat = el.center.lat; lng = el.center.lon; }
    else return null;

    const tags = el.tags || {};
    const name = tags['name:ja'] || tags['name'] || tags['name:en'];
    if (!name) return null; // skip unnamed POIs

    return {
      id: el.type + '/' + el.id,
      lat, lng,
      name,
      tags,
      cat: detectCategory(tags),
      hasInfo: !!(tags.wikipedia || tags.wikidata || tags.description || tags.website),
    };
  }

  function detectCategory(tags) {
    if (tags.amenity === 'cafe') return 'cafe';
    if (tags.leisure === 'park') return 'park';
    if (tags.shop === 'books') return 'bookstore';
    if (tags.amenity === 'place_of_worship') return 'shrine';
    if (tags.tourism === 'viewpoint') return 'viewpoint';
    if (tags.shop === 'bakery') return 'bakery';
    if (tags.amenity === 'public_bath' || tags.leisure === 'sauna') return 'sento';
    if (tags.tourism === 'artwork' || tags.tourism === 'museum') return 'art';
    if (tags.shop === 'confectionery' || tags.shop === 'pastry') return 'sweets';
    return null;
  }

  function categoryById(id) {
    return CATEGORIES.find(c => c.id === id);
  }

  // ---------- Search & rank ----------

  async function searchDetours() {
    if (!state.origin) {
      showToast('出発地を設定してください', 'error');
      return;
    }
    if (state.mode === 'route' && !state.dest) {
      showToast('目的地を設定するか、散歩モードに切り替えてください', 'error');
      return;
    }
    if (state.activeCategories.size === 0) {
      showToast('カテゴリを1つ以上選択してください', 'error');
      return;
    }

    const cats = [...state.activeCategories].map(categoryById).filter(Boolean);
    showLoader('寄り道スポットを探しています...');
    renderSkeletonList(5);
    try {
      const pois = await fetchPois(state.origin, state.dest, cats, state.budgetMin);
      const ranked = rankPois(pois);
      state.candidates = ranked;
      renderCandidates();
      drawRoutes();
      updateCompareBadge();
      hideLoader();
      if (ranked.length === 0) {
        showToast('範囲内に候補が見つかりませんでした。バジェットを増やしてください', 'info', 4000);
      } else {
        showToast(`${ranked.length}件の寄り道候補を表示`, 'success');
      }
      saveStateToHash();
    } catch (e) {
      hideLoader();
      console.error(e);
      showToast('検索に失敗しました。少し待ってから再試行してください', 'error', 4000);
    }
  }

  function rankPois(pois) {
    const origin = state.origin;
    const dest = state.dest;
    const budget = state.budgetMin;

    const scored = pois
      .map(p => {
        const detourMin = detourMinutes(origin, dest, p);
        const distKm = haversineKm(origin, p);
        return { ...p, detourMin, distKm, qualityScore: poiQualityScore(p) };
      })
      // 街歩きに不向きなPOI（病院・銀行・ガソリン等）を除外
      .filter(p => p.qualityScore > -50)
      .filter(p => p.detourMin <= budget);

    // Sort: prefer info-rich, then less detour
    scored.sort((a, b) => {
      if (state.sortMode === 'time') return a.detourMin - b.detourMin;
      // 'near': closeness wins, but info-rich gets a tie-breaker bonus
      const aScore = a.distKm + (a.hasInfo ? -0.2 : 0);
      const bScore = b.distKm + (b.hasInfo ? -0.2 : 0);
      return aScore - bScore;
    });

    return scored.slice(0, 30);
  }

  // ---------- Rendering ----------

  function renderCandidates() {
    const list = $('#results-list');
    const emptyState = $('#empty-state');
    list.innerHTML = '';
    clearPoiMarkers();

    if (state.candidates.length === 0) {
      emptyState.hidden = false;
      $('#empty-state p').textContent = '候補が見つかりません。バジェットを増やすかカテゴリを変えてください。';
      $('#results-count').textContent = '候補：0 件';
      return;
    }
    emptyState.hidden = true;
    $('#results-count').textContent = `候補：${state.candidates.length} 件`;

    state.candidates.forEach(poi => {
      const li = document.createElement('li');
      li.className = 'result-item';
      li.dataset.id = poi.id;
      const cat = categoryById(poi.cat) || { emoji: '📍' };
      const isAdded = state.selected.some(s => s.id === poi.id);
      if (isAdded) li.classList.add('added');

      li.innerHTML = `
        <span class="result-emoji">${cat.emoji}</span>
        <div class="result-body">
          <div class="result-name">${escapeHtml(poi.name)}</div>
          <div class="result-meta">
            <span class="meta-pill">⏱ +${Math.round(poi.detourMin)}分</span>
            <span class="meta-pill">📏 ${poi.distKm.toFixed(1)}km</span>
            ${poi.hasInfo ? '<span class="meta-pill">ℹ️</span>' : ''}
          </div>
        </div>
        <button class="result-add-btn" aria-label="${isAdded ? '寄り道から外す' : '寄り道に追加'}">${isAdded ? '✓' : '+'}</button>
      `;

      li.addEventListener('click', (e) => {
        if (e.target.closest('.result-add-btn')) {
          toggleSelect(poi);
        } else {
          showDetail(poi);
          state.map.flyTo([poi.lat, poi.lng], 16, { duration: 0.5 });
        }
      });

      list.appendChild(li);

      // Add map marker
      const marker = L.marker([poi.lat, poi.lng], {
        icon: makeIcon(cat.emoji, 'poi-marker' + (isAdded ? ' added' : ''), 36),
        title: poi.name,
      }).addTo(state.map);
      marker.on('click', () => {
        showDetail(poi);
      });
      state.markers.pois.push(marker);
    });
  }

  function showDetail(poi) {
    const card = $('#detail-card');
    const content = $('#detail-content');
    const cat = categoryById(poi.cat) || { emoji: '📍', label: 'スポット' };
    const tags = poi.tags;

    const wiki = tags.wikipedia ? wikipediaUrl(tags.wikipedia) : null;
    const wikidata = tags.wikidata;
    const website = tags.website;
    const opening = tags.opening_hours;
    const desc = tags.description;
    const isAdded = state.selected.some(s => s.id === poi.id);

    content.innerHTML = `
      <h3>${cat.emoji} ${escapeHtml(poi.name)}</h3>
      <div class="meta">
        <span>⏱ +${Math.round(poi.detourMin)}分</span>
        <span>📏 ${poi.distKm.toFixed(1)}km</span>
        <span>🏷️ ${cat.label}</span>
      </div>
      ${desc ? `<p class="desc">${escapeHtml(desc)}</p>` : ''}
      ${opening ? `<p class="desc">🕐 ${escapeHtml(opening)}</p>` : ''}
      <div class="actions">
        <button class="add-btn" id="detail-add">${isAdded ? '✓ 寄り道に追加済' : '＋ 寄り道に追加'}</button>
        ${wiki ? `<a class="wiki-btn" href="${wiki}" target="_blank" rel="noopener">Wikipedia</a>` : ''}
        ${website ? `<a class="wiki-btn" href="${escapeAttr(website)}" target="_blank" rel="noopener">Web</a>` : ''}
      </div>
    `;
    card.hidden = false;
    $('#detail-add').onclick = () => {
      toggleSelect(poi);
      showDetail(poi); // re-render
    };
  }

  function wikipediaUrl(tag) {
    // tag format: "ja:記事名"
    const [lang, ...rest] = tag.split(':');
    const title = rest.join(':');
    return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  }

  function toggleSelect(poi) {
    const idx = state.selected.findIndex(s => s.id === poi.id);
    if (idx >= 0) {
      state.selected.splice(idx, 1);
      showToast('寄り道から外しました');
    } else {
      state.selected.push(poi);
      showToast(`「${poi.name}」を寄り道に追加 ✨`, 'success');
    }
    renderCandidates();
    renderSummary();
    drawRoutes();
    updateCompareBadge();
    saveStateToHash();
  }

  function renderSummary() {
    const section = $('#summary-section');
    const list = $('#summary-list');
    const totals = $('#summary-totals');
    if (state.selected.length === 0) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    list.innerHTML = '';

    // Build sequence: 出 → stop1 → stop2 → ... → 着
    const points = [
      { name: '出発地', emoji: '🟢', isEndpoint: true, ...state.origin },
      ...state.selected.map(s => ({ ...s, emoji: (categoryById(s.cat) || { emoji: '📍' }).emoji })),
    ];
    if (state.dest) points.push({ name: '目的地', emoji: '🔴', isEndpoint: true, ...state.dest });
    else points.push({ name: '出発地に戻る', emoji: '🟢', isEndpoint: true, ...state.origin });

    const legs = state.routeLegs; // road-followed legs from OSRM, or null

    // Compute visited indexes (stops are positions 1..N within state.selected)
    const courseId = state.activeWalk?.courseId;
    const visited = courseId ? (state.completedStops[courseId] || new Set()) : new Set();
    let nextStopIdx = -1;
    if (state.activeWalk) {
      for (let i = 0; i < state.selected.length; i++) {
        if (!visited.has(i)) { nextStopIdx = i; break; }
      }
    }

    let stopCounter = -1; // -1 means not yet hit a real stop
    points.forEach((p, i) => {
      // Determine if this is a real stop (not endpoint) → maps to state.selected
      let stopIdx = -1;
      if (!p.isEndpoint) {
        stopCounter++;
        stopIdx = stopCounter;
      }
      const isVisited = stopIdx >= 0 && visited.has(stopIdx);
      const isNext = stopIdx >= 0 && stopIdx === nextStopIdx;
      const li = document.createElement('li');
      li.className = 'sum-stop' +
        (p.isEndpoint ? ' sum-endpoint' : '') +
        (isVisited ? ' visited' : '') +
        (isNext ? ' next-target' : '');
      li.innerHTML = `
        <span class="sum-emoji">${p.emoji}</span>
        <span class="sum-name">${escapeHtml(p.name)}</span>
        ${p.isEndpoint ? '' : (state.activeWalk && !isVisited
          ? `<button class="remove" data-stop-idx="${stopIdx}" title="手動チェックイン">✓</button>`
          : `<button class="remove" data-id="${p.id}" aria-label="削除">×</button>`)}
      `;
      list.appendChild(li);

      // Insert leg row between this and next
      if (i < points.length - 1) {
        let legText = '';
        let stepDetails = '';
        if (legs && legs[i]) {
          const km = (legs[i].distanceM / 1000).toFixed(1);
          const min = Math.round(legs[i].durationS / 60);
          legText = `↓ ${min}分 ・ ${km}km`;
          // Build turn-by-turn summary
          const steps = legs[i].steps || [];
          if (steps.length > 0) {
            const significant = steps.filter(s => s.distanceM > 50 && s.maneuver !== 'arrive' && s.maneuver !== 'depart');
            if (significant.length > 0) {
              stepDetails = significant.slice(0, 3).map(s => {
                const dKm = s.distanceM > 1000 ? (s.distanceM/1000).toFixed(1) + 'km' : Math.round(s.distanceM) + 'm';
                const turn = maneuverIcon(s.maneuver, s.modifier);
                const name = s.name ? `「${s.name}」` : '';
                return `${turn}${dKm}${name}`;
              }).join(' → ');
            }
          }
        } else {
          const next = points[i + 1];
          const km = haversineKm(p, next);
          const min = Math.round(travelMinutes(km));
          legText = `↓ 約${min}分 ・ 約${km.toFixed(1)}km`;
        }
        const legLi = document.createElement('li');
        legLi.className = 'sum-leg';
        legLi.innerHTML = `<span class="sum-leg-summary">${escapeHtml(legText)}</span>${stepDetails ? `<details class="sum-leg-steps"><summary>道順</summary><div class="sum-leg-steps-inner">${escapeHtml(stepDetails)}</div></details>` : ''}`;
        list.appendChild(legLi);
      }
    });

    list.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.stopIdx != null) {
          // Manual check-in
          checkInStop(parseInt(btn.dataset.stopIdx, 10), true);
          return;
        }
        const id = btn.dataset.id;
        const poi = state.selected.find(s => s.id === id);
        if (poi) toggleSelect(poi);
      });
    });

    // Totals
    let totalMin, totalKm;
    if (legs) {
      totalMin = Math.round(state.routeTotalS / 60);
      totalKm = (state.routeTotalM / 1000).toFixed(1);
    } else {
      // Fallback haversine
      totalKm = 0;
      for (let i = 0; i < points.length - 1; i++) {
        totalKm += haversineKm(points[i], points[i + 1]);
      }
      totalMin = Math.round(travelMinutes(totalKm));
      totalKm = totalKm.toFixed(1);
    }
    if (state.mode === 'course') {
      totals.innerHTML = `
        <span>📍 <strong>${state.selected.length}</strong> スポット</span>
        <span>⏱ <strong>${totalMin}</strong> 分</span>
        <span>📏 <strong>${totalKm}</strong> km</span>
      `;
    } else {
      const directKm = state.dest ? haversineKm(state.origin, state.dest) : 0;
      const directMin = Math.round(travelMinutes(directKm));
      const extraMin = totalMin - directMin;
      totals.innerHTML = `
        <span>直行：<strong>${directMin}分</strong></span>
        <span>寄り道込：<strong>${totalMin}分 / ${totalKm}km</strong></span>
        <span class="delta">+${extraMin}分</span>
      `;
    }

    // Add "Open in Google Maps" button
    let navBtn = $('#nav-google');
    if (!navBtn) {
      navBtn = document.createElement('a');
      navBtn.id = 'nav-google';
      navBtn.className = 'btn-navigate';
      navBtn.target = '_blank';
      navBtn.rel = 'noopener';
      totals.parentElement.insertBefore(navBtn, totals.nextSibling);
    }
    navBtn.href = buildGoogleMapsUrl();
    navBtn.innerHTML = '<span>📱</span><span>Googleマップで開いてナビ</span>';
  }

  function buildGoogleMapsUrl() {
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('origin', `${state.origin.lat},${state.origin.lng}`);
    const dest = state.dest || state.origin;
    url.searchParams.set('destination', `${dest.lat},${dest.lng}`);
    if (state.selected.length > 0) {
      url.searchParams.set('waypoints', state.selected.map(s => `${s.lat},${s.lng}`).join('|'));
    }
    const mode = state.travel === 'walk' ? 'walking' : state.travel === 'bike' ? 'bicycling' : 'driving';
    url.searchParams.set('travelmode', mode);
    return url.toString();
  }

  // Compute bearing from point A to B in degrees (0 = north)
  function bearing(a, b) {
    const lat1 = a[0] * Math.PI / 180;
    const lat2 = b[0] * Math.PI / 180;
    const dLng = (b[1] - a[1]) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }

  // Place arrow markers at regular distance intervals along a polyline
  function decorateWithArrows(coords, intervalM = 60) {
    const arrows = [];
    let cumDist = 0;
    let nextAt = intervalM;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      const segM = haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) * 1000;
      if (segM === 0) continue;
      const segBearing = bearing(a, b);
      while (cumDist + segM >= nextAt) {
        const t = (nextAt - cumDist) / segM;
        const lat = a[0] + (b[0] - a[0]) * t;
        const lng = a[1] + (b[1] - a[1]) * t;
        // SVG arrow pointing UP (north) — rotate by bearing directly
        // 0° = north (up), 90° = east (right), 180° = south (down), 270° = west (left)
        const svg = `<svg width="22" height="22" viewBox="0 0 22 22" style="transform: rotate(${segBearing}deg);">
          <circle cx="11" cy="11" r="10" fill="#ff7e3d" stroke="white" stroke-width="2"/>
          <path d="M11 4 L17 16 L11 13 L5 16 Z" fill="white" stroke="none"/>
        </svg>`;
        const m = L.marker([lat, lng], {
          icon: L.divIcon({
            html: svg,
            className: 'route-arrow-wrap',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
          interactive: false,
          keyboard: false,
          zIndexOffset: 200,
        });
        arrows.push(m);
        nextAt += intervalM;
      }
      cumDist += segM;
    }
    return arrows;
  }

  function maneuverIcon(type, modifier) {
    if (type === 'turn') {
      if (modifier === 'left' || modifier === 'sharp left' || modifier === 'slight left') return '↰ 左折';
      if (modifier === 'right' || modifier === 'sharp right' || modifier === 'slight right') return '↱ 右折';
      return '⇨ ';
    }
    if (type === 'merge' || type === 'on ramp') return '⇨ 合流';
    if (type === 'roundabout' || type === 'rotary') return '⟲ ロータリー';
    if (type === 'fork') return '⇆ 分岐';
    if (type === 'continue') return '⇧ 直進';
    if (type === 'new name') return '⇨ ';
    return '⇨ ';
  }

  // OSRM road-following routing
  // Uses routing.openstreetmap.de (free public OSRM with foot/bike/car profiles)
  const OSRM_PROFILES = {
    walk: { server: 'routed-foot', profile: 'foot' },
    bike: { server: 'routed-bike', profile: 'bike' },
    car:  { server: 'routed-car',  profile: 'driving' },
  };

  const routeCache = new Map();

  async function fetchRoadPath(points, mode) {
    if (points.length < 2) return null;
    const cfg = OSRM_PROFILES[mode] || OSRM_PROFILES.walk;
    const coordStr = points.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
    const cacheKey = `${cfg.server}|${coordStr}`;
    if (routeCache.has(cacheKey)) return routeCache.get(cacheKey);

    const url = `https://routing.openstreetmap.de/${cfg.server}/route/v1/${cfg.profile}/${coordStr}?overview=full&geometries=geojson&steps=true&annotations=false`;
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('osrm ' + res.status);
      const data = await res.json();
      if (!data.routes || data.routes.length === 0) throw new Error('no route');
      const route = data.routes[0];
      // Convert legs into per-segment metrics + steps for turn-by-turn
      const legs = (route.legs || []).map(leg => ({
        distanceM: leg.distance,
        durationS: leg.duration,
        steps: (leg.steps || []).map(s => ({
          distanceM: s.distance,
          name: s.name || '',
          maneuver: s.maneuver?.type || '',
          modifier: s.maneuver?.modifier || '',
        })),
      }));
      const result = {
        coords: route.geometry.coordinates.map(c => [c[1], c[0]]), // lat,lng
        distanceM: route.distance,
        durationS: route.duration,
        legs,
      };
      routeCache.set(cacheKey, result);
      return result;
    } catch (e) {
      console.warn('OSRM routing failed:', e);
      state.routeFallbackReason = e.message || 'unknown';
      if (typeof showRouteWarning === 'function') showRouteWarning();
      return null;
    }
  }

  // Show a warning banner with retry button when OSRM fails
  function showRouteWarning() {
    let banner = $('#route-warning');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'route-warning';
      banner.className = 'route-warning-banner';
      $('.map-wrap').appendChild(banner);
    }
    banner.innerHTML = `
      ⚠ 道なりルート取得失敗（直線で表示中）
      <button id="route-retry">🔄 再試行</button>
      <button id="route-warning-close" aria-label="閉じる">✕</button>
    `;
    banner.hidden = false;
    $('#route-retry').onclick = async () => {
      banner.hidden = true;
      showToast('🔄 ルート再取得中...', 'info', 1500);
      // Clear cache for this route
      routeCache.clear();
      drawRoutes();
    };
    $('#route-warning-close').onclick = () => { banner.hidden = true; };
    setTimeout(() => { banner.hidden = true; }, 8000);
  }

  let drawRoutesToken = 0;

  async function drawRoutes() {
    const myToken = ++drawRoutesToken;
    clearRoutes();
    if (!state.origin) return;

    const mode = state.travel;

    // 1) Direct route (gray dashed) — only meaningful in free mode
    if (state.dest && state.mode !== 'course') {
      const directRoad = await fetchRoadPath([state.origin, state.dest], mode);
      if (myToken !== drawRoutesToken) return;
      const directCoords = directRoad ? directRoad.coords
        : [[state.origin.lat, state.origin.lng], [state.dest.lat, state.dest.lng]];
      state.routeLines.direct = L.polyline(directCoords, {
        color: '#94a3b8', weight: 3, opacity: 0.55, dashArray: '6,8'
      }).addTo(state.map);
    }

    // 2) Detour route — three-layer with animated arrow + per-leg color
    if (state.selected.length > 0) {
      const points = [state.origin, ...state.selected];
      if (state.dest) points.push(state.dest);
      else points.push(state.origin); // stroll round-trip

      const road = await fetchRoadPath(points, mode);
      if (myToken !== drawRoutesToken) return;

      const detourCoords = road ? road.coords
        : points.map(p => [p.lat, p.lng]);

      const layers = [];

      // Layer 1: white outline (readability)
      const outline = L.polyline(detourCoords, {
        color: '#ffffff',
        weight: 12,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(state.map);
      layers.push(outline);

      // Layer 2: orange filled body
      const body = L.polyline(detourCoords, {
        color: '#ff7e3d',
        weight: 7,
        opacity: 1,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(state.map);
      layers.push(body);

      // Layer 3: directional arrow markers placed every ~80m along the route
      const arrowMarkers = decorateWithArrows(detourCoords, 80);
      arrowMarkers.forEach(m => m.addTo(state.map));
      layers.push(...arrowMarkers);

      state.routeLines.detour = layers;
      state.routeLines.detourBg = null;

      if (road && road.legs) {
        state.routeLegs = road.legs;
        state.routeTotalM = road.distanceM;
        state.routeTotalS = road.durationS;
      } else {
        state.routeLegs = null;
        state.routeTotalM = null;
        state.routeTotalS = null;
      }
      renderSummary();
      updateCompareBadge();
    }
  }

  function updateCompareBadge() {
    let badge = $('#compare-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'compare-badge';
      badge.className = 'compare-badge';
      $('.map-wrap').appendChild(badge);
    }
    // In course mode, show course summary; in free mode, show direct vs detour
    if (state.mode === 'course' && state.selected.length > 0) {
      const totalKm = state.routeTotalM ? (state.routeTotalM / 1000).toFixed(1) : '';
      const totalMin = state.routeTotalS ? Math.round(state.routeTotalS / 60) : Math.round(state.selected.reduce((s, p) => s + (p.detourMin || 0), 0));
      badge.hidden = false;
      badge.innerHTML = `
        <span><span class="lbl">📍</span> <span class="val">${state.selected.length}スポット</span></span>
        <span class="sep"></span>
        <span><span class="lbl">⏱</span> <span class="val">${totalMin}分</span></span>
        ${totalKm ? `<span class="sep"></span><span><span class="lbl">📏</span> <span class="val">${totalKm}km</span></span>` : ''}
      `;
      return;
    }
    if (!state.origin || !state.dest) {
      badge.hidden = true;
      return;
    }
    const directKm = haversineKm(state.origin, state.dest);
    const directMin = travelMinutes(directKm);
    const totalExtra = state.selected.reduce((s, p) => s + p.detourMin, 0);
    badge.hidden = false;
    badge.innerHTML = `
      <span><span class="lbl">直行:</span> <span class="val">${Math.round(directMin)}分</span></span>
      <span class="sep"></span>
      <span><span class="lbl">寄り道:</span> <span class="val">${Math.round(directMin + totalExtra)}分</span></span>
      ${totalExtra > 0 ? `<span class="sep"></span><span class="delta">+${Math.round(totalExtra)}分</span>` : ''}
    `;
  }

  // ---------- URL hash state ----------

  function saveStateToHash() {
    const h = {
      m: state.mode,
      t: state.travel,
      b: state.budgetMin,
      c: [...state.activeCategories].join(','),
      o: state.origin ? `${state.origin.lat.toFixed(5)},${state.origin.lng.toFixed(5)},${encodeURIComponent(state.origin.shortLabel || '')}` : '',
      d: state.dest ? `${state.dest.lat.toFixed(5)},${state.dest.lng.toFixed(5)},${encodeURIComponent(state.dest.shortLabel || '')}` : '',
      s: state.selected.map(p => p.id).join('|'),
    };
    const params = new URLSearchParams();
    Object.entries(h).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) params.set(k, v); });
    history.replaceState(null, '', '#' + params.toString());
  }

  function loadStateFromHash() {
    const hash = location.hash.slice(1);
    if (!hash) return false;
    const p = new URLSearchParams(hash);
    if (p.has('m')) state.mode = p.get('m');
    if (p.has('t')) state.travel = p.get('t');
    if (p.has('b')) state.budgetMin = parseInt(p.get('b'), 10) || 15;
    if (p.has('c')) state.activeCategories = new Set(p.get('c').split(',').filter(Boolean));
    if (p.has('o')) {
      const [lat, lng, label] = p.get('o').split(',');
      state.origin = { lat: parseFloat(lat), lng: parseFloat(lng), label: decodeURIComponent(label || ''), shortLabel: decodeURIComponent(label || '') };
    }
    if (p.has('d')) {
      const [lat, lng, label] = p.get('d').split(',');
      state.dest = { lat: parseFloat(lat), lng: parseFloat(lng), label: decodeURIComponent(label || ''), shortLabel: decodeURIComponent(label || '') };
    }
    return true;
  }

  // ---------- Categories UI ----------

  function buildCategories() {
    const grid = $('#cat-grid');
    grid.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cat-chip' + (state.activeCategories.has(cat.id) ? ' active' : '');
      chip.dataset.id = cat.id;
      chip.setAttribute('aria-pressed', state.activeCategories.has(cat.id));
      chip.innerHTML = `<span class="cat-emoji">${cat.emoji}</span><span>${cat.label}</span>`;
      chip.addEventListener('click', () => {
        if (state.activeCategories.has(cat.id)) state.activeCategories.delete(cat.id);
        else state.activeCategories.add(cat.id);
        chip.classList.toggle('active');
        chip.setAttribute('aria-pressed', state.activeCategories.has(cat.id));
        saveStateToHash();
      });
      grid.appendChild(chip);
    });
  }

  // ---------- Mode tabs ----------

  function setMode(mode) {
    const previousMode = state.mode;
    state.mode = mode;

    // Clean up state when switching mode (avoid leftover markers / polylines)
    if (previousMode && previousMode !== mode) {
      // Stop any active walk
      if (state.activeWalk) stopWalk();
      // Clear selection (route through stops)
      state.selected = [];
      state.routeLegs = null;
      state.routeTotalM = null;
      state.routeTotalS = null;
      // Clear visual layers
      clearRoutes();
      clearPoiMarkers();
      clearPreviewMarkers();
      // Clear endpoints when leaving course mode
      if (previousMode === 'course' && mode !== 'course') {
        setEndpointMarker('origin', null);
        setEndpointMarker('dest', null);
        state.origin = null;
        state.dest = null;
        // 自由/散歩モードに切替時：現在地を出発地のデフォルトに
        if (navigator.geolocation && (mode === 'route' || mode === 'stroll')) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              state.origin = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                name: '現在地',
                shortLabel: '現在地',
              };
              try { setEndpointMarker('origin', state.origin); } catch {}
              const originInput = $('#origin-input');
              if (originInput) originInput.value = '現在地';
              showToast('📍 現在地を出発地に設定しました', 'success', 2500);
            },
            () => { /* 取得失敗は静かに */ },
            { enableHighAccuracy: false, timeout: 5000, maximumAge: 30000 }
          );
        }
      }
      // Reset UI
      const summarySection = $('#summary-section');
      if (summarySection) summarySection.hidden = true;
      const compareBadge = $('#compare-badge');
      if (compareBadge) compareBadge.hidden = true;
      const detailCard = $('#detail-card');
      if (detailCard) detailCard.hidden = true;
      const warning = $('#route-warning');
      if (warning) warning.hidden = true;
      // Reset gacha session counter
      state.sessionPullCount = 0;
    }

    ['course', 'route', 'stroll'].forEach(m => {
      const tab = $(`#tab-${m}`);
      if (tab) {
        tab.classList.toggle('active', mode === m);
        tab.setAttribute('aria-selected', mode === m);
      }
    });
    const freeBlock = $('#free-mode-block');
    if (freeBlock) freeBlock.hidden = (mode === 'course');
    const filtersSec = $('#filters-section');
    if (filtersSec) filtersSec.hidden = (mode !== 'course');
    const destRow = $('#dest-row');
    if (destRow) destRow.style.display = (mode === 'stroll') ? 'none' : '';
    if (mode === 'stroll') {
      state.dest = null;
      setEndpointMarker('dest', null);
    }
    // Update gacha button label
    const gachaTitle = $('#gacha-title');
    if (gachaTitle) {
      gachaTitle.textContent = (mode === 'course')
        ? 'コースガチャを回す'
        : (mode === 'stroll' ? '散歩ガチャを回す（ランダム生成）' : '自由ルートガチャを回す（ランダム生成）');
    }
    // モード別にテーマ選択 / quick-modes を出し分け
    const quickModes = $('#quick-modes-course');
    const themeChips = $('#theme-chips');
    if (quickModes) quickModes.style.display = (mode === 'course') ? '' : 'none';
    if (themeChips) themeChips.hidden = (mode === 'course');
    // Update collection button label
    const colBtn = $('#collection-btn span:last-child');
    if (colBtn) colBtn.textContent = (mode === 'course') ? 'コース図鑑' : 'コレクション';
    // Update empty state message
    const empty = $('#empty-state p');
    if (empty) {
      empty.textContent = (mode === 'course')
        ? '🎰 上のガチャでコースを引いてみよう！'
        : '👇 条件を設定して「寄り道候補を探す」を押してください';
    }
    // Update results header label
    const resultsCount = $('#results-count');
    if (resultsCount && state.candidates.length === 0) {
      resultsCount.textContent = (mode === 'course') ? 'コースを引くとここに表示' : '候補：0 件';
    }
    // Update summary header label
    const sumHeader = $('#summary-header');
    if (sumHeader) sumHeader.textContent = (mode === 'course') ? '選んだコース' : 'あなたの寄り道ルート';
    // Update walk-start button label
    const walkStart = $('#walk-start span:last-child');
    if (walkStart) walkStart.textContent = (mode === 'course') ? 'このコースを歩き始める' : 'このルートを歩き始める';
    // Hide sort button in course mode (no candidates to sort)
    const sortBtn = $('#sort-btn');
    if (sortBtn) sortBtn.style.display = (mode === 'course') ? 'none' : '';
    // Today's pick + home stats visible only in course mode
    if (typeof renderTodaysPick === 'function') renderTodaysPick();
    if (typeof renderHomeStats === 'function') renderHomeStats();
    if (typeof renderCoursePreview === 'function') renderCoursePreview();
    saveStateToHash();
  }

  function buildAreaSelector() {
    const grid = $('#area-grid');
    if (!grid) return;
    const areas = window.YORIMICHI_AREAS || [];
    grid.innerHTML = '';
    // "All" chip
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'area-chip' + (state.activeArea === null ? ' active' : '');
    all.dataset.id = 'all';
    all.innerHTML = `<span class="area-emoji">🗺</span><span>すべて</span>`;
    all.addEventListener('click', () => {
      state.activeArea = null;
      buildAreaSelector();
      saveStateToHash();
    });
    grid.appendChild(all);

    areas.forEach(area => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'area-chip' +
        (state.activeArea === area.id ? ' active' : '') +
        (area.enabled ? '' : ' disabled');
      chip.dataset.id = area.id;
      chip.disabled = !area.enabled;
      chip.innerHTML = `
        <span class="area-emoji">${area.icon}</span>
        <span>${tField(area, 'name')}</span>
        ${area.comingSoon ? `<span class="area-badge">${currentLang === 'en' ? 'Soon' : '準備中'}</span>` : ''}
      `;
      chip.addEventListener('click', () => {
        if (!area.enabled) return;
        state.activeArea = state.activeArea === area.id ? null : area.id;
        buildAreaSelector();
        if (typeof updateFilterStat === 'function') updateFilterStat();
        state.currentPlans = [];
        renderCoursePreview();
        // Center map on chosen area's first course
        if (state.activeArea) {
          const cs = getCourseCandidates();
          if (cs.length > 0 && state.map) {
            state.map.flyTo([cs[0].origin.lat, cs[0].origin.lng], 14, { duration: 0.6 });
          }
        }
        saveStateToHash();
      });
      grid.appendChild(chip);
    });
  }

  function getCourseCandidates() {
    let all = window.YORIMICHI_COURSES || [];
    // Only enabled areas
    const enabledIds = new Set((window.YORIMICHI_AREAS || []).filter(a => a.enabled).map(a => a.id));
    all = all.filter(c => enabledIds.has(c.area));
    if (state.activeArea) all = all.filter(c => c.area === state.activeArea);
    if (state.activeTags.size > 0) {
      const want = state.activeTags;
      all = all.filter(c => {
        const courseTags = new Set([...(c.tags || []), ...c.stops.flatMap(s => s.tags || [])]);
        for (const t of want) if (!courseTags.has(t)) return false;
        return true;
      });
    }
    // Photo / perk visual filters
    if (state.filterHasPhoto) {
      const photos = window.YORIMICHI_PHOTOS || {};
      all = all.filter(c => c.stops.some(s => photos[s.name]));
    }
    if (state.filterHasPerk) {
      const perks = window.YORIMICHI_PERKS || {};
      // 提携締結済みの特典のみで絞り込み（status: 'live'）
      all = all.filter(c => c.stops.some(s => perks[s.name] && perks[s.name].status === 'live'));
    }
    // 所要時間フィルタ
    const dur = state.filterDuration || 'all';
    if (dur === 'short') all = all.filter(c => (c.estimatedMin || 0) <= 30);
    else if (dur === 'medium') all = all.filter(c => (c.estimatedMin || 0) > 30 && (c.estimatedMin || 0) <= 90);
    else if (dur === 'long') all = all.filter(c => (c.estimatedMin || 0) > 90);
    // 未完走のみ
    if (state.filterUnwalked) {
      all = all.filter(c => !state.completedCourses.has(c.id));
    }
    // 雨でもOK = 屋内タグ多め or 全体に屋内比率高い
    if (state.filterRainOk) {
      all = all.filter(c => {
        const tags = [...(c.tags || []), ...c.stops.flatMap(s => s.tags || [])];
        const indoorTags = ['屋内', 'カフェ', '美術館', '博物館', '神社', '寺', '雨でもOK', '雨の日', '室内', 'ショッピング', 'ギャラリー'];
        const hits = tags.filter(t => indoorTags.some(ind => String(t).includes(ind))).length;
        return hits >= 1;
      });
    }
    // 夜OK = bestTime に夜時間帯を含むスポットが2件以上 or 'nightlife' タグ
    if (state.filterNightOk) {
      all = all.filter(c => {
        const tags = [...(c.tags || []), ...c.stops.flatMap(s => s.tags || [])];
        if (tags.some(t => /夜|ナイト|バー|居酒屋|night/i.test(String(t)))) return true;
        // bestTime チェック: 18:00以降を含むスポットが2件以上
        const nightStops = c.stops.filter(s => {
          if (!s.bestTime) return false;
          const m = String(s.bestTime).match(/(\d{1,2}):/);
          if (!m) return false;
          const hr = parseInt(m[1], 10);
          return hr >= 18 || hr <= 4;
        });
        return nightStops.length >= 2;
      });
    }
    return all;
  }

  function buildTagFilter() {
    const grid = $('#tag-grid');
    if (!grid) return;
    // Aggregate all tags from courses (in enabled areas)
    const enabledIds = new Set((window.YORIMICHI_AREAS || []).filter(a => a.enabled).map(a => a.id));
    const allCourses = (window.YORIMICHI_COURSES || []).filter(c => enabledIds.has(c.area));
    const tagCount = new Map();
    allCourses.forEach(c => {
      const tags = new Set([...(c.tags || []), ...c.stops.flatMap(s => s.tags || [])]);
      tags.forEach(t => tagCount.set(t, (tagCount.get(t) || 0) + 1));
    });
    // Sort by frequency desc, take top 12
    const sorted = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

    grid.innerHTML = '';
    sorted.forEach(([tag, count]) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip' + (state.activeTags.has(tag) ? ' active' : '');
      chip.textContent = `#${tag}`;
      chip.title = `${count}件`;
      chip.addEventListener('click', () => {
        if (state.activeTags.has(tag)) state.activeTags.delete(tag);
        else state.activeTags.add(tag);
        chip.classList.toggle('active');
        updateFilterStat();
        // Reset plans so next gacha pull uses new filter
        state.currentPlans = [];
      });
      grid.appendChild(chip);
    });
    updateFilterStat();
  }

  function updateFilterStat() {
    const stat = $('#filter-stat');
    if (stat) {
      const count = getCourseCandidates().length;
      stat.textContent = `対象：${count}コース`;
    }
    // Active filter count badge
    const badge = $('#filters-active-badge');
    if (badge) {
      const active = (state.activeArea ? 1 : 0) + state.activeTags.size +
        (state.filterHasPhoto ? 1 : 0) + (state.filterHasPerk ? 1 : 0) +
        (state.filterUnwalked ? 1 : 0) + (state.filterRainOk ? 1 : 0) + (state.filterNightOk ? 1 : 0) +
        ((state.filterDuration && state.filterDuration !== 'all') ? 1 : 0);
      if (active > 0) {
        badge.textContent = String(active);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
  }

  // ---------- Theme ----------

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('yorimichi-theme', theme); } catch (e) {}
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('yorimichi-theme'); } catch (e) {}
    if (saved) setTheme(saved);
    $('#theme-toggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      let next;
      if (cur === 'dark') next = 'light';
      else if (cur === 'light') next = 'dark';
      else next = matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
      setTheme(next);
    });
  }

  // ---------- Mobile panel toggle ----------

  function initMobilePanel() {
    const panel = $('#panel');
    const handle = $('#panel-handle');
    handle.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      const expanded = !panel.classList.contains('collapsed');
      handle.setAttribute('aria-expanded', expanded);
      setTimeout(() => state.map.invalidateSize(), 250);
    });

    // Auto-collapse panel when user starts dragging the map (mobile)
    if (state.map) {
      let panelWasCollapsed = false;
      state.map.on('movestart', () => {
        if (window.innerWidth > 768) return; // mobile only
        if (panel.classList.contains('collapsed')) return;
        panel.classList.add('collapsed');
        handle.setAttribute('aria-expanded', 'false');
        panelWasCollapsed = true;
      });
    }

    // Swipe gesture support on the handle bar
    let startY = 0;
    let isDragging = false;
    handle.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      isDragging = true;
    }, { passive: true });
    handle.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const deltaY = e.touches[0].clientY - startY;
      if (deltaY > 30) {
        // Swipe down: collapse
        panel.classList.add('collapsed');
        handle.setAttribute('aria-expanded', 'false');
        isDragging = false;
        setTimeout(() => state.map.invalidateSize(), 250);
      } else if (deltaY < -30) {
        // Swipe up: expand
        panel.classList.remove('collapsed');
        handle.setAttribute('aria-expanded', 'true');
        isDragging = false;
        setTimeout(() => state.map.invalidateSize(), 250);
      }
    }, { passive: true });
    handle.addEventListener('touchend', () => { isDragging = false; }, { passive: true });
  }

  // ---------- Helpers ----------

  // Normalize Japanese text for search: hiragana ↔ katakana, lowercase
  function normalizeJa(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/\s+/g, '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ---------- Slider visual fill ----------

  function updateSliderFill() {
    const slider = $('#budget-slider');
    const min = +slider.min, max = +slider.max, val = +slider.value;
    const pct = ((val - min) / (max - min)) * 100;
    slider.style.setProperty('--fill', pct + '%');
    $('#budget-value').textContent = `+${val} 分`;
    state.budgetMin = val;
  }

  // ============================================================
  // GACHA SYSTEM
  // ============================================================

  const RARITY = {
    legendary: { name: 'LEGENDARY', stars: '✨✨✨', cls: 'rarity-legendary', rate: 0.01 },
    sr:        { name: 'SUPER RARE', stars: '🌟🌟', cls: 'rarity-sr', rate: 0.09 },
    r:         { name: 'RARE', stars: '⭐', cls: 'rarity-r', rate: 0.30 },
    n:         { name: 'NORMAL', stars: '◎', cls: 'rarity-n', rate: 0.60 },
  };

  // ---------- Themes ----------

  const THEMES = {
    cafe_hop:    { id: 'cafe_hop',    name: 'カフェ巡り',     icon: '☕', cats: ['cafe', 'bakery', 'sweets'] },
    shrine:      { id: 'shrine',      name: '御朱印巡礼',     icon: '⛩️', cats: ['shrine'] },
    view:        { id: 'view',        name: '絶景ハント',     icon: '🌅', cats: ['viewpoint', 'park'] },
    art:         { id: 'art',         name: 'アートな散歩',   icon: '🎨', cats: ['art'] },
    sweets:      { id: 'sweets',      name: 'スイーツ三昧',   icon: '🍰', cats: ['sweets', 'bakery', 'cafe'] },
    green:       { id: 'green',       name: '緑したたむ',     icon: '🌳', cats: ['park', 'shrine'] },
    book:        { id: 'book',        name: '本と紙の道',     icon: '📚', cats: ['bookstore', 'cafe'] },
    onsen:       { id: 'onsen',       name: '湯けむり寄り道', icon: '♨️', cats: ['sento'] },
    mixed:       { id: 'mixed',       name: 'おまかせ冒険',   icon: '🎲', cats: null }, // any
  };

  // Title generator (templates per theme + rarity, mixed in)
  function generateRouteTitle(theme, stops, rarity) {
    const top = stops[0];
    const last = stops[stops.length - 1];
    const adj = {
      legendary: ['伝説の', '至高の', '一生に一度の', '幻の'],
      sr:        ['とびきりの', 'とっておきの', '名物', 'ご褒美'],
      r:         ['ちょっと素敵な', 'お気に入り', '小さな贅沢の'],
      n:         ['ふらっと', 'のんびり', '気まぐれ'],
    };
    const a = adj[rarity][Math.floor(Math.random() * adj[rarity].length)];
    if (theme.id === 'mixed') {
      const cats = [...new Set(stops.map(s => categoryById(s.cat)?.label).filter(Boolean))];
      return `${a}${cats.slice(0, 2).join('と')}の旅`;
    }
    if (stops.length === 1) {
      return `${a}${theme.name}：${top.name}`;
    }
    if (stops.length >= 4) {
      return `${a}${theme.name}（${stops.length}スポット）`;
    }
    return `${a}${theme.name}：${top.name}と${last.name}`;
  }

  // ===== Coin Economy =====
  // 1ガチャのコスト（コイン）
  const GACHA_COST = 3;
  // コース完走ボーナス
  const COMPLETION_BONUS = 3;

  // ===== Theme → Category mapping for random gacha =====
  // 自由ルート/散歩モードでテーマ選択時にPOI抽選を寄せる
  const THEME_CONFIG = {
    cafe:   { label: 'カフェ・喫茶',   cats: ['cafe'],                              boost: 3 },
    shrine: { label: '神社・寺',       cats: ['shrine'],                            boost: 3 },
    photo:  { label: '写真映え',       cats: ['viewpoint', 'art', 'monument'],      boost: 3 },
    food:   { label: '食べ歩き',       cats: ['restaurant', 'bakery'],              boost: 3 },
    green:  { label: '緑の散歩道',     cats: ['park'],                              boost: 3 },
    sunset: { label: '夕焼けタイム',   cats: ['viewpoint', 'shrine', 'park'],       boost: 3 },
  };

  // ランダムガチャから除外するOSM amenity（病院・銀行・ガソリン等）
  const EXCLUDE_AMENITIES = new Set([
    'hospital', 'pharmacy', 'doctors', 'clinic', 'dentist', 'veterinary',
    'fuel', 'bank', 'atm', 'parking', 'parking_entrance', 'parking_space',
    'taxi', 'embassy', 'police', 'post_office', 'post_box',
    'school', 'university', 'kindergarten', 'college', 'driving_school',
    'fire_station', 'townhall', 'courthouse', 'prison',
    'recycling', 'waste_disposal', 'vending_machine',
    'car_wash', 'car_rental', 'car_repair',
  ]);

  // POI quality scoring（高いほど街歩きに向く）
  function poiQualityScore(poi) {
    let s = 0;
    const tags = poi.tags || {};
    if (tags.wikipedia) s += 5;
    if (tags.wikidata) s += 2;
    if (tags.image || tags['mapillary']) s += 2;
    if (tags.website) s += 2;
    if (tags.opening_hours) s += 1;
    if (tags.description) s += 2;
    if (tags.tourism) s += 3;
    if (tags.historic) s += 3;
    // amenity ブラックリスト
    if (tags.amenity && EXCLUDE_AMENITIES.has(tags.amenity)) s -= 100;
    if (tags.shop && (tags.shop === 'convenience' || tags.shop === 'supermarket')) s -= 5;
    if (tags.highway) s -= 50;
    if (tags.barrier) s -= 50;
    return s;
  }

  // 選択中のテーマ（route / stroll モードでのみ意味を持つ）
  state.activeTheme = '';

  // Gacha state (persisted in localStorage)
  const gacha = {
    coins: 0,
    freeUsedToday: 0,
    lastFreeDate: '',
    collection: {},
    pulls: 0,
    pullsSinceSR: 0,        // pity counter for SR
    pullsSinceLR: 0,        // pity counter for LR
  };

  // Date helpers (JST 6:00 reset boundary)
  function getResetDate() {
    // Returns YYYY-MM-DD where the "day" rolls over at 6:00 JST
    const now = new Date();
    const jstOffsetMin = 9 * 60;
    const jst = new Date(now.getTime() + (jstOffsetMin + now.getTimezoneOffset()) * 60 * 1000);
    if (jst.getHours() < 6) {
      jst.setDate(jst.getDate() - 1);
    }
    return jst.toISOString().slice(0, 10);
  }

  function gachaLoad() {
    try {
      const s = JSON.parse(localStorage.getItem('yorimichi-gacha') || '{}');
      Object.assign(gacha, s);
    } catch (e) {}
    const today = getResetDate();
    if (gacha.lastFreeDate !== today) {
      gacha.freeUsedToday = 0;
      gacha.lastFreeDate = today;
      gachaSave();
    }
  }

  function loadStreak() {
    try {
      const raw = localStorage.getItem('yorimichi-streak');
      if (raw) {
        const s = JSON.parse(raw);
        state.loginStreak = s.streak || 0;
        state.lastLoginDate = s.lastDate || '';
      }
    } catch (e) {}
    const today = getResetDate();
    if (state.lastLoginDate === today) return; // already counted today
    // Compute yesterday
    const t = new Date(today + 'T00:00:00');
    t.setDate(t.getDate() - 1);
    const yesterday = t.toISOString().slice(0, 10);
    if (state.lastLoginDate === yesterday) {
      state.loginStreak += 1;
    } else if (state.lastLoginDate) {
      state.loginStreak = 1;
    } else {
      state.loginStreak = 1;
    }
    state.lastLoginDate = today;
    try {
      localStorage.setItem('yorimichi-streak', JSON.stringify({ streak: state.loginStreak, lastDate: today }));
    } catch (e) {}
  }

  function loadCompletion() {
    try {
      const c = JSON.parse(localStorage.getItem('yorimichi-completed') || '[]');
      state.completedCourses = new Set(c);
    } catch (e) {}
    try {
      const cs = JSON.parse(localStorage.getItem('yorimichi-completed-stops') || '{}');
      Object.entries(cs).forEach(([k, v]) => {
        state.completedStops[k] = new Set(v);
      });
    } catch (e) {}
    try {
      state.walkCounts = JSON.parse(localStorage.getItem('yorimichi-walk-counts') || '{}');
    } catch (e) {}
    try {
      state.walkHistory = JSON.parse(localStorage.getItem('yorimichi-walk-history') || '[]');
    } catch (e) {}
    try {
      state.coinClaimedDate = localStorage.getItem('yorimichi-coin-claimed') || '';
    } catch (e) {}
    try {
      const fav = JSON.parse(localStorage.getItem('yorimichi-favorites') || '[]');
      state.favoriteCourses = new Set(fav);
    } catch (e) { state.favoriteCourses = new Set(); }
    try {
      const sk = JSON.parse(localStorage.getItem('yorimichi-skipped-stops') || '{}');
      state.skippedStops = {};
      Object.entries(sk).forEach(([k, v]) => { state.skippedStops[k] = new Set(v); });
    } catch (e) { state.skippedStops = {}; }
  }

  function saveFavorites() {
    try {
      localStorage.setItem('yorimichi-favorites', JSON.stringify([...(state.favoriteCourses || [])]));
    } catch {}
  }

  function isFavorite(courseId) {
    return state.favoriteCourses?.has(courseId);
  }

  function toggleFavorite(courseId) {
    if (!state.favoriteCourses) state.favoriteCourses = new Set();
    if (state.favoriteCourses.has(courseId)) {
      state.favoriteCourses.delete(courseId);
      saveFavorites();
      return false;
    }
    state.favoriteCourses.add(courseId);
    saveFavorites();
    return true;
  }
  function saveCompletion() {
    try {
      localStorage.setItem('yorimichi-completed', JSON.stringify([...state.completedCourses]));
      const cs = {};
      Object.entries(state.completedStops).forEach(([k, set]) => { cs[k] = [...set]; });
      localStorage.setItem('yorimichi-completed-stops', JSON.stringify(cs));
      localStorage.setItem('yorimichi-walk-counts', JSON.stringify(state.walkCounts));
      localStorage.setItem('yorimichi-walk-history', JSON.stringify(state.walkHistory));
    } catch (e) {}
    // クラウド同期スケジュール
    try { if (typeof scheduleSync === 'function') scheduleSync('completion'); } catch {}
  }

  function gachaSave() {
    try {
      localStorage.setItem('yorimichi-gacha', JSON.stringify(gacha));
    } catch (e) {}
    // クラウド同期スケジュール（オプトイン時のみ）
    try { if (typeof scheduleSync === 'function') scheduleSync('gacha'); } catch {}
  }

  function gachaUpdateUI() {
    const freeRemain = Math.max(0, 3 - gacha.freeUsedToday);
    $('#gacha-counter').textContent = `本日 ${gacha.freeUsedToday}/3 回`;
    $('#gacha-coins').textContent = `🪙 ${gacha.coins}`;
    if ($('#modal-free-counter')) $('#modal-free-counter').textContent = `${gacha.freeUsedToday}/3`;
    if ($('#modal-coins')) $('#modal-coins').textContent = String(gacha.coins);
    if ($('#free-remaining')) $('#free-remaining').textContent = String(freeRemain);

    // Update turn button label and disabled state
    const turnBtn = $('#btn-turn');
    const turnCost = $('#turn-cost');
    if (turnBtn && turnCost) {
      // Show pity hint if close
      let pityHint = '';
      if (gacha.pullsSinceLR >= 15) pityHint = ` ✨LRまで${20 - gacha.pullsSinceLR}`;
      else if (gacha.pullsSinceSR >= 7) pityHint = ` 🌟SR以上まで${10 - gacha.pullsSinceSR}`;

      if (isPremiumSync()) {
        turnCost.textContent = `★ プレミアム（使い放題）${pityHint}`;
        turnBtn.disabled = false;
      } else if (freeRemain > 0) {
        turnCost.innerHTML = `残り <span id="free-remaining">${freeRemain}</span>回（無料）${pityHint}`;
        turnBtn.disabled = false;
      } else if (gacha.coins >= GACHA_COST) {
        turnCost.textContent = `🪙 ${GACHA_COST}コイン${pityHint}`;
        turnBtn.disabled = false;
      } else {
        turnCost.textContent = `コイン不足`;
        turnBtn.disabled = true;
      }
    }
  }

  function assignRarity(poi) {
    const tags = poi.tags || {};
    const cat = poi.cat;
    let rarity = 'n';
    const isSpecialCat = cat === 'viewpoint' || cat === 'art' || cat === 'shrine';
    if (tags.wikipedia && (isSpecialCat || tags.wikidata)) rarity = 'legendary';
    else if (tags.wikipedia || tags.wikidata) rarity = 'sr';
    else if (tags.website || tags.description || tags.opening_hours) rarity = 'r';
    else if (poi.name && cat) rarity = 'r';
    else rarity = 'n';
    return rarity;
  }

  function rollRarity() {
    const r = Math.random();
    let acc = 0;
    for (const [key, def] of Object.entries(RARITY)) {
      acc += def.rate;
      if (r < acc) return key;
    }
    return 'n';
  }

  // ---------- Route generation (gacha unit) ----------

  // Pick a theme matching available candidates and target rarity
  function pickTheme(annotated, targetRarity) {
    const themeKeys = Object.keys(THEMES);
    // Try non-mixed themes first
    const tries = themeKeys.filter(k => k !== 'mixed').sort(() => Math.random() - 0.5);
    for (const key of tries) {
      const t = THEMES[key];
      const matching = annotated.filter(p => t.cats === null || t.cats.includes(p.cat));
      const minStops = targetRarity === 'legendary' ? 3 : targetRarity === 'sr' ? 2 : 1;
      if (matching.length >= minStops) return t;
    }
    return THEMES.mixed;
  }

  // Greedy nearest-neighbor ordering of stops between origin and dest
  function orderStops(origin, dest, stops) {
    const ordered = [];
    let current = origin;
    const remaining = [...stops];
    while (remaining.length > 0) {
      remaining.sort((a, b) => {
        const aScore = haversineKm(current, a) + (dest ? haversineKm(a, dest) * 0.3 : 0);
        const bScore = haversineKm(current, b) + (dest ? haversineKm(b, dest) * 0.3 : 0);
        return aScore - bScore;
      });
      const next = remaining.shift();
      ordered.push(next);
      current = next;
    }
    return ordered;
  }

  // Pick N stops from candidates greedily, keeping total route within budget
  function pickStops(candidates, budgetMin, n) {
    const origin = state.origin;
    const dest = state.dest;
    const maxBudget = budgetMin * 1.2; // 20% slack
    const picked = [];
    const remaining = [...candidates];

    while (picked.length < n && remaining.length > 0) {
      // Random pick from top-N options for variety
      const topN = Math.max(1, Math.min(remaining.length, picked.length === 0 ? 8 : 4));
      const idx = Math.floor(Math.random() * topN);
      const cand = remaining.splice(idx, 1)[0];

      // Try adding this stop and check the actual route detour
      const trial = orderStops(origin, dest, [...picked, cand]);
      const m = computeRouteMetrics(origin, dest, trial);
      if (m.detourMin > maxBudget) continue;
      picked.push(cand);
    }
    return picked;
  }

  // Compute total detour time for a route (from origin via stops to dest)
  function computeRouteMetrics(origin, dest, orderedStops) {
    let path = [origin, ...orderedStops];
    if (dest) path.push(dest);
    else path.push(origin); // stroll: round trip

    let totalKm = 0;
    for (let i = 0; i < path.length - 1; i++) {
      totalKm += haversineKm(path[i], path[i + 1]);
    }
    const totalMin = travelMinutes(totalKm) + orderedStops.length * STAY_MIN;

    // Direct (no stops) for comparison
    const directKm = dest ? haversineKm(origin, dest) : 0;
    const directMin = travelMinutes(directKm);
    const detourMin = totalMin - directMin;

    return { totalKm, totalMin, directMin, detourMin };
  }

  function computeRouteRarity(stops) {
    let score = stops.length * 6;
    score += stops.filter(s => s.tags && (s.tags.wikipedia || s.tags.wikidata)).length * 12;
    score += stops.filter(s => s.tags && (s.tags.website || s.tags.opening_hours)).length * 4;
    // Bonus for theme coherence (all same category)
    const cats = new Set(stops.map(s => s.cat));
    if (cats.size === 1 && stops.length >= 2) score += 6;
    if (score >= 50) return 'legendary';
    if (score >= 30) return 'sr';
    if (score >= 14) return 'r';
    return 'n';
  }

  // Generate one route (a gacha pull)
  function generateRoute(targetRarity = null) {
    const candidates = state.candidates;
    if (candidates.length === 0) return null;

    const tr = targetRarity || rollRarity();

    // Annotate POIs with rarity
    const annotated = candidates.map(p => ({ ...p, rarity: assignRarity(p) }));

    // Choose number of stops based on target rarity
    const stopRanges = {
      legendary: [4, 5],
      sr:        [3, 4],
      r:         [2, 3],
      n:         [1, 2],
    };
    const [minN, maxN] = stopRanges[tr];
    const n = minN + Math.floor(Math.random() * (maxN - minN + 1));

    // ユーザー選択テーマがあれば優先、なければ自動 pickTheme
    const userTheme = state.activeTheme && THEME_CONFIG[state.activeTheme];
    let theme;
    if (userTheme) {
      theme = {
        id: state.activeTheme,
        name: userTheme.label,
        icon: ({ cafe: '☕', shrine: '🏯', photo: '📸', food: '🍱', green: '🌳', sunset: '🌅' })[state.activeTheme] || '🌍',
        cats: userTheme.cats,
      };
    } else {
      theme = pickTheme(annotated, tr);
    }

    // Filter candidates by theme（cats マッチを優先）
    let pool;
    if (theme.cats === null) {
      pool = annotated;
    } else {
      const matched = annotated.filter(p => theme.cats.includes(p.cat));
      // ユーザー指定テーマで該当少なければ全候補にフォールバック（ガチャ自体は引ける）
      if (matched.length >= Math.min(n, 2)) pool = matched;
      else pool = annotated;
    }
    if (pool.length < n) pool = annotated; // fallback

    // Sort pool by quality for higher rarities
    if (tr === 'legendary' || tr === 'sr') {
      pool.sort((a, b) => {
        const order = ['legendary', 'sr', 'r', 'n'];
        return order.indexOf(a.rarity) - order.indexOf(b.rarity);
      });
    } else {
      pool.sort(() => Math.random() - 0.5);
    }

    // Pick stops within budget
    const stops = pickStops(pool, state.budgetMin, n);
    if (stops.length === 0) return null;

    // Order them
    const ordered = orderStops(state.origin, state.dest, stops);

    // Metrics
    const metrics = computeRouteMetrics(state.origin, state.dest, ordered);

    // Recompute rarity from actual stops (may upgrade/downgrade)
    const rarity = computeRouteRarity(ordered);

    // Title
    const title = generateRouteTitle(theme, ordered, rarity);

    return {
      id: 'route_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      title,
      theme: theme.id,
      themeIcon: theme.icon,
      themeName: theme.name,
      rarity,
      stops: ordered,
      totalKm: metrics.totalKm,
      totalMin: metrics.totalMin,
      directMin: metrics.directMin,
      detourMin: metrics.detourMin,
      generatedAt: Date.now(),
    };
  }

  // 3-plan state for the new gacha UX
  state.currentPlans = [];
  state.lastPlanContext = null; // 'origin+dest' to detect changes

  let quickMode = 'all'; // 'all' | 'undiscovered' | 'rare-up'

  function pickOneCourse() {
    let pool = [...getCourseCandidates()];
    if (quickMode === 'undiscovered' || $('#pool-undiscovered-only')?.checked) {
      const undisc = pool.filter(c => !state.discoveredCourses.has(c.id));
      if (undisc.length >= 1) pool = undisc;
    }
    if (pool.length === 0) return null;

    // Pity: 20連でLR確定、10連でSR以上確定
    const wantLR = gacha.pullsSinceLR >= 19;
    const wantSR = gacha.pullsSinceSR >= 9;
    if (wantLR) {
      const lrPool = pool.filter(c => c.rarity === 'legendary');
      if (lrPool.length > 0) return courseToRoute(lrPool[Math.floor(Math.random() * lrPool.length)]);
    }
    if (wantSR) {
      const srPool = pool.filter(c => c.rarity === 'legendary' || c.rarity === 'sr');
      if (srPool.length > 0) return courseToRoute(srPool[Math.floor(Math.random() * srPool.length)]);
    }

    if (quickMode === 'rare-up') {
      const weights = pool.map(c => {
        const r = c.rarity || 'r';
        return r === 'legendary' ? 10 : r === 'sr' ? 5 : r === 'r' ? 2 : 1;
      });
      const total = weights.reduce((a, b) => a + b, 0);
      let pick = Math.random() * total;
      for (let i = 0; i < pool.length; i++) {
        pick -= weights[i];
        if (pick <= 0) return courseToRoute(pool[i]);
      }
      return courseToRoute(pool[pool.length - 1]);
    }

    return courseToRoute(pool[Math.floor(Math.random() * pool.length)]);
  }

  /**
   * AI（Claude Haiku）でランダム生成コースに名前と物語を付与
   */
  async function fetchAINarrative(route) {
    if (!route || !route.stops) return null;
    const areaLabel = state.origin?.shortLabel || '街';
    const themeLabel = route.themeName || route.theme || '街歩き';
    const stopNames = route.stops.map(s => s.name).filter(Boolean).slice(0, 8);
    if (stopNames.length === 0) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000); // 8秒で諦める
    try {
      const res = await fetch(`${API_BASE}/api/generate-narrative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: themeLabel,
          area: areaLabel,
          rarity: route.rarity || 'n',
          stops: stopNames,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      return null;
    }
  }

  /**
   * 自由ルート / 散歩モード用：state.candidates から手続き的にコースを生成。
   * Pity（連続ハズレ救済）も適用。
   */
  function pickRandomGeneratedRoute() {
    if (!state.candidates || state.candidates.length === 0) return null;

    // Pity: 20連でLR確定、10連でSR以上確定
    const wantLR = gacha.pullsSinceLR >= 19;
    const wantSR = gacha.pullsSinceSR >= 9;
    let targetRarity = null;
    if (wantLR) targetRarity = 'legendary';
    else if (wantSR) targetRarity = 'sr';

    // generateRoute は targetRarity を受け取れる
    let route = null;
    let attempts = 0;
    while (!route && attempts < 5) {
      attempts++;
      route = generateRoute(targetRarity);
    }
    if (!route) return null;

    // 識別用フラグ（curated でないことを明示）
    route.isCurated = false;
    route.isGenerated = true;
    return route;
  }

  async function turnGachapon() {
    const turnBtn = $('#btn-turn');
    if (turnBtn.disabled) return;

    // Cost check / deduct
    const isPremium = isPremiumSync();
    const freeRemain = Math.max(0, 3 - gacha.freeUsedToday);
    if (isPremium) {
      // プレミアム: 無制限・コスト無し
    } else if (freeRemain > 0) {
      gacha.freeUsedToday += 1;
    } else {
      if (gacha.coins < GACHA_COST) {
        showStage('empty');
        return;
      }
      gacha.coins -= GACHA_COST;
    }
    gachaSave();
    gachaUpdateUI();

    state.sessionPullCount = (state.sessionPullCount || 0) + 1;

    // Pick the route up front
    // - 既存コースモード（course）：キュレーション済み13コースから抽選
    // - 自由ルート / 散歩モード：出発地〜目的地周辺の候補からランダム生成
    // 初回特典：通算 0pull 時は SR 以上確定
    const isFirstEverPull = (gacha.pulls === 0);
    if (isFirstEverPull) {
      gacha.pullsSinceLR = Math.max(gacha.pullsSinceLR, 9); // 次の SR 保証ロジックを発動
      gacha.pullsSinceSR = Math.max(gacha.pullsSinceSR, 9);
    }
    let route = null;
    if (state.mode === 'course') {
      route = pickOneCourse();
    } else {
      route = pickRandomGeneratedRoute();
      // AI で名前と物語を上書き（失敗してもフォールバックで継続）
      if (route) {
        try {
          const narrative = await fetchAINarrative(route);
          if (narrative && narrative.name) {
            route.aiName = narrative.name;
            route.aiStory = narrative.story;
            route.aiSource = narrative.source;
            // 表示用 title を AI 名で上書き
            route.title = narrative.name;
          }
        } catch (e) {
          console.warn('AI narrative failed', e);
        }
      }
    }
    if (!route) {
      showToast('該当するコースがありません。出発地を変えるか候補を再取得してください', 'error', 4000);
      // Refund the cost since we couldn't deliver
      if (freeRemain > 0) gacha.freeUsedToday = Math.max(0, gacha.freeUsedToday - 1);
      else gacha.coins += GACHA_COST;
      gachaSave();
      gachaUpdateUI();
      return;
    }

    turnBtn.disabled = true;
    const machine = $('#gachapon');
    const output = $('#gp-output');
    const capsule = $('#gp-output-capsule');

    // Reset
    output.hidden = true;
    output.className = 'gp-output ' + (RARITY[route.rarity]?.cls || '');
    machine.classList.remove('turning', 'dropping', 'opening');
    void machine.offsetWidth; // reflow

    // Phase 1: turning - click-clack handle sound
    machine.classList.add('turning');
    playSfx('turn');
    await new Promise(r => setTimeout(r, 1600));

    // Phase 2: drop - thud sound
    machine.classList.remove('turning');
    output.hidden = false;
    machine.classList.add('dropping');
    playSfx('drop');
    await new Promise(r => setTimeout(r, 800));

    // LR full-screen flash
    if (route.rarity === 'legendary') {
      const flash = document.createElement('div');
      flash.className = 'legendary-flash';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 700);
    }

    // Phase 3: opening - capsule splits + reveal sound
    machine.classList.add('opening');
    playSfx('open');
    await new Promise(r => setTimeout(r, 600));
    // Then play rarity-specific reveal sound
    playSfx(route.rarity === 'legendary' ? 'legendary' : route.rarity === 'sr' ? 'sr' : route.rarity === 'r' ? 'r' : 'pop');

    // Mark discovered
    if (route.isCurated) {
      const wasNew = !state.discoveredCourses.has(route.id);
      state.discoveredCourses.add(route.id);
      try { localStorage.setItem('yorimichi-discovered', JSON.stringify([...state.discoveredCourses])); } catch (e) {}

      // Check if this completes the entire collection
      const allCourses = (window.YORIMICHI_COURSES || []).filter(c => {
        const enabled = (window.YORIMICHI_AREAS || []).find(a => a.id === c.area)?.enabled;
        return enabled;
      });
      if (wasNew && state.discoveredCourses.size >= allCourses.length) {
        setTimeout(() => showCompletionCelebration(allCourses.length), 4000);
      }
    }
    gacha.pulls += 1;
    // Pity counters
    if (route.rarity === 'legendary') {
      gacha.pullsSinceLR = 0;
      gacha.pullsSinceSR = 0;
    } else if (route.rarity === 'sr') {
      gacha.pullsSinceSR = 0;
      gacha.pullsSinceLR += 1;
    } else {
      gacha.pullsSinceSR += 1;
      gacha.pullsSinceLR += 1;
    }
    gachaSave();

    // Reveal
    revealRoute(route);
    turnBtn.disabled = false;
    setTimeout(checkNewBadges, 1500);
    // 招待ボーナス（初ガチャ時のみ）
    setTimeout(maybeGrantInviteeBonus, 2000);
    // ミッション「ガチャを1回引く」
    try { markMissionDone('gacha'); } catch {}
    // ライブイベント
    try {
      const cid = route?.isCurated ? route.id : null;
      sendHeartbeat('pull', cid ? { course_id: cid } : {});
    } catch {}
  }

  function updateSessionStreak() {
    // Show "○連続" badge near gacha button if session has multiple pulls
    let badge = $('#session-streak-badge');
    if (state.sessionPullCount >= 2) {
      const hint = $('#capsule-hint');
      if (hint) {
        hint.innerHTML = `🔥 ${state.sessionPullCount}連続ガチャ中！次は何が出る？`;
      }
    } else {
      const hint = $('#capsule-hint');
      if (hint) hint.textContent = 'ハンドルを回してコースを引こう';
    }
  }

  async function showGachaModal() {
    // Reset session counter when opening modal fresh
    if (!state.sessionPullCount) state.sessionPullCount = 0;
    if (state.mode === 'course') {
      const pool = getCourseCandidates();
      if (pool.length === 0) {
        showToast('このエリアのコースはまだありません', 'error');
        return;
      }
      const areaLabel = state.activeArea
        ? (window.YORIMICHI_AREAS.find(a => a.id === state.activeArea)?.name || '')
        : 'すべてのエリア';
      $('#gacha-context').textContent = `🗺 ${areaLabel} (${pool.length}コース)`;
    } else {
      if (!state.origin) {
        showToast('まず出発地を設定してください', 'error');
        return;
      }
      if (state.mode === 'route' && !state.dest) {
        showToast('目的地を設定するか、散歩モードに切り替えてください', 'error');
        return;
      }
      // 候補がまだ無ければ自動的に取得（ガチャを引くために事前準備不要にする）
      if (state.candidates.length === 0) {
        if (state.activeCategories.size === 0) {
          // 全カテゴリ ON にして検索
          state.activeCategories = new Set(CATEGORIES.map(c => c.id));
        }
        showLoader('🎰 ランダムコースを準備中…');
        try {
          const cats = [...state.activeCategories].map(categoryById).filter(Boolean);
          const pois = await fetchPois(state.origin, state.dest, cats, state.budgetMin || 30);
          state.candidates = rankPois(pois);
        } catch (e) {
          console.error(e);
          hideLoader();
          showToast('候補の取得に失敗しました。少し待ってから再試行してください', 'error', 4000);
          return;
        }
        hideLoader();
        if (state.candidates.length < 3) {
          showToast('周辺にスポットが少なすぎます。バジェットを増やしてください', 'error', 4000);
          return;
        }
      }
      const modeLabel = state.mode === 'stroll' ? '🌿 散歩' : '🎯 自由ルート';
      const ctx = `${modeLabel} ・ 📍 ${state.origin.shortLabel || '出発地'}` +
        (state.dest ? ` → 🚩 ${state.dest.shortLabel || '目的地'}` : '') +
        ` (${state.candidates.length}スポット候補)`;
      $('#gacha-context').textContent = ctx;
    }

    $('#gacha-modal').hidden = false;
    showStage('select');

    // Reset gachapon machine state
    const machine = $('#gachapon');
    if (machine) machine.classList.remove('turning', 'dropping', 'opening');
    const output = $('#gp-output');
    if (output) output.hidden = true;

    renderPoolPreview();
    gachaUpdateUI();
  }

  function regeneratePlans() {
    state.currentPlans = [];
    if (state.mode === 'course') {
      let pool = [...getCourseCandidates()];
      // Apply "undiscovered only" filter if checked
      if ($('#pool-undiscovered-only')?.checked) {
        const undisc = pool.filter(c => !state.discoveredCourses.has(c.id));
        if (undisc.length >= 1) pool = undisc;
      }
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      state.currentPlans = pool.slice(0, 3).map(c => courseToRoute(c));
    } else {
      // Free mode: generate procedurally as before
      const seenIds = new Set();
      let attempts = 0;
      while (state.currentPlans.length < 3 && attempts < 20) {
        attempts++;
        const route = generateRoute();
        if (!route) continue;
        const sig = route.stops.map(s => s.id).sort().join('|');
        if (seenIds.has(sig)) continue;
        seenIds.add(sig);
        state.currentPlans.push(route);
      }
    }
  }

  // Convert a curated course into a route object compatible with reveal/apply
  function courseToRoute(course) {
    return {
      id: course.id,
      isCurated: true,
      title: tField(course, 'name'),
      description: tField(course, 'description'),
      theme: course.area,
      themeIcon: course.themeIcon || course.areaIcon,
      themeName: tField(course, 'areaName'),
      rarity: course.rarity || 'r',
      stops: course.stops.map(s => ({
        id: course.id + '_' + (s.name || ''),
        lat: s.lat, lng: s.lng,
        name: tField(s, 'name'),
        cat: s.cat,
        emoji: s.emoji,
        desc: tField(s, 'desc'),
        tags: {},
        rarity: 'n',
      })),
      origin: course.origin,
      dest: course.dest,
      travelMode: course.travelMode,
      totalKm: 0,        // computed when applied
      totalMin: course.estimatedMin || 60,
      directMin: 0,
      detourMin: course.estimatedMin || 60,
      generatedAt: Date.now(),
    };
  }

  function renderPoolPreview() {
    const list = $('#pool-list');
    if (!list) return;

    // 自由ルート / 散歩モードでは「周辺スポットからランダム生成」の説明を出す
    if (state.mode !== 'course') {
      const candCount = state.candidates ? state.candidates.length : 0;
      $('#pool-count').textContent = `${candCount}スポット候補`;
      list.innerHTML = '';
      const turnBtn = $('#btn-turn');
      if (candCount < 3) {
        const help = document.createElement('div');
        help.className = 'pool-empty';
        help.innerHTML = `
          🌐 周辺のスポット候補が少なすぎます<br>
          <small>条件を変えて再度お試しください。</small>
        `;
        list.appendChild(help);
        if (turnBtn) turnBtn.disabled = true;
        return;
      }
      // 簡易プレビュー：ランダムに最大10件をシルエット表示
      const sample = [...state.candidates]
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.min(10, candCount));
      const intro = document.createElement('div');
      intro.className = 'pool-empty';
      intro.innerHTML = `
        🎲 周辺の候補から<strong>ランダムに5〜7スポット</strong>を選んでコース化します<br>
        <small>引くたびに違う街歩きコースが出ます。</small>
      `;
      list.appendChild(intro);
      sample.forEach(p => {
        const item = document.createElement('div');
        item.className = 'pool-item';
        item.innerHTML = `
          <span class="pool-item-emoji">${(p.cat && categoryById(p.cat)?.emoji) || '📍'}</span>
          <span class="pool-item-name">？？？</span>
          <span class="pool-item-rarity">⭐</span>
        `;
        list.appendChild(item);
      });
      if (turnBtn && gacha.coins >= 0) gachaUpdateUI();
      return;
    }

    let pool = getCourseCandidates();
    let undiscoveredFilter = false;
    if ($('#pool-undiscovered-only')?.checked || quickMode === 'undiscovered') {
      pool = pool.filter(c => !state.discoveredCourses.has(c.id));
      undiscoveredFilter = true;
    }
    $('#pool-count').textContent = `${pool.length}コース`;
    list.innerHTML = '';

    if (pool.length === 0) {
      const help = document.createElement('div');
      help.className = 'pool-empty';
      if (undiscoveredFilter) {
        help.innerHTML = `
          🎉 全コース発見済み！<br>
          <small>全エリアの全コースをコレクションしました。「全部」モードに切り替えれば、引き直しで楽しめます。</small>
          <button class="btn-secondary" id="pool-empty-action" style="margin-top:8px">「全部」に切り替える</button>
        `;
      } else {
        help.innerHTML = `
          😢 該当コースがありません<br>
          <small>絞り込み条件が厳しすぎるかも。フィルタをクリアしてください。</small>
          <button class="btn-secondary" id="pool-empty-action" style="margin-top:8px">フィルタをクリア</button>
        `;
      }
      list.appendChild(help);
      const btn = $('#pool-empty-action');
      if (btn) {
        btn.onclick = () => {
          if (undiscoveredFilter) {
            const cb = $('#pool-undiscovered-only');
            if (cb) cb.checked = false;
            const allMode = $$('.quick-mode').find(c => c.dataset.quickmode === 'all');
            if (allMode) allMode.click();
          } else {
            state.activeArea = null;
            state.activeTags.clear();
            buildAreaSelector();
            buildTagFilter();
            updateFilterStat();
          }
          renderPoolPreview();
        };
      }
      // Disable turn button if pool empty
      const turnBtn = $('#btn-turn');
      if (turnBtn) turnBtn.disabled = true;
      return;
    }

    // Re-enable turn button
    const turnBtn = $('#btn-turn');
    if (turnBtn && gacha.coins >= 0) gachaUpdateUI();

    pool.forEach(c => {
      const rarity = RARITY[c.rarity || 'r'];
      const isDis = state.discoveredCourses.has(c.id);
      const item = document.createElement('div');
      item.className = 'pool-item ' + rarity.cls + (isDis ? ' discovered' : '');
      item.innerHTML = `
        <span class="pool-item-emoji">${c.themeIcon || c.areaIcon || '🌳'}</span>
        <span class="pool-item-name">${escapeHtml(isDis ? c.name : '？？？')}</span>
        <span class="pool-item-rarity">${rarity.stars}</span>
      `;
      list.appendChild(item);
    });
  }

  // Deprecated: 3-capsule UI replaced by gachapon machine
  function renderCapsules() { /* no-op */ }

  async function pickCapsule(idx) {
    const route = state.currentPlans[idx];
    if (!route) return;
    const cap = $$('.capsule-pick')[idx];
    if (cap) cap.classList.add('opening');
    playSfx(route.rarity === 'legendary' ? 'legendary' : route.rarity === 'sr' ? 'sr' : 'pop');
    await new Promise(r => setTimeout(r, 700));
    // LR full-screen flash
    if (route.rarity === 'legendary') {
      const flash = document.createElement('div');
      flash.className = 'legendary-flash';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 700);
    }
    if (route.isCurated) {
      state.discoveredCourses.add(route.id);
      try {
        localStorage.setItem('yorimichi-discovered', JSON.stringify([...state.discoveredCourses]));
      } catch (e) {}
    }
    gacha.pulls += 1;
    gachaSave();
    revealRoute(route);
  }

  // ============================================================
  // Voice guidance (Web Speech API)
  // ============================================================
  const voice = {
    enabled: true,
  };
  function loadVoicePref() {
    try {
      voice.enabled = localStorage.getItem('yorimichi-voice') !== '0';
    } catch (e) {}
  }
  function saveVoicePref() {
    try { localStorage.setItem('yorimichi-voice', voice.enabled ? '1' : '0'); } catch (e) {}
  }
  function speak(text) {
    if (!voice.enabled) return;
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = currentLang === 'en' ? 'en-US' : 'ja-JP';
      u.rate = 1.0;
      u.pitch = 1.05;
      u.volume = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) { console.warn('speak failed', e); }
  }

  // Web Audio sound effects + Haptic feedback
  let audioCtx = null;
  function vib(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }
  function playSfx(type) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      if (type === 'legendary') {
        // Triumphant fanfare + strong vibration
        [392.00, 493.88, 587.33, 783.99, 987.77].forEach((freq, i) => {
          setTimeout(() => playTone(ctx, freq, 0.5, 'triangle', 0.18), i * 90);
        });
        vib([60, 40, 60, 40, 200]);
      } else if (type === 'sr') {
        playTone(ctx, 523.25, 0.3, 'triangle', 0.16);
        setTimeout(() => playTone(ctx, 783.99, 0.4, 'triangle', 0.16), 110);
        vib([40, 30, 80]);
      } else if (type === 'r') {
        playTone(ctx, 440, 0.2, 'sine', 0.14);
        setTimeout(() => playTone(ctx, 554.37, 0.2, 'sine', 0.14), 80);
        vib(40);
      } else if (type === 'turn') {
        // Handle turning click-clack
        for (let i = 0; i < 5; i++) {
          setTimeout(() => playTone(ctx, 220 + Math.random() * 40, 0.04, 'square', 0.05), i * 80);
        }
        vib([20, 60, 20, 60, 20]);
      } else if (type === 'drop') {
        // Capsule drop
        playTone(ctx, 880, 0.08, 'sine', 0.12);
        setTimeout(() => playTone(ctx, 660, 0.1, 'sine', 0.10), 60);
        setTimeout(() => playTone(ctx, 440, 0.15, 'sine', 0.08), 130);
        vib(30);
      } else if (type === 'open') {
        // Capsule opens - bright pop
        playTone(ctx, 1320, 0.08, 'sine', 0.12);
        setTimeout(() => playTone(ctx, 1760, 0.12, 'sine', 0.10), 50);
        vib(15);
      } else if (type === 'stamp') {
        // Stamp acquired - chime
        playTone(ctx, 880, 0.12, 'triangle', 0.14);
        setTimeout(() => playTone(ctx, 1108.73, 0.18, 'triangle', 0.12), 70);
        vib([20, 30, 60]);
      } else if (type === 'click') {
        playTone(ctx, 600, 0.04, 'sine', 0.08);
        vib(10);
      } else if (type === 'pop') {
        playTone(ctx, 440, 0.15, 'square', 0.10);
        vib(15);
      }
    } catch (e) {}
  }
  function playTone(ctx, freq, dur, type = 'sine', vol = 0.15) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  function showStage(stage) {
    ['select', 'result', 'empty'].forEach(s => {
      const el = $(`#gacha-stage-${s}`);
      if (el) el.hidden = (s !== stage);
    });
  }

  function revealRoute(route) {
    showStage('result');
    const card = $('#result-card');
    const rays = $('#result-rays');
    const rarity = RARITY[route.rarity];

    card.className = 'result-card route-card ' + rarity.cls;
    rays.className = 'result-rays show ' + rarity.cls;

    $('#result-rarity-stars').textContent = rarity.stars;
    $('#result-rarity-name').textContent = rarity.name;
    $('#route-theme-icon').textContent = route.themeIcon;
    $('#route-theme-name').textContent = route.themeName;
    $('#route-title').textContent = route.title;
    $('#route-stops').textContent = `📍 ${route.stops.length}スポット`;
    $('#route-time').textContent = route.isCurated
      ? `⏱ 約${Math.round(route.detourMin)}分`
      : `⏱ +${Math.round(route.detourMin)}分`;
    $('#route-dist').textContent = route.isCurated
      ? `🚶 ${route.travelMode === 'walk' ? '徒歩' : route.travelMode === 'bike' ? '自転車' : '車'}`
      : `📏 ${route.totalKm.toFixed(1)}km`;

    // Description (curated courses or AI story)
    const descEl = $('#route-description');
    if (route.aiStory) {
      const sourceTag = route.aiSource === 'ai' ? ' <small style="opacity:0.6">(✨ AI生成)</small>' : '';
      descEl.innerHTML = escapeHtml(route.aiStory) + sourceTag;
      descEl.hidden = false;
    } else if (route.description) {
      descEl.textContent = route.description;
      descEl.hidden = false;
    } else {
      descEl.hidden = true;
    }

    // Stops list
    const list = $('#route-stops-list');
    list.innerHTML = '';
    route.stops.forEach((stop, i) => {
      const cat = categoryById(stop.cat) || { emoji: stop.emoji || '📍', label: 'スポット' };
      const emoji = stop.emoji || cat.emoji;
      const _rawPerk = (window.YORIMICHI_PERKS || {})[stop.name];
      const perk = (_rawPerk && _rawPerk.status === 'live') ? _rawPerk : null;
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="stop-num">${i + 1}</span>
        <div class="stop-info">
          <div class="stop-name">${emoji} ${escapeHtml(stop.name)}${perk ? ' <span class="cd-perk-tag">🎫</span>' : ''}</div>
          ${stop.desc ? `<div class="stop-desc">${escapeHtml(stop.desc)}</div>` : `<div class="stop-cat">${cat.emoji} ${escapeHtml(cat.label)}</div>`}
        </div>
      `;
      list.appendChild(li);
    });

    // Apply route button
    const addBtn = $('#result-add');
    addBtn.innerHTML = route.isCurated ? '<span>🚶 このコースで行く</span>' : '<span>🚶 このルートで行く</span>';
    addBtn.onclick = () => {
      applyRoute(route);
      $('#gacha-modal').hidden = true;
      const noun = route.isCurated ? 'コース' : 'ルート';
      showToast(`✨ 「${route.title}」を${noun}に設定しました`, 'success', 3500);
    };

    // Back to gachapon (turn again)
    const againBtn = $('#result-again');
    const sessionTotal = state.sessionPullCount || 0;
    againBtn.innerHTML = sessionTotal >= 3
      ? `<span>もう一回（${sessionTotal}連続）</span>`
      : '<span>もう一回回す</span>';
    againBtn.onclick = () => {
      const machine = $('#gachapon');
      if (machine) {
        machine.classList.remove('turning', 'dropping', 'opening');
        machine.classList.add('shake-in');
        setTimeout(() => machine.classList.remove('shake-in'), 400);
      }
      const output = $('#gp-output');
      if (output) output.hidden = true;
      playSfx('click');
      gachaUpdateUI();
      renderPoolPreview();
      updateSessionStreak();
      showStage('select');
    };

    // Share result: X / LINE / Copy の3ボタン
    const buildText = () => route.isCurated ? buildCourseShareText(route) : (route.title + ' を引いた！\n' + location.origin);
    const buildUrl = () => route.isCurated && route.id ? getCourseShareUrl(route.id) : location.origin;

    const shareXBtn = $('#result-share-x');
    if (shareXBtn) {
      shareXBtn.onclick = () => {
        const text = buildText();
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank', 'noopener');
      };
    }
    const shareLineBtn = $('#result-share-line');
    if (shareLineBtn) {
      shareLineBtn.onclick = () => {
        const text = buildText();
        const url = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
        window.open(url, '_blank', 'noopener');
      };
    }
    const shareCopyBtn = $('#result-share-copy');
    if (shareCopyBtn) {
      shareCopyBtn.onclick = async () => {
        const text = buildText() + '\n' + buildUrl();
        try {
          await navigator.clipboard.writeText(text);
          showToast('🔗 リンク・テキストをコピーしました', 'success', 2500);
        } catch {
          showToast('コピーできませんでした', 'error', 2500);
        }
      };
    }
    // Backward compat: 旧 #result-share
    const shareBtn = $('#result-share');
    if (shareBtn) {
      shareBtn.onclick = () => {
        if (route.isCurated && route.id) {
          shareCourseImmediate(route);
        } else {
          shareGachaResult(route);
        }
      };
    }

    // Confetti for top rarities
    if (route.rarity === 'legendary') {
      fireConfetti(120, 'legendary', { shapes: ['rect', 'circle', 'star'] });
    } else if (route.rarity === 'sr') {
      fireConfetti(60, ['#ff9800', '#ffc107', '#ff5722']);
    }

    // 🎓 Step 2: 結果確認後「このルートで行く」を pulse
    if (isFirstRunUser()) {
      setTimeout(() => {
        showCoach({
          target: '#result-add',
          message: '👆 このコースを使って歩こう！押すと地図にセットされます',
          hintKey: 'coach-step2-result-add',
          arrow: 'down',
          autoDismissMs: 15000,
        });
      }, 1500);
    }
  }

  // Replace current selection with a route's stops
  function applyRoute(route) {
    // Curated course: also set origin / dest / travel mode
    if (route.isCurated) {
      if (route.origin) {
        state.origin = { ...route.origin };
        setEndpointMarker('origin', state.origin);
        const oi = $('#origin-input');
        if (oi) oi.value = route.origin.shortLabel || route.origin.name || '';
      }
      if (route.dest) {
        state.dest = { ...route.dest };
        setEndpointMarker('dest', state.dest);
        const di = $('#dest-input');
        if (di) di.value = route.dest.shortLabel || route.dest.name || '';
      }
      if (route.travelMode) {
        state.travel = route.travelMode;
        const radio = $(`input[name="travel"][value="${state.travel}"]`);
        if (radio) radio.checked = true;
      }
      // Mark course as discovered
      state.discoveredCourses.add(route.id);
      try {
        localStorage.setItem('yorimichi-discovered', JSON.stringify([...state.discoveredCourses]));
      } catch (e) {}
    }

    state.selected = route.stops.map(s => ({
      id: s.id,
      name: s.name,
      cat: s.cat,
      lat: s.lat,
      lng: s.lng,
      detourMin: 0,
      tags: s.tags || {},
      desc: s.desc,
      emoji: s.emoji,
    }));
    const perStop = route.detourMin / Math.max(1, route.stops.length);
    state.selected.forEach(s => { s.detourMin = perStop; });

    if (route.isCurated) {
      // Course mode: hide preview pins, show numbered stops
      clearPreviewMarkers();
      state.candidates = [];
      renderSelectedMarkers();
    } else {
      renderCandidates();
    }
    renderSummary();
    drawRoutes();
    updateCompareBadge();
    fitToEndpoints();
    saveStateToHash();

    // 🚶 ルート適用後は「歩き始める」へ自動誘導（全ユーザー対象）
    setTimeout(() => {
      const startBtn = $('#walk-start');
      if (!startBtn || startBtn.hidden) return;

      // 「探す」タブに切替（summary-section が探すタブ内にある）
      const discoverTab = document.querySelector('.main-tab[data-main-tab="discover"]');
      if (discoverTab && !discoverTab.classList.contains('active')) {
        discoverTab.click();
      }

      // summary-section を画面中央へスクロール
      const ss = $('#summary-section');
      if (ss) ss.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // 「歩き始める」ボタンを 3秒間 pulse + 永続的な🌟マーク
      startBtn.classList.add('walk-start-attract');
      setTimeout(() => startBtn.classList.remove('walk-start-attract'), 6000);

      // 初回ユーザーには明示的なヒントバブルも
      if (isFirstRunUser()) {
        showCoach({
          target: '#walk-start',
          message: '🚶 準備完了！ここを押して散歩を始めよう',
          hintKey: 'coach-step3-walk-start',
          arrow: 'down',
          autoDismissMs: 18000,
        });
      } else {
        // 既存ユーザーにもさり気なくトースト通知
        showToast('🚶 「歩き始める」ボタンが下にあります', 'info', 4000);
      }
    }, 600);
  }

  // Confetti palette presets（用途別）
  const CONFETTI_PRESETS = {
    success:   ['#16a34a', '#ffd700', '#3b82f6'],
    legendary: ['#ffd700', '#ff9800', '#9c27b0', '#ec4899', '#3b82f6', '#ffffff'],
    rare:      ['#3b82f6', '#9c27b0', '#ffd700'],
    cherry:    ['#ec4899', '#f48fb1', '#ffffff', '#ffd700'],
    autumn:    ['#d84315', '#ff9800', '#ffd700', '#8d6e63'],
  };

  function fireConfetti(count, colors, opts = {}) {
    const container = $('#confetti');
    if (!container) return;
    container.hidden = false;
    if (!opts.append) container.innerHTML = '';
    const cols = (typeof colors === 'string') ? CONFETTI_PRESETS[colors] : colors;
    const palette = cols || CONFETTI_PRESETS.success;
    const shapes = opts.shapes || ['rect', 'circle', 'star'];
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      piece.className = 'confetti-piece confetti-' + shape;
      const c = palette[i % palette.length];
      piece.style.setProperty('--c', c);
      piece.style.setProperty('--r', (Math.random() * 360) + 'deg');
      piece.style.setProperty('--d', (2 + Math.random() * 2) + 's');
      piece.style.left = (Math.random() * 100) + 'vw';
      piece.style.animationDelay = (Math.random() * 0.5) + 's';
      container.appendChild(piece);
    }
    setTimeout(() => {
      if (!opts.append) {
        container.hidden = true;
        container.innerHTML = '';
      }
    }, 4500);
  }

  // ---------- Shop ----------

  function showShop() {
    $('#gacha-modal').hidden = true;
    $('#shop-modal').hidden = false;
  }
  function hideShop() {
    $('#shop-modal').hidden = true;
  }

  // ---------- Stripe Checkout integration ----------
  const API_BASE = 'https://yorimichi-api-1028920472559.asia-northeast1.run.app';

  function getOrCreateUserId() {
    let userId = localStorage.getItem('yorimichi-user-id');
    if (!userId) {
      userId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10));
      localStorage.setItem('yorimichi-user-id', userId);
    }
    return userId;
  }

  async function startStripeCheckout(packId) {
    const userId = getOrCreateUserId();
    showToast('🔄 決済画面に移動します…', 'info', 2000);
    try {
      const res = await fetch(`${API_BASE}/api/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: packId, user_id: userId }),
      });
      const data = await res.json();
      if (data && data.url) {
        window.location.href = data.url;
      } else {
        console.error('checkout response:', data);
        showToast('❌ 決済の準備に失敗しました', 'error', 3000);
      }
    } catch (e) {
      console.error(e);
      showToast('❌ ネットワークエラーで決済を開始できませんでした', 'error', 3000);
    }
  }

  // ---------- GPX export ----------
  // 1コースの stops 配列を GPX 1.1 形式に変換
  function buildGPX(course) {
    if (!course || !course.stops || course.stops.length === 0) return null;
    const escape = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    const ts = (new Date()).toISOString();
    const courseName = escape(tField(course, 'name') || course.name || '街歩きコース');
    const desc = escape(tField(course, 'description') || course.description || '');
    const wpts = course.stops.map((s, i) => {
      const lat = (s.lat || 0).toFixed(6);
      const lng = (s.lng || 0).toFixed(6);
      const name = escape(`${i + 1}. ${s.name || 'スポット'}`);
      const stopDesc = escape(s.desc || s.cat || '');
      return `  <wpt lat="${lat}" lon="${lng}">
    <name>${name}</name>
    <desc>${stopDesc}</desc>
    <sym>Waypoint</sym>
  </wpt>`;
    }).join('\n');
    const trkPts = course.stops.map(s => {
      const lat = (s.lat || 0).toFixed(6);
      const lng = (s.lng || 0).toFixed(6);
      return `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="街歩きガチャ - https://yorimichi.in-dx.jp" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${courseName}</name>
    <desc>${desc}</desc>
    <time>${ts}</time>
    <link href="https://yorimichi.in-dx.jp/"><text>街歩きガチャ</text></link>
  </metadata>
${wpts}
  <trk>
    <name>${courseName}</name>
    <trkseg>
${trkPts}
    </trkseg>
  </trk>
</gpx>`;
  }

  function downloadGPX(course) {
    const xml = buildGPX(course);
    if (!xml) {
      showToast('エクスポートできるコースがありません', 'error', 3000);
      return;
    }
    const blob = new Blob([xml], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(course.id || 'course').replace(/[^a-z0-9_-]/gi, '_')}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('💾 GPXファイルをダウンロードしました', 'success', 3000);
  }

  // ---------- Course recommendation (history-based) ----------
  /**
   * 天気コードから「外向き / 内向き」を判定。
   * 雨・雪・雷雨は内向き（神保町の古書店巡り等）を優先。
   */
  function isIndoorPreferredWeather(code) {
    if (typeof code !== 'number') return false;
    // 雨系 51-67, 80-86, 雷雨95-99, 雪71-77
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 86) || code >= 95) return true;
    if (code >= 71 && code <= 77) return true;
    return false;
  }

  /**
   * 履歴から最も歩かれたエリア・テーマを学習し、
   * 天気も考慮して「あなた向け」を1本選んで返す。
   */
  function getRecommendedCourse() {
    const all = (window.YORIMICHI_COURSES || []).filter(c => {
      const enabled = (window.YORIMICHI_AREAS || []).find(a => a.id === c.area)?.enabled;
      return enabled !== false;
    });
    if (all.length === 0) return null;

    // エリア・テーマ集計
    const areaScore = {};
    const themeScore = {};
    for (const id of state.completedCourses) {
      const c = all.find(x => x.id === id);
      if (!c) continue;
      areaScore[c.area] = (areaScore[c.area] || 0) + 1;
      if (c.theme) themeScore[c.theme] = (themeScore[c.theme] || 0) + 1;
    }
    // 未完走 + 未発見を最優先
    const candidates = all.filter(c => !state.completedCourses.has(c.id));
    if (candidates.length === 0) return null;

    // 現在の天気をチェック（キャッシュから）
    let weatherCode = null;
    try {
      const w = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || 'null');
      if (w && Date.now() - w.fetchedAt < WEATHER_CACHE_TTL_MS) weatherCode = w.code;
    } catch {}
    const indoorPreferred = isIndoorPreferredWeather(weatherCode);
    // 屋内向きカテゴリ（雨の日にスコア+）
    const INDOOR_CATS = new Set(['cafe', 'shop', 'museum', 'art', 'bakery']);
    // 屋外向きカテゴリ（晴れの日にスコア+）
    const OUTDOOR_CATS = new Set(['park', 'viewpoint', 'shrine', 'temple']);

    // 時間帯による好み判定
    const hour = (new Date()).getHours();
    let timeBand;
    if (hour >= 4 && hour < 8) timeBand = 'dawn';        // 早朝
    else if (hour >= 8 && hour < 11) timeBand = 'morning'; // 朝
    else if (hour >= 11 && hour < 15) timeBand = 'midday'; // 昼
    else if (hour >= 15 && hour < 18) timeBand = 'afternoon'; // 午後
    else if (hour >= 18 && hour < 21) timeBand = 'evening'; // 夕方〜夜
    else timeBand = 'night'; // 深夜
    state._lastRecoTimeBand = timeBand;

    // スコアリング: 同じエリア/テーマなら点数増、既に発見済みなら少し減らす
    const ranked = candidates.map(c => {
      let score = 0;
      score += (areaScore[c.area] || 0) * 3;
      if (c.theme) score += (themeScore[c.theme] || 0) * 2;
      // レアリティ加点
      const rarityBonus = { legendary: 4, sr: 3, r: 2, n: 1 }[c.rarity || 'r'] || 1;
      score += rarityBonus;
      // 未発見ならボーナス
      if (!state.discoveredCourses.has(c.id)) score += 2;
      // 天気適合ボーナス
      if (c.stops && c.stops.length > 0) {
        const indoorCount = c.stops.filter(s => INDOOR_CATS.has(s.cat)).length;
        const outdoorCount = c.stops.filter(s => OUTDOOR_CATS.has(s.cat)).length;
        const indoorRatio = indoorCount / c.stops.length;
        const outdoorRatio = outdoorCount / c.stops.length;
        if (indoorPreferred) {
          score += indoorRatio * 4;
          score -= outdoorRatio * 2;
        } else if (weatherCode === 0) {
          // 快晴
          score += outdoorRatio * 3;
        }
      }
      // 時間帯適合: コースのタグ・時間制限を見て加減点
      const tagSet = new Set((c.tags || []).map(t => String(t).toLowerCase()));
      const courseName = (c.name || '') + (c.description || '');
      if (timeBand === 'dawn') {
        if (/早朝|朝5|朝6|dawn|misty|morning/i.test(courseName) || tagSet.has('早朝限定')) score += 6;
        if (/夜景|ネオン|sunset|illumination/i.test(courseName)) score -= 4;
      } else if (timeBand === 'morning') {
        if (/朝|モーニング|morning/i.test(courseName) || tagSet.has('定番')) score += 3;
      } else if (timeBand === 'afternoon') {
        if (/夕焼け|サンセット|sunset|夕やけ/i.test(courseName) || tagSet.has('夕日')) score += 3;
      } else if (timeBand === 'evening') {
        if (/夕焼け|sunset|夜景|ネオン|illumination|路地裏/i.test(courseName) || tagSet.has('夕日') || tagSet.has('ネオン')) score += 5;
        if (/早朝|朝5|朝6|dawn/i.test(courseName) || tagSet.has('早朝限定')) score -= 8;
      } else if (timeBand === 'night') {
        if (/夜景|ネオン|illumination/i.test(courseName)) score += 4;
        if (/早朝|朝5|朝6|dawn|morning/i.test(courseName) || tagSet.has('早朝限定')) score -= 10;
        // 夜は深夜営業少ないコースは減点（神社・公園系）
        if (c.stops && c.stops.length > 0) {
          const closedAtNightCount = c.stops.filter(s => OUTDOOR_CATS.has(s.cat)).length;
          if (closedAtNightCount > c.stops.length * 0.5) score -= 2;
        }
      }
      // ランダムノイズ
      score += Math.random() * 1.5;
      return { c, score, indoorPreferred };
    }).sort((a, b) => b.score - a.score);

    const top = ranked[0];
    if (top) {
      // メモリにメタデータを残す（バナー表示で「☔ 雨でも楽しめる」など）
      state._lastRecoMeta = { indoorPreferred, weatherCode };
    }
    return top?.c || candidates[0];
  }

  // ---------- Lifetime stats + walk log ----------
  function getLifetimeStats() {
    const totalMin = parseInt(localStorage.getItem('yorimichi-total-walk-min') || '0', 10) || 0;
    const completed = state.completedCourses.size;
    const discovered = state.discoveredCourses.size;
    const totalStamps = Object.values(state.walkCounts || {}).reduce((sum, n) => sum + (n || 0), 0);
    // 最も歩いたコース
    let mostId = null;
    let mostCount = 0;
    for (const [id, n] of Object.entries(state.walkCounts || {})) {
      if (n > mostCount) { mostCount = n; mostId = id; }
    }
    const mostCourse = mostId ? (window.YORIMICHI_COURSES || []).find(c => c.id === mostId) : null;
    // エリア集計
    const areaCount = {};
    for (const id of state.completedCourses) {
      const c = (window.YORIMICHI_COURSES || []).find(x => x.id === id);
      if (c?.area) areaCount[c.area] = (areaCount[c.area] || 0) + 1;
    }
    let mostArea = null, mostAreaN = 0;
    for (const [a, n] of Object.entries(areaCount)) {
      if (n > mostAreaN) { mostArea = a; mostAreaN = n; }
    }
    const mostAreaObj = mostArea ? (window.YORIMICHI_AREAS || []).find(a => a.id === mostArea) : null;
    return { totalMin, completed, discovered, totalStamps, mostCourse, mostCourseCount: mostCount, mostArea: mostAreaObj };
  }

  // 📊 詳細統計：曜日・時間帯・月別・ベスト記録
  function getDetailedStats() {
    const history = state.walkHistory || [];
    const dowCount = [0, 0, 0, 0, 0, 0, 0]; // 日〜土
    const hourBands = { early: 0, morning: 0, noon: 0, afternoon: 0, evening: 0, night: 0 };
    const monthCount = {}; // YYYY-MM
    history.forEach(h => {
      if (!h.date) return;
      const d = new Date(h.date + 'T00:00:00');
      if (!isNaN(d)) {
        dowCount[d.getDay()]++;
        const ym = h.date.slice(0, 7);
        monthCount[ym] = (monthCount[ym] || 0) + 1;
      }
    });
    // bestDay = 最も多い曜日
    const dowNames = ['日', '月', '火', '水', '木', '金', '土'];
    let bestDow = -1, bestDowN = 0;
    dowCount.forEach((n, i) => { if (n > bestDowN) { bestDow = i; bestDowN = n; } });
    // 最多スタンプ日（同じ日の history.stops 合計が最大）
    const stampsByDate = {};
    history.forEach(h => {
      if (!h.date) return;
      stampsByDate[h.date] = (stampsByDate[h.date] || 0) + (h.stops || 0);
    });
    let bestDay = null, bestDayStamps = 0;
    for (const [d, n] of Object.entries(stampsByDate)) {
      if (n > bestDayStamps) { bestDay = d; bestDayStamps = n; }
    }
    // 直近6ヶ月のグラフ用データ
    const recentMonths = [];
    const today = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${d.getMonth() + 1}月`;
      recentMonths.push({ ym, label, count: monthCount[ym] || 0 });
    }
    return {
      dowCount,
      bestDow: bestDow >= 0 ? dowNames[bestDow] : null,
      bestDowN,
      bestDay,
      bestDayStamps,
      recentMonths,
    };
  }

  // ===== Me tab render =====
  // 📊 詳細統計ダッシュボード（月別グラフ・曜日分布・ベスト記録）
  function renderDetailedStats() {
    const monthlyEl = $('#me-monthly-chart');
    const dowEl = $('#me-dow-chart');
    const bestEl = $('#me-best-records');
    if (!monthlyEl || !dowEl || !bestEl) return;
    const stats = getDetailedStats();
    const history = state.walkHistory || [];
    if (history.length === 0) {
      monthlyEl.innerHTML = '';
      dowEl.innerHTML = '';
      bestEl.innerHTML = '';
      return;
    }
    // 月別バーチャート
    const maxMonth = Math.max(1, ...stats.recentMonths.map(m => m.count));
    monthlyEl.innerHTML = `
      <div class="me-stats-title">📅 直近6ヶ月の散歩回数</div>
      <div class="me-month-bars">
        ${stats.recentMonths.map(m => {
          const h = Math.round((m.count / maxMonth) * 60);
          return `
            <div class="me-month-bar-col">
              <div class="me-month-bar-num">${m.count}</div>
              <div class="me-month-bar-track">
                <div class="me-month-bar-fill" style="height:${h}px"></div>
              </div>
              <div class="me-month-bar-label">${m.label}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    // 曜日分布
    const maxDow = Math.max(1, ...stats.dowCount);
    const dowNames = ['日', '月', '火', '水', '木', '金', '土'];
    dowEl.innerHTML = `
      <div class="me-stats-title">📊 曜日別の散歩回数</div>
      <div class="me-dow-bars">
        ${stats.dowCount.map((n, i) => {
          const w = Math.round((n / maxDow) * 100);
          const isWeekend = (i === 0 || i === 6);
          return `
            <div class="me-dow-row">
              <div class="me-dow-label ${isWeekend ? 'weekend' : ''}">${dowNames[i]}</div>
              <div class="me-dow-track"><div class="me-dow-fill" style="width:${w}%"></div></div>
              <div class="me-dow-num">${n}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    // ベスト記録
    const lifetime = getLifetimeStats();
    const records = [];
    if (stats.bestDay) records.push({ icon: '🌟', label: '最多スタンプ日', value: `${stats.bestDay} (${stats.bestDayStamps}スタンプ)` });
    if (stats.bestDow) records.push({ icon: '📅', label: 'よく歩く曜日', value: `${stats.bestDow}曜日 (${stats.bestDowN}回)` });
    if (lifetime.mostCourse) records.push({ icon: '🏆', label: 'お気に入りコース', value: `${tField(lifetime.mostCourse, 'name')} (${lifetime.mostCourseCount}回)` });
    if (lifetime.mostArea) records.push({ icon: '📍', label: 'よく歩くエリア', value: `${lifetime.mostArea.icon || ''} ${tField(lifetime.mostArea, 'name')}` });
    if (records.length > 0) {
      bestEl.innerHTML = `
        <div class="me-stats-title">🏅 ベスト記録</div>
        <div class="me-best-list">
          ${records.map(r => `
            <div class="me-best-row">
              <span class="me-best-icon">${r.icon}</span>
              <span class="me-best-label">${escapeHtml(r.label)}</span>
              <span class="me-best-value">${escapeHtml(r.value)}</span>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      bestEl.innerHTML = '';
    }
  }

  // 📰 統合旅ログフィード（歩行履歴 + 写真撮影 + メモ書き）
  function renderJourneyFeed() {
    const titleEl = $('#me-feed-title');
    const feedEl = $('#me-feed');
    if (!titleEl || !feedEl) return;
    const events = [];
    const allCourses = (window.YORIMICHI_COURSES || []);

    // 歩行履歴
    (state.walkHistory || []).forEach(h => {
      const c = allCourses.find(x => x.id === h.courseId);
      if (!c && !h.completed) return;
      events.push({
        type: h.completed ? 'walk-complete' : 'walk-incomplete',
        date: h.date,
        ts: h.date ? new Date(h.date + 'T12:00:00').getTime() : Date.now(),
        emoji: h.completed ? '🏅' : '🚶',
        title: h.completed ? '完走しました' : '歩きました',
        body: c ? tField(c, 'name') : '自由ルート',
        course: c,
      });
    });

    // 写真撮影（保存日時はタイムスタンプ無いため、courseId と stopIdx で擬似タイムスタンプ）
    allCourses.forEach(c => {
      const photos = getCoursePhotos(c.id);
      Object.entries(photos).forEach(([idxStr, entry]) => {
        const idx = parseInt(idxStr, 10);
        const stop = c.stops[idx];
        if (!stop) return;
        const url = _photoUrlOf(entry);
        if (!url) return;
        const desc = _photoDescOf(entry);
        // walkHistory から同じコースの最も近い日付を擬似タイムスタンプに使用
        const lastWalk = (state.walkHistory || []).filter(h => h.courseId === c.id).pop();
        const ts = lastWalk?.date ? new Date(lastWalk.date + 'T12:00:00').getTime() + idx : Date.now() - (allCourses.indexOf(c) * 100000);
        events.push({
          type: 'photo',
          date: lastWalk?.date || '',
          ts,
          emoji: '📸',
          title: stop.name,
          body: desc || tField(c, 'name'),
          photoUrl: url,
          course: c,
        });
      });
    });

    // スポットメモ
    allCourses.forEach(c => {
      const memos = getStopMemos(c.id);
      Object.entries(memos).forEach(([idxStr, entry]) => {
        const idx = parseInt(idxStr, 10);
        const stop = c.stops[idx];
        if (!stop || !entry?.memo) return;
        events.push({
          type: 'memo',
          date: entry.at ? new Date(entry.at).toISOString().slice(0, 10) : '',
          ts: entry.at || Date.now(),
          emoji: stop.emoji || '📝',
          title: stop.name,
          body: `「${entry.memo}」`,
          course: c,
        });
      });
    });

    if (events.length === 0) {
      titleEl.hidden = true;
      feedEl.hidden = true;
      feedEl.innerHTML = '';
      return;
    }

    events.sort((a, b) => b.ts - a.ts);
    const recent = events.slice(0, 12);
    feedEl.innerHTML = recent.map(e => {
      const dateLabel = e.date || '';
      const photoThumb = e.photoUrl ? `<img class="me-feed-thumb" src="${escapeHtml(e.photoUrl)}" loading="lazy" alt="" />` : '';
      return `
        <div class="me-feed-item me-feed-${e.type}">
          <div class="me-feed-emoji">${escapeHtml(e.emoji)}</div>
          <div class="me-feed-body">
            <div class="me-feed-title">${escapeHtml(e.title)}</div>
            <div class="me-feed-meta">${escapeHtml(e.body)}</div>
            <div class="me-feed-date">${escapeHtml(dateLabel)}</div>
          </div>
          ${photoThumb}
        </div>
      `;
    }).join('');
    titleEl.hidden = false;
    feedEl.hidden = false;
  }

  // ❤️ お気に入りコースのレンダリング
  function renderFavorites() {
    const titleEl = $('#me-favorites-title');
    const listEl = $('#me-favorites');
    if (!titleEl || !listEl) return;
    const favIds = [...(state.favoriteCourses || [])];
    if (favIds.length === 0) {
      titleEl.hidden = true;
      listEl.hidden = true;
      listEl.innerHTML = '';
      return;
    }
    const courses = (window.YORIMICHI_COURSES || []);
    const items = favIds
      .map(id => courses.find(c => c.id === id))
      .filter(Boolean);
    if (items.length === 0) {
      titleEl.hidden = true;
      listEl.hidden = true;
      return;
    }
    listEl.innerHTML = items.map(c => {
      const done = state.completedCourses.has(c.id);
      return `
        <button class="me-fav-item" type="button" data-course-id="${escapeHtml(c.id)}">
          <span class="me-fav-emoji">${c.themeIcon || c.areaIcon || '🌳'}</span>
          <span class="me-fav-body">
            <span class="me-fav-name">${escapeHtml(tField(c, 'name'))}${done ? ' <span class="me-fav-tag">完走済</span>' : ''}</span>
            <span class="me-fav-meta">${c.areaIcon || ''} ${escapeHtml(tField(c, 'areaName'))} ・ 約${c.estimatedMin || '?'}分</span>
          </span>
          <span class="me-fav-remove" data-remove="${escapeHtml(c.id)}" aria-label="お気に入りから削除">×</span>
        </button>
      `;
    }).join('');
    titleEl.hidden = false;
    listEl.hidden = false;

    listEl.querySelectorAll('.me-fav-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const removeAttr = e.target.getAttribute && e.target.getAttribute('data-remove');
        const cid = el.getAttribute('data-course-id');
        if (removeAttr) {
          e.stopPropagation();
          toggleFavorite(removeAttr);
          renderFavorites();
          showToast('お気に入りから外しました', 'info', 1800);
          return;
        }
        const c = courses.find(x => x.id === cid);
        if (c) showCourseDetail(c);
      });
    });
  }

  function renderMeTab() {
    const xp = computeXP();
    const { current, next, progress } = computeLevel(xp);
    const avatar = $('#me-avatar');
    const title = $('#me-title');
    const level = $('#me-level');
    if (avatar) avatar.textContent = current.emoji;
    if (title) title.textContent = current.title;
    if (level) level.textContent = `Lv.${current.lv}`;

    // XP プログレスバー
    const xpFill = $('#me-xp-fill');
    const xpText = $('#me-xp-text');
    if (xpFill) {
      xpFill.style.width = `${Math.round((progress || 0) * 100)}%`;
    }
    if (xpText) {
      if (next === current) {
        xpText.textContent = `🎉 最大レベル到達 (${xp} XP)`;
      } else {
        const rest = (next.xp - xp);
        xpText.textContent = `次のLv.${next.lv}まで ${rest} XP / Total ${xp} XP`;
      }
    }

    const grid = $('#me-stats');
    if (!grid) return;
    const s = getLifetimeStats();
    const hours = Math.floor(s.totalMin / 60);
    const mins = s.totalMin % 60;
    const timeLabel = hours > 0 ? `${hours}h${mins > 0 ? ' ' + mins + 'm' : ''}` : `${mins}m`;
    grid.innerHTML = `
      <div class="me-stat">
        <div class="me-stat-num">${s.completed}</div>
        <div class="me-stat-label">完走コース</div>
      </div>
      <div class="me-stat">
        <div class="me-stat-num">${s.totalStamps}</div>
        <div class="me-stat-label">獲得スタンプ</div>
      </div>
      <div class="me-stat">
        <div class="me-stat-num">${timeLabel}</div>
        <div class="me-stat-label">累計散歩時間</div>
      </div>
      <div class="me-stat">
        <div class="me-stat-num">🔥${state.loginStreak || 0}</div>
        <div class="me-stat-label">連続日数</div>
      </div>
    `;

    // 📊 詳細統計ダッシュボード
    renderDetailedStats();

    // 📰 統合旅ログフィード
    renderJourneyFeed();

    // ❤️ お気に入り
    renderFavorites();

    // 最近の活動タイムライン（直近3件）
    const tlTitle = $('#me-activity-title');
    const tlEl = $('#me-timeline');
    if (tlTitle && tlEl) {
      const history = (state.walkHistory || []).slice().reverse().slice(0, 3);
      if (history.length === 0) {
        tlTitle.hidden = true;
        tlEl.hidden = true;
      } else {
        tlEl.innerHTML = history.map(h => {
          const c = (window.YORIMICHI_COURSES || []).find(x => x.id === h.courseId);
          const name = c ? tField(c, 'name') : '自由ルート';
          const emoji = c?.themeIcon || c?.areaIcon || '🚶';
          const status = h.completed ? '🏅' : '🚶';
          return `
            <div class="me-timeline-item">
              <div class="me-tl-emoji">${emoji}</div>
              <div class="me-tl-body">
                <div class="me-tl-label">${escapeHtml(status + ' ' + name)}</div>
                <div class="me-tl-date">${escapeHtml(h.date || '')}</div>
              </div>
            </div>
          `;
        }).join('');
        tlTitle.hidden = false;
        tlEl.hidden = false;
      }
    }

    // バッジショーケース + 進行中バッジ
    const bgTitle = $('#me-badges-title');
    const bgEl = $('#me-badges');
    if (bgTitle && bgEl) {
      // バッジ定義（しきい値・現在値）
      const badgeDefs = [
        { name: '🥇 初完走', threshold: 1, current: s.completed, kind: 'completed' },
        { name: '🌟 5コース達成', threshold: 5, current: s.completed, kind: 'completed' },
        { name: '👑 10コース達成', threshold: 10, current: s.completed, kind: 'completed' },
        { name: '💎 20コース達成', threshold: 20, current: s.completed, kind: 'completed' },
        { name: '🔍 5コース発見', threshold: 5, current: s.discovered, kind: 'discovered' },
        { name: '🗺 15コース発見', threshold: 15, current: s.discovered, kind: 'discovered' },
        { name: '🔥 1週間連続', threshold: 7, current: state.loginStreak || 0, kind: 'streak' },
        { name: '💪 30日連続', threshold: 30, current: state.loginStreak || 0, kind: 'streak' },
        { name: '⏱ 1時間散歩', threshold: 60, current: s.totalMin, kind: 'walkmin' },
        { name: '🚀 10時間散歩', threshold: 600, current: s.totalMin, kind: 'walkmin' },
        { name: '🎰 50連達成', threshold: 50, current: gacha.pulls, kind: 'pulls' },
      ];
      const earned = badgeDefs.filter(b => b.current >= b.threshold);
      // 次の未獲得バッジ（1つだけ進捗バー付きで表示）
      const nextBadge = badgeDefs.find(b => b.current < b.threshold);

      let html = '';
      if (earned.length > 0) {
        html += earned.map(b => `<span class="me-badge-pill earned">${escapeHtml(b.name)}</span>`).join('');
      }
      if (nextBadge) {
        const pct = Math.round((nextBadge.current / nextBadge.threshold) * 100);
        html += `
          <div class="me-next-badge" style="width: 100%; margin-top: 10px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);font-weight:700;margin-bottom:4px;">
              <span>次のバッジ: ${escapeHtml(nextBadge.name)}</span>
              <span>${nextBadge.current}/${nextBadge.threshold}</span>
            </div>
            <div class="me-xp-bar" style="margin: 0;">
              <div class="me-xp-fill" style="width: ${pct}%;"></div>
            </div>
          </div>
        `;
      }
      // ロック中バッジのプレビュー
      const lockedCount = badgeDefs.length - earned.length;
      if (lockedCount > 0) {
        html += `
          <div class="me-locked-preview" style="width:100%; margin-top:10px; padding:10px; background:var(--surface-2); border-radius:8px;">
            <div style="font-size:11px; color:var(--text-muted); font-weight:700; margin-bottom:6px;">🔒 残り${lockedCount}個のバッジ</div>
            <div style="display:flex; gap:4px; flex-wrap:wrap;">
              ${badgeDefs.filter(b => b.current < b.threshold).slice(0, 6).map(b =>
                `<span class="me-badge-pill" style="opacity:0.4; filter:grayscale(0.5);" title="${escapeHtml(b.name)} - ${b.current}/${b.threshold}">${escapeHtml(b.name.split(' ')[0])}???</span>`
              ).join('')}
            </div>
          </div>
        `;
      }

      if (html === '' && s.completed === 0) {
        // 完走0時の励ましメッセージ
        bgEl.innerHTML = `
          <div style="width:100%; text-align:center; padding: 16px; background: var(--surface-2); border-radius: 12px; color: var(--text-muted); font-size: 13px;">
            🌱 まずは1コース歩いてバッジを獲得しよう
          </div>
        `;
        bgTitle.textContent = '🏆 最初のバッジまで';
        bgTitle.hidden = false;
        bgEl.hidden = false;
      } else if (html) {
        bgEl.innerHTML = html;
        bgTitle.textContent = earned.length > 0 ? '🏆 獲得バッジ' : '🏆 進行中バッジ';
        bgTitle.hidden = false;
        bgEl.hidden = false;
      } else {
        bgTitle.hidden = true;
        bgEl.hidden = true;
      }
    }
  }

  function renderLifetimeStats() {
    const el = $('#lifetime-stats');
    if (!el) return;
    const s = getLifetimeStats();
    const hours = Math.floor(s.totalMin / 60);
    const mins = s.totalMin % 60;
    const timeLabel = hours > 0 ? `${hours}h${mins > 0 ? ' ' + mins + 'm' : ''}` : `${mins}m`;
    el.innerHTML = `
      <div class="lt-stat">
        <div class="lt-stat-num">${s.completed}</div>
        <div class="lt-stat-label">完走コース</div>
      </div>
      <div class="lt-stat">
        <div class="lt-stat-num">${s.totalStamps}</div>
        <div class="lt-stat-label">獲得スタンプ</div>
      </div>
      <div class="lt-stat">
        <div class="lt-stat-num">${timeLabel}</div>
        <div class="lt-stat-label">累計散歩時間</div>
      </div>
      <div class="lt-stat">
        <div class="lt-stat-num">${s.mostArea ? (s.mostArea.icon + ' ' + s.mostArea.name.slice(0, 4)) : '—'}</div>
        <div class="lt-stat-label">最頻エリア</div>
      </div>
    `;
  }

  // ===== Photo album =====
  function renderPhotoAlbum() {
    const grid = $('#album-grid');
    const stats = $('#album-stats');
    if (!grid || !stats) return;

    // すべてのコースから写真を集約
    const allCourses = window.YORIMICHI_COURSES || [];
    const allPhotos = [];
    allCourses.forEach(course => {
      const photos = getCoursePhotos(course.id);
      Object.entries(photos).forEach(([idxStr, entry]) => {
        const idx = parseInt(idxStr, 10);
        const stop = course.stops[idx];
        if (!stop) return;
        const url = _photoUrlOf(entry);
        if (!url) return;
        allPhotos.push({
          courseId: course.id,
          stopIdx: idx,
          courseName: tField(course, 'name'),
          area: tField(course, 'areaName'),
          areaIcon: course.areaIcon,
          stopName: stop.name,
          url,
          desc: _photoDescOf(entry),
        });
      });
    });

    // 自由ルートで撮ったものは __free_ プレフィックスで保存されることがある
    // localStorage を直接確認
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('yorimichi-photos-__free_'));
      keys.forEach(key => {
        try {
          const data = JSON.parse(localStorage.getItem(key) || '{}');
          Object.entries(data).forEach(([idxStr, entry]) => {
            const url = _photoUrlOf(entry);
            if (!url) return;
            allPhotos.push({
              courseId: 'free',
              courseName: '自由ルート',
              area: '',
              areaIcon: '🌐',
              stopName: '撮影スポット',
              url,
              desc: _photoDescOf(entry),
            });
          });
        } catch {}
      });
    } catch {}

    stats.textContent = `📸 ${allPhotos.length}枚 ・ ${new Set(allPhotos.map(p => p.courseId)).size}コース`;
    grid.innerHTML = '';
    if (allPhotos.length === 0) {
      grid.innerHTML = `<div class="album-empty">
        <div style="font-size:48px;opacity:0.5;margin-bottom:12px;">📷</div>
        <div style="font-weight:700;color:var(--text);">まだ写真がありません</div>
        <div style="font-size:13px;margin-top:6px;">散歩中に HUD の📸ボタンで撮影できます</div>
      </div>`;
      return;
    }

    allPhotos.forEach((p, i) => {
      const tile = document.createElement('div');
      tile.className = 'album-photo';
      tile.innerHTML = `
        <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.stopName)}" loading="lazy" />
        <div class="album-photo-meta">${escapeHtml(p.areaIcon || '')} ${escapeHtml(p.stopName)}</div>
      `;
      tile.addEventListener('click', () => showPhotoViewer(p));
      grid.appendChild(tile);
    });
  }

  function showPhotoViewer(photo) {
    if (document.querySelector('.photo-viewer')) return;
    const overlay = document.createElement('div');
    overlay.className = 'photo-viewer';
    const hasCourse = photo.courseId && photo.stopIdx != null;
    const currentDesc = photo.desc || '';
    overlay.innerHTML = `
      <button class="photo-viewer-close" aria-label="閉じる">✕</button>
      <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.stopName)}" />
      <div class="photo-viewer-info">
        <div class="photo-viewer-name">${escapeHtml(photo.areaIcon || '')} ${escapeHtml(photo.stopName)}</div>
        <div class="photo-viewer-course">${escapeHtml(photo.courseName)}</div>
        <div class="photo-viewer-desc-wrap">
          <div class="photo-viewer-desc-label">${currentDesc ? '✨ AI描写' : 'メモなし'}</div>
          <div class="photo-viewer-desc" id="pv-desc">${currentDesc ? escapeHtml(currentDesc) : '<span style="opacity:0.6">説明はまだありません</span>'}</div>
        </div>
        ${hasCourse ? `
          <div class="photo-viewer-actions">
            <button class="pv-action" id="pv-regen" type="button">${currentDesc ? '🔄 再生成' : '✨ AIで生成'}</button>
            <button class="pv-action" id="pv-edit" type="button">✏️ 編集</button>
          </div>
        ` : ''}
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      // ボタン以外で閉じる
      if (e.target === overlay || e.target.classList.contains('photo-viewer-close')) {
        overlay.remove();
      }
    });
    document.body.appendChild(overlay);
    if (!hasCourse) return;
    // 再生成
    overlay.querySelector('#pv-regen').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.textContent = '⏳ 生成中...';
      try {
        const desc = await describePhotoWithAI(photo.url, photo.stopName, photo.area || '');
        if (desc) {
          saveCoursePhoto(photo.courseId, photo.stopIdx, photo.url, desc);
          photo.desc = desc;
          const descEl = overlay.querySelector('#pv-desc');
          if (descEl) descEl.textContent = desc;
          const labelEl = overlay.querySelector('.photo-viewer-desc-label');
          if (labelEl) labelEl.textContent = '✨ AI描写';
          showToast('✨ AI描写を更新しました', 'success', 2200);
          btn.textContent = '🔄 再生成';
        } else {
          showToast('AI描写の生成に失敗しました', 'error', 2500);
          btn.textContent = '✨ AIで生成';
        }
      } catch (e) {
        showToast('生成に失敗しました', 'error', 2500);
        btn.textContent = '✨ AIで生成';
      } finally {
        btn.disabled = false;
      }
    });
    // 編集
    overlay.querySelector('#pv-edit').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const newDesc = prompt('説明を編集（最大120字）', photo.desc || '');
      if (newDesc == null) return;
      const trimmed = String(newDesc).trim().slice(0, 120);
      saveCoursePhoto(photo.courseId, photo.stopIdx, photo.url, trimmed);
      photo.desc = trimmed;
      const descEl = overlay.querySelector('#pv-desc');
      if (descEl) descEl.textContent = trimmed || '説明なし';
      const labelEl = overlay.querySelector('.photo-viewer-desc-label');
      if (labelEl) labelEl.textContent = trimmed ? '✏️ メモ' : 'メモなし';
      showToast('💾 説明を保存しました', 'success', 2000);
    });
  }

  // 月別アクティビティカレンダー描画（GitHub草スタイル）
  function renderWalkCalendar() {
    const cal = $('#walk-calendar');
    if (!cal) return;
    const history = state.walkHistory || [];
    // 日付別にカウント
    const dateCounts = {};
    history.forEach(h => {
      if (!h.date) return;
      dateCounts[h.date] = (dateCounts[h.date] || 0) + 1;
    });

    // 直近12週間（84日）を6x14グリッドで表示
    const today = new Date(getResetDate() + 'T00:00:00');
    const days = 12 * 7; // 84
    const cells = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const ymd = d.toISOString().slice(0, 10);
      const count = dateCounts[ymd] || 0;
      let lvl = 0;
      if (count >= 3) lvl = 4;
      else if (count >= 2) lvl = 3;
      else if (count >= 1) lvl = 2;
      const isToday = (ymd === getResetDate());
      cells.push({ ymd, count, lvl, dow: d.getDay(), isToday, label: `${d.getMonth() + 1}/${d.getDate()}` });
    }

    // 列ごと（週単位）にレイアウト：cells は古い順、左から12週、各列7日（日〜土）
    const weeks = [];
    // 一番古いセルの曜日に応じて先頭をパディング
    const firstDow = cells[0].dow;
    const padded = Array(firstDow).fill(null).concat(cells);
    while (padded.length % 7 !== 0) padded.push(null);
    for (let i = 0; i < padded.length; i += 7) {
      weeks.push(padded.slice(i, i + 7));
    }

    const recentDays = Object.keys(dateCounts).filter(d => {
      const dt = new Date(d + 'T00:00:00');
      const diffDays = (today - dt) / (1000 * 60 * 60 * 24);
      return diffDays <= 84;
    }).length;

    cal.innerHTML = `
      <div class="walk-cal-header">
        <span class="walk-cal-title">📅 直近12週の歩いた日</span>
        <span class="walk-cal-meta">${recentDays}日 / 84日</span>
      </div>
      <div class="walk-cal-grid">
        ${weeks.map(week => `
          <div class="walk-cal-col">
            ${week.map(c => {
              if (!c) return `<div class="walk-cal-cell empty"></div>`;
              const cls = `walk-cal-cell lvl-${c.lvl}${c.isToday ? ' today' : ''}`;
              const title = c.count > 0 ? `${c.label}: ${c.count}件` : `${c.label}: 歩いていない`;
              return `<div class="${cls}" data-date="${c.ymd}" title="${title}"></div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>
      <div class="walk-cal-legend">
        <span>少</span>
        <span class="walk-cal-cell lvl-0"></span>
        <span class="walk-cal-cell lvl-2"></span>
        <span class="walk-cal-cell lvl-3"></span>
        <span class="walk-cal-cell lvl-4"></span>
        <span>多</span>
      </div>
    `;

    // セルタップで該当日の履歴をトーストで表示
    cal.querySelectorAll('.walk-cal-cell[data-date]').forEach(el => {
      el.addEventListener('click', () => {
        const ymd = el.getAttribute('data-date');
        const items = (state.walkHistory || []).filter(h => h.date === ymd);
        if (items.length === 0) {
          showToast(`${ymd}: 歩いていません`, 'info', 2200);
          return;
        }
        const names = items.map(h => {
          const c = (window.YORIMICHI_COURSES || []).find(c => c.id === h.courseId);
          return c ? tField(c, 'name') : '自由ルート';
        }).join(' / ');
        showToast(`${ymd}: ${items.length}件 ・ ${names}`, 'success', 3500);
      });
    });
  }

  function renderWalkLog() {
    const list = $('#walk-log-list');
    const stats = $('#walk-log-stats');
    if (!list || !stats) return;
    renderWalkCalendar();
    const filterMode = $('#walk-log-filter')?.value || 'all';
    const sortMode = $('#walk-log-sort')?.value || 'newest';
    let history = (state.walkHistory || []).slice();
    // フィルタ
    if (filterMode === 'completed') history = history.filter(h => h.completed);
    else if (filterMode === 'incomplete') history = history.filter(h => !h.completed);
    else if (filterMode === 'recent7' || filterMode === 'recent30') {
      const days = filterMode === 'recent7' ? 7 : 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      history = history.filter(h => (h.date || '') >= cutoffStr);
    }
    // ソート
    if (sortMode === 'newest') history.reverse();
    else if (sortMode === 'oldest') {} // already chronological
    else if (sortMode === 'course') {
      history.sort((a, b) => {
        const ca = a.courseId || ''; const cb = b.courseId || '';
        if (ca !== cb) return ca.localeCompare(cb);
        return (b.date || '').localeCompare(a.date || '');
      });
    }

    // 集計
    const totalCompleted = history.filter(h => h.completed).length;
    const totalStops = history.reduce((s, h) => s + (h.stops || 0), 0);
    const days = new Set(history.map(h => h.date)).size;
    stats.innerHTML = `
      <div>
        <div class="wls-num">${totalCompleted}</div>
        <div class="wls-label">完走回数</div>
      </div>
      <div>
        <div class="wls-num">${totalStops}</div>
        <div class="wls-label">スポット累計</div>
      </div>
      <div>
        <div class="wls-num">${days}</div>
        <div class="wls-label">散歩日数</div>
      </div>
    `;

    if (history.length === 0) {
      list.innerHTML = `
        <div class="empty-state-polished">
          <div class="es-icon">🚶</div>
          <div class="es-title">まだ歩いていません</div>
          <div class="es-desc">ガチャを引いて、はじめての散歩に出かけましょう！</div>
        </div>
      `;
      return;
    }

    list.innerHTML = history.map(h => {
      const course = (window.YORIMICHI_COURSES || []).find(c => c.id === h.courseId);
      const name = course ? tField(course, 'name') : '自由ルート';
      const emoji = course?.themeIcon || course?.areaIcon || '🚶';
      const completed = h.completed ? '🏅 完走' : '途中';
      // 該当コースのスポットメモを集めて表示
      let memosHtml = '';
      if (course) {
        const memos = getStopMemos(course.id);
        const memoEntries = Object.entries(memos)
          .map(([k, v]) => ({ idx: parseInt(k, 10), memo: v?.memo || '' }))
          .filter(m => m.memo)
          .sort((a, b) => a.idx - b.idx)
          .slice(0, 3);
        if (memoEntries.length > 0) {
          memosHtml = `<div class="wli-memos">${memoEntries.map(m => {
            const stop = course.stops[m.idx];
            return `<div class="wli-memo">${escapeHtml(stop?.emoji || '📍')} <span>${escapeHtml(m.memo)}</span></div>`;
          }).join('')}</div>`;
        }
      }
      return `
        <div class="walk-log-item">
          <div class="wli-emoji">${emoji}</div>
          <div class="wli-body">
            <div class="wli-name">${escapeHtml(name)}</div>
            <div class="wli-meta">${completed} ・ ${h.stops || 0}スポット</div>
            ${memosHtml}
          </div>
          <div class="wli-date">${escapeHtml(h.date || '')}</div>
        </div>
      `;
    }).join('');
  }

  // ---------- Daily missions ----------
  const MISSIONS_KEY = 'yorimichi-missions';

  function getResetDateForMissions() {
    return (new Date()).toDateString();
  }

  function getMissionsState() {
    try {
      const raw = JSON.parse(localStorage.getItem(MISSIONS_KEY) || '{}');
      const today = getResetDateForMissions();
      if (raw.date !== today) {
        return { date: today, done: { gacha: false, walk: false, photo: false }, claimedBonus: false };
      }
      return { date: today, done: raw.done || {}, claimedBonus: !!raw.claimedBonus };
    } catch {
      return { date: getResetDateForMissions(), done: {}, claimedBonus: false };
    }
  }
  function saveMissionsState(s) {
    try { localStorage.setItem(MISSIONS_KEY, JSON.stringify(s)); } catch {}
  }
  function markMissionDone(key) {
    const s = getMissionsState();
    if (s.done[key]) return;
    s.done[key] = true;
    saveMissionsState(s);
    renderMissions();
    // 全達成で +5 ボーナス
    if (!s.claimedBonus && s.done.gacha && s.done.walk && s.done.photo) {
      s.claimedBonus = true;
      saveMissionsState(s);
      gacha.coins += 5;
      gachaSave();
      gachaUpdateUI();
      showToast('🎯 今日のミッション全達成！+5🪙ボーナス', 'success', 5000);
    } else {
      const labels = { gacha: 'ガチャ1回', walk: '1スポット完走', photo: '写真撮影' };
      showToast(`✅ ミッション達成: ${labels[key] || key}`, 'success', 2500);
    }
  }
  // ===== Settings consolidation =====
  function openSettingsModal() {
    const modal = $('#settings-modal');
    if (!modal) return;
    // 現在値を反映
    const themeSel = $('#settings-theme');
    if (themeSel) {
      try { themeSel.value = localStorage.getItem('yorimichi-theme') || 'auto'; } catch {}
    }
    const mapSel = $('#settings-mapstyle');
    if (mapSel) {
      try { mapSel.value = localStorage.getItem('yorimichi-mapstyle') || 'default'; } catch {}
    }
    const langSel = $('#settings-lang');
    if (langSel) {
      try { langSel.value = localStorage.getItem('yorimichi-lang') || 'ja'; } catch {}
    }
    const voiceCb = $('#settings-voice');
    if (voiceCb) voiceCb.checked = !!voice.enabled;
    const sfxCb = $('#settings-sfx');
    if (sfxCb) {
      try { sfxCb.checked = (localStorage.getItem('yorimichi-sfx') || '1') === '1'; } catch { sfxCb.checked = true; }
    }
    const hapticCb = $('#settings-haptic');
    if (hapticCb) {
      try { hapticCb.checked = (localStorage.getItem('yorimichi-haptic') || '1') === '1'; } catch { hapticCb.checked = true; }
    }
    const pedoCb = $('#settings-pedometer');
    if (pedoCb) {
      try { pedoCb.checked = (localStorage.getItem('yorimichi-pedometer') || '1') === '1'; } catch { pedoCb.checked = true; }
    }
    const gpsHi = $('#settings-gps-hi');
    if (gpsHi) {
      try { gpsHi.checked = (localStorage.getItem('yorimichi-gps-hi') || '1') === '1'; } catch { gpsHi.checked = true; }
    }
    modal.hidden = false;
  }

  function setupSettingsControls() {
    const persist = (key, val) => { try { localStorage.setItem(key, val); } catch {} };

    const themeSel = $('#settings-theme');
    if (themeSel) themeSel.addEventListener('change', () => {
      const v = themeSel.value;
      persist('yorimichi-theme', v);
      // 即時反映: 既存テーマ切替ロジックに合わせる
      if (v === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else if (v === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
    });

    const mapSel = $('#settings-mapstyle');
    if (mapSel) mapSel.addEventListener('change', () => {
      const v = mapSel.value;
      persist('yorimichi-mapstyle', v);
      // 既存マップ切替があれば呼ぶ
      try { if (typeof switchMapStyle === 'function') switchMapStyle(v); } catch {}
    });

    const langSel = $('#settings-lang');
    if (langSel) langSel.addEventListener('change', () => {
      const v = langSel.value;
      persist('yorimichi-lang', v);
      // 即時反映: i18n関数が既存
      try { if (typeof setLanguage === 'function') setLanguage(v); } catch {}
    });

    const voiceCb = $('#settings-voice');
    if (voiceCb) voiceCb.addEventListener('change', () => {
      voice.enabled = voiceCb.checked;
      saveVoicePref();
    });

    const sfxCb = $('#settings-sfx');
    if (sfxCb) sfxCb.addEventListener('change', () => persist('yorimichi-sfx', sfxCb.checked ? '1' : '0'));

    const hapticCb = $('#settings-haptic');
    if (hapticCb) hapticCb.addEventListener('change', () => persist('yorimichi-haptic', hapticCb.checked ? '1' : '0'));

    const pedoCb = $('#settings-pedometer');
    if (pedoCb) pedoCb.addEventListener('change', () => persist('yorimichi-pedometer', pedoCb.checked ? '1' : '0'));

    const gpsHi = $('#settings-gps-hi');
    if (gpsHi) gpsHi.addEventListener('change', () => persist('yorimichi-gps-hi', gpsHi.checked ? '1' : '0'));

    const heatmapCb = $('#settings-heatmap');
    if (heatmapCb) {
      try { heatmapCb.checked = localStorage.getItem('yorimichi-heatmap') === '1'; } catch {}
      heatmapCb.addEventListener('change', () => {
        persist('yorimichi-heatmap', heatmapCb.checked ? '1' : '0');
        if (heatmapCb.checked) showVisitedHeatmap();
        else hideVisitedHeatmap();
      });
    }

    // クラウド同期トグル
    const syncCb = $('#settings-cloudsync');
    if (syncCb) {
      syncCb.checked = isCloudSyncEnabled();
      syncCb.addEventListener('change', async () => {
        setCloudSyncEnabled(syncCb.checked);
        if (syncCb.checked) {
          showToast('☁️ クラウド同期を有効化しました', 'success', 3000);
          // 既存サーバーデータがあるか確認
          const existing = await pullRestoreFromCloud();
          if (existing && (existing.coins > 0 || (existing.discoveredCourses && existing.discoveredCourses.length > 0))) {
            if (confirm('クラウドに既存のデータが見つかりました。復元しますか？\n（現在のローカルデータは上書きされます）')) {
              applyRestoredState(existing);
              showToast('✅ クラウドから復元しました', 'success', 3500);
              setTimeout(() => location.reload(), 1500);
              return;
            }
          }
          // 既存なし or 復元しない → 現状をプッシュ
          await pushSync('initial');
        } else {
          showToast('☁️ クラウド同期をオフにしました', 'info', 2500);
        }
      });
    }
    const syncNowBtn = $('#settings-sync-now');
    if (syncNowBtn) syncNowBtn.addEventListener('click', async () => {
      if (!isCloudSyncEnabled()) {
        showToast('まずクラウド同期をオンにしてください', 'warning', 3000);
        return;
      }
      await pushSync('manual');
      showToast('⬆ 同期しました', 'success', 2500);
    });
    const restoreBtn = $('#settings-restore');
    if (restoreBtn) restoreBtn.addEventListener('click', async () => {
      if (!isCloudSyncEnabled()) {
        showToast('まずクラウド同期をオンにしてください', 'warning', 3000);
        return;
      }
      const restored = await pullRestoreFromCloud();
      if (!restored) {
        showToast('復元できるデータがありません', 'info', 3000);
        return;
      }
      if (!confirm('クラウドから復元すると、現在のローカルデータは上書きされます。続行しますか？')) return;
      applyRestoredState(restored);
      showToast('✅ クラウドから復元しました', 'success', 3000);
      setTimeout(() => location.reload(), 1500);
    });
    const cloudDelBtn = $('#settings-cloud-delete');
    if (cloudDelBtn) cloudDelBtn.addEventListener('click', async () => {
      if (!confirm('クラウド側のあなたのデータを完全に削除します。\nこの操作は元に戻せません。続行しますか？')) return;
      const ok = await deleteCloudData();
      if (ok) showToast('🗑 クラウドのデータを削除しました', 'success', 3000);
      else showToast('削除に失敗しました', 'error', 3000);
    });

    const notifyBtn = $('#settings-notify-btn');
    if (notifyBtn) notifyBtn.addEventListener('click', toggleNotifications);
  }

  // ===== Visited spots heatmap (map overlay) =====
  // 過去に訪問した全スポットの座標を localStorage の completedStops + walkHistory から集計
  // Leaflet circleMarker で薄いオレンジ円を描画
  let _heatmapLayer = null;

  function getAllVisitedCoords() {
    const coords = [];
    const seenKeys = new Set();
    const allCourses = window.YORIMICHI_COURSES || [];
    for (const [courseId, visited] of Object.entries(state.completedStops || {})) {
      const course = allCourses.find(c => c.id === courseId);
      if (!course) continue;
      const visitedSet = visited instanceof Set ? visited : new Set(visited || []);
      visitedSet.forEach(idx => {
        const stop = course.stops[idx];
        if (!stop || stop.lat == null || stop.lng == null) return;
        const key = `${stop.lat.toFixed(4)},${stop.lng.toFixed(4)}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        coords.push({ lat: stop.lat, lng: stop.lng, name: stop.name });
      });
    }
    return coords;
  }

  function showVisitedHeatmap() {
    if (!state.map || typeof L === 'undefined') return;
    if (_heatmapLayer) {
      try { state.map.removeLayer(_heatmapLayer); } catch {}
      _heatmapLayer = null;
    }
    const coords = getAllVisitedCoords();
    if (coords.length === 0) return;
    const group = L.layerGroup();
    coords.forEach(c => {
      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 8,
        fillColor: '#ff7e3d',
        fillOpacity: 0.5,
        color: '#ff4500',
        weight: 1,
        opacity: 0.7,
      });
      marker.bindTooltip(`✓ ${c.name}`, { direction: 'top' });
      group.addLayer(marker);
    });
    _heatmapLayer = group;
    state.map.addLayer(_heatmapLayer);
  }

  function hideVisitedHeatmap() {
    if (_heatmapLayer && state.map) {
      try { state.map.removeLayer(_heatmapLayer); } catch {}
      _heatmapLayer = null;
    }
  }

  function toggleVisitedHeatmap() {
    if (_heatmapLayer) hideVisitedHeatmap();
    else showVisitedHeatmap();
  }

  // ===== AI spot guide (cached) =====
  const _spotGuideCache = new Map();
  async function requestSpotGuide(stopName, area, category) {
    if (!stopName) return null;
    if (_spotGuideCache.has(stopName)) return _spotGuideCache.get(stopName);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${API_BASE}/api/spot-guide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stop_name: stopName, area, category }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.photo) return null;
      _spotGuideCache.set(stopName, data);
      return data;
    } catch (e) {
      return null;
    }
  }

  // ===== Shareable course URL =====
  // ?course=<id> でコースをディープリンク。開いた人は同じコースを地図に表示
  function getCourseShareUrl(courseId) {
    const userId = getOrCreateUserId();
    return `${location.origin}/?course=${encodeURIComponent(courseId)}&ref=${encodeURIComponent(userId)}`;
  }

  function buildCourseShareText(course) {
    const url = getCourseShareUrl(course.id);
    const name = tField(course, 'name');
    const meta = `${course.areaIcon || ''} ${tField(course, 'areaName')} ・ 約${course.estimatedMin}分`;
    return `🎰「${name}」を引いた！\n${meta}\n\n一緒に歩こう👣\n${url}\n\n#街歩きガチャ`;
  }

  // 統一シェアシート: X / LINE / Copy / システム共有 を出す軽量モーダル
  function showShareSheet(course) {
    if (document.querySelector('.share-sheet-overlay')) return;
    const text = buildCourseShareText(course);
    const url = getCourseShareUrl(course.id);
    const overlay = document.createElement('div');
    overlay.className = 'share-sheet-overlay';
    overlay.innerHTML = `
      <div class="share-sheet">
        <div class="share-sheet-handle"></div>
        <div class="share-sheet-title">📤 このコースをシェア</div>
        <div class="share-sheet-course">${escapeHtml(tField(course, 'name'))}</div>
        <div class="share-sheet-buttons">
          <button class="share-sheet-btn share-x" data-action="x">𝕏 で投稿</button>
          <button class="share-sheet-btn share-line" data-action="line">LINEで送る</button>
          <button class="share-sheet-btn share-copy" data-action="copy">🔗 リンクコピー</button>
          ${navigator.share ? '<button class="share-sheet-btn share-native" data-action="native">📱 他のアプリで共有</button>' : ''}
        </div>
        <button class="share-sheet-close" data-action="close">閉じる</button>
      </div>
    `;
    overlay.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      const action = btn?.dataset.action;
      if (!action && e.target !== overlay) return;
      if (action === 'x') {
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      } else if (action === 'line') {
        window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, '_blank', 'noopener');
      } else if (action === 'copy') {
        try {
          await navigator.clipboard.writeText(text + '\n' + url);
          showToast('🔗 コピーしました', 'success', 2500);
        } catch {
          showToast('コピーできませんでした', 'error', 2500);
        }
      } else if (action === 'native' && navigator.share) {
        try {
          await navigator.share({ title: tField(course, 'name'), text, url });
        } catch {}
      }
      // すべて閉じる
      overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  async function shareCourseImmediate(course) {
    const text = buildCourseShareText(course);
    const url = getCourseShareUrl(course.id);
    const title = `${tField(course, 'name')} | 街歩きガチャ`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        // ユーザーキャンセルは無視
        if (e.name !== 'AbortError') console.warn('share failed', e);
      }
    }
    // Fallback: X intent
    const x = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(x, '_blank', 'noopener');
  }

  /**
   * URL の ?course=xxx を検出し、該当コースを自動的に地図にロード
   */
  function processCourseShareLink() {
    const params = new URLSearchParams(location.search);
    const courseId = params.get('course');
    if (!courseId) return;
    // URL クリーン化
    params.delete('course');
    const newSearch = params.toString();
    const cleanUrl = location.pathname + (newSearch ? '?' + newSearch : '') + location.hash;
    history.replaceState(null, '', cleanUrl);

    const course = (window.YORIMICHI_COURSES || []).find(c => c.id === courseId);
    if (!course) {
      showToast('共有されたコースが見つかりません', 'warning', 3000);
      return;
    }
    setTimeout(() => {
      try {
        if (typeof setMode === 'function') setMode('course');
        applyRoute(courseToRoute(course));
        showToast(`✨ 共有された「${tField(course, 'name')}」を地図にセット`, 'success', 4500);
      } catch (e) { console.warn('apply shared course failed', e); }
    }, 800);
  }

  // ===== Streak Save (連続記録の救済) =====
  // 連続日数が切れる直前に通知＋3コインで救済
  const STREAK_SAVE_COST = 3;

  function getDateString(d = new Date()) {
    return d.toDateString();
  }

  /**
   * 現在の連続日数が切れそうかを判定
   * 「最終ログイン日と今日の差が1日（昨日）かつ、まだ今日アクセスしてないが
   * 24時間以内に切れる」ケースは普通の流れ。
   * ここでは「2日前にログインしていて昨日ログインせず、今日もログインしてない」=
   * 既に切れた状態を救済対象とする。
   */
  function maybeOfferStreakSave() {
    if (!state.loginStreak || state.loginStreak < 3) return; // 3日以上の人だけ
    if (!state.lastLoginDate) return;
    const today = new Date();
    const last = new Date(state.lastLoginDate);
    if (isNaN(last.getTime())) return;
    const diffDays = Math.floor((today - last) / 86400000);
    // 連続が切れたかどうか: 最後のログインから2日以上経過
    if (diffDays < 2 || diffDays > 7) return; // 7日以上はもう諦め
    // 救済オファーは1セッション1回まで
    if (state._streakSaveOffered) return;
    state._streakSaveOffered = true;

    // モーダル表示
    setTimeout(() => showStreakSaveModal(state.loginStreak, diffDays), 2000);
  }

  function showStreakSaveModal(brokenStreak, daysSince) {
    if (document.getElementById('streak-save-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'streak-save-modal';
    overlay.className = 'modal-backdrop';
    overlay.innerHTML = `
      <div class="modal" style="max-width: 380px; text-align: center;">
        <div style="font-size: 56px; margin-bottom: 8px;">🔥</div>
        <h2 class="modal-title">連続${brokenStreak}日記録が切れそう…</h2>
        <p style="font-size: 14px; color: var(--text-muted); line-height: 1.7; margin-bottom: 20px;">
          ${daysSince}日空いてしまいました。<br>
          <strong>${STREAK_SAVE_COST}🪙 で救済</strong>すれば連続記録を継続できます！
        </p>
        <div style="background: var(--surface-2); border-radius: 12px; padding: 12px; margin-bottom: 16px;">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">救済すると</div>
          <div style="font-weight: 800; color: var(--brand);">連続${brokenStreak + 1}日目に到達</div>
        </div>
        <button class="btn-primary" id="streak-save-yes" type="button" style="width:100%; margin-bottom:8px;">
          🪙 ${STREAK_SAVE_COST}コインで救済する
        </button>
        <button class="btn-secondary" id="streak-save-no" type="button" style="width:100%;">
          リセットしてやり直す
        </button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#streak-save-yes').onclick = () => {
      if (gacha.coins < STREAK_SAVE_COST) {
        showToast(`コインが足りません（${STREAK_SAVE_COST}コイン必要）`, 'warning', 3500);
        // ショップへ誘導
        overlay.remove();
        setTimeout(() => { try { showShop(); } catch {} }, 500);
        return;
      }
      gacha.coins -= STREAK_SAVE_COST;
      gachaSave();
      // 連続日数を継続させる: lastLoginDate を「昨日」にする
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      state.lastLoginDate = yesterday.toDateString();
      // saveCompletion / 永続化
      try { localStorage.setItem('yorimichi-last-login', state.lastLoginDate); } catch {}
      try { localStorage.setItem('yorimichi-login-streak', String(state.loginStreak)); } catch {}
      showToast(`🔥 連続${state.loginStreak}日記録を救済しました！`, 'success', 4000);
      overlay.remove();
    };
    overlay.querySelector('#streak-save-no').onclick = () => {
      state.loginStreak = 0;
      try { localStorage.setItem('yorimichi-login-streak', '0'); } catch {}
      overlay.remove();
    };
  }

  // ===== Live activity counter & heartbeat =====
  let _liveStatsTimer = null;

  async function sendHeartbeat(event = 'tick', extra = {}) {
    try {
      const userId = getOrCreateUserId();
      const body = { user_id: userId, event, ...extra };
      await fetch(`${API_BASE}/api/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }

  async function fetchAndRenderLiveStats() {
    try {
      const res = await fetch(`${API_BASE}/api/live-stats`);
      if (!res.ok) return;
      const data = await res.json();
      const banner = $('#live-counter');
      const text = $('#live-counter-text');
      if (!banner || !text) return;
      const active5 = data.active_5min || 0;
      const active30 = data.active_30min || 0;
      const pulls30 = data.pulls_30min || 0;

      // 新ステータスバーに反映
      try { renderStatusLive(active5, active30); } catch {}

      // 1人だけだと「自分だけ」感が出るので、表示閾値あり
      if (active30 < 1) {
        banner.hidden = true;
        return;
      }
      // メッセージ生成
      let msg;
      if (active5 >= 1) {
        msg = `今 ${active5}人が街歩き中`;
      } else if (active30 >= 1) {
        msg = `この30分で ${active30}人が街歩き`;
      }
      if (pulls30 >= 5) {
        msg += ` ・ ${pulls30}コース引かれた`;
      }
      text.textContent = msg;
      banner.hidden = false;
    } catch (e) { console.warn('live stats failed', e); }
  }

  async function fetchAndRenderPopularRanking() {
    try {
      const res = await fetch(`${API_BASE}/api/popular-courses`);
      if (!res.ok) return;
      const data = await res.json();
      const list = data.courses || [];
      const widget = $('#popular-ranking');
      const ul = $('#popular-list');
      if (!widget || !ul) return;
      const allCourses = window.YORIMICHI_COURSES || [];
      // courseIdに対応するコース名を解決
      const items = list
        .map(r => {
          const course = allCourses.find(c => c.id === r.course_id);
          if (!course) return null;
          return { course, pulls: r.pulls_7d };
        })
        .filter(Boolean)
        .slice(0, 5);
      if (items.length === 0) {
        widget.hidden = true;
        return;
      }
      const medals = ['gold', 'silver', 'bronze', '', ''];
      ul.innerHTML = items.map((it, i) => `
        <li class="popular-item" data-cid="${escapeHtml(it.course.id)}">
          <span class="popular-rank ${medals[i] || ''}">${i + 1}</span>
          <span class="popular-name">${escapeHtml(it.course.themeIcon || it.course.areaIcon || '🌳')} ${escapeHtml(tField(it.course, 'name'))}</span>
          <span class="popular-pulls">${it.pulls}回引かれた</span>
        </li>
      `).join('');
      // クリックで地図にセット
      ul.querySelectorAll('.popular-item').forEach(li => {
        li.addEventListener('click', () => {
          const cid = li.dataset.cid;
          const course = allCourses.find(c => c.id === cid);
          if (course) {
            applyRoute(courseToRoute(course));
            showToast(`✨ 「${tField(course, 'name')}」を地図に設定`, 'success', 3000);
            document.querySelector('.main-tab[data-main-tab="discover"]')?.click();
          }
        });
      });
      widget.hidden = false;
    } catch (e) { console.warn('popular fetch failed', e); }
  }

  function startLiveActivity() {
    sendHeartbeat('tick');
    fetchAndRenderLiveStats();
    fetchAndRenderPopularRanking();
    if (_liveStatsTimer) clearInterval(_liveStatsTimer);
    _liveStatsTimer = setInterval(() => {
      sendHeartbeat('tick');
      fetchAndRenderLiveStats();
    }, 60_000); // 60秒ごと
    // 人気ランキングは5分に1回でOK
    setInterval(fetchAndRenderPopularRanking, 5 * 60_000);
  }

  // 連続記録バッジ
  function renderStreakBadge() {
    const badge = $('#streak-badge-home');
    const text = $('#streak-text-home');
    if (!badge || !text) return;
    const streak = state.loginStreak || 0;
    if (streak < 2) {
      badge.hidden = true;
      return;
    }
    text.textContent = `連続${streak}日 ・ がんばってる！`;
    badge.hidden = false;
  }

  // 初回ユーザー向けウェルカムカード制御
  function renderWelcomeCard() {
    const card = $('#welcome-card');
    if (!card) return;
    // 完走0かつガチャ0回 = 初回ユーザー
    const isFirstTime = (state.completedCourses.size === 0) && (gacha.pulls === 0);
    card.hidden = !isFirstTime;
    // 初回でない場合 → クイックスタートを表示
    const qs = $('#quickstart-hero');
    if (qs) qs.hidden = isFirstTime; // 初回はwelcome側がメインCTAになる
  }

  async function quickStart() {
    try {
      // 探すタブに切替（DOM経由でclick）
      const discoverTab = document.querySelector('.main-tab[data-main-tab="discover"]');
      if (discoverTab) discoverTab.click();
      // Course mode に強制セット
      if (state.mode !== 'course' && typeof setMode === 'function') {
        setMode('course');
      }
      // 全エリアON / 未発見優先
      state.activeArea = null;
      state.activeTags = state.activeTags || new Set();
      state.activeTags.clear();
      state.filterDuration = 'all';
      state.filterHasPhoto = false;
      state.filterHasPerk = false;
      // ガチャモーダルを開く
      await showGachaModal();
      // 自動でハンドルを回す
      setTimeout(() => {
        const turnBtn = $('#btn-turn');
        if (turnBtn && !turnBtn.disabled) {
          turnBtn.click();
        }
      }, 600);
    } catch (e) {
      console.warn('quickStart failed', e);
      showToast('開始に失敗しました', 'error', 2500);
    }
  }

  // ===== Daily tip rotation =====
  const DAILY_TIPS = [
    '🚶 はじめての街は「逆方向の路地」を選ぶと発見が増えます',
    '📸 看板や色だけ撮ると、後で見返した時に旅の記憶が蘇ります',
    '☕ カフェに入る前に、外観の写真を1枚撮るのがおすすめ',
    '🌅 同じ場所でも時間帯を変えると、まったく別の街に見えます',
    '🍂 季節の終わりかけに歩くと、その街らしい風景が濃く出ます',
    '👟 歩きやすい靴に変えるだけで、寄り道距離は1.5倍に',
    '🎧 知らない街では、音楽より周囲の音を聴く方が記憶に残ります',
    '🗺 紙の地図を一度開くと、画面では気づかない街の形が見えます',
    '🍶 商店街は「個人店3軒以内」のエリアを狙うと当たりが多い',
    '🐈 角を曲がる前に立ち止まると、知らない景色に出会えます',
    '🍰 和菓子屋さんは午前中、洋菓子屋さんは午後が品揃え◎',
    '🌳 公園の入口より、出口側の方が穴場ベンチがあります',
    '🚉 駅から3つ目の角で曲がると、観光客のいない街に入れます',
    '📚 古本屋では、平積みより棚の3段目から見るのが上級者',
    '⛩️ 神社は朝6時台が一番空気が澄んでます',
  ];

  function renderDailyTip() {
    const tipEl = $('#daily-tip');
    if (!tipEl) return;
    // 日付ベースで決定的に選ぶ（毎日同じ Tip）
    const today = new Date();
    const dayKey = today.getFullYear() * 1000 + today.getMonth() * 50 + today.getDate();
    const idx = dayKey % DAILY_TIPS.length;
    $('#daily-tip-text').textContent = DAILY_TIPS[idx];
    tipEl.hidden = false;
  }

  // ===== Weather indicator (Open-Meteo, free, no API key) =====
  const WEATHER_CACHE_KEY = 'yorimichi-weather-cache';
  const WEATHER_CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

  // WMO 天気コード簡易マッピング
  function describeWeather(code) {
    if (code === 0) return { icon: '☀️', label: '快晴', mood: '散歩日和！', cls: 'warm' };
    if (code >= 1 && code <= 2) return { icon: '⛅', label: '晴れ時々曇り', mood: '気持ちよく歩けます', cls: '' };
    if (code === 3) return { icon: '☁️', label: 'くもり', mood: '日差しを気にせず歩けます', cls: '' };
    if (code >= 45 && code <= 48) return { icon: '🌫️', label: '霧', mood: '幻想的な散歩に', cls: '' };
    if (code >= 51 && code <= 67) return { icon: '🌧️', label: '雨', mood: '今日は屋根のあるコースを', cls: 'rain' };
    if (code >= 71 && code <= 77) return { icon: '❄️', label: '雪', mood: '足元注意、暖かく', cls: 'cold' };
    if (code >= 80 && code <= 86) return { icon: '🌧️', label: 'にわか雨', mood: '傘を忘れずに', cls: 'rain' };
    if (code >= 95) return { icon: '⛈️', label: '雷雨', mood: '今日は外出を控えて', cls: 'rain' };
    return { icon: '🌤️', label: '天気', mood: '街歩き日和', cls: '' };
  }

  function getCachedWeather() {
    try {
      const data = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || 'null');
      if (!data) return null;
      if (Date.now() - data.fetchedAt > WEATHER_CACHE_TTL_MS) return null;
      return data;
    } catch { return null; }
  }

  async function fetchWeather(lat, lng) {
    const cached = getCachedWeather();
    if (cached && Math.abs(cached.lat - lat) < 0.5 && Math.abs(cached.lng - lng) < 0.5) {
      return cached;
    }
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,weather_code&timezone=auto`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      const weather = {
        lat, lng,
        temp: data.current?.temperature_2m,
        code: data.current?.weather_code ?? 0,
        fetchedAt: Date.now(),
      };
      try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weather)); } catch {}
      return weather;
    } catch { return null; }
  }

  // 統合ステータスバー：天気＋ライブ＋Tip
  function renderStatusBar() {
    const bar = $('#status-bar');
    if (!bar) return;
    let anyVisible = false;

    // Weather
    try {
      const w = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || 'null');
      if (w && Date.now() - w.fetchedAt < WEATHER_CACHE_TTL_MS) {
        const desc = describeWeather(w.code);
        const weatherEl = $('#status-weather');
        if (weatherEl) {
          $('#status-weather-icon').textContent = desc.icon;
          const t = (typeof w.temp === 'number') ? `${Math.round(w.temp)}°C` : '';
          $('#status-weather-text').textContent = `${desc.label}${t ? ' ' + t : ''}`;
          weatherEl.hidden = false;
          anyVisible = true;
        }
      }
    } catch {}

    bar.hidden = !anyVisible;
  }

  function renderStatusLive(active5, active30) {
    const liveEl = $('#status-live');
    if (!liveEl) return;
    if (active30 < 1) { liveEl.hidden = true; return; }
    let txt;
    if (active5 >= 1) txt = `今 ${active5}人散歩中`;
    else txt = `${active30}人が今日散歩`;
    $('#status-live-text').textContent = txt;
    liveEl.hidden = false;
    const bar = $('#status-bar');
    if (bar) bar.hidden = false;
  }

  // Daily tip ボタンクリックでツールチップ風表示
  function setupDailyTipButton() {
    const btn = $('#status-tip-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const today = new Date();
      const dayKey = today.getFullYear() * 1000 + today.getMonth() * 50 + today.getDate();
      const idx = dayKey % DAILY_TIPS.length;
      showToast(`💡 ${DAILY_TIPS[idx]}`, 'info', 6000);
    });
  }

  // 統合おすすめカード（reco-banner + today-pick の代替）
  // 🚶 コース難易度を自動推定（時間 + スポット数 + 区間長から）
  function computeCourseDifficulty(course) {
    if (!course) return { level: 1, label: '初級', icon: '🚶', factors: [] };
    const min = course.estimatedMin || 0;
    const stops = (course.stops || []).length;
    // 累計区間距離
    let totalKm = 0;
    for (let i = 1; i < course.stops.length; i++) {
      const a = course.stops[i - 1];
      const b = course.stops[i];
      if (a.lat == null || b.lat == null) continue;
      totalKm += haversineKm(a, b);
    }
    let score = 0;
    const factors = [];
    if (min >= 90) { score += 2; factors.push(`所要時間 ${min}分`); }
    else if (min >= 60) { score += 1; factors.push(`所要時間 ${min}分`); }
    if (stops >= 7) { score += 2; factors.push(`${stops}スポット`); }
    else if (stops >= 5) { score += 1; factors.push(`${stops}スポット`); }
    if (totalKm >= 4) { score += 2; factors.push(`総距離 ${totalKm.toFixed(1)}km`); }
    else if (totalKm >= 2) { score += 1; factors.push(`総距離 ${totalKm.toFixed(1)}km`); }
    // タグから「階段」「坂」を検出
    const tags = [...(course.tags || []), ...(course.stops || []).flatMap(s => s.tags || [])];
    if (tags.some(t => /階段|坂|登り/.test(String(t)))) {
      score += 1;
      factors.push('階段や坂あり');
    }
    let level, label, icon;
    if (score >= 4) { level = 3; label = '上級'; icon = '🚶🚶🚶'; }
    else if (score >= 2) { level = 2; label = '中級'; icon = '🚶🚶'; }
    else { level = 1; label = '初級'; icon = '🚶'; }
    return { level, label, icon, factors, totalKm };
  }

  // 🗺 コースのスポット位置から SVG ミニマップを生成（カードのサムネ用）
  function buildCourseThumbSvg(course, opts) {
    opts = opts || {};
    const W = opts.w || 80;
    const H = opts.h || 50;
    const stops = (course?.stops || []).filter(s => s.lat != null && s.lng != null);
    if (stops.length < 2) return '';
    // BBox
    const lats = stops.map(s => s.lat);
    const lngs = stops.map(s => s.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const dLat = Math.max(maxLat - minLat, 0.001);
    const dLng = Math.max(maxLng - minLng, 0.001);
    const pad = 6;
    const points = stops.map(s => {
      const x = pad + ((s.lng - minLng) / dLng) * (W - pad * 2);
      // SVG y は上下逆
      const y = pad + (1 - (s.lat - minLat) / dLat) * (H - pad * 2);
      return [x, y];
    });
    const polyline = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const dots = points.map(([x, y], i) => {
      const r = (i === 0 || i === points.length - 1) ? 3 : 2;
      const fill = i === 0 ? '#16a34a' : (i === points.length - 1 ? '#dc2626' : '#ff7e3d');
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" stroke="white" stroke-width="0.7"/>`;
    }).join('');
    const stroke = opts.lightStroke ? 'rgba(255,255,255,0.85)' : 'rgba(255,126,61,0.7)';
    return `<svg class="course-thumb-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
      <polyline points="${polyline}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    </svg>`;
  }

  function renderFeaturedCard() {
    const card = $('#featured-card');
    if (!card) return;
    const reco = getRecommendedCourse();
    if (!reco) { card.hidden = true; return; }

    // モードに応じてラベル変更
    const tb = state._lastRecoTimeBand;
    let label = '✨ 今日のあなた向け';
    if (tb === 'dawn') label = '🌅 早朝にぴったりのコース';
    else if (tb === 'evening') label = '🌆 夕暮れ時に歩きたい';
    else if (tb === 'night') label = '🌃 夜の散歩に';
    else if (state._lastRecoMeta?.indoorPreferred) label = '☔ 雨でも楽しめるコース';
    else if (state._lastRecoMeta?.weatherCode === 0) label = '☀️ 快晴日和に';

    $('#featured-label').textContent = label;
    $('#featured-emoji').textContent = reco.themeIcon || reco.areaIcon || '🌳';
    $('#featured-title').textContent = tField(reco, 'name');
    const minutes = reco.estimatedMin ? `約${reco.estimatedMin}分` : '';
    const diff = computeCourseDifficulty(reco);
    $('#featured-meta').textContent = `${reco.areaIcon || ''} ${tField(reco, 'areaName')} ・ ${minutes} ・ ${reco.stops.length}スポット ・ ${diff.icon} ${diff.label}`;
    const thumbEl = $('#featured-thumb');
    if (thumbEl) thumbEl.innerHTML = buildCourseThumbSvg(reco, { w: 70, h: 50, lightStroke: true });

    const btn = $('#featured-pick');
    if (btn) {
      btn.onclick = () => {
        applyRoute(courseToRoute(reco));
        showToast(`✨ 「${tField(reco, 'name')}」を地図に設定`, 'success', 3000);
        document.querySelector('.main-tab[data-main-tab="discover"]')?.click();
      };
    }
    card.hidden = false;
  }

  // 📍 現在地に近い未完走コースを上位3件、ホームに表示
  async function renderNearbyBanner() {
    const banner = $('#nearby-banner');
    const list = $('#nearby-list');
    const meta = $('#nearby-meta');
    if (!banner || !list) return;
    let userLoc = null;
    try {
      userLoc = await getCurrentLocation();
    } catch {
      banner.hidden = true;
      return;
    }
    const courses = (window.YORIMICHI_COURSES || []);
    if (courses.length === 0) { banner.hidden = true; return; }

    // 現在天気を考慮して屋内/屋外スコアを微調整
    let weatherCode = null;
    try {
      const w = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || 'null');
      if (w && Date.now() - w.fetchedAt < WEATHER_CACHE_TTL_MS) weatherCode = w.code;
    } catch {}
    const indoorPreferred = isIndoorPreferredWeather(weatherCode);
    const INDOOR_CATS = new Set(['cafe', 'shop', 'museum', 'art', 'bakery']);

    const ranked = courses
      .map(c => {
        const startLat = c.stops?.[0]?.lat;
        const startLng = c.stops?.[0]?.lng;
        if (startLat == null || startLng == null) return null;
        const km = haversineKm(userLoc, { lat: startLat, lng: startLng });
        // 屋内比率
        const stops = c.stops || [];
        const indoorRatio = stops.length > 0 ? stops.filter(s => INDOOR_CATS.has(s.cat)).length / stops.length : 0;
        return { course: c, km, indoorRatio };
      })
      .filter(x => x && x.km <= 5)
      .sort((a, b) => {
        // 未完走優先
        const aDone = state.completedCourses.has(a.course.id) ? 1 : 0;
        const bDone = state.completedCourses.has(b.course.id) ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        // 雨天時は屋内多めを優先
        if (indoorPreferred && Math.abs(a.indoorRatio - b.indoorRatio) > 0.15) {
          return b.indoorRatio - a.indoorRatio;
        }
        return a.km - b.km;
      })
      .slice(0, 3);

    if (ranked.length === 0) { banner.hidden = true; return; }

    // 天気アイコン付きヘッダー
    if (meta) {
      let metaText = `${ranked.length}件 / 5km圏内`;
      if (indoorPreferred) {
        metaText = `☔ 雨向き ・ ${metaText}`;
      } else if (weatherCode === 0) {
        metaText = `☀️ 快晴 ・ ${metaText}`;
      }
      meta.textContent = metaText;
    }
    list.innerHTML = ranked.map(({ course, km, indoorRatio }) => {
      const distLabel = km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
      const done = state.completedCourses.has(course.id);
      const thumb = buildCourseThumbSvg(course, { w: 60, h: 40, lightStroke: true });
      // 雨の日は屋内多めバッジを表示
      const indoorBadge = (indoorPreferred && indoorRatio >= 0.5)
        ? '<span class="nearby-indoor-tag">☔ 屋内多め</span>'
        : '';
      return `
        <button class="nearby-item${done ? ' nearby-done' : ''}" type="button" data-course-id="${escapeHtml(course.id)}">
          <span class="nearby-item-emoji">${course.themeIcon || course.areaIcon || '🌳'}</span>
          <span class="nearby-item-body">
            <span class="nearby-item-name">${escapeHtml(tField(course, 'name'))}${done ? ' <span class="nearby-done-tag">完走済</span>' : ''}${indoorBadge}</span>
            <span class="nearby-item-meta">${course.areaIcon || ''} ${escapeHtml(tField(course, 'areaName'))} ・ 約${course.estimatedMin || '?'}分</span>
          </span>
          <span class="nearby-item-thumb">${thumb}</span>
          <span class="nearby-item-dist">📏 ${distLabel}</span>
        </button>
      `;
    }).join('');

    list.querySelectorAll('.nearby-item').forEach(el => {
      el.addEventListener('click', () => {
        const cid = el.getAttribute('data-course-id');
        const c = courses.find(x => x.id === cid);
        if (c) showCourseDetail(c);
      });
    });

    banner.hidden = false;
  }

  async function renderWeatherBanner() {
    const banner = $('#weather-banner');
    if (!banner) return;
    // 出発地が設定されていれば優先、なければ東京駅をデフォルト
    let lat = 35.6812, lng = 139.7671; // Tokyo Station
    if (state.origin && state.origin.lat) {
      lat = state.origin.lat;
      lng = state.origin.lng;
    }
    const w = await fetchWeather(lat, lng);
    if (!w) { banner.hidden = true; return; }
    const desc = describeWeather(w.code);
    banner.className = 'weather-banner' + (desc.cls ? ' ' + desc.cls : '');
    $('#weather-icon').textContent = desc.icon;
    $('#weather-msg').textContent = desc.mood;
    const tempStr = (typeof w.temp === 'number') ? `${Math.round(w.temp)}°C` : '';
    $('#weather-meta').textContent = `${desc.label}${tempStr ? ' ・ ' + tempStr : ''}`;
    banner.hidden = false;
    // 新ステータスバーにも反映
    try { renderStatusBar(); } catch {}
  }

  // ===== Recommendation banner on home =====
  function renderRecommendationBanner() {
    const banner = $('#reco-banner');
    if (!banner) return;
    if (state.mode !== 'course') {
      banner.hidden = true;
      return;
    }
    // 既に発見済み or 完走済みなら表示しない（毎回出ると邪魔）
    const reco = getRecommendedCourse();
    if (!reco) { banner.hidden = true; return; }
    // ユーザーが今のセッションで既にこれを開いてたらスキップ
    if (state._recoShownId === reco.id && state._recoShownAt && Date.now() - state._recoShownAt < 60_000) {
      return;
    }
    state._recoShownId = reco.id;
    state._recoShownAt = Date.now();

    banner.hidden = false;
    $('#reco-emoji').textContent = reco.themeIcon || reco.areaIcon || '🌳';
    $('#reco-title').textContent = tField(reco, 'name');
    const minutes = reco.estimatedMin ? `約${reco.estimatedMin}分` : '';
    let metaPrefix = '';
    const tb = state._lastRecoTimeBand;
    if (tb === 'dawn') metaPrefix = '🌅 早朝にぴったり ・ ';
    else if (tb === 'evening') metaPrefix = '🌆 夕暮れ時に ・ ';
    else if (tb === 'night') metaPrefix = '🌃 夜の散歩に ・ ';
    else if (state._lastRecoMeta?.indoorPreferred) metaPrefix = '☔ 雨でも楽しめる ・ ';
    else if (state._lastRecoMeta?.weatherCode === 0) metaPrefix = '☀️ 快晴日和に ・ ';
    $('#reco-meta').textContent = `${metaPrefix}${reco.areaIcon || ''} ${tField(reco, 'areaName')} ・ ${minutes} ・ ${reco.stops.length}スポット`;
    const card = $('#reco-card');
    if (card) {
      card.onclick = () => {
        applyRoute(courseToRoute(reco));
        showToast(`✨ 「${tField(reco, 'name')}」を地図に設定しました`, 'success', 3000);
        // 探すタブに自動切替（地図 + 歩行ボタンが見える）
        document.querySelector('.main-tab[data-main-tab="discover"]')?.click();
      };
    }
  }

  function renderMissions() {
    const widget = $('#missions-widget');
    const list = $('#missions-list');
    if (!widget || !list) return;
    const s = getMissionsState();
    const items = [
      { key: 'gacha', label: 'ガチャを1回引く',   icon: '🎰', coins: 1, done: !!s.done.gacha },
      { key: 'walk',  label: '1スポット完走',    icon: '🚶', coins: 2, done: !!s.done.walk },
      { key: 'photo', label: '写真を1枚撮影',    icon: '📸', coins: 1, done: !!s.done.photo },
    ];
    const doneCount = items.filter(i => i.done).length;
    const totalCount = items.length;
    const pct = Math.round((doneCount / totalCount) * 100);
    list.innerHTML = `
      <div class="missions-progress">
        <div class="missions-progress-bar"><div class="missions-progress-fill" style="width: ${pct}%;"></div></div>
        <div class="missions-progress-text">${doneCount}/${totalCount} 達成 ${doneCount === totalCount ? '🎉' : ''}</div>
      </div>
    ` + items.map(it => `
      <div class="mission-item ${it.done ? 'done' : ''}">
        <span class="mission-check">${it.done ? '✅' : '⬜'}</span>
        <span class="mission-icon">${it.icon}</span>
        <span class="mission-label">${escapeHtml(it.label)}</span>
        <span class="mission-coin">+${it.coins}🪙</span>
      </div>
    `).join('');
    widget.hidden = false;
  }

  // ---------- Browser notifications ----------
  const NOTIFY_KEY = 'yorimichi-notify-pref';

  function getNotifyPref() {
    try { return JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}'); } catch { return {}; }
  }
  function setNotifyPref(p) {
    try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(p)); } catch {}
  }

  function updateNotifyUI() {
    const btn = $('#notify-toggle');
    const status = $('#notify-status');
    if (!btn || !status) return;
    if (!('Notification' in window)) {
      btn.disabled = true;
      btn.textContent = 'このブラウザは未対応';
      status.textContent = '';
      return;
    }
    const perm = Notification.permission;
    const pref = getNotifyPref();
    if (perm === 'granted' && pref.enabled) {
      btn.textContent = '通知をオフにする';
      status.textContent = '✓ オン（朝9時・夕方17時にリマインダー）';
      status.className = 'notify-status granted';
    } else if (perm === 'denied') {
      btn.textContent = 'ブラウザ設定で許可してください';
      btn.disabled = true;
      status.textContent = '✕ ブロック中';
      status.className = 'notify-status denied';
    } else {
      btn.textContent = '通知をオンにする';
      status.textContent = '未設定';
      status.className = 'notify-status';
    }
  }

  async function toggleNotifications() {
    if (!('Notification' in window)) return;
    const pref = getNotifyPref();
    if (Notification.permission === 'granted' && pref.enabled) {
      // オフにする
      pref.enabled = false;
      setNotifyPref(pref);
      updateNotifyUI();
      showToast('通知をオフにしました', 'info', 2500);
      return;
    }
    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        updateNotifyUI();
        return;
      }
    }
    if (Notification.permission === 'granted') {
      pref.enabled = true;
      pref.lastFireDate = '';
      setNotifyPref(pref);
      updateNotifyUI();
      showToast('🔔 通知をオンにしました', 'success', 3000);
      // テスト通知
      try {
        new Notification('街歩きガチャ', {
          body: '通知が有効になりました 👣 今日の散歩、ご一緒に',
          icon: '/og.png',
        });
      } catch {}
    }
  }

  /**
   * 完走後に「明日も同じ時間にリマインダーする？」提案
   * 通知が拒否済みなら出さない
   */
  function maybeOfferTomorrowReminder() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') return;
    // 1日1回まで
    const today = (new Date()).toDateString();
    if (localStorage.getItem('yorimichi-tomorrow-offer-day') === today) return;
    localStorage.setItem('yorimichi-tomorrow-offer-day', today);

    if (document.getElementById('tomorrow-reminder-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'tomorrow-reminder-modal';
    overlay.className = 'modal-backdrop';
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    overlay.innerHTML = `
      <div class="modal" style="max-width: 360px; text-align: center;">
        <button class="modal-close" id="tr-close" type="button" aria-label="閉じる">✕</button>
        <div style="font-size: 48px; margin-bottom: 8px;">⏰</div>
        <h2 class="modal-title">明日も歩こう？</h2>
        <p style="font-size: 14px; color: var(--text-muted); line-height: 1.7; margin-bottom: 16px;">
          明日の <strong>${hh}:${mm}</strong> にリマインダー通知をお送りします。
        </p>
        <button class="btn-primary" id="tr-yes" type="button" style="width:100%; margin-bottom: 8px;">
          🔔 リマインダーを設定
        </button>
        <button class="btn-secondary" id="tr-no" type="button" style="width:100%;">
          結構です
        </button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#tr-close').onclick = () => overlay.remove();
    overlay.querySelector('#tr-no').onclick = () => overlay.remove();
    overlay.querySelector('#tr-yes').onclick = async () => {
      let perm = Notification.permission;
      if (perm === 'default') {
        perm = await Notification.requestPermission();
      }
      if (perm !== 'granted') {
        showToast('通知が拒否されています。設定から有効化してください', 'warning', 4000);
        overlay.remove();
        return;
      }
      // 24時間後にトリガーする予約（タブが開いてる必要があるが、PWAに追加されてれば可）
      const tomorrowMs = 24 * 60 * 60 * 1000;
      try {
        localStorage.setItem('yorimichi-tomorrow-reminder-at', String(Date.now() + tomorrowMs));
      } catch {}
      setTimeout(() => {
        try {
          new Notification('街歩きガチャ', {
            body: '昨日の散歩はいかがでしたか？今日もぜひ 👣',
            icon: '/og.png',
          });
        } catch {}
      }, tomorrowMs);
      showToast('🔔 明日のリマインダーを設定しました', 'success', 3500);
      overlay.remove();
    };
  }

  function maybeFireDailyReminder() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const pref = getNotifyPref();
    if (!pref.enabled) return;
    const now = new Date();
    const hour = now.getHours();
    const todayStr = now.toDateString();
    // 朝9-11時 or 夕方17-19時の枠で1日2回まで
    let slot = null;
    if (hour >= 9 && hour < 11) slot = 'morning';
    else if (hour >= 17 && hour < 19) slot = 'evening';
    if (!slot) return;
    const fired = pref.fired || {};
    const key = `${todayStr}-${slot}`;
    if (fired[key]) return;
    fired[key] = true;
    pref.fired = fired;
    setNotifyPref(pref);
    const messages = {
      morning: ['☀️ 朝の散歩、ガチャから始めよう', '🌳 おはよう！今日の街歩きコースは？'],
      evening: ['🌅 夕焼けタイム。今日の散歩しよう', '🚶 帰り道、ちょっと寄り道してみない？'],
    };
    const msg = messages[slot][Math.floor(Math.random() * messages[slot].length)];
    try {
      new Notification('街歩きガチャ', { body: msg, icon: '/og.png' });
    } catch {}
  }

  // ---------- Course rating ----------
  let _ratingTarget = null; // { courseId, courseName }
  function showRatingModal(course) {
    if (!course || !course.id) return;
    // 既に評価済みなら出さない
    let rated = {};
    try { rated = JSON.parse(localStorage.getItem('yorimichi-rated-courses') || '{}'); } catch {}
    if (rated[course.id]) return;
    _ratingTarget = { courseId: course.id, courseName: tField(course, 'name') };
    const modal = $('#rating-modal');
    if (!modal) return;
    $('#rating-course-name').textContent = _ratingTarget.courseName;
    $('#rating-comment').value = '';
    $$('.rating-star').forEach(s => s.classList.remove('active'));
    $('#rating-submit').disabled = true;
    modal.hidden = false;
  }
  function setupRatingListeners() {
    let selectedRating = 0;
    $$('.rating-star').forEach(star => {
      star.addEventListener('click', () => {
        selectedRating = parseInt(star.dataset.value, 10);
        $$('.rating-star').forEach(s => {
          const v = parseInt(s.dataset.value, 10);
          s.classList.toggle('active', v <= selectedRating);
          s.textContent = v <= selectedRating ? '★' : '☆';
        });
        $('#rating-submit').disabled = false;
      });
    });
    const skip = $('#rating-skip');
    if (skip) skip.addEventListener('click', () => { $('#rating-modal').hidden = true; });
    const submit = $('#rating-submit');
    if (submit) submit.addEventListener('click', async () => {
      if (selectedRating < 1 || !_ratingTarget) return;
      const comment = ($('#rating-comment').value || '').slice(0, 200);
      const userId = (typeof getOrCreateUserId === 'function') ? getOrCreateUserId() : '';
      try {
        await fetch(`${API_BASE}/api/course-rating`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            course_id: _ratingTarget.courseId,
            rating: selectedRating,
            comment,
          }),
          keepalive: true,
        });
      } catch (e) { console.warn('rating send failed', e); }
      // 重複送信防止
      try {
        const rated = JSON.parse(localStorage.getItem('yorimichi-rated-courses') || '{}');
        rated[_ratingTarget.courseId] = { r: selectedRating, t: Date.now() };
        localStorage.setItem('yorimichi-rated-courses', JSON.stringify(rated));
      } catch {}
      showToast(`⭐ ${selectedRating}星の評価をありがとう！`, 'success', 3000);
      // ボーナスコイン: 評価で +1 (1日1回まで)
      const today = (new Date()).toDateString();
      let bonusKey = 'yorimichi-rating-bonus-day';
      if (localStorage.getItem(bonusKey) !== today) {
        gacha.coins += 1;
        gachaSave();
        gachaUpdateUI();
        localStorage.setItem(bonusKey, today);
      }
      $('#rating-modal').hidden = true;
      selectedRating = 0;
    });
  }

  // ---------- Cloud Sync (Firestore, opt-in) ----------
  const CLOUD_SYNC_KEY = 'yorimichi-cloud-sync';
  const CLOUD_SYNC_LAST_KEY = 'yorimichi-cloud-sync-last';
  let _syncDebounceTimer = null;

  function isCloudSyncEnabled() {
    try { return localStorage.getItem(CLOUD_SYNC_KEY) === '1'; } catch { return false; }
  }
  function setCloudSyncEnabled(v) {
    try { localStorage.setItem(CLOUD_SYNC_KEY, v ? '1' : '0'); } catch {}
  }

  /** 現在の状態を Firestore 用にシリアライズ */
  function buildSyncPayload() {
    const ratedCourses = (() => { try { return JSON.parse(localStorage.getItem('yorimichi-rated-courses') || '{}'); } catch { return {}; } })();
    const totalWalkMin = parseInt(localStorage.getItem('yorimichi-total-walk-min') || '0', 10) || 0;
    const totalSteps = parseInt(localStorage.getItem('yorimichi-total-steps') || '0', 10) || 0;

    return {
      coins: gacha.coins || 0,
      freeUsedToday: gacha.freeUsedToday || 0,
      lastFreeDate: gacha.lastFreeDate || '',
      pulls: gacha.pulls || 0,
      pullsSinceSR: gacha.pullsSinceSR || 0,
      pullsSinceLR: gacha.pullsSinceLR || 0,
      discoveredCourses: [...state.discoveredCourses],
      completedCourses: [...state.completedCourses],
      walkCounts: state.walkCounts || {},
      walkHistory: (state.walkHistory || []).slice(-200),
      loginStreak: state.loginStreak || 0,
      lastLoginDate: state.lastLoginDate || '',
      totalWalkMin: totalWalkMin,
      totalSteps: totalSteps,
      ratedCourses: ratedCourses,
    };
  }

  /** サーバーから取得した state を localStorage / 実行時 state に反映 */
  function applyRestoredState(restored) {
    if (!restored) return;
    if (typeof restored.coins === 'number') gacha.coins = restored.coins;
    if (typeof restored.freeUsedToday === 'number') gacha.freeUsedToday = restored.freeUsedToday;
    if (typeof restored.lastFreeDate === 'string') gacha.lastFreeDate = restored.lastFreeDate;
    if (typeof restored.pulls === 'number') gacha.pulls = restored.pulls;
    if (typeof restored.pullsSinceSR === 'number') gacha.pullsSinceSR = restored.pullsSinceSR;
    if (typeof restored.pullsSinceLR === 'number') gacha.pullsSinceLR = restored.pullsSinceLR;
    if (Array.isArray(restored.discoveredCourses)) state.discoveredCourses = new Set(restored.discoveredCourses);
    if (Array.isArray(restored.completedCourses)) state.completedCourses = new Set(restored.completedCourses);
    if (restored.walkCounts && typeof restored.walkCounts === 'object') state.walkCounts = restored.walkCounts;
    if (Array.isArray(restored.walkHistory)) state.walkHistory = restored.walkHistory;
    if (typeof restored.loginStreak === 'number') state.loginStreak = restored.loginStreak;
    if (typeof restored.lastLoginDate === 'string') state.lastLoginDate = restored.lastLoginDate;
    if (typeof restored.totalWalkMin === 'number') {
      try { localStorage.setItem('yorimichi-total-walk-min', String(restored.totalWalkMin)); } catch {}
    }
    if (typeof restored.totalSteps === 'number') {
      try { localStorage.setItem('yorimichi-total-steps', String(restored.totalSteps)); } catch {}
    }
    if (restored.ratedCourses && typeof restored.ratedCourses === 'object') {
      try { localStorage.setItem('yorimichi-rated-courses', JSON.stringify(restored.ratedCourses)); } catch {}
    }
    // 永続化
    try {
      gachaSave();
      localStorage.setItem('yorimichi-discovered', JSON.stringify([...state.discoveredCourses]));
      saveCompletion();
    } catch {}
  }

  async function pushSync(reason) {
    if (!isCloudSyncEnabled()) return;
    const userId = getOrCreateUserId();
    const payload = { user_id: userId, state: buildSyncPayload() };
    try {
      const res = await fetch(`${API_BASE}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (res.ok) {
        try { localStorage.setItem(CLOUD_SYNC_LAST_KEY, String(Date.now())); } catch {}
      }
    } catch (e) { console.warn('cloud sync push failed', e); }
  }

  function scheduleSync(reason = 'change') {
    if (!isCloudSyncEnabled()) return;
    clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = setTimeout(() => pushSync(reason), 5000); // 5秒デバウンス
  }

  async function pullRestoreFromCloud() {
    if (!isCloudSyncEnabled()) return null;
    const userId = getOrCreateUserId();
    try {
      const res = await fetch(`${API_BASE}/api/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.exists || !data.state) return null;
      return data.state;
    } catch (e) { console.warn('cloud restore failed', e); return null; }
  }

  /** 公開プロフィール用スナップショットを生成 */
  function buildPublicProfileSnapshot() {
    const xp = computeXP();
    const { current } = computeLevel(xp);
    // お気に入りエリア
    const areaCount = {};
    for (const id of state.completedCourses) {
      const c = (window.YORIMICHI_COURSES || []).find(x => x.id === id);
      if (c?.area) areaCount[c.area] = (areaCount[c.area] || 0) + 1;
    }
    let favArea = '';
    let favCount = 0;
    for (const [a, n] of Object.entries(areaCount)) {
      if (n > favCount) { favArea = a; favCount = n; }
    }
    const favAreaObj = favArea ? (window.YORIMICHI_AREAS || []).find(a => a.id === favArea) : null;
    // バッジは現状あれば取得（簡易）
    const badges = [];
    try {
      const b = JSON.parse(localStorage.getItem('yorimichi-badges') || '[]');
      if (Array.isArray(b)) badges.push(...b);
    } catch {}
    return {
      display_name: current.title,
      level: current.lv,
      xp: xp,
      completed_courses_count: state.completedCourses.size,
      discovered_courses_count: state.discoveredCourses.size,
      total_walk_min: parseInt(localStorage.getItem('yorimichi-total-walk-min') || '0', 10) || 0,
      login_streak: state.loginStreak || 0,
      favorite_area: favAreaObj ? `${favAreaObj.icon} ${favAreaObj.name}` : '',
      badges: badges.slice(0, 20),
      completed_course_ids: [...state.completedCourses].slice(0, 50),
    };
  }

  async function generatePublicProfile() {
    const userId = getOrCreateUserId();
    const snapshot = buildPublicProfileSnapshot();
    try {
      const res = await fetch(`${API_BASE}/api/public-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, snapshot }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { console.warn('public profile failed', e); return null; }
  }

  async function deleteCloudData() {
    const userId = getOrCreateUserId();
    try {
      const res = await fetch(`${API_BASE}/api/delete-user-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      return res.ok;
    } catch { return false; }
  }

  // ---------- Subscription (Premium) ----------
  // localStorage cache のキー
  const PREMIUM_CACHE_KEY = 'yorimichi-premium';

  function getPremiumCache() {
    try {
      const raw = localStorage.getItem(PREMIUM_CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // 有効期限：1時間
      if (Date.now() - (data.checkedAt || 0) > 60 * 60 * 1000) return null;
      return data;
    } catch { return null; }
  }

  function setPremiumCache(premium, subId) {
    try {
      localStorage.setItem(PREMIUM_CACHE_KEY, JSON.stringify({
        premium: !!premium,
        subscription_id: subId || null,
        checkedAt: Date.now(),
      }));
    } catch {}
  }

  function isPremiumSync() {
    const c = getPremiumCache();
    return c?.premium === true;
  }

  async function refreshPremiumStatus() {
    const userId = getOrCreateUserId();
    try {
      const res = await fetch(`${API_BASE}/api/subscription-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      setPremiumCache(data.premium, data.subscription_id);
      updateSubscriptionUI();
      return data;
    } catch (e) {
      console.warn('refreshPremiumStatus failed', e);
      return null;
    }
  }

  function updateSubscriptionUI() {
    const card = $('#sub-card');
    const active = $('#sub-active');
    if (!card || !active) return;
    if (isPremiumSync()) {
      card.hidden = true;
      active.hidden = false;
    } else {
      card.hidden = false;
      active.hidden = true;
    }
  }

  async function startSubscriptionCheckout() {
    const userId = getOrCreateUserId();
    showToast('🔄 決済画面に移動します…', 'info', 2000);
    try {
      const res = await fetch(`${API_BASE}/api/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (data && data.url) {
        window.location.href = data.url;
      } else {
        showToast('❌ 決済の準備に失敗しました', 'error', 3000);
      }
    } catch (e) {
      console.error(e);
      showToast('❌ ネットワークエラー', 'error', 3000);
    }
  }

  async function cancelSubscription() {
    const cache = getPremiumCache();
    const subId = cache?.subscription_id;
    if (!subId) {
      showToast('購読情報が見つかりません', 'error', 3000);
      return;
    }
    if (!confirm('期間末でプランを解約します。よろしいですか？')) return;
    try {
      const res = await fetch(`${API_BASE}/api/cancel-subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription_id: subId }),
      });
      const data = await res.json();
      if (data && data.ok) {
        showToast('解約予約を承りました。期間末まで利用可能です', 'success', 4000);
      } else {
        showToast('解約の処理に失敗しました', 'error', 3000);
      }
    } catch (e) {
      console.error(e);
      showToast('❌ ネットワークエラー', 'error', 3000);
    }
  }

  async function verifySubscriptionFromUrl() {
    const params = new URLSearchParams(location.search);
    const sub = params.get('sub');
    if (!sub) return;
    params.delete('sub');
    params.delete('session_id');
    const cleanUrl = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
    history.replaceState(null, '', cleanUrl);
    if (sub === 'cancel') {
      showToast('購読をキャンセルしました', 'info', 2500);
      return;
    }
    if (sub === 'success') {
      // サーバー側で反映を待つために少し時間を置く
      showToast('🎉 プレミアム購読を確認中…', 'info', 2500);
      setTimeout(async () => {
        const data = await refreshPremiumStatus();
        if (data?.premium) {
          showToast('✨ プレミアム購読が有効になりました！', 'success', 4500);
        } else {
          showToast('購読が反映され次第、自動で更新されます', 'info', 4000);
        }
      }, 2500);
    }
  }

  // ---------- Invite system ----------
  const INVITE_BONUS = 15;

  function getInviteUrl() {
    const userId = getOrCreateUserId();
    return `${location.origin}/?ref=${encodeURIComponent(userId)}`;
  }

  function setupInviteLink() {
    const linkEl = $('#invite-link');
    const copyBtn = $('#invite-copy');
    const shareBtn = $('#invite-share');
    if (!linkEl) return;
    const url = getInviteUrl();
    linkEl.value = url;

    if (copyBtn) {
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          showToast('📋 招待リンクをコピーしました', 'success', 2500);
        } catch {
          linkEl.select();
          document.execCommand('copy');
          showToast('📋 コピーしました', 'success', 2500);
        }
      };
    }
    if (shareBtn) {
      shareBtn.onclick = async () => {
        const shareText = `街歩きガチャを一緒に遊ぼう！\nお互いに +${INVITE_BONUS}🪙 もらえます 🎰\n${url}`;
        if (navigator.share) {
          try { await navigator.share({ title: '街歩きガチャ', text: shareText, url }); return; } catch {}
        }
        // Fallback: X intent
        const x = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
        window.open(x, '_blank', 'noopener');
      };
    }
  }

  /**
   * 初回訪問で ?ref=uuid が付いていたら被招待者として記録。
   * その後、被招待者が初めてガチャを回した瞬間に
   * 自分・招待者ともに +INVITE_BONUS コイン付与（招待者側はサーバ管理が無いので
   * MVP ではローカルで「自分が招待された記録」だけ残し、本人にだけ即時ボーナス）。
   */
  function processInviteParam() {
    const params = new URLSearchParams(location.search);
    const ref = params.get('ref');
    if (!ref) return;
    // URL クリーン化（後続の coins=success 等を維持）
    params.delete('ref');
    const newSearch = params.toString();
    const cleanUrl = location.pathname + (newSearch ? '?' + newSearch : '') + location.hash;
    history.replaceState(null, '', cleanUrl);

    const myId = getOrCreateUserId();
    if (ref === myId) return; // 自己招待は無効

    let inviteData = {};
    try { inviteData = JSON.parse(localStorage.getItem('yorimichi-invite') || '{}'); } catch {}
    if (inviteData.invitedBy) return; // 既に招待済み
    inviteData.invitedBy = ref;
    inviteData.bonusGranted = false;
    try { localStorage.setItem('yorimichi-invite', JSON.stringify(inviteData)); } catch {}
    showToast(`🎁 招待リンクから来てくれてありがとう！初ガチャで +${INVITE_BONUS}🪙`, 'info', 5000);
  }

  function maybeGrantInviteeBonus() {
    let inviteData = {};
    try { inviteData = JSON.parse(localStorage.getItem('yorimichi-invite') || '{}'); } catch {}
    if (!inviteData.invitedBy || inviteData.bonusGranted) return;
    gacha.coins += INVITE_BONUS;
    gachaSave();
    gachaUpdateUI();
    showToast(`🎁 招待ボーナス +${INVITE_BONUS}🪙！`, 'success', 4000);
    inviteData.bonusGranted = true;
    try { localStorage.setItem('yorimichi-invite', JSON.stringify(inviteData)); } catch {}
  }

  async function verifyAndGrantCoinsFromUrl() {
    const params = new URLSearchParams(location.search);
    const status = params.get('coins');
    if (!status) return;

    // URL を即時クリーン化（リロードで二重発火防止）
    const cleanUrl = location.pathname + location.hash;
    history.replaceState(null, '', cleanUrl);

    if (status === 'cancel') {
      showToast('決済をキャンセルしました', 'info', 2500);
      return;
    }
    if (status !== 'success') return;

    const sessionId = params.get('session_id');
    if (!sessionId) return;

    // 冪等性: 既に消費済みのセッションは無視
    const consumedKey = 'yorimichi-consumed-sessions';
    let consumed = [];
    try { consumed = JSON.parse(localStorage.getItem(consumedKey) || '[]'); } catch { consumed = []; }
    if (consumed.includes(sessionId)) return;

    try {
      const res = await fetch(`${API_BASE}/api/verify-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json();
      if (data && data.paid && Number.isFinite(data.coins) && data.coins > 0) {
        gacha.coins += data.coins;
        gachaSave();
        gachaUpdateUI();
        showToast(`🪙 ${data.coins} コインを付与しました！`, 'success', 4000);
        consumed.push(sessionId);
        // 直近100件まで保持
        if (consumed.length > 100) consumed = consumed.slice(-100);
        localStorage.setItem(consumedKey, JSON.stringify(consumed));
      } else {
        showToast('決済が確認できませんでした', 'warning', 3000);
      }
    } catch (e) {
      console.error(e);
      showToast('❌ 決済の確認に失敗しました', 'error', 3000);
    }
  }

  // 互換性のため purchaseCoins は残すが、新フロー（startStripeCheckout）に誘導
  function purchaseCoins(coins, yen, bonus = 0, packId) {
    if (packId) return startStripeCheckout(packId);
    showToast('🚧 決済プランIDが未指定です', 'warning', 3000);
  }

  // ---------- Collection ----------

  let collectionFilter = 'all';
  let collectionSearch = '';
  let collectionSort = 'rarity';

  function showCollection() {
    $('#collection-modal').hidden = false;
    renderCollection(collectionFilter);
  }

  function renderCollection(filter) {
    // Silhouette-collection style: show ALL canonical courses; discovered ones are revealed, others are silhouettes
    const allCourses = window.YORIMICHI_COURSES || [];
    const discovered = state.discoveredCourses;

    // Stats
    const stats = $('#collection-stats');
    const counts = { legendary: 0, sr: 0, r: 0, n: 0 };
    const discoveredCount = { legendary: 0, sr: 0, r: 0, n: 0 };
    allCourses.forEach(c => {
      const r = c.rarity || 'r';
      counts[r] = (counts[r] || 0) + 1;
      if (discovered.has(c.id)) discoveredCount[r] = (discoveredCount[r] || 0) + 1;
    });
    const totalDiscovered = discovered.size;
    const totalCourses = allCourses.length;

    stats.innerHTML = `
      <div class="col-stat"><div class="col-stat-label">発見</div><div class="col-stat-val">${totalDiscovered}/${totalCourses}</div></div>
      <div class="col-stat rarity-legendary"><div class="col-stat-label">✨ LR</div><div class="col-stat-val" style="color: var(--rarity-color)">${discoveredCount.legendary}/${counts.legendary}</div></div>
      <div class="col-stat rarity-sr"><div class="col-stat-label">🌟 SR</div><div class="col-stat-val" style="color: var(--rarity-color)">${discoveredCount.sr}/${counts.sr}</div></div>
      <div class="col-stat rarity-r"><div class="col-stat-label">⭐ R</div><div class="col-stat-val" style="color: var(--rarity-color)">${discoveredCount.r}/${counts.r}</div></div>
    `;

    const grid = $('#collection-grid');
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = '1fr';

    let filtered = filter === 'all' ? allCourses : allCourses.filter(c => (c.rarity || 'r') === filter);

    // Apply search (kana-normalized)
    if (collectionSearch) {
      const q = normalizeJa(collectionSearch);
      filtered = filtered.filter(c => {
        if (!discovered.has(c.id)) return false;
        const haystack = [
          c.name, c.name_en,
          c.areaName, c.areaName_en,
          ...(c.stops || []).flatMap(s => [s.name, s.name_en]),
          ...(c.tags || []),
        ].filter(Boolean).map(normalizeJa).join(' ');
        return haystack.includes(q);
      });
    }

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="col-empty">該当するコースがありません</div>';
      return;
    }

    // Sort
    const rarityOrder = { 'legendary': 0, 'sr': 1, 'r': 2, 'n': 3 };
    if (collectionSort === 'rarity') {
      filtered.sort((a, b) => (rarityOrder[a.rarity || 'r'] || 9) - (rarityOrder[b.rarity || 'r'] || 9));
    } else if (collectionSort === 'recent') {
      filtered.sort((a, b) => {
        const aDis = state.discoveredCourses.has(a.id);
        const bDis = state.discoveredCourses.has(b.id);
        return (bDis ? 1 : 0) - (aDis ? 1 : 0);
      });
    } else if (collectionSort === 'completion') {
      filtered.sort((a, b) => (state.walkCounts?.[b.id] || 0) - (state.walkCounts?.[a.id] || 0));
    } else if (collectionSort === 'duration') {
      filtered.sort((a, b) => (a.estimatedMin || 60) - (b.estimatedMin || 60));
    } else if (collectionSort === 'stops') {
      filtered.sort((a, b) => (b.stops?.length || 0) - (a.stops?.length || 0));
    }

    filtered.forEach(c => {
      const rarity = RARITY[c.rarity || 'r'];
      const isDiscovered = discovered.has(c.id);
      const isCompleted = state.completedCourses.has(c.id);
      const emojis = (c.stops || []).map(s => s.emoji || '📍').join(' ');
      const card = document.createElement('div');
      card.className = 'col-card col-route-card ' + rarity.cls +
        (isDiscovered ? '' : ' undiscovered') +
        (isCompleted ? ' completed' : '');
      const wc = state.walkCounts?.[c.id] || 0;
      const cLv = getCourseLevel(wc);
      if (isDiscovered) {
        card.innerHTML = `
          <div class="c-route-head">
            <span class="c-stars">${rarity.stars}</span>
            <span class="c-route-theme">${c.areaIcon || '🗺'} ${escapeHtml(tField(c, 'areaName'))}</span>
          </div>
          <div class="c-route-title">${escapeHtml(tField(c, 'name'))}${cLv ? ` <span class="lv-pill">${cLv.emoji} ${cLv.lv}</span>` : ''}</div>
          <div class="c-route-meta">📍${(c.stops || []).length}スポット ・ 約${c.estimatedMin || 60}分${wc > 0 ? ` ・ 🏅×${wc}` : ''}</div>
          <div class="c-route-emojis">${emojis}</div>
        `;
        card.addEventListener('click', () => {
          $('#collection-modal').hidden = true;
          showCourseDetail(c);
        });
      } else {
        card.innerHTML = `
          <div class="c-route-head">
            <span class="c-stars">${rarity.stars}</span>
            <span class="c-route-theme">${c.areaIcon || '🗺'} ${escapeHtml(c.areaName || '')}</span>
          </div>
          <div class="c-route-title">？？？</div>
          <div class="c-route-meta">未発見のコース</div>
          <div class="c-route-emojis">❓ ❓ ❓</div>
        `;
      }
      grid.appendChild(card);
    });
  }

  // Course Lv: based on completion count
  function getCourseLevel(walkCount) {
    if (walkCount >= 10) return { lv: 'マスター', emoji: '👑', desc: '10回以上完走の常連' };
    if (walkCount >= 5)  return { lv: '常連',     emoji: '🌟', desc: '5回以上完走の達人' };
    if (walkCount >= 3)  return { lv: 'リピーター', emoji: '⭐', desc: '3回以上完走の親しみある人' };
    if (walkCount >= 1)  return { lv: '完走者',   emoji: '🏅', desc: '1回完走済み' };
    return null;
  }

  // Course detail modal (preview before applying)
  function showCourseDetail(course) {
    const rarity = RARITY[course.rarity || 'r'];
    const content = $('#course-detail-content');
    const heroBg = course.stops[0]?.photoBg || `linear-gradient(135deg, var(--brand), var(--brand-dark))`;
    const walkCount = state.walkCounts?.[course.id] || 0;
    const isCompleted = state.completedCourses.has(course.id);
    const courseLv = getCourseLevel(walkCount);

    content.innerHTML = `
      <div class="cd-hero ${rarity.cls}" style="background:${heroBg}; --rarity-color: ${rarity.cls === 'rarity-legendary' ? '#d4af37' : rarity.cls === 'rarity-sr' ? '#ff9800' : rarity.cls === 'rarity-r' ? '#2563eb' : '#94a3b8'}">
        <span class="cd-rarity-band">${rarity.stars} ${rarity.name}</span>
        <span class="cd-area-band">${course.areaIcon} ${escapeHtml(tField(course, 'areaName'))}</span>
        <span>${course.themeIcon || '🗺'}</span>
      </div>
      <div class="cd-name">${escapeHtml(tField(course, 'name'))}</div>
      <div class="cd-stats">
        <span class="meta-pill">📍 ${course.stops.length}スポット</span>
        <span class="meta-pill">⏱ 約${course.estimatedMin}分</span>
        <span class="meta-pill cd-difficulty cd-difficulty-${computeCourseDifficulty(course).level}" title="${escapeHtml(computeCourseDifficulty(course).factors.join(' / '))}">${computeCourseDifficulty(course).icon} ${computeCourseDifficulty(course).label}</span>
        <span class="meta-pill">💴 ${escapeHtml(course.budget || '無料')}</span>
        <span class="meta-pill">🚶 ${course.travelMode === 'walk' ? '徒歩' : course.travelMode === 'bike' ? '自転車' : '車'}</span>
      </div>
      <div class="cd-desc">${escapeHtml(tField(course, 'description'))}</div>

      ${course.tags?.length ? `<div class="detail-tags">${course.tags.map(t => `<span class="detail-tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}

      ${renderTimeline(course.stops)}

      <div class="cd-stops-title">📍 経由スポット <span class="cd-stops-hint">タップで詳細</span></div>
      <div class="cd-stops">
        ${course.stops.map((s, i) => {
          const photoUrl = (window.YORIMICHI_PHOTOS || {})[s.name];
          const _rawPerk = (window.YORIMICHI_PERKS || {})[s.name];
          const perk = (_rawPerk && _rawPerk.status === 'live') ? _rawPerk : null;
          const thumb = photoUrl
            ? `<span class="cd-stop-thumb" style="background-image:url('${photoUrl}')"></span>`
            : `<span class="cd-stop-emoji">${s.emoji || '📍'}</span>`;
          // スポット間の徒歩時間（4km/h）
          let segmentHtml = '';
          if (i > 0) {
            const prev = course.stops[i - 1];
            if (prev && s.lat != null && s.lng != null && prev.lat != null && prev.lng != null) {
              const segKm = haversineKm(prev, s);
              const segMin = Math.max(1, Math.round((segKm / 4) * 60));
              const segM = Math.round(segKm * 1000);
              const segDist = segM >= 1000 ? `${(segM/1000).toFixed(1)}km` : `${segM}m`;
              segmentHtml = `<div class="cd-segment"><span class="cd-segment-line"></span><span class="cd-segment-text">🚶 ${segDist}・約${segMin}分</span><span class="cd-segment-line"></span></div>`;
            }
          }
          // 詳細情報（展開時表示）
          const stayMin = (typeof s.stayMin === 'number') ? s.stayMin : 5;
          const tags = (s.tags || []).slice(0, 5);
          const detailRows = [];
          if (s.bestTime) detailRows.push(`<span class="cd-meta-pill">🕐 ${escapeHtml(s.bestTime)}</span>`);
          detailRows.push(`<span class="cd-meta-pill">⏱ 滞在約${stayMin}分</span>`);
          if (s.budget) detailRows.push(`<span class="cd-meta-pill">💴 ${escapeHtml(s.budget)}</span>`);
          if (perk) detailRows.push(`<span class="cd-meta-pill cd-perk-pill">🎫 ${escapeHtml(perk.label || '特典あり')}</span>`);
          const tagsHtml = tags.length
            ? `<div class="cd-stop-tags">${tags.map(t => `<span class="detail-tag">#${escapeHtml(t)}</span>`).join('')}</div>`
            : '';
          return `
          ${segmentHtml}
          <div class="cd-stop expandable" data-stop-idx="${i}">
            <span class="cd-stop-num">${i + 1}</span>
            ${thumb}
            <div class="cd-stop-info">
              <div class="cd-stop-name">${escapeHtml(tField(s, 'name'))}${perk ? ' <span class="cd-perk-tag">🎫 特典あり</span>' : ''}</div>
              <div class="cd-stop-desc">${s.bestTime ? `<span class="cd-besttime">🕐 ${escapeHtml(s.bestTime)}</span> ` : ''}${escapeHtml(tField(s, 'desc'))}</div>
            </div>
            <span class="cd-stop-toggle" aria-hidden="true">▾</span>
            <div class="cd-stop-expanded">
              <div class="cd-stop-meta">${detailRows.join('')}</div>
              ${tagsHtml}
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="cd-actions">
        <button class="btn-primary" id="cd-apply" type="button">
          <span>🚶</span><span>${isCompleted ? 'もう一度歩く' : 'このコースで行く'}</span>
        </button>
        <button class="btn-secondary" id="cd-walk-now" type="button">
          <span>⚡</span><span>すぐ歩く</span>
        </button>
        <button class="btn-peek" id="cd-peek" type="button">
          <span>👁</span><span>地図で覗く（適用しない）</span>
        </button>
        <button class="btn-fav" id="cd-fav" type="button" aria-label="お気に入り">
          <span class="fav-icon">${isFavorite(course.id) ? '❤️' : '🤍'}</span>
          <span>${isFavorite(course.id) ? 'お気に入り済' : 'お気に入りに保存'}</span>
        </button>
      </div>
      ${walkCount > 0 ? `<div class="cd-walk-count">${courseLv ? `${courseLv.emoji} ${courseLv.lv} ・ ` : ''}🏅 完走 ${walkCount} 回</div>` : ''}
    `;

    $('#course-detail-modal').hidden = false;
    $('#cd-apply').onclick = () => {
      $('#course-detail-modal').hidden = true;
      applyRoute(courseToRoute(course));
      showToast(`✨ 「${tField(course, 'name')}」を地図に設定しました`, 'success', 3000);
    };
    $('#cd-walk-now').onclick = () => {
      $('#course-detail-modal').hidden = true;
      applyRoute(courseToRoute(course));
      setTimeout(() => startWalk(), 500);
    };
    // 各スポットをタップして展開
    $$('.cd-stop.expandable').forEach(el => {
      el.addEventListener('click', () => {
        el.classList.toggle('open');
      });
    });
    // ❤️ お気に入りトグル
    const favBtn = $('#cd-fav');
    if (favBtn) {
      favBtn.onclick = () => {
        const nowFav = toggleFavorite(course.id);
        const icon = favBtn.querySelector('.fav-icon');
        const label = favBtn.querySelector('span:last-child');
        if (icon) icon.textContent = nowFav ? '❤️' : '🤍';
        if (label) label.textContent = nowFav ? 'お気に入り済' : 'お気に入りに保存';
        showToast(nowFav ? `❤️ お気に入りに追加しました` : `お気に入りから外しました`, 'success', 2000);
        try { renderFavorites(); } catch {}
      };
    }
    // 👁 ピーク（地図で覗くだけ・state.selected を上書きしない）
    const peekBtn = $('#cd-peek');
    if (peekBtn) {
      peekBtn.onclick = () => {
        $('#course-detail-modal').hidden = true;
        showCoursePeek(course);
      };
    }
  }

  // 👁 コースを「適用せず」地図にプレビュー表示
  function showCoursePeek(course) {
    if (!state.map || !course?.stops) return;
    // 既存ピークを消す
    clearCoursePeek();
    state._peekLayer = state._peekLayer || L.layerGroup().addTo(state.map);
    const stops = course.stops.filter(s => s.lat != null && s.lng != null);
    // 経由ピン（小さめ・半透明）
    stops.forEach((s, i) => {
      const html = `
        <span class="peek-poi-num">${i + 1}</span>
        <span class="peek-poi-emo">${s.emoji || '📍'}</span>
        <span class="peek-poi-label">${escapeHtml(s.name)}</span>
      `;
      const marker = L.marker([s.lat, s.lng], {
        icon: makeIcon(html, 'peek-poi-marker', 36),
        zIndexOffset: 200 + i,
      });
      state._peekLayer.addLayer(marker);
    });
    // ライン
    if (stops.length >= 2) {
      const line = L.polyline(stops.map(s => [s.lat, s.lng]), {
        color: '#6c63ff',
        weight: 4,
        opacity: 0.7,
        dashArray: '8, 6',
      });
      state._peekLayer.addLayer(line);
    }
    // ビューポート合わせ
    const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lng]));
    state.map.fitBounds(bounds, { padding: [40, 40] });
    // フローティングバー表示（覗き中・適用 or 解除ボタン付き）
    showPeekBar(course);
    // 全画面マップに切り替え（パネルを閉じる）
    document.body.classList.add('map-fullscreen');
    const fsBtn = document.getElementById('map-fullscreen-btn');
    if (fsBtn) fsBtn.textContent = '⛔';
    setTimeout(() => state.map.invalidateSize(), 350);
  }
  function clearCoursePeek() {
    if (state._peekLayer) {
      try { state._peekLayer.clearLayers(); } catch {}
    }
    hidePeekBar();
  }
  function showPeekBar(course) {
    let bar = document.getElementById('peek-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'peek-bar';
      bar.className = 'peek-bar';
      document.body.appendChild(bar);
    }
    bar.innerHTML = `
      <span class="peek-bar-label">👁 プレビュー中</span>
      <span class="peek-bar-name">${escapeHtml(tField(course, 'name'))}</span>
      <button class="peek-bar-apply" id="peek-bar-apply" type="button">このコースで行く</button>
      <button class="peek-bar-close" id="peek-bar-close" type="button" aria-label="閉じる">×</button>
    `;
    bar.hidden = false;
    document.getElementById('peek-bar-apply').onclick = () => {
      clearCoursePeek();
      applyRoute(courseToRoute(course));
      showToast(`✨ 「${tField(course, 'name')}」を地図に設定しました`, 'success', 2500);
    };
    document.getElementById('peek-bar-close').onclick = () => {
      clearCoursePeek();
    };
  }
  function hidePeekBar() {
    const bar = document.getElementById('peek-bar');
    if (bar) bar.hidden = true;
  }

  function rerollPlans(type) {
    if (type === 'free') {
      if (gacha.freeUsedToday >= 3) {
        showToast('本日の無料引き直しは終了しました', 'info');
        showStage('empty');
        return;
      }
      gacha.freeUsedToday += 1;
    } else {
      if (gacha.coins < GACHA_COST) {
        showStage('empty');
        return;
      }
      gacha.coins -= GACHA_COST;
    }
    gachaSave();
    gachaUpdateUI();
    playSfx('pop');
  }

  function setupGachaListeners() {
    $('#gacha-btn').addEventListener('click', showGachaModal);
    $('#gacha-close').addEventListener('click', () => {
      $('#gacha-modal').hidden = true;
      state.sessionPullCount = 0; // reset on close
    });
    $('#btn-turn').addEventListener('click', turnGachapon);
    $('#gp-handle').addEventListener('click', turnGachapon);
    $('#shop-btn').addEventListener('click', showShop);
    $('#shop-btn-2').addEventListener('click', showShop);
    $('#back-to-select').addEventListener('click', () => showStage('select'));
    $('#shop-close').addEventListener('click', hideShop);
    $$('.shop-item').forEach(item => {
      item.addEventListener('click', () => {
        const packId = item.dataset.pack;
        if (!packId) return;
        startStripeCheckout(packId);
      });
    });
    // 評価モーダル
    setupRatingListeners();

    // 中断ウォークの自動リカバリ（24時間以内に拡張、賢い再開UI）
    try {
      const raw = localStorage.getItem(ACTIVE_WALK_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const ageMin = (Date.now() - (saved.savedAt || 0)) / 60000;
        // 24時間（1440分）まで再開可能に
        if (ageMin <= 1440 && saved.courseId && !saved.courseId.startsWith('__free_')) {
          const course = (window.YORIMICHI_COURSES || []).find(c => c.id === saved.courseId);
          if (course) {
            setTimeout(() => showWalkResumeModal(course, saved, ageMin), 1500);
          } else {
            clearActiveWalkPersist();
          }
        } else {
          // 24時間超過したら破棄
          clearActiveWalkPersist();
        }
      }
    } catch (e) { console.warn('walk recovery failed', e); }

    // 通知トグル
    const notifyBtn = $('#notify-toggle');
    if (notifyBtn) notifyBtn.addEventListener('click', toggleNotifications);
    updateNotifyUI();
    // 起動時にデイリーリマインダー判定
    try { maybeFireDailyReminder(); } catch {}

    // ミッションUI 初期描画
    try { renderMissions(); } catch {}

    // レコメンド初期描画
    try { renderRecommendationBanner(); } catch {}

    // 天気バナー
    try { renderWeatherBanner(); } catch {}

    // 今日のTip
    try { renderDailyTip(); } catch {}
    try { setupDailyTipButton(); } catch {}
    try { renderFeaturedCard(); } catch {}
    try { renderStatusBar(); } catch {}
    // 📍 GPS取得後に近場コースを推薦（非同期、失敗しても無視）
    setTimeout(() => { renderNearbyBanner().catch(() => {}); }, 1500);

    // Quick Start ボタン
    const quickBtn = $('#quickstart-btn');
    if (quickBtn) quickBtn.addEventListener('click', quickStart);

    // 初回ウェルカムCTA（quickStartと同じ動作）
    const welcomeBtn = $('#welcome-cta');
    if (welcomeBtn) welcomeBtn.addEventListener('click', quickStart);
    try { renderWelcomeCard(); } catch {}

    // 🎓 Step 1: 初回ユーザーへの最初のコーチマーク
    setTimeout(() => {
      if (isFirstRunUser()) {
        const target = $('#welcome-cta')?.offsetParent ? '#welcome-cta' : '#quickstart-btn';
        showCoach({
          target,
          message: '👇 まずはここから！1タップでガチャを引いて散歩を始められます',
          hintKey: 'coach-step1-quickstart',
          arrow: 'up',
          autoDismissMs: 12000,
        });
      }
    }, 2500);

    // モードヘルプ
    const modeHelpBtn = $('#mode-help-btn');
    if (modeHelpBtn) modeHelpBtn.addEventListener('click', () => {
      const helpModal = $('#help-modal');
      if (helpModal) {
        helpModal.hidden = false;
        // 該当アコーディオンを開く
        const item = Array.from(helpModal.querySelectorAll('.faq-item summary')).find(s =>
          s.textContent && s.textContent.includes('既存コース')
        );
        if (item && item.parentElement) item.parentElement.open = true;
      }
    });

    // 🆕 探すタブの巨大ガチャCTA
    const discoverCtaBtn = $('#discover-cta-btn');
    if (discoverCtaBtn) discoverCtaBtn.addEventListener('click', () => {
      try { showGachaModal(); } catch {}
    });
    function updateDiscoverCta() {
      const label = $('#dcta-label');
      const sub = $('#dcta-sub');
      const desc = $('#mode-desc');
      if (!label || !sub) return;
      // CTAラベルは常に「ガチャを引く」で統一、modeによって sub だけ変える
      label.textContent = '🎰 ガチャを引く';
      if (state.mode === 'course') {
        sub.textContent = 'キュレーション済み21本から1本';
        if (desc) desc.textContent = '📖 キュレーション済みコース21本から運命の一本を引く';
      } else if (state.mode === 'route') {
        sub.textContent = '出発地→目的地から AI が動的生成';
        if (desc) desc.textContent = '🎯 出発地と目的地を入れると AI が街歩きコースを動的生成';
      } else if (state.mode === 'stroll') {
        sub.textContent = '出発地から AI が散歩コース生成';
        if (desc) desc.textContent = '🌿 出発地のみ入れて、AIが周辺の散歩コースを生成';
      }
    }
    // 既存の setMode が呼ばれた後に CTA も更新（observer 風）
    const _origSetMode = (typeof setMode === 'function') ? setMode : null;
    if (_origSetMode) {
      window._setMode = _origSetMode; // backup
    }
    // setMode はクロージャ内なので直接書換えは不可。代わりにモード切替後にUI更新するhookは
    // タブクリック時とapp初期化時に呼ぶ
    [$('#tab-course'), $('#tab-route'), $('#tab-stroll')].forEach(t => {
      if (t) t.addEventListener('click', () => setTimeout(updateDiscoverCta, 50));
    });
    updateDiscoverCta();

    // 🆕 メインタブ切替（ホーム / 探す / マイ）
    const MAIN_TAB_KEY = 'yorimichi-main-tab';
    function setMainTab(name) {
      $$('.main-tab').forEach(t => {
        const isActive = t.dataset.mainTab === name;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      $$('.tab-panel').forEach(p => {
        p.hidden = (p.dataset.tabPanel !== name);
      });
      try { localStorage.setItem(MAIN_TAB_KEY, name); } catch {}
      // タブ切替時に該当タブの内容を更新
      if (name === 'home') {
        try { renderWelcomeCard(); } catch {}
        try { renderStreakBadge(); } catch {}
        try { renderFeaturedCard(); } catch {}
        try { renderMissions(); } catch {}
        try { renderStatusBar(); } catch {}
        try { renderRecommendationBanner(); } catch {}
        try { renderWeatherBanner(); } catch {}
      } else if (name === 'me') {
        try { renderMeTab(); } catch {}
      }
    }
    $$('.main-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        vib(8); // 軽いタップフィードバック
        setMainTab(tab.dataset.mainTab);
      });
    });

    // 🚶 常時表示バー: タップで地図にフォーカス（パネルを閉じる）
    const awb = document.getElementById('active-walk-bar');
    if (awb) awb.addEventListener('click', () => {
      vib(15);
      // パネルを最小化してマップ全画面に
      try {
        document.body.classList.add('map-fullscreen');
        const fsBtn = document.getElementById('map-fullscreen-btn');
        if (fsBtn) fsBtn.textContent = '⛔';
        if (state.map) setTimeout(() => state.map.invalidateSize(), 350);
      } catch {}
      // 一時停止中なら overlay を表示
      if (state.activeWalk?.paused) showPauseOverlay();
    });
    // 起動時の初期タブ復元
    try {
      const saved = localStorage.getItem(MAIN_TAB_KEY) || 'home';
      setMainTab(saved);
    } catch { setMainTab('home'); }

    // マイタブのインライン公開シェア
    const meShareBtn = $('#me-share-public');
    if (meShareBtn) meShareBtn.addEventListener('click', async () => {
      meShareBtn.disabled = true;
      const orig = meShareBtn.innerHTML;
      meShareBtn.innerHTML = '<span>⏳</span><span>生成中...</span>';
      const result = await generatePublicProfile();
      meShareBtn.disabled = false;
      meShareBtn.innerHTML = orig;
      if (!result || !result.url) {
        showToast('生成に失敗しました', 'error', 3000);
        return;
      }
      // ネイティブ共有
      const text = `街歩きガチャの実績ページ ✨\n${result.url}\n\n#街歩きガチャ`;
      if (navigator.share) {
        try {
          await navigator.share({ title: '街歩きガチャ実績', text, url: result.url });
        } catch {}
      } else {
        try {
          await navigator.clipboard.writeText(text);
          showToast('📋 リンクをコピーしました', 'success', 3000);
        } catch {}
      }
    });

    // マイタブのショートカット
    $('#ms-profile')?.addEventListener('click', () => showProfile());
    $('#ms-walk-log')?.addEventListener('click', () => {
      renderWalkLog();
      $('#walk-log-modal').hidden = false;
    });
    $('#ms-album')?.addEventListener('click', () => {
      renderPhotoAlbum();
      $('#photo-album-modal').hidden = false;
    });
    $('#ms-collection')?.addEventListener('click', () => showCollection());
    $('#ms-settings')?.addEventListener('click', () => openSettingsModal());
    $('#ms-help')?.addEventListener('click', () => { $('#help-modal').hidden = false; });

    // スクロールトップボタン
    const scrollBtn = $('#scroll-top-btn');
    const panelEl = $('#panel');
    if (scrollBtn && panelEl) {
      const scrollHost = panelEl.querySelector('.panel-inner') || panelEl;
      const checkScroll = () => {
        scrollBtn.hidden = scrollHost.scrollTop < 200;
      };
      scrollHost.addEventListener('scroll', checkScroll, { passive: true });
      // ウィンドウ自体のスクロールも検出（デスクトップ）
      window.addEventListener('scroll', () => {
        scrollBtn.hidden = window.scrollY < 200 && scrollHost.scrollTop < 200;
      }, { passive: true });
      scrollBtn.addEventListener('click', () => {
        scrollHost.scrollTo({ top: 0, behavior: 'smooth' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // ライブアクティビティ
    try { startLiveActivity(); } catch {}

    // Streak Save 検出（連続記録が切れそうな人へ救済オファー）
    try { maybeOfferStreakSave(); } catch {}

    // 所要時間フィルタ
    state.filterDuration = state.filterDuration || 'all';
    $$('.duration-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.duration-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.filterDuration = chip.dataset.duration || 'all';
        if (typeof updateFilterStat === 'function') updateFilterStat();
        if (typeof renderPoolPreview === 'function') renderPoolPreview();
      });
    });

    // テーマチップ（route / stroll モード）
    $$('.theme-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.theme-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeTheme = chip.dataset.theme || '';
      });
    });
    // 初期: 「おまかせ」
    const initialTheme = document.querySelector('.theme-chip[data-theme=""]');
    if (initialTheme) initialTheme.classList.add('active');

    // サブスクボタン
    const subCta = $('#sub-cta');
    if (subCta) subCta.addEventListener('click', startSubscriptionCheckout);
    const subCancel = $('#sub-cancel');
    if (subCancel) subCancel.addEventListener('click', cancelSubscription);
    // ショップを開いたとき毎回最新状態取得
    const shopBtnA = $('#shop-btn');
    if (shopBtnA) shopBtnA.addEventListener('click', () => refreshPremiumStatus().catch(() => {}));
    $('#collection-btn').addEventListener('click', showCollection);
    $('#collection-close').addEventListener('click', () => $('#collection-modal').hidden = true);
    $$('.col-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.col-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        collectionFilter = tab.dataset.rarity;
        renderCollection(collectionFilter);
      });
    });

    // Backdrop click to close + focus trap setup
    $$('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) bd.hidden = true;
      });
    });

    // Escape to close + focus trap on Tab
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        $$('.modal-backdrop').forEach(bd => bd.hidden = true);
        try { clearCoach(); } catch {}
        return;
      }
      if (e.key === 'Tab') {
        const visibleModal = $$('.modal-backdrop').find(bd => !bd.hidden);
        if (!visibleModal) return;
        const focusable = visibleModal.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      // Keyboard shortcuts (when no modal open and no input focused)
      const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      const anyModalOpen = $$('.modal-backdrop').some(b => !b.hidden);
      if (!isInput && !anyModalOpen) {
        if (e.key === 'g' || e.key === 'G') { e.preventDefault(); showGachaModal(); }
        else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); showCollection(); }
        else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); showProfile(); }
      }
    });

    // Auto-focus first interactive element when a modal opens
    const observer = new MutationObserver(() => {
      $$('.modal-backdrop').forEach(bd => {
        if (!bd.hidden && !bd._focused) {
          const first = bd.querySelector('button:not([disabled]), input:not([disabled])');
          if (first) {
            setTimeout(() => first.focus(), 50);
            bd._focused = true;
          }
        } else if (bd.hidden) {
          bd._focused = false;
        }
      });
    });
    $$('.modal-backdrop').forEach(bd => observer.observe(bd, { attributes: true, attributeFilter: ['hidden'] }));
  }

  // ============================================================
  // Profile, Level, Badges
  // ============================================================
  const LEVELS = [
    { lv: 1,  xp: 0,    title: '散歩はじめ',     emoji: '🥚' },
    { lv: 2,  xp: 10,   title: '街歩きキッズ',   emoji: '🐣' },
    { lv: 3,  xp: 25,   title: '探検ジュニア',   emoji: '🐤' },
    { lv: 4,  xp: 50,   title: '寄り道アマチュア', emoji: '🚶' },
    { lv: 5,  xp: 80,   title: '路地裏フリーク', emoji: '🏃' },
    { lv: 6,  xp: 120,  title: '散歩ツウ',       emoji: '🧭' },
    { lv: 7,  xp: 170,  title: '街道マスター',   emoji: '🌟' },
    { lv: 8,  xp: 230,  title: '寄り道伝説',     emoji: '✨' },
    { lv: 9,  xp: 300,  title: '街の生き字引',   emoji: '📜' },
    { lv: 10, xp: 400,  title: '寄り道仙人',     emoji: '🧙' },
  ];

  const BADGES = [
    { id: 'first_pull', name: '初ガチャ',      icon: '🎰', desc: 'はじめての1回',   check: () => gacha.pulls >= 1 },
    { id: 'discover_3', name: '発見者',        icon: '🔍', desc: '3コース発見',      check: () => state.discoveredCourses.size >= 3 },
    { id: 'discover_all', name: 'コンプリート', icon: '📖', desc: '全コース発見',     check: () => state.discoveredCourses.size >= (window.YORIMICHI_COURSES || []).length },
    { id: 'finish_1',   name: '初完走',        icon: '🏅', desc: '1コース完走',     check: () => state.completedCourses.size >= 1 },
    { id: 'finish_5',   name: '散歩マイスター', icon: '🥇', desc: '5コース完走',     check: () => state.completedCourses.size >= 5 },
    { id: 'streak_3',   name: '三日坊主突破',   icon: '🔥', desc: '3日連続ログイン', check: () => state.loginStreak >= 3 },
    { id: 'streak_7',   name: '一週間皆勤',    icon: '🌟', desc: '7日連続ログイン', check: () => state.loginStreak >= 7 },
    { id: 'legendary',  name: '伝説の引き手',  icon: '✨', desc: 'LRコースを発見',   check: () => [...state.discoveredCourses].some(id => {
      const c = (window.YORIMICHI_COURSES || []).find(x => x.id === id);
      return c && c.rarity === 'legendary';
    }) },
    { id: 'pull_10',    name: 'ガチャ中毒',    icon: '🎲', desc: 'ガチャ10回',      check: () => gacha.pulls >= 10 },
  ];

  // ============================================================
  // Data export/import/reset
  // ============================================================
  const DATA_KEYS = [
    'yorimichi-gacha', 'yorimichi-discovered', 'yorimichi-completed',
    'yorimichi-completed-stops', 'yorimichi-walk-counts', 'yorimichi-coin-claimed',
    'yorimichi-streak', 'yorimichi-badges', 'yorimichi-onboarded',
    'yorimichi-gps-explained', 'yorimichi-mapstyle', 'yorimichi-theme',
    'yorimichi-voice', 'yorimichi-lang',
  ];

  async function exportData() {
    const dump = {};
    DATA_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) dump[k] = v;
    });
    dump._exportedAt = new Date().toISOString();
    dump._version = 1;
    const text = JSON.stringify(dump, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      showToast('📤 データをクリップボードにコピーしました', 'success', 3000);
    } catch (e) {
      // Fallback: open in new window
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `yorimichi-data-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('📤 ダウンロードしました', 'success', 3000);
    }
  }

  function importData() {
    const json = prompt('インポートするJSONを貼り付けてください:');
    if (!json) return;
    try {
      const data = JSON.parse(json);
      if (!data._version) throw new Error('Invalid format');
      Object.entries(data).forEach(([k, v]) => {
        if (k.startsWith('_')) return;
        if (DATA_KEYS.includes(k)) localStorage.setItem(k, v);
      });
      showToast('📥 インポート完了。リロードします', 'success', 2000);
      setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      showToast('❌ JSONが不正です', 'error', 3000);
    }
  }

  function resetData() {
    if (!confirm('すべてのデータ（コレクション・コイン・連続日数など）をリセットします。よろしいですか？')) return;
    if (!confirm('本当によろしいですか？この操作は取り消せません。')) return;
    DATA_KEYS.forEach(k => localStorage.removeItem(k));
    showToast('🗑 リセット完了。リロードします', 'success', 2000);
    setTimeout(() => window.location.reload(), 2000);
  }

  // Track earned badges to detect new ones
  let lastEarnedBadges = new Set();
  function loadEarnedBadges() {
    try {
      const arr = JSON.parse(localStorage.getItem('yorimichi-badges') || '[]');
      lastEarnedBadges = new Set(arr);
    } catch (e) {}
  }
  function saveEarnedBadges() {
    try { localStorage.setItem('yorimichi-badges', JSON.stringify([...lastEarnedBadges])); } catch (e) {}
  }
  function checkNewBadges() {
    const newly = [];
    BADGES.forEach(b => {
      if (b.check() && !lastEarnedBadges.has(b.id)) {
        lastEarnedBadges.add(b.id);
        newly.push(b);
      }
    });
    if (newly.length > 0) {
      saveEarnedBadges();
      // Show first one immediately, queue others
      showTrophy(newly[0]);
      for (let i = 1; i < newly.length; i++) {
        setTimeout(() => showTrophy(newly[i]), i * 3500);
      }
    }
  }
  function showTrophy(badge) {
    const burst = $('#trophy-burst');
    $('#trophy-icon').textContent = badge.icon;
    $('#trophy-name').textContent = badge.name;
    $('#trophy-desc').textContent = badge.desc;
    burst.hidden = false;
    fireConfetti(80, ['#ffd700', '#ff9800', '#16a34a', '#2563eb']);
    speak(`称号獲得！${badge.name}！`);
    setTimeout(() => { burst.hidden = true; }, 3000);
  }

  function computeXP() {
    let xp = 0;
    xp += gacha.pulls * 1;                          // 1 per pull
    xp += state.discoveredCourses.size * 3;          // 3 per discovery
    xp += state.completedCourses.size * 8;           // 8 per completion
    xp += Math.min(state.loginStreak, 30) * 1;       // 1 per streak day
    return xp;
  }

  function computeLevel(xp) {
    let cur = LEVELS[0];
    for (const l of LEVELS) {
      if (xp >= l.xp) cur = l;
      else break;
    }
    const next = LEVELS.find(l => l.lv === cur.lv + 1) || cur;
    return { current: cur, next, progress: next === cur ? 1 : (xp - cur.xp) / (next.xp - cur.xp) };
  }

  function updateProfileButton() {
    const xp = computeXP();
    const { current } = computeLevel(xp);
    const btn = $('#profile-btn');
    if (!btn) return;
    $('#profile-level-emoji').textContent = current.emoji;
    $('#profile-lv').textContent = `Lv.${current.lv}`;
  }

  // Pseudo percentile (using XP curve to estimate)
  function computeRank(xp) {
    // Imaginary distribution: most users have low XP, few have high
    if (xp >= 300) return { pct: 1, label: 'トップ1%', emoji: '👑' };
    if (xp >= 200) return { pct: 5, label: '上位5%', emoji: '✨' };
    if (xp >= 120) return { pct: 10, label: '上位10%', emoji: '🌟' };
    if (xp >= 60)  return { pct: 25, label: '上位25%', emoji: '⭐' };
    if (xp >= 30)  return { pct: 50, label: '上位50%', emoji: '🥈' };
    if (xp >= 10)  return { pct: 75, label: '上位75%', emoji: '🥉' };
    return { pct: 100, label: 'スタートライン', emoji: '🌱' };
  }

  function showProfile() {
    $('#profile-modal').hidden = false;
    try { renderLifetimeStats(); } catch {}
    const xp = computeXP();
    const { current, next, progress } = computeLevel(xp);
    const rank = computeRank(xp);
    $('#profile-avatar').textContent = current.emoji;
    $('#profile-title').textContent = current.title + ' ' + rank.emoji;
    $('#profile-lv-label').textContent = `Lv.${current.lv} · ${rank.label}`;
    $('#profile-lv-fill').style.width = (progress * 100) + '%';
    $('#profile-lv-xp').textContent = next === current
      ? `MAX (${xp} XP)`
      : `${xp - current.xp} / ${next.xp - current.xp} XP`;

    $('#ps-courses').textContent = state.completedCourses.size;
    $('#ps-stamps').textContent = Object.values(state.completedStops).reduce((a, s) => a + s.size, 0);
    $('#ps-pulls').textContent = gacha.pulls;
    $('#ps-streak').textContent = state.loginStreak;

    // Cumulative distance / time
    let totalKm = 0;
    let totalMin = 0;
    (state.walkHistory || []).forEach(h => {
      const c = (window.YORIMICHI_COURSES || []).find(x => x.id === h.courseId);
      if (c) {
        totalMin += c.estimatedMin || 60;
        // Approximate distance from stops count
        totalKm += (c.stops?.length || 0) * 0.5; // ~500m per stop
      }
    });
    const cumStat = $('#profile-cum');
    if (cumStat) {
      cumStat.innerHTML = `📏 累計 <strong>${totalKm.toFixed(1)}</strong>km ・ ⏱ 累計 <strong>${Math.round(totalMin / 60)}</strong>時間 ${totalMin % 60}分`;
    }

    // Weekly activity graph (4 weeks)
    const graph = $('#profile-graph');
    if (graph) {
      graph.innerHTML = '';
      const today = new Date(getResetDate() + 'T00:00:00');
      const dayCounts = {};
      (state.walkHistory || []).forEach(h => {
        dayCounts[h.date] = (dayCounts[h.date] || 0) + 1;
      });
      for (let i = 27; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const count = dayCounts[dateStr] || 0;
        const lvl = count >= 3 ? 4 : count >= 2 ? 3 : count >= 1 ? 2 : 0;
        const div = document.createElement('div');
        div.className = 'pg-day' + (lvl ? ` lvl-${lvl}` : '') + (i === 0 ? ' today' : '');
        div.title = `${dateStr}：${count}コース完走`;
        graph.appendChild(div);
      }
    }

    const badgesEl = $('#profile-badges');
    badgesEl.innerHTML = '';
    BADGES.forEach(b => {
      const earned = b.check();
      const card = document.createElement('div');
      card.className = 'badge-card ' + (earned ? 'earned' : 'locked');
      card.innerHTML = `
        <span class="badge-icon">${earned ? b.icon : '❓'}</span>
        <span class="badge-name">${escapeHtml(b.name)}</span>
        <span class="badge-desc">${escapeHtml(b.desc)}</span>
      `;
      badgesEl.appendChild(card);
    });
  }

  // ============================================================
  // Daily login bonus
  // ============================================================
  // 1ガチャ=3コイン に合わせて再設計（連数で報酬感を表示）
  const STREAK_REWARDS = [
    { day: 2,  coins: 3,   msg: '2日目！🪙3（1連分）ゲット' },
    { day: 3,  coins: 6,   msg: '三日坊主突破！🪙6（2連分）' },
    { day: 5,  coins: 15,  msg: '5日連続！🪙15（5連分）' },
    { day: 7,  coins: 30,  msg: '一週間皆勤！🪙30（10連分）＋限定LR解禁の可能性' },
    { day: 14, coins: 60,  msg: '半月達成！🪙60（20連分）' },
    { day: 30, coins: 180, msg: '1か月皆勤！🪙180（60連分）の大盤振る舞い' },
  ];

  function maybeShowDailyBonus() {
    const today = getResetDate();
    if (state.coinClaimedDate === today) return; // already claimed
    if (state.loginStreak < 1) return;
    // Find biggest reward applicable
    let reward = null;
    for (const r of STREAK_REWARDS) {
      if (state.loginStreak === r.day) { reward = r; break; }
    }
    // Default small reward for any return visit on 2+ day
    if (!reward && state.loginStreak >= 2) reward = { day: state.loginStreak, coins: 3, msg: `連続${state.loginStreak}日目！🪙3（1連分）` };
    if (!reward) {
      // Day 1 - just claim with no popup
      state.coinClaimedDate = today;
      try { localStorage.setItem('yorimichi-coin-claimed', today); } catch (e) {}
      return;
    }

    $('#daily-bonus-modal').hidden = false;
    $('#daily-bonus-title').textContent = reward.msg;
    $('#daily-bonus-text').textContent = `連続ログイン ${state.loginStreak} 日目です。受け取って今日も寄り道しよう！`;

    // Calendar (last 7 days)
    const cal = $('#streak-calendar');
    cal.innerHTML = '';
    const days = ['月', '火', '水', '木', '金', '土', '日'];
    for (let i = 6; i >= 0; i--) {
      const dayOffset = i;
      const div = document.createElement('div');
      const isToday = dayOffset === 0;
      const isCompleted = dayOffset < state.loginStreak;
      div.className = 'streak-day' + (isCompleted ? ' completed' : '') + (isToday ? ' today' : '');
      div.textContent = isCompleted || isToday ? '🪙' : '·';
      cal.appendChild(div);
    }

    $('#daily-bonus-claim').onclick = () => {
      gacha.coins += reward.coins;
      gachaSave();
      gachaUpdateUI();
      state.coinClaimedDate = today;
      try { localStorage.setItem('yorimichi-coin-claimed', today); } catch (e) {}
      $('#daily-bonus-modal').hidden = true;
      fireConfetti(60, ['#ffd700', '#ff9800']);
      showToast(`🪙 ${reward.coins}コインを受け取りました！`, 'success', 3000);
    };
  }

  // ============================================================
  // Resume banner (incomplete walk from last session)
  // ============================================================
  function checkResumableWalk() {
    for (const [courseId, visited] of Object.entries(state.completedStops)) {
      if (visited.size === 0) continue;
      const course = (window.YORIMICHI_COURSES || []).find(c => c.id === courseId);
      if (!course) continue;
      if (visited.size >= course.stops.length) continue;
      // Calculate remaining stops
      const remaining = course.stops.length - visited.size;
      const banner = $('#resume-banner');
      banner.hidden = false;
      const courseName = tField(course, 'name');
      $('#resume-meta').textContent = `${courseName} ・ あと ${remaining} スポットで完走`;
      $('#resume-btn').onclick = () => {
        banner.hidden = true;
        applyRoute(courseToRoute(course));
        setTimeout(() => startWalk(), 800);
      };
      $('#resume-dismiss').onclick = () => {
        banner.hidden = true;
        state.completedStops[courseId] = new Set();
        saveCompletion();
      };
      break;
    }
  }

  // ============================================================
  // Today's recommendation (deterministic by date)
  // ============================================================
  function dateSeed() {
    const d = getResetDate();
    let h = 0;
    for (let i = 0; i < d.length; i++) h = ((h << 5) - h + d.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function getTodaysCourse() {
    const all = (window.YORIMICHI_COURSES || []).filter(c => {
      const area = (window.YORIMICHI_AREAS || []).find(a => a.id === c.area);
      return area && area.enabled;
    });
    if (all.length === 0) return null;
    return all[dateSeed() % all.length];
  }

  function renderHomeStats() {
    const hs = $('#home-stats');
    if (!hs) return;
    if (state.mode !== 'course') { hs.hidden = true; return; }
    const completed = state.completedCourses.size;
    const discovered = state.discoveredCourses.size;
    const stamps = Object.values(state.completedStops).reduce((a, s) => a + s.size, 0);
    const totalCompletions = Object.values(state.walkCounts || {}).reduce((a, n) => a + n, 0);
    if (totalCompletions === 0 && discovered === 0 && state.loginStreak <= 1) {
      hs.hidden = true; return;
    }
    hs.hidden = false;
    $('#hs-completed').textContent = totalCompletions;
    $('#hs-stamps').textContent = stamps + totalCompletions * 4; // approx historical
    $('#hs-discovered').textContent = discovered;
    $('#hs-streak').textContent = state.loginStreak;
  }

  function renderTodaysPick() {
    const card = $('#today-pick');
    if (state.mode !== 'course') {
      card.hidden = true;
      return;
    }
    const today = getTodaysCourse();
    if (!today) { card.hidden = true; return; }
    card.hidden = false;
    $('#today-emoji').textContent = today.themeIcon || today.areaIcon || '🌳';
    $('#today-title').textContent = tField(today, 'name');
    $('#today-meta').textContent = `${today.areaIcon} ${tField(today, 'areaName')} ・ 約${today.estimatedMin}分 ・ ${today.stops.length}スポット`;
    $('#today-streak').textContent = state.loginStreak >= 2 ? `🔥 連続${state.loginStreak}日目` : '';
    $('#today-card').onclick = () => {
      // Apply directly + reveal as discovery
      state.discoveredCourses.add(today.id);
      try { localStorage.setItem('yorimichi-discovered', JSON.stringify([...state.discoveredCourses])); } catch (e) {}
      const route = courseToRoute(today);
      revealRouteFromTodayCard(route);
    };
  }

  function revealRouteFromTodayCard(route) {
    // Open gacha modal directly to result stage
    $('#gacha-modal').hidden = false;
    state.currentPlans = [route, route, route]; // placeholder so back-to-capsules works
    revealRoute(route);
  }

  // ============================================================
  // Onboarding
  // ============================================================
  function maybeShowOnboarding() {
    let seen = false;
    try { seen = localStorage.getItem('yorimichi-onboarded') === '1'; } catch (e) {}
    if (seen) return;
    $('#onboard-modal').hidden = false;
    setOnboardStep(1);
  }
  function setOnboardStep(n) {
    [1, 2, 3, 4].forEach(i => {
      const s = $(`#onboard-step-${i}`);
      if (s) s.hidden = (i !== n);
    });
  }
  function setupOnboardListeners() {
    $$('.onboard-next').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = parseInt(btn.dataset.next, 10);
        setOnboardStep(next);
      });
    });
    const finish = $('.onboard-finish');
    if (finish) finish.addEventListener('click', () => {
      try { localStorage.setItem('yorimichi-onboarded', '1'); } catch (e) {}
      $('#onboard-modal').hidden = true;
      // Open gacha
      showGachaModal();
    });
    $('#onboard-close').addEventListener('click', () => {
      try { localStorage.setItem('yorimichi-onboarded', '1'); } catch (e) {}
      $('#onboard-modal').hidden = true;
    });
  }

  // ============================================================
  // Walking session (GPS check-in)
  // ============================================================
  function startWalk() {
    if (!state.selected.length) {
      showToast('先にコースを設定してください', 'error');
      return;
    }
    // First time: show GPS explainer
    let seen = false;
    try { seen = localStorage.getItem('yorimichi-gps-explained') === '1'; } catch (e) {}
    if (!seen) {
      $('#gps-explain').hidden = false;
      return;
    }
    beginWalk(true);
  }

  function beginWalk(useGps) {
    let courseId = null;
    for (const c of (window.YORIMICHI_COURSES || [])) {
      if (state.selected[0].id && state.selected[0].id.startsWith(c.id + '_')) {
        courseId = c.id;
        break;
      }
    }
    if (!courseId) courseId = '__free_' + Date.now();

    state.activeWalk = {
      courseId,
      stopsTotal: state.selected.length,
      gpsWatchId: null,
      paused: false,
      startedAt: Date.now(),
      lastTouchedAt: Date.now(),
    };
    persistActiveWalk();

    if (!state.completedStops[courseId]) {
      state.completedStops[courseId] = new Set();
    }

    $('#walk-session').hidden = false;
    $('#walk-start').hidden = true;
    $('#walk-stop').hidden = false;

    updateWalkUI();

    if (useGps && navigator.geolocation) {
      state.activeWalk.gpsWatchId = navigator.geolocation.watchPosition(
        onGpsUpdate,
        (err) => {
          console.warn('GPS error', err);
          showToast('GPSがエラーです。手動チェックインで遊べます', 'info', 4000);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      );
      showToast('🚶 ウォーク開始！スポットに近づくとスタンプGET', 'success', 3500);
    } else {
      showToast('🚶 手動モードでウォーク開始！各スポットの ✓ ボタンでチェックイン', 'info', 5000);
    }

    // モバイル用 Walk HUD を表示
    showWalkHud();

    // 🎓 Step 4: 散歩開始時に大きなトースト＋HUDボタン解説
    if (isFirstRunUser() && !isCoachSeen('coach-step4-walk-start-hint')) {
      markCoachSeen('coach-step4-walk-start-hint');
      setTimeout(() => {
        showToast('💡 50m以内に近づくと自動でスタンプGET。HUDの📸で写真、📤でシェア', 'success', 7000);
      }, 1500);
      // HUDの初回ハイライト
      setTimeout(() => {
        const hud = $('#walk-hud');
        if (hud && !hud.hidden) {
          showCoach({
            target: '#walk-hud-photo',
            message: '📸 各スポットで1枚撮ろう！完走証明書に組み込まれます',
            hintKey: 'coach-step4-photo-hint',
            arrow: 'down',
            autoDismissMs: 10000,
          });
        }
      }, 8500);
    }

    // 経過時間を1秒ごとにticking
    if (state.activeWalk._tickTimer) clearInterval(state.activeWalk._tickTimer);
    state.activeWalk._tickTimer = setInterval(() => {
      if (!state.activeWalk) return;
      const el = $('#walk-hud-elapsed');
      if (el && state.activeWalk.startedAt) {
        const elapsed = Math.floor((Date.now() - state.activeWalk.startedAt) / 1000);
        const mm = Math.floor(elapsed / 60);
        const ss = elapsed % 60;
        el.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
      }
    }, 1000);

    // 歩数計（モバイルのみ・iOS は権限要求）
    startStepCounter().then(ok => {
      const stepEl = $('#walk-hud-steps');
      if (stepEl && ok) stepEl.hidden = false;
    });
    // Welcome voice
    const first = state.selected[0];
    if (first) speak(`ウォーク開始！最初のスポット、${first.name}を目指しましょう`);
  }

  function stopWalk() {
    if (state.activeWalk && state.activeWalk.gpsWatchId != null) {
      navigator.geolocation.clearWatch(state.activeWalk.gpsWatchId);
    }
    if (state.activeWalk && state.activeWalk._tickTimer) {
      clearInterval(state.activeWalk._tickTimer);
      state.activeWalk._tickTimer = null;
    }
    // 累計ウォーク時間を加算
    if (state.activeWalk && state.activeWalk.startedAt) {
      const minutes = Math.round((Date.now() - state.activeWalk.startedAt) / 60000);
      try {
        const total = parseInt(localStorage.getItem('yorimichi-total-walk-min') || '0', 10) || 0;
        localStorage.setItem('yorimichi-total-walk-min', String(total + Math.max(0, minutes)));
      } catch {}
    }
    state.activeWalk = null;
    clearActiveWalkPersist();
    if (state.userMarker) { state.userMarker.remove(); state.userMarker = null; }
    $('#walk-session').hidden = true;
    $('#walk-start').hidden = false;
    $('#walk-stop').hidden = true;
    hideWalkHud();
    stopStepCounter();
    renderSelectedMarkers();
    showToast('ウォーク終了', 'info');
  }

  // ===== Walk pause/resume + persistence =====
  const ACTIVE_WALK_KEY = 'yorimichi-active-walk';

  function persistActiveWalk() {
    if (!state.activeWalk) return;
    try {
      localStorage.setItem(ACTIVE_WALK_KEY, JSON.stringify({
        courseId: state.activeWalk.courseId,
        stopsTotal: state.activeWalk.stopsTotal,
        paused: !!state.activeWalk.paused,
        startedAt: state.activeWalk.startedAt,
        savedAt: Date.now(),
      }));
    } catch {}
  }
  function clearActiveWalkPersist() {
    try { localStorage.removeItem(ACTIVE_WALK_KEY); } catch {}
  }

  // 🔁 中断ウォークの再開モーダル（進捗・残り・誘い文句付き）
  function showWalkResumeModal(course, saved, ageMin) {
    const visited = state.completedStops[course.id] || new Set();
    const total = course.stops.length;
    const done = visited.size;
    const remaining = total - done;
    const ageLabel = ageMin < 60 ? `${Math.round(ageMin)}分前` :
                     ageMin < 24 * 60 ? `${Math.floor(ageMin / 60)}時間前` :
                     `${Math.floor(ageMin / (60 * 24))}日前`;
    // 誘い文句: 残り数で変化
    let pitch = '続きを歩きませんか？';
    if (remaining === 0) pitch = '🎉 全スポット訪問済！完走モーダルを再表示します';
    else if (remaining === 1) pitch = '🌟 あと1スポットで完走です！';
    else if (remaining <= 2) pitch = `🔥 あと${remaining}スポットで完走！`;
    else pitch = `${done}/${total}スポット訪問済 ・ あと${remaining}スポット`;

    const overlay = document.createElement('div');
    overlay.className = 'walk-resume-overlay';
    overlay.innerHTML = `
      <div class="walk-resume-card">
        <div class="walk-resume-header">
          <span class="walk-resume-emoji">${escapeHtml(course.themeIcon || course.areaIcon || '🚶')}</span>
          <div>
            <div class="walk-resume-label">${ageLabel}に中断したウォーク</div>
            <div class="walk-resume-title">${escapeHtml(tField(course, 'name'))}</div>
          </div>
        </div>
        <div class="walk-resume-pitch">${pitch}</div>
        <div class="walk-resume-progress">
          <div class="walk-resume-progress-track"><div class="walk-resume-progress-fill" style="width:${total > 0 ? Math.round((done / total) * 100) : 0}%"></div></div>
          <div class="walk-resume-progress-text">${done}/${total}</div>
        </div>
        <div class="walk-resume-actions">
          <button class="walk-resume-cancel" type="button">あとで</button>
          <button class="walk-resume-go" type="button">${remaining === 0 ? '完走証を見る' : '▶ 続きを歩く'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.walk-resume-cancel').addEventListener('click', () => {
      overlay.remove();
      // localStorage は残しておく：次回も提案するため
    });
    overlay.querySelector('.walk-resume-go').addEventListener('click', () => {
      overlay.remove();
      vib(20);
      if (remaining === 0) {
        // 既に完走済（もう完走モーダルが出てたケース）→ 完走証を再表示
        showCertificate(course);
        clearActiveWalkPersist();
      } else {
        applyRoute(courseToRoute(course));
        setTimeout(() => startWalk(), 600);
      }
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  function showPauseOverlay() {
    let ov = document.getElementById('walk-pause-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'walk-pause-overlay';
      ov.className = 'walk-pause-overlay';
      ov.innerHTML = `
        <div class="wpo-icon">⏸</div>
        <div class="wpo-title">ウォーク一時停止中</div>
        <div class="wpo-sub">経過時間とGPSトラッキングを停止しています</div>
        <button class="wpo-resume" id="wpo-resume" type="button">▶ 再開する</button>
      `;
      document.body.appendChild(ov);
      ov.querySelector('#wpo-resume').addEventListener('click', () => {
        resumeWalk();
      });
      // 背景タップでも再開
      ov.addEventListener('click', (e) => {
        if (e.target === ov) resumeWalk();
      });
    }
    ov.hidden = false;
  }
  function hidePauseOverlay() {
    const ov = document.getElementById('walk-pause-overlay');
    if (ov) ov.hidden = true;
  }
  function pauseWalk() {
    if (!state.activeWalk || state.activeWalk.paused) return;
    state.activeWalk.paused = true;
    if (state.activeWalk.gpsWatchId != null) {
      try { navigator.geolocation.clearWatch(state.activeWalk.gpsWatchId); } catch {}
      state.activeWalk.gpsWatchId = null;
    }
    persistActiveWalk();
    const btn = $('#walk-hud-pause');
    if (btn) btn.textContent = '▶';
    vib(40);
    showPauseOverlay();
  }
  function resumeWalk() {
    if (!state.activeWalk || !state.activeWalk.paused) return;
    state.activeWalk.paused = false;
    if (navigator.geolocation) {
      state.activeWalk.gpsWatchId = navigator.geolocation.watchPosition(
        onGpsUpdate,
        (err) => console.warn('GPS error', err),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      );
    }
    persistActiveWalk();
    const btn = $('#walk-hud-pause');
    if (btn) btn.textContent = '⏸';
    vib(20);
    hidePauseOverlay();
    showToast('▶ ウォークを再開しました', 'success', 2200);
  }
  function togglePauseWalk() {
    if (!state.activeWalk) return;
    if (state.activeWalk.paused) resumeWalk();
    else pauseWalk();
  }

  // ===== Step counter (DeviceMotion API) =====
  // 加速度センサで歩数を概算。完璧な歩数計ではないが「歩いてる感」UI に十分
  const _stepCounter = {
    enabled: false,
    count: 0,
    lastPeakTime: 0,
    lastMag: 0,
    threshold: 1.2, // 重力加速度との差
  };

  function _onDeviceMotion(e) {
    if (!_stepCounter.enabled) return;
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a) return;
    const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
    const now = performance.now();
    // 単純なピーク検出（0.3秒以上の間隔・閾値超え）
    if (mag - _stepCounter.lastMag > _stepCounter.threshold &&
        now - _stepCounter.lastPeakTime > 300) {
      _stepCounter.count += 1;
      _stepCounter.lastPeakTime = now;
      // HUDに反映
      const stepEl = $('#walk-hud-steps');
      if (stepEl) stepEl.textContent = `👣 ${_stepCounter.count}歩`;
    }
    _stepCounter.lastMag = mag;
  }

  async function startStepCounter() {
    if (!('DeviceMotionEvent' in window)) return false;
    // iOS 13+ は requestPermission が必要
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceMotionEvent.requestPermission();
        if (perm !== 'granted') return false;
      } catch { return false; }
    }
    _stepCounter.enabled = true;
    _stepCounter.count = 0;
    window.addEventListener('devicemotion', _onDeviceMotion, { passive: true });
    return true;
  }

  function stopStepCounter() {
    _stepCounter.enabled = false;
    window.removeEventListener('devicemotion', _onDeviceMotion);
    if (_stepCounter.count > 0) {
      try {
        const total = parseInt(localStorage.getItem('yorimichi-total-steps') || '0', 10) || 0;
        localStorage.setItem('yorimichi-total-steps', String(total + _stepCounter.count));
      } catch {}
    }
    _stepCounter.count = 0;
  }

  // ===== Voice navigation during walks =====
  // 距離アナウンスの閾値（このメートル数を切ったら一度だけ案内）
  const VOICE_DISTANCE_THRESHOLDS = [500, 200, 100, 50];

  function compass8(bearingDeg) {
    const b = ((bearingDeg % 360) + 360) % 360;
    const labels = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
    const idx = Math.round(b / 45) % 8;
    return labels[idx];
  }

  // AI でスポット紹介ナレーションを生成（軽量・キャッシュ）
  const _spotIntroCache = new Map();
  async function fetchSpotIntro(stopName, areaLabel) {
    if (!stopName) return null;
    if (_spotIntroCache.has(stopName)) return _spotIntroCache.get(stopName);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(`${API_BASE}/api/generate-narrative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: 'スポット紹介',
          area: areaLabel || '',
          rarity: 'r',
          stops: [stopName, '到着案内'],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      // story を 50字程度の音声向け文字列に整形
      const intro = (data?.story || '').slice(0, 80);
      _spotIntroCache.set(stopName, intro);
      return intro;
    } catch { return null; }
  }

  function maybeAnnounceDistance(userLoc, nextStop) {
    if (!state.activeWalk) return;
    if (!voice.enabled) return;
    if (!userLoc || !nextStop || nextStop.lat == null || nextStop.lng == null) return;
    const dM = haversineKm(userLoc, nextStop) * 1000;
    state.activeWalk.voiceState = state.activeWalk.voiceState || { announcedThresholds: new Set(), introPlayed: new Set(), nextStopIdx: -1 };
    const vs = state.activeWalk.voiceState;
    // 次スポット番号が変わったらリセット
    if (vs.nextStopIdx !== nextStop._idx) {
      vs.announcedThresholds = new Set();
      vs.nextStopIdx = nextStop._idx;
    }
    // 50m手前で初めて → AIスポット紹介
    if (dM < 60 && !vs.introPlayed.has(nextStop._idx)) {
      vs.introPlayed.add(nextStop._idx);
      const areaLabel = state.origin?.shortLabel || '';
      fetchSpotIntro(nextStop.name, areaLabel).then(intro => {
        if (intro) speak(`まもなく${nextStop.name}に到着します。${intro}`);
        else speak(`まもなく${nextStop.name}に到着します`);
      });
      return;
    }
    // 距離節目アナウンス
    for (const th of VOICE_DISTANCE_THRESHOLDS) {
      if (dM < th && !vs.announcedThresholds.has(th)) {
        vs.announcedThresholds.add(th);
        const dir = nextStop._bearing != null ? compass8(nextStop._bearing) : null;
        if (th >= 200 && dir) {
          speak(`次のスポット${nextStop.name}まで約${th}メートル。${dir}方向です`);
        } else if (th >= 100) {
          speak(`次のスポットまで約${th}メートル`);
        } else {
          speak(`もうすぐ${nextStop.name}です`);
        }
        break;
      }
    }
  }

  // ===== Coach Mark / Guided Tour =====
  // 初回ユーザーが「次にどのボタンを押すか」迷わないよう、pulse + ヒントバブルで示す。
  // 一度見せたら同じ hintKey は再表示しない。
  const COACH_SEEN_KEY = 'yorimichi-coach-seen';
  let _activeCoachBubble = null;
  let _activeCoachTarget = null;

  function getCoachSeen() {
    try { return JSON.parse(localStorage.getItem(COACH_SEEN_KEY) || '[]'); } catch { return []; }
  }
  function isCoachSeen(key) {
    return getCoachSeen().includes(key);
  }
  function markCoachSeen(key) {
    try {
      const seen = getCoachSeen();
      if (!seen.includes(key)) {
        seen.push(key);
        localStorage.setItem(COACH_SEEN_KEY, JSON.stringify(seen));
      }
    } catch {}
  }
  function resetCoachSeen() {
    try { localStorage.removeItem(COACH_SEEN_KEY); } catch {}
  }

  function clearCoach() {
    if (_activeCoachTarget) {
      _activeCoachTarget.classList.remove('coach-pulse');
      _activeCoachTarget = null;
    }
    if (_activeCoachBubble) {
      _activeCoachBubble.remove();
      _activeCoachBubble = null;
    }
  }

  /**
   * showCoach({ target, message, hintKey, arrow, autoDismissMs })
   * - target: CSS selector or Element
   * - message: 表示文字列
   * - hintKey: localStorage 重複防止キー
   * - arrow: 'up' | 'down' | 'left' | 'right' (バブルから target への矢印方向)
   */
  function showCoach({ target, message, hintKey, arrow = 'up', autoDismissMs = 0 }) {
    if (!hintKey || isCoachSeen(hintKey)) return;
    const el = (typeof target === 'string') ? document.querySelector(target) : target;
    if (!el || el.hidden) return;
    // 前回のコーチをクリーン
    clearCoach();
    markCoachSeen(hintKey);

    el.classList.add('coach-pulse');
    _activeCoachTarget = el;

    const bubble = document.createElement('div');
    bubble.className = `coach-bubble arrow-${arrow}`;
    bubble.innerHTML = `<span>${escapeHtml(message)}</span><button class="coach-bubble-close" aria-label="閉じる">×</button>`;
    document.body.appendChild(bubble);
    _activeCoachBubble = bubble;

    // バブル位置を計算
    const positionBubble = () => {
      const rect = el.getBoundingClientRect();
      const bubW = bubble.offsetWidth || 240;
      const bubH = bubble.offsetHeight || 50;
      let top, left;
      switch (arrow) {
        case 'up': // バブルが下、矢印が上
          top = rect.bottom + 12;
          left = Math.max(8, rect.left + rect.width / 2 - 30);
          break;
        case 'down': // バブルが上、矢印が下
          top = rect.top - bubH - 12;
          left = Math.max(8, rect.left + rect.width / 2 - 30);
          break;
        case 'left':
          top = rect.top + rect.height / 2 - 16;
          left = rect.right + 12;
          break;
        case 'right':
          top = rect.top + rect.height / 2 - 16;
          left = rect.left - bubW - 12;
          break;
        default:
          top = rect.bottom + 12;
          left = rect.left;
      }
      // 画面端で切れないよう調整
      const viewW = window.innerWidth;
      if (left + bubW > viewW - 8) left = viewW - bubW - 8;
      if (left < 8) left = 8;
      bubble.style.top = `${top + window.scrollY}px`;
      bubble.style.left = `${left}px`;
    };
    requestAnimationFrame(positionBubble);

    // 閉じるボタン
    bubble.querySelector('.coach-bubble-close').addEventListener('click', clearCoach);
    // target をクリックしたら自動で閉じる
    const onTargetClick = () => {
      el.removeEventListener('click', onTargetClick);
      clearCoach();
    };
    el.addEventListener('click', onTargetClick, { once: true });
    // 自動消滅
    if (autoDismissMs > 0) {
      setTimeout(() => {
        if (_activeCoachBubble === bubble) clearCoach();
      }, autoDismissMs);
    }
  }

  /** 初回ユーザーかどうか（完走0かつガチャ2回未満） */
  function isFirstRunUser() {
    return state.completedCourses.size === 0 && (gacha.pulls || 0) < 2;
  }

  // ===== Photo capture during walks =====
  // 写真は localStorage（容量制限のため最大解像度640px・JPEG quality 0.7）に保存
  // キー: yorimichi-photos-<courseId> = { stopIdx: dataUrl, ... }
  const PHOTO_MAX_SIZE = 640;
  const PHOTO_QUALITY = 0.72;

  function getCoursePhotos(courseId) {
    if (!courseId) return {};
    try { return JSON.parse(localStorage.getItem('yorimichi-photos-' + courseId) || '{}'); } catch { return {}; }
  }
  function saveCoursePhoto(courseId, stopIdx, dataUrl, description) {
    const all = getCoursePhotos(courseId);
    // 旧フォーマット (string dataUrl) と 新フォーマット ({url, desc}) を両対応
    all[stopIdx] = description ? { url: dataUrl, desc: description } : { url: dataUrl };
    try {
      localStorage.setItem('yorimichi-photos-' + courseId, JSON.stringify(all));
    } catch (e) {
      // QuotaExceeded → 最古の写真を削除して再試行
      const keys = Object.keys(all);
      if (keys.length > 1) {
        delete all[keys[0]];
        try { localStorage.setItem('yorimichi-photos-' + courseId, JSON.stringify(all)); } catch {}
      }
      console.warn('photo save failed', e);
    }
  }
  function _photoUrlOf(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') return entry; // 旧フォーマット
    return entry.url || null;
  }
  function _photoDescOf(entry) {
    if (!entry || typeof entry === 'string') return '';
    return entry.desc || '';
  }

  // Gemini Vision で写真を描写
  async function describePhotoWithAI(dataUrl, stopName, areaName) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000); // 10秒で諦める
      const res = await fetch(`${API_BASE}/api/describe-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: dataUrl,
          stop_name: stopName || '',
          area: areaName || '',
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      const desc = (data?.description || '').trim();
      return desc || null;
    } catch (e) {
      console.warn('describePhotoWithAI failed', e);
      return null;
    }
  }

  function compressImageToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > h && w > PHOTO_MAX_SIZE) { h = h * PHOTO_MAX_SIZE / w; w = PHOTO_MAX_SIZE; }
          else if (h > PHOTO_MAX_SIZE) { w = w * PHOTO_MAX_SIZE / h; h = PHOTO_MAX_SIZE; }
          canvas.width = Math.round(w);
          canvas.height = Math.round(h);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          try { resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY)); } catch (e) { reject(e); }
        };
        img.onerror = reject;
        img.src = ev.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function capturePhotoForCurrentStop() {
    if (!state.activeWalk) {
      showToast('ウォーク中に写真を撮ることができます', 'info', 2500);
      return;
    }
    const courseId = state.activeWalk.courseId;
    const visited = state.completedStops[courseId] || new Set();
    // 直近に訪問したスポット（または未訪問の最初）を対象に
    let targetIdx = -1;
    const visitedArr = [...visited];
    if (visitedArr.length > 0) targetIdx = visitedArr[visitedArr.length - 1];
    else for (let i = 0; i < state.selected.length; i++) {
      if (!visited.has(i)) { targetIdx = i; break; }
    }
    if (targetIdx < 0) {
      showToast('対象スポットが見つかりません', 'info', 2500);
      return;
    }

    const input = $('#walk-photo-input');
    if (!input) return;
    input.value = '';
    input.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        showToast('📸 写真を保存中…', 'info', 1500);
        const dataUrl = await compressImageToDataUrl(file);
        const stopName = state.selected[targetIdx]?.name || 'スポット';
        const areaName = state.origin?.shortLabel || '';
        // 即時保存（AI待たずに）
        saveCoursePhoto(courseId, targetIdx, dataUrl);
        showToast(`✅ ${stopName} で1枚保存しました`, 'success', 2500);
        // ミッション「写真を1枚撮影」
        try { markMissionDone('photo'); } catch {}
        // バックグラウンドで AI 描写を取得・後付けで保存
        describePhotoWithAI(dataUrl, stopName, areaName).then(desc => {
          if (!desc) return;
          saveCoursePhoto(courseId, targetIdx, dataUrl, desc);
          showToast(`✨ AIが描写: ${desc.slice(0, 40)}${desc.length > 40 ? '…' : ''}`, 'info', 4000);
        });
      } catch (err) {
        console.error(err);
        showToast('写真の保存に失敗しました', 'error', 3000);
      }
    };
    input.click();
  }

  // ===== Walk Mode HUD =====
  function showWalkHud() {
    const hud = $('#walk-hud');
    if (!hud) return;
    hud.hidden = false;
    updateWalkHud(null);
    // 「現在地に戻る」ボタンも表示
    const recenter = $('#map-recenter-btn');
    if (recenter) recenter.hidden = false;
    // 常時表示バー
    try { updateActiveWalkBar(); } catch {}
  }

  // 🧭 ヘッドアップ表示（地図を進行方向に回転）
  function applyMapHeading() {
    if (!state._headupEnabled) return;
    const heading = state.activeWalk?._lastHeading;
    if (heading == null || isNaN(heading)) return;
    const mapEl = state.map?.getContainer();
    if (!mapEl) return;
    // tile を逆回転（北を進行方向に向ける = -heading 度回転）
    const tilesPane = mapEl.querySelector('.leaflet-tile-pane');
    const overlayPane = mapEl.querySelector('.leaflet-overlay-pane');
    const markerPane = mapEl.querySelector('.leaflet-marker-pane');
    [tilesPane, overlayPane, markerPane].forEach(p => {
      if (p) p.style.transform = `${p.style.transform.replace(/rotate\([^)]+\)/g, '').trim()} rotate(${-heading}deg)`.trim();
    });
    // マーカーを再度水平に戻す（読みやすさのため）
    if (markerPane) {
      markerPane.querySelectorAll('.leaflet-marker-icon').forEach(m => {
        // 既存 transform から rotate 削除
        const t = m.style.transform || '';
        const cleaned = t.replace(/rotate\([^)]+\)/g, '').trim();
        m.style.transform = `${cleaned} rotate(${heading}deg)`;
      });
    }
  }
  function clearMapHeading() {
    const mapEl = state.map?.getContainer();
    if (!mapEl) return;
    ['leaflet-tile-pane', 'leaflet-overlay-pane', 'leaflet-marker-pane'].forEach(cls => {
      const p = mapEl.querySelector('.' + cls);
      if (p) p.style.transform = p.style.transform.replace(/rotate\([^)]+\)/g, '').trim();
    });
    const markerPane = mapEl.querySelector('.leaflet-marker-pane');
    if (markerPane) {
      markerPane.querySelectorAll('.leaflet-marker-icon').forEach(m => {
        m.style.transform = (m.style.transform || '').replace(/rotate\([^)]+\)/g, '').trim();
      });
    }
  }
  function toggleHeadup() {
    state._headupEnabled = !state._headupEnabled;
    const btn = document.getElementById('walk-hud-headup');
    if (btn) {
      btn.classList.toggle('active', state._headupEnabled);
    }
    if (state._headupEnabled) {
      applyMapHeading();
      showToast('🧭 ヘッドアップ表示ON（進行方向が上）', 'info', 2500);
    } else {
      clearMapHeading();
      showToast('🧭 北固定モードに戻しました', 'info', 2500);
    }
  }
  function hideWalkHud() {
    const hud = $('#walk-hud');
    if (hud) hud.hidden = true;
    const recenter = $('#map-recenter-btn');
    if (recenter) recenter.hidden = true;
    // 終了時は一時停止オーバーレイ + 常時バーも消す + ヘッドアップ解除
    try { hidePauseOverlay(); } catch {}
    try {
      const bar = document.getElementById('active-walk-bar');
      if (bar) bar.hidden = true;
    } catch {}
    if (state._headupEnabled) {
      state._headupEnabled = false;
      try { clearMapHeading(); } catch {}
    }
  }

  // 🚶 アクティブウォークの常時表示バー更新
  function updateActiveWalkBar() {
    const bar = document.getElementById('active-walk-bar');
    if (!bar) return;
    if (!state.activeWalk) { bar.hidden = true; return; }
    const courseId = state.activeWalk.courseId;
    const course = (window.YORIMICHI_COURSES || []).find(c => c.id === courseId);
    const visited = state.completedStops[courseId] || new Set();
    const total = state.activeWalk.stopsTotal || state.selected.length;
    const done = visited.size;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const nameEl = document.getElementById('awb-name');
    const emojiEl = document.getElementById('awb-emoji');
    const progEl = document.getElementById('awb-progress-text');
    const fillEl = document.getElementById('awb-progress-fill');
    if (nameEl) nameEl.textContent = course ? tField(course, 'name') : 'コース';
    if (emojiEl) emojiEl.textContent = state.activeWalk.paused ? '⏸' : (course?.themeIcon || course?.areaIcon || '🚶');
    if (progEl) progEl.textContent = `${done}/${total}`;
    if (fillEl) fillEl.style.width = `${pct}%`;
    bar.hidden = false;
  }
  function updateWalkHud(userLoc) {
    const hud = $('#walk-hud');
    if (!hud || hud.hidden) return;
    if (!state.activeWalk) return;
    const courseId = state.activeWalk.courseId;
    const visited = state.completedStops[courseId] || new Set();
    const totalStops = state.selected.length;
    const visitedCount = visited.size;
    // 次に未訪問のスポットを探す
    let nextIdx = -1;
    for (let i = 0; i < state.selected.length; i++) {
      if (!visited.has(i)) { nextIdx = i; break; }
    }
    if (nextIdx === -1) {
      $('#walk-hud-name').textContent = '🎉 全スポット完走！';
      $('#walk-hud-dist').textContent = '完走おめでとう';
      $('#walk-hud-progress').textContent = `${totalStops}/${totalStops}`;
      $('#walk-hud-arrow').style.opacity = '0.3';
      const progressFill = $('#walk-hud-progress-fill');
      if (progressFill) progressFill.style.width = '100%';
      const etaEl = $('#walk-hud-eta');
      if (etaEl) etaEl.hidden = true;
      return;
    }
    const next = state.selected[nextIdx];
    $('#walk-hud-name').textContent = (next.emoji || '📍') + ' ' + (next.name || '次のスポット');
    $('#walk-hud-progress').textContent = `${visitedCount}/${totalStops}`;
    // 全体進捗バー
    const progressFill = $('#walk-hud-progress-fill');
    if (progressFill && totalStops > 0) {
      const pct = Math.round((visitedCount / totalStops) * 100);
      progressFill.style.width = `${pct}%`;
    }
    if (userLoc && next.lat != null && next.lng != null) {
      const dKm = haversineKm(userLoc, next);
      const dM = Math.round(dKm * 1000);
      $('#walk-hud-dist').textContent = dM >= 1000 ? `${(dM/1000).toFixed(1)} km` : `${dM} m`;
      // 矢印を北基準で次スポット方位へ回転
      const brg = bearing([userLoc.lat, userLoc.lng], [next.lat, next.lng]);
      $('#walk-hud-arrow').style.transform = `rotate(${brg}deg)`;
      $('#walk-hud-arrow').style.opacity = '1';
      // 音声ナビ：次スポットの index と方位を保持して案内
      maybeAnnounceDistance(userLoc, { ...next, _idx: nextIdx, _bearing: brg });
    } else {
      $('#walk-hud-dist').textContent = 'GPS取得中…';
      $('#walk-hud-arrow').style.opacity = '0.5';
    }

    // 累積距離 + 経過時間を更新
    const totalDistEl = $('#walk-hud-totaldist');
    const elapsedEl = $('#walk-hud-elapsed');
    if (state.activeWalk?.startedAt) {
      const elapsed = Math.floor((Date.now() - state.activeWalk.startedAt) / 1000);
      const mm = Math.floor(elapsed / 60);
      const ss = elapsed % 60;
      if (elapsedEl) elapsedEl.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
      const totalKm = state.activeWalk._totalKm || 0;
      if (totalDistEl) {
        if (totalKm > 0.05) {
          totalDistEl.textContent = `📏 ${totalKm.toFixed(2)}km`;
          totalDistEl.hidden = false;
        } else {
          totalDistEl.hidden = true;
        }
      }
    }

    // 残り推定時間: 現在地→次→以降のスポット間距離を合計、徒歩4km/h + 滞在時間を加算
    const etaEl = $('#walk-hud-eta');
    if (etaEl) {
      let remainingKm = 0;
      let prev = userLoc || null;
      const remainingStops = [];
      for (let i = nextIdx; i < state.selected.length; i++) {
        if (visited.has(i)) continue;
        const s = state.selected[i];
        if (prev && s.lat != null && s.lng != null) {
          remainingKm += haversineKm(prev, s);
        }
        prev = s;
        remainingStops.push(s);
      }
      // 徒歩 4km/h
      const walkMin = (remainingKm / 4) * 60;
      // 滞在時間: stayMin があれば使い、なければ 1スポット 5分
      let stayMin = 0;
      remainingStops.forEach(s => {
        stayMin += (typeof s.stayMin === 'number' ? s.stayMin : 5);
      });
      // 最終スポットでは滞在しない想定（少し多めに見積もるので残しておく）
      const totalMin = Math.max(1, Math.round(walkMin + stayMin));
      if (totalMin > 0 && remainingStops.length > 0) {
        etaEl.textContent = totalMin >= 60
          ? `⏱ 残り${Math.floor(totalMin/60)}h${totalMin%60}m`
          : `⏱ 残り約${totalMin}分`;
        etaEl.hidden = false;
      } else {
        etaEl.hidden = true;
      }
    }
  }

  function onGpsUpdate(pos) {
    const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    // 累積距離計算: 直前の位置との距離を足す
    if (state.activeWalk) {
      const aw = state.activeWalk;
      if (aw._lastLoc) {
        const incrementKm = haversineKm(aw._lastLoc, loc);
        // 異常値（>500m / 数秒）は破棄（GPSドリフト対策）
        if (incrementKm < 0.5) {
          aw._totalKm = (aw._totalKm || 0) + incrementKm;
        }
      }
      aw._lastLoc = loc;
      // ヘッドアップ表示の更新（進行方向）
      let heading = pos.coords.heading;
      // 移動が遅すぎる時 heading は NaN になる → 直前の位置との bearing を使う
      if ((heading == null || isNaN(heading)) && aw._lastHeadingLoc) {
        const bearingDeg = bearing([aw._lastHeadingLoc.lat, aw._lastHeadingLoc.lng], [loc.lat, loc.lng]);
        if (!isNaN(bearingDeg)) heading = bearingDeg;
      }
      if (heading != null && !isNaN(heading)) {
        aw._lastHeading = heading;
        applyMapHeading();
      }
      // ヘッドアップ用の前回基準位置（5m毎に更新）
      if (!aw._lastHeadingLoc || haversineKm(aw._lastHeadingLoc, loc) > 0.005) {
        aw._lastHeadingLoc = loc;
      }
    }
    // Update user marker
    if (!state.userMarker) {
      const icon = L.divIcon({
        html: '<div class="user-pulse"></div>',
        className: 'user-loc',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      state.userMarker = L.marker([loc.lat, loc.lng], { icon, zIndexOffset: 1000 }).addTo(state.map);
    } else {
      state.userMarker.setLatLng([loc.lat, loc.lng]);
    }

    // Check stops within 50m
    const courseId = state.activeWalk.courseId;
    const visited = state.completedStops[courseId];
    state.selected.forEach((stop, idx) => {
      if (visited.has(idx)) return;
      const dKm = haversineKm(loc, stop);
      if (dKm * 1000 < 50) {
        checkInStop(idx);
      }
    });

    // モバイルHUD更新
    updateWalkHud(loc);
  }

  // 📝 スポット別メモ（チェックイン時に1行記録）
  function getStopMemos(courseId) {
    if (!courseId) return {};
    try { return JSON.parse(localStorage.getItem('yorimichi-stop-memos-' + courseId) || '{}'); } catch { return {}; }
  }
  function saveStopMemo(courseId, stopIdx, memo) {
    const all = getStopMemos(courseId);
    all[stopIdx] = { memo: String(memo || '').slice(0, 120), at: Date.now() };
    try { localStorage.setItem('yorimichi-stop-memos-' + courseId, JSON.stringify(all)); } catch {}
  }
  function showMemoPrompt(stop, courseId, idx) {
    // 既存があれば編集、なければ新規
    const existing = getStopMemos(courseId)[idx]?.memo || '';
    const overlay = document.createElement('div');
    overlay.className = 'memo-prompt-overlay';
    overlay.innerHTML = `
      <div class="memo-prompt-card">
        <div class="memo-prompt-header">
          <span class="memo-prompt-emoji">${escapeHtml(stop.emoji || '📍')}</span>
          <div class="memo-prompt-title">
            <div>${escapeHtml(stop.name)}</div>
            <div class="memo-prompt-sub">気持ちをひとことメモ（任意・最大120字）</div>
          </div>
        </div>
        <textarea id="memo-prompt-input" class="memo-prompt-input" placeholder="例：抹茶ラテが絶品だった。次は限定スイーツも頼みたい。" maxlength="120">${escapeHtml(existing)}</textarea>
        <div class="memo-prompt-counter"><span id="memo-prompt-count">${existing.length}</span>/120</div>
        <div class="memo-prompt-actions">
          <button class="memo-prompt-skip" type="button">スキップ</button>
          <button class="memo-prompt-save" type="button">💾 保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#memo-prompt-input');
    const counter = overlay.querySelector('#memo-prompt-count');
    input.addEventListener('input', () => { counter.textContent = String(input.value.length); });
    setTimeout(() => input.focus(), 50);
    const close = () => { try { overlay.remove(); } catch {} };
    overlay.querySelector('.memo-prompt-skip').addEventListener('click', close);
    overlay.querySelector('.memo-prompt-save').addEventListener('click', () => {
      const v = input.value.trim();
      if (v) {
        saveStopMemo(courseId, idx, v);
        showToast('📝 メモを保存しました', 'success', 2000);
      }
      close();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  function checkInStop(idx, manual = false) {
    if (!state.activeWalk) return;
    const courseId = state.activeWalk.courseId;
    const visited = state.completedStops[courseId];
    if (visited.has(idx)) return;
    visited.add(idx);
    saveCompletion();
    // ミッション「1スポット完走」
    try { markMissionDone('walk'); } catch {}

    const stop = state.selected[idx];
    showStampBurst(stop);
    fireConfetti(40, ['#ffd700', '#16a34a', '#ff7e3d']);
    playSfx('stamp');
    speak(`${stop.name}に到着しました。スタンプGET。${stop.desc ? stop.desc.slice(0, 50) : ''}`);
    updateWalkUI();
    renderSelectedMarkers();

    // 📝 メモ入力プロンプト（最後のスポット以外、視覚的に邪魔にならない遅延付き）
    setTimeout(() => {
      if (!state.activeWalk) return;
      // 既に完走モーダルが出ていたら出さない
      if (!$('#cert-modal') || !$('#cert-modal').hidden) return;
      showMemoPrompt(stop, courseId, idx);
    }, 1800);

    // Announce next stop
    let nextIdx = -1;
    for (let i = 0; i < state.selected.length; i++) {
      if (!visited.has(i)) { nextIdx = i; break; }
    }
    if (nextIdx >= 0) {
      const next = state.selected[nextIdx];
      const dKm = haversineKm(stop, next);
      const dist = dKm < 1 ? `${Math.round(dKm * 1000)}メートル` : `${dKm.toFixed(1)}キロ`;
      setTimeout(() => speak(`次は${next.name}まで約${dist}です`), 4000);
    }

    if (visited.size >= state.selected.length) {
      finishWalk();
    }
    setTimeout(checkNewBadges, 2200);
  }

  function finishWalk() {
    if (!state.activeWalk) return;
    const courseId = state.activeWalk.courseId;
    state.completedCourses.add(courseId);
    state.walkCounts[courseId] = (state.walkCounts[courseId] || 0) + 1;
    // Record in history
    const today = getResetDate();
    state.walkHistory = state.walkHistory || [];
    state.walkHistory.push({ courseId, date: today, stops: state.activeWalk.stopsTotal, completed: true });
    // Keep only last 90 days
    state.walkHistory = state.walkHistory.slice(-200);
    // Reset progress for re-walk
    state.completedStops[courseId] = new Set();
    saveCompletion();
    fireConfetti(150, ['#ffd700', '#16a34a', '#ff7e3d', '#ec4899', '#3b82f6'], { shapes: ['rect', 'circle'] });
    // 🎉 完走時の触覚フィードバック（祝福パターン）
    vib([100, 60, 100, 60, 100, 60, 300]);
    speak('コース完走、おめでとうございます！');
    // Bonus coins for completion
    gacha.coins += COMPLETION_BONUS;
    gachaSave();
    showToast(`🪙 完走ボーナス +${COMPLETION_BONUS}コイン！`, 'success', 4000);
    // ライブイベント
    try { sendHeartbeat('complete'); } catch {}

    const course = (window.YORIMICHI_COURSES || []).find(c => c.id === courseId);
    setTimeout(() => {
      stopWalk();
      if (course) showCertificate(course);
      else showToast('🏅 完走おめでとう！', 'success', 4000);
      checkNewBadges();
      // 評価モーダルを少し遅らせて出す（証明書を見終えた頃）
      if (course) setTimeout(() => showRatingModal(course), 6000);
      // 明日のリマインダー提案（通知許可があれば）
      if (course) setTimeout(() => maybeOfferTomorrowReminder(), 9000);
      // 完走後 7秒でマイタブのバッジ進捗をハイライトしたいユーザーへ示唆
      setTimeout(() => {
        const meTab = document.querySelector('.main-tab[data-main-tab="me"]');
        if (meTab && !meTab.classList.contains('me-pulse')) {
          meTab.classList.add('me-pulse');
          setTimeout(() => meTab.classList.remove('me-pulse'), 4500);
        }
      }, 7000);
    }, 1500);
  }

  function showCompletionCelebration(total) {
    const burst = document.createElement('div');
    burst.className = 'completion-burst';
    burst.innerHTML = `
      <div class="cb-content">
        <div class="cb-icon">🏆</div>
        <div class="cb-label">全コース発見コンプリート！</div>
        <div class="cb-count">${total} / ${total}</div>
        <div class="cb-msg">あなたは正真正銘の散歩マスター。<br>新エリア追加時に最速通知します。</div>
        <button class="cb-close">続ける</button>
      </div>
    `;
    document.body.appendChild(burst);
    fireConfetti(300, 'legendary', { shapes: ['rect', 'circle', 'star'] });
    speak('全コース発見コンプリート！おめでとう！');
    burst.querySelector('.cb-close').onclick = () => burst.remove();
    setTimeout(() => { if (burst.parentElement) burst.remove(); }, 6000);
  }

  // ===== QR Code generation (light implementation) =====
  // 軽量QRコード生成（外部ライブラリ無し・矩形描画ベース）
  // 一般的なQRには専用ライブラリが必要なため、このアプリでは
  // 「Google Chart API 風の URL を Canvas にロード」する方式を採用
  // Note: api.qrserver.com (フリー・APIキー不要・QR生成専門)
  async function loadQRImage(text, size = 280) {
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=4&data=${encodeURIComponent(text)}`;
    return loadImage(url);
  }

  // ===== Instagram縦長シェア画像 (1080x1920) =====
  // 直近のAIウォークレポートをキャッシュ（generateInstagramShareImage で使う）
  let _lastWalkReport = '';
  let _lastWalkHaiku = '';
  let _lastWalkEssay = '';

  async function generateInstagramShareImage(course) {
    const W = 1080;
    const H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 背景：オレンジ→ピンク→紫のグラデ
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#ff7e3d');
    bg.addColorStop(0.5, '#ff4081');
    bg.addColorStop(1, '#9c27b0');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 装飾円
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.arc(150, 200, 250, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W - 150, H - 250, 280, 0, Math.PI * 2);
    ctx.fill();

    // ヘッダー
    ctx.font = 'bold 48px sans-serif';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.fillText('👣 街歩きガチャ', W / 2, 120);

    ctx.font = '32px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('完走しました！', W / 2, 175);

    // 完走メダル（中央上部）
    ctx.font = '180px serif';
    ctx.fillText('🏅', W / 2, 380);

    // コース名（白枠＋黒文字カード）
    const cardX = 60, cardY = 440, cardW = W - 120, cardH = 280;
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    roundRect(ctx, cardX, cardY, cardW, cardH, 28);
    ctx.fill();

    ctx.fillStyle = '#1c1c1f';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    const name = tField(course, 'name');
    wrapText(ctx, name, W / 2, cardY + 80, cardW - 80, 70);

    // エリア + メタ
    ctx.font = '36px sans-serif';
    ctx.fillStyle = '#6b6b72';
    ctx.fillText(`${course.areaIcon || ''} ${tField(course, 'areaName')}`, W / 2, cardY + 200);
    ctx.font = '28px sans-serif';
    ctx.fillText(`📍 ${course.stops.length}スポット ・ 約${course.estimatedMin}分`, W / 2, cardY + 250);

    // 写真コラージュ（あれば）
    const photos = getCoursePhotos(course.id);
    const photoEntries = Object.entries(photos)
      .map(([idx, entry]) => ({ idx: parseInt(idx, 10), url: _photoUrlOf(entry) }))
      .filter(p => p.url)
      .sort((a, b) => a.idx - b.idx);
    const loaded = await Promise.all(photoEntries.slice(0, 4).map(p => loadImage(p.url)));
    const validPhotos = loaded.filter(Boolean);

    if (validPhotos.length > 0) {
      const pcRows = validPhotos.length <= 2 ? 1 : 2;
      const pcCols = validPhotos.length <= 1 ? 1 : 2;
      const pad = 16;
      const totalW = W - 120;
      const cellSize = Math.floor((totalW - pad * (pcCols - 1)) / pcCols);
      const startX = (W - (cellSize * pcCols + pad * (pcCols - 1))) / 2;
      const startY = 770;
      validPhotos.forEach((img, i) => {
        const r = Math.floor(i / pcCols);
        const c = i % pcCols;
        const x = startX + c * (cellSize + pad);
        const y = startY + r * (cellSize + pad);
        ctx.save();
        roundRect(ctx, x, y, cellSize, cellSize, 24);
        ctx.clip();
        const ratio = Math.max(cellSize / img.width, cellSize / img.height);
        const dw = img.width * ratio;
        const dh = img.height * ratio;
        const dx = x + (cellSize - dw) / 2;
        const dy = y + (cellSize - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 6;
        roundRect(ctx, x, y, cellSize, cellSize, 24);
        ctx.stroke();
      });
    } else {
      // 写真ない時はスタンプ円
      ctx.font = '120px serif';
      ctx.textAlign = 'center';
      const stamps = course.stops.slice(0, 4);
      const stampSize = 200;
      const stampPad = 24;
      const stampStart = (W - (stamps.length * stampSize + (stamps.length - 1) * stampPad)) / 2;
      stamps.forEach((s, i) => {
        const cx = stampStart + i * (stampSize + stampPad) + stampSize / 2;
        const cy = 900 + (i % 2) * (stampSize + 30);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(cx, cy, stampSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1c1c1f';
        ctx.fillText(s.emoji || '📍', cx, cy + 40);
      });
    }

    // AI ウォークレポート（あれば）
    if (_lastWalkHaiku || _lastWalkEssay || _lastWalkReport) {
      const reportY = (validPhotos.length > 0 ? 1260 : 1320);
      const haiku = _lastWalkHaiku;
      const essay = _lastWalkEssay || _lastWalkReport;
      const reportH = haiku ? 280 : 200;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      roundRect(ctx, 80, reportY, W - 160, reportH, 20);
      ctx.fill();
      // ✍️ ラベル
      ctx.fillStyle = '#6c63ff';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('✍️ AIによる振り返り', 110, reportY + 38);
      // 俳句（金色背景でハイライト）
      let textY = reportY + 75;
      if (haiku) {
        const haikuBoxY = reportY + 60;
        const haikuBoxH = 80;
        const haikuGrad = ctx.createLinearGradient(110, haikuBoxY, 110, haikuBoxY + haikuBoxH);
        haikuGrad.addColorStop(0, '#fff8e1');
        haikuGrad.addColorStop(1, '#ffe082');
        ctx.fillStyle = haikuGrad;
        roundRect(ctx, 110, haikuBoxY, W - 220, haikuBoxH, 12);
        ctx.fill();
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        roundRect(ctx, 110, haikuBoxY, W - 220, haikuBoxH, 12);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#5a3a00';
        ctx.font = 'bold 32px "Hiragino Mincho ProN", "Yu Mincho", serif';
        ctx.textAlign = 'center';
        ctx.fillText(`《 ${haiku} 》`, W / 2, haikuBoxY + 52);
        textY = haikuBoxY + haikuBoxH + 30;
      }
      // 本文
      if (essay) {
        ctx.fillStyle = '#1c1c1f';
        ctx.font = '24px "Hiragino Mincho ProN", serif';
        ctx.textAlign = 'left';
        wrapText(ctx, essay, 110, textY, W - 220, 34);
      }
    }

    // QRコード（招待リンク）
    let qrImg = null;
    try {
      qrImg = await loadQRImage(getInviteUrl(), 280);
    } catch {}
    const qrSize = 240;
    const qrX = 100;
    const qrY = H - 360;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    roundRect(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 16);
    ctx.fill();
    if (qrImg) {
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    } else {
      ctx.fillStyle = '#1c1c1f';
      ctx.font = '30px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('QR', qrX + qrSize / 2, qrY + qrSize / 2);
    }

    // QRラベル
    ctx.fillStyle = 'white';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('スキャンで', qrX + qrSize + 30, qrY + 70);
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText('街歩きガチャ', qrX + qrSize + 30, qrY + 130);
    ctx.font = '28px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText('+15🪙ボーナス', qrX + qrSize + 30, qrY + 175);

    // 日付 + ハッシュタグ
    const today = new Date();
    const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
    ctx.font = '28px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'center';
    ctx.fillText(dateStr, W / 2, H - 80);
    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = 'white';
    ctx.fillText('#街歩きガチャ', W / 2, H - 40);

    return canvas;
  }

  async function downloadInstagramShareImage(course) {
    try {
      showToast('🎨 IG用画像を生成中...', 'info', 1500);
      const canvas = await generateInstagramShareImage(course);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png', 0.95));
      // Web Share API (Level 2 - files) があれば直接シェア（モバイルで便利）
      const fileName = `machiaruki_${(course.id || 'course').replace(/[^a-z0-9_-]/gi, '_')}_ig.png`;
      try {
        if (navigator.canShare && navigator.share) {
          const file = new File([blob], fileName, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            const haiku = _lastWalkHaiku ? `《 ${_lastWalkHaiku} 》\n\n` : '';
            await navigator.share({
              files: [file],
              title: `${tField(course, 'name')} 完走しました`,
              text: `${haiku}街歩きガチャで散歩中 👣 #街歩きガチャ\n${getInviteUrl()}`,
            });
            showToast('📤 シェアしました', 'success', 2500);
            return;
          }
        }
      } catch (e) {
        // share キャンセル等は無視してダウンロードへフォールバック
        if (e && e.name === 'AbortError') return;
      }
      // フォールバック: 通常のダウンロード
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast('💾 IGストーリー用画像を保存', 'success', 3000);
    } catch (e) {
      console.error(e);
      showToast('画像生成に失敗しました', 'error', 3000);
    }
  }

  // 写真を Image にロード
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // Generate certificate as PNG using Canvas (async = 写真ロード対応)
  async function downloadCertPng(course) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');

    // 撮影写真を事前ロード（旧フォーマット string と新フォーマット {url,desc} 両対応）
    const photos = getCoursePhotos(course.id);
    const photoEntries = Object.entries(photos)
      .map(([idx, entry]) => ({
        idx: parseInt(idx, 10),
        url: _photoUrlOf(entry),
        desc: _photoDescOf(entry),
      }))
      .filter(p => p.url)
      .sort((a, b) => a.idx - b.idx);
    const loadedPhotos = await Promise.all(photoEntries.map(p => loadImage(p.url)));
    const validPhotos = loadedPhotos.map((img, i) => img ? { img, idx: photoEntries[i].idx, desc: photoEntries[i].desc } : null).filter(Boolean);

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#fff8e1');
    grad.addColorStop(1, '#ffecb3');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Decorative circles
    ctx.fillStyle = 'rgba(255, 215, 0, 0.2)';
    ctx.beginPath();
    ctx.arc(150, 200, 200, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(canvas.width - 150, canvas.height - 200, 240, 0, 2 * Math.PI);
    ctx.fill();

    // Outer border
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 12;
    ctx.strokeRect(60, 60, canvas.width - 120, canvas.height - 120);
    ctx.lineWidth = 4;
    ctx.strokeRect(90, 90, canvas.width - 180, canvas.height - 180);

    // Medal emoji (centered top)
    ctx.font = '200px serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏅', canvas.width / 2, 380);

    // 完走証明書 title
    ctx.font = 'bold 80px sans-serif';
    ctx.fillStyle = '#b71c1c';
    ctx.fillText('完 走 証 明 書', canvas.width / 2, 530);

    // Walk count badge
    const count = state.walkCounts?.[course.id] || 1;
    let badgeText = `🏅 ${count}回目の完走`;
    if (count === 1) badgeText = '🌟 初完走！';
    else if (count >= 10) badgeText = `👑 ${count}回目（マスター）`;
    else if (count >= 5) badgeText = `🌟 ${count}回目（常連）`;
    else if (count >= 3) badgeText = `⭐ ${count}回目（リピーター）`;
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = '#5a3a00';
    // Yellow pill background
    const txtWidth = ctx.measureText(badgeText).width;
    const pillX = canvas.width / 2 - txtWidth / 2 - 24;
    const pillY = 575;
    const pillW = txtWidth + 48;
    const pillH = 50;
    const grad2 = ctx.createLinearGradient(pillX, pillY, pillX + pillW, pillY);
    grad2.addColorStop(0, '#ffd700');
    grad2.addColorStop(1, '#ff9800');
    ctx.fillStyle = grad2;
    roundRect(ctx, pillX, pillY, pillW, pillH, 25);
    ctx.fill();
    ctx.fillStyle = '#5a3a00';
    ctx.fillText(badgeText, canvas.width / 2, pillY + 36);

    // Course name (might wrap)
    ctx.font = 'bold 64px sans-serif';
    ctx.fillStyle = '#1c1c1f';
    const courseName = tField(course, 'name');
    wrapText(ctx, courseName, canvas.width / 2, 760, canvas.width - 200, 80);

    // Area
    ctx.font = '40px sans-serif';
    ctx.fillStyle = '#6b6b72';
    ctx.fillText(`${course.areaIcon} ${tField(course, 'areaName')}`, canvas.width / 2, 920);

    // Stamps (each stop emoji in a circle)
    const stamps = course.stops;
    const stampSize = 110;
    const stampSpacing = 130;
    const totalStampWidth = stamps.length * stampSpacing - (stampSpacing - stampSize);
    let stampStartX = (canvas.width - totalStampWidth) / 2;
    stamps.forEach((s, i) => {
      const cx = stampStartX + i * stampSpacing + stampSize / 2;
      const cy = 1100;
      // Circle background
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, stampSize / 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 6;
      ctx.stroke();
      // Emoji
      ctx.font = '64px serif';
      ctx.fillStyle = '#1c1c1f';
      ctx.fillText(s.emoji || '📍', cx, cy + 22);
    });

    // Stats
    ctx.font = '36px sans-serif';
    ctx.fillStyle = '#6b6b72';
    ctx.fillText(`📍 ${stamps.length}スポット ・ 約${course.estimatedMin}分 ・ ${course.travelMode === 'walk' ? '徒歩' : course.travelMode}`, canvas.width / 2, 1320);

    // 撮影写真コラージュ（あれば）
    if (validPhotos.length > 0) {
      const photoMaxCount = Math.min(validPhotos.length, 4);
      const padding = 16;
      const totalW = canvas.width - 200;
      const photoSize = (totalW - padding * (photoMaxCount - 1)) / photoMaxCount;
      const photoY = 1390;
      const photoStartX = (canvas.width - (photoSize * photoMaxCount + padding * (photoMaxCount - 1))) / 2;
      validPhotos.slice(0, photoMaxCount).forEach((p, i) => {
        const x = photoStartX + i * (photoSize + padding);
        // クリッピング（角丸）
        ctx.save();
        roundRect(ctx, x, photoY, photoSize, photoSize, 16);
        ctx.clip();
        // カバーフィット
        const ratio = Math.max(photoSize / p.img.width, photoSize / p.img.height);
        const dw = p.img.width * ratio;
        const dh = p.img.height * ratio;
        const dx = x + (photoSize - dw) / 2;
        const dy = photoY + (photoSize - dh) / 2;
        ctx.drawImage(p.img, dx, dy, dw, dh);
        ctx.restore();
        // ボーダー
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 4;
        roundRect(ctx, x, photoY, photoSize, photoSize, 16);
        ctx.stroke();
      });
    }

    // AI ウォークレポート（あれば挿入）
    if (_lastWalkReport) {
      const rY = 1530;
      ctx.fillStyle = 'rgba(255, 248, 225, 0.85)';
      roundRect(ctx, 80, rY, canvas.width - 160, 130, 16);
      ctx.fill();
      ctx.fillStyle = '#6c63ff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('✍️ AIによる振り返り', 100, rY + 36);
      ctx.fillStyle = '#1c1c1f';
      ctx.font = '24px "Hiragino Mincho ProN", serif';
      wrapText(ctx, _lastWalkReport, 100, rY + 70, canvas.width - 200, 32);
    }

    // Date
    const today = new Date();
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    ctx.font = '32px sans-serif';
    ctx.fillStyle = '#6b6b72';
    ctx.textAlign = 'center';
    ctx.fillText(dateStr, canvas.width / 2, _lastWalkReport ? 1700 : 1640);

    // Footer brand
    ctx.font = 'bold 56px sans-serif';
    ctx.fillStyle = '#ff7e3d';
    ctx.fillText('👣 街歩きガチャ', canvas.width / 2, _lastWalkReport ? 1790 : 1740);

    ctx.font = '28px sans-serif';
    ctx.fillStyle = '#6b6b72';
    ctx.fillText('あと◯分あったら、どこ寄る？', canvas.width / 2, _lastWalkReport ? 1840 : 1790);

    // Download
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `yorimichi-certificate-${course.id}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('📥 完走証明書をダウンロードしました', 'success', 3000);
    }, 'image/png');
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    // Simple Japanese-friendly wrap (per char)
    const lines = [];
    let line = '';
    for (const ch of text) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line.length > 0) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  }

  // Share gacha result (called from result card)
  function shareGachaResult(route) {
    const rarity = RARITY[route.rarity] || RARITY.r;
    const rarityWord = route.rarity === 'legendary' ? '✨LEGENDARY' :
                       route.rarity === 'sr' ? '🌟SUPER RARE' :
                       route.rarity === 'r' ? '⭐RARE' : '◎NORMAL';
    const text = `${rarityWord} 当選🎰
「${route.title}」
${route.themeIcon} ${route.themeName} ・ ${route.stops.length}スポット ・ ${Math.round(route.detourMin)}分

街歩きガチャで散歩コースを引いてみよう👣`;
    const url = location.href.split('#')[0].split('?')[0];

    // Picker modal
    const picker = document.createElement('div');
    picker.className = 'modal-backdrop';
    picker.style.zIndex = '6000';
    picker.innerHTML = `
      <div class="modal" style="max-width:340px; text-align:center; padding:24px;">
        <h3 style="margin:0 0 4px;font-size:18px">📤 このコースをシェア</h3>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px">${escapeHtml(route.title)}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
          <button class="btn-share-x" data-share="x">𝕏</button>
          <button class="btn-share-line" data-share="line">LINE</button>
          <button class="btn-share-copy" data-share="copy">🔗 URL</button>
        </div>
        <button style="margin-top:12px;background:transparent;border:none;color:var(--text-muted);font-size:12px;cursor:pointer" data-close>キャンセル</button>
      </div>
    `;
    document.body.appendChild(picker);

    picker.addEventListener('click', async (e) => {
      const target = e.target.closest('[data-share],[data-close]');
      if (!target) {
        if (e.target === picker) picker.remove();
        return;
      }
      const action = target.dataset.share;
      if (action === 'x') {
        const u = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url);
        window.open(u, '_blank', 'noopener');
      } else if (action === 'line') {
        const u = 'https://line.me/R/msg/text/?' + encodeURIComponent(text + '\n' + url);
        window.open(u, '_blank', 'noopener');
      } else if (action === 'copy') {
        try {
          await navigator.clipboard.writeText(text + '\n' + url);
          showToast('🔗 URLとメッセージをコピーしました', 'success');
        } catch {
          showToast('コピーできませんでした', 'error');
        }
      }
      picker.remove();
    });
    setTimeout(() => {
      const x = picker.querySelector('[data-share="x"]');
      if (x) x.focus();
    }, 50);
  }

  async function fetchWalkReport(course, durationMin, photosTaken) {
    if (!course || !course.stops) return null;
    let weatherCode = null;
    try {
      const w = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || 'null');
      if (w && Date.now() - w.fetchedAt < WEATHER_CACHE_TTL_MS) weatherCode = w.code;
    } catch {}
    // 📝 ユーザーのスポットメモを収集して投入
    const memos = getStopMemos(course.id);
    const userMemos = Object.entries(memos)
      .map(([k, v]) => {
        const idx = parseInt(k, 10);
        const stop = course.stops[idx];
        if (!stop || !v?.memo) return null;
        return { stop_name: stop.name, memo: String(v.memo).slice(0, 120) };
      })
      .filter(Boolean)
      .slice(0, 6);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(`${API_BASE}/api/walk-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_name: tField(course, 'name'),
          area: tField(course, 'areaName'),
          visited_stops: course.stops.map(s => s.name).filter(Boolean),
          duration_min: durationMin || course.estimatedMin || 0,
          photos_taken: photosTaken,
          weather_code: weatherCode,
          hour: (new Date()).getHours(),
          user_memos: userMemos,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data) return null;
      // 後方互換: report のみのときも対応
      return {
        report: data.report || data.essay || '',
        haiku: data.haiku || '',
        essay: data.essay || data.report || '',
      };
    } catch (e) {
      console.warn('walk report fetch failed', e);
      return null;
    }
  }

  function showCertificate(course) {
    $('#cert-modal').hidden = false;
    $('#cert-course').textContent = tField(course, 'name');
    $('#cert-area').textContent = `${course.areaIcon} ${tField(course, 'areaName')}`;
    // ウォークレポートを非同期生成
    const reportEl = $('#walk-report');
    const reportText = $('#walk-report-text');
    const haikuEl = $('#walk-report-haiku');
    if (reportEl && reportText) {
      reportEl.hidden = true;
      reportText.textContent = '';
      if (haikuEl) { haikuEl.hidden = true; haikuEl.textContent = ''; }
      // 撮影写真数 + 開始からの経過時間概算
      const photos = getCoursePhotos(course.id);
      const photosCount = Object.keys(photos).length;
      fetchWalkReport(course, course.estimatedMin, photosCount).then(result => {
        if (!result) return;
        const haiku = result.haiku || '';
        const essay = result.essay || result.report || '';
        if (haikuEl && haiku) {
          haikuEl.textContent = `《 ${haiku} 》`;
          haikuEl.hidden = false;
        }
        reportText.textContent = essay;
        reportEl.hidden = false;
        _lastWalkReport = result.report || (haiku ? `《${haiku}》\n\n${essay}` : essay);
        _lastWalkHaiku = haiku;
        _lastWalkEssay = essay;
      });
    }

    // Walk count badge
    const count = state.walkCounts?.[course.id] || 1;
    const wcBadge = $('#cert-walk-count');
    let badgeText = '';
    if (count === 1) badgeText = '🌟 初完走！';
    else if (count >= 10) badgeText = `👑 ${count}回目の完走（マスター）`;
    else if (count >= 5) badgeText = `🌟 ${count}回目の完走（常連）`;
    else if (count >= 3) badgeText = `⭐ ${count}回目の完走（リピーター）`;
    else badgeText = `🏅 ${count}回目の完走`;
    wcBadge.textContent = badgeText;
    wcBadge.hidden = false;

    const stamps = $('#cert-stamps');
    stamps.innerHTML = '';
    course.stops.forEach(s => {
      const div = document.createElement('div');
      div.className = 'cert-stamp';
      div.textContent = s.emoji || '📍';
      stamps.appendChild(div);
    });
    const today = new Date();
    $('#cert-date').textContent = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

    // 完走シェア用テキスト：エリア・スポット数・所要時間・招待リンクを盛り込む
    const stops = course.stops || [];
    const stopList = stops.slice(0, 3).map(s => s.name).filter(Boolean).join('・');
    const more = stops.length > 3 ? `…他${stops.length - 3}` : '';
    const minutes = course.estimatedMin ? `約${course.estimatedMin}分・` : '';
    const inviteUrl = getInviteUrl();
    const hashtag = '#街歩きガチャ';
    const shareText = `🏅 ${course.name} を完走！
${course.areaIcon || '📍'} ${course.areaName} ・ ${minutes}${stops.length}スポット
${stopList}${more}

街歩きガチャで散歩コースを引いて、GPSスタンプラリーで遊べます🎰
${hashtag}`;
    const shareUrl = inviteUrl;

    $('#share-x').onclick = () => {
      const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(shareUrl);
      window.open(url, '_blank', 'noopener');
    };
    $('#share-line').onclick = () => {
      const url = 'https://line.me/R/msg/text/?' + encodeURIComponent(shareText + '\n' + shareUrl);
      window.open(url, '_blank', 'noopener');
    };
    $('#share-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareText + '\n' + shareUrl);
        showToast('🔗 URLをコピーしました', 'success');
      } catch {
        showToast('コピーできませんでした', 'error');
      }
    };

    // Download as PNG
    $('#cert-download').onclick = async () => {
      try {
        showToast('🎨 証明書を生成中...', 'info', 1500);
        await downloadCertPng(course);
      } catch (e) {
        console.error(e);
        showToast('証明書の生成に失敗しました', 'error', 3000);
      }
    };

    // GPX export
    const gpxBtn = $('#cert-gpx');
    if (gpxBtn) gpxBtn.onclick = () => downloadGPX(course);

    // Instagram縦長シェア画像
    const igBtn = $('#cert-ig');
    if (igBtn) igBtn.onclick = () => downloadInstagramShareImage(course);

    // 3択の next-actions（同じコース再歩行・同エリア別コース・もう1回ガチャ）
    const reWalkBtn = $('#next-action-rewalk');
    if (reWalkBtn) {
      reWalkBtn.onclick = () => {
        $('#cert-modal').hidden = true;
        applyRoute(courseToRoute(course));
        showToast(`🔄 「${tField(course, 'name')}」をもう一度歩きます`, 'info', 3000);
      };
    }
    const areaBtn = $('#next-action-area');
    const areaIcon = $('#nab-area-icon');
    const areaLabel = $('#nab-area-label');
    // 同じエリアの別コース
    const sameAreaCourses = (window.YORIMICHI_COURSES || []).filter(c =>
      c.area === course.area && c.id !== course.id
    );
    if (areaBtn && sameAreaCourses.length > 0) {
      const altCourse = sameAreaCourses[Math.floor(Math.random() * sameAreaCourses.length)];
      if (areaIcon) areaIcon.textContent = altCourse.themeIcon || altCourse.areaIcon || '🌳';
      if (areaLabel) areaLabel.innerHTML = `同じエリア:<br>${escapeHtml(tField(altCourse, 'name')).slice(0, 14)}`;
      areaBtn.onclick = () => {
        $('#cert-modal').hidden = true;
        applyRoute(courseToRoute(altCourse));
        showToast(`🌳 「${tField(altCourse, 'name')}」を地図に設定`, 'success', 3000);
      };
      areaBtn.style.display = '';
    } else if (areaBtn) {
      areaBtn.style.display = 'none';
    }
    const gachaBtn = $('#next-action-gacha');
    if (gachaBtn) {
      gachaBtn.onclick = () => {
        $('#cert-modal').hidden = true;
        try { showGachaModal(); } catch {}
      };
    }

    // Suggest next course - 履歴ベースのレコメンドエンジンで強化
    const next = getRecommendedCourse() || pickNextSuggestion(course);
    const nextSec = $('#next-suggestion');
    if (next) {
      nextSec.hidden = false;
      $('#next-emoji').textContent = next.themeIcon || next.areaIcon || '🌳';
      $('#next-title').textContent = next.name;
      $('#next-meta').textContent = `${next.areaIcon} ${next.areaName} ・ 約${next.estimatedMin}分 ・ ${next.stops.length}スポット`;
      $('#next-course-card').onclick = () => {
        $('#cert-modal').hidden = true;
        applyRoute(courseToRoute(next));
        showToast(`✨ 「${next.name}」を地図に設定しました`, 'success', 3000);
      };
    } else {
      nextSec.hidden = true;
    }
  }

  // Render best-time timeline for a course (24h horizontal bar)
  function renderTimeline(stops) {
    const ranges = stops.map(s => {
      if (!s.bestTime) return null;
      const m = s.bestTime.match(/(\d{1,2}):(\d{2})\s*[-〜～]\s*(\d{1,2}):(\d{2})/);
      if (!m) return null;
      const start = parseInt(m[1]) + parseInt(m[2]) / 60;
      let end = parseInt(m[3]) + parseInt(m[4]) / 60;
      if (end < start) end += 24; // overnight
      return { name: tField(s, 'name'), start, end, emoji: s.emoji || '📍' };
    }).filter(Boolean);
    if (ranges.length === 0) return '';

    const minH = Math.min(...ranges.map(r => r.start));
    const maxH = Math.max(...ranges.map(r => r.end));
    const span = Math.max(maxH - minH, 4);

    const bars = ranges.map(r => {
      const left = ((r.start - minH) / span) * 100;
      const width = ((r.end - r.start) / span) * 100;
      return `<div class="tl-bar" style="left:${left}%; width:${width}%" title="${escapeHtml(r.name)} (${r.start}:00-${r.end}:00)"><span>${r.emoji}</span></div>`;
    }).join('');

    return `
      <div class="cd-timeline">
        <div class="tl-label">🕐 オススメ時間帯（${Math.floor(minH)}時 〜 ${Math.ceil(maxH)}時）</div>
        <div class="tl-track">
          ${bars}
        </div>
      </div>
    `;
  }

  function pickNextSuggestion(currentCourse) {
    const all = (window.YORIMICHI_COURSES || []).filter(c => {
      const enabled = (window.YORIMICHI_AREAS || []).find(a => a.id === c.area)?.enabled;
      return enabled && c.id !== currentCourse.id;
    });
    if (all.length === 0) return null;
    // Priority: undiscovered same area > discovered same area > undiscovered other > discovered other
    const sameArea = all.filter(c => c.area === currentCourse.area);
    const sameAreaUndiscovered = sameArea.filter(c => !state.discoveredCourses.has(c.id));
    if (sameAreaUndiscovered.length > 0) return sameAreaUndiscovered[Math.floor(Math.random() * sameAreaUndiscovered.length)];
    if (sameArea.length > 0) return sameArea[Math.floor(Math.random() * sameArea.length)];
    const otherUndiscovered = all.filter(c => !state.discoveredCourses.has(c.id));
    if (otherUndiscovered.length > 0) return otherUndiscovered[Math.floor(Math.random() * otherUndiscovered.length)];
    return all[Math.floor(Math.random() * all.length)];
  }

  function showStampBurst(stop) {
    const burst = $('#stamp-burst');
    $('#stamp-emoji').textContent = stop.emoji || '📍';
    $('#stamp-name').textContent = stop.name;
    burst.hidden = false;
    setTimeout(() => { burst.hidden = true; }, 1800);
  }

  function updateWalkUI() {
    if (!state.activeWalk) return;
    const courseId = state.activeWalk.courseId;
    const visited = state.completedStops[courseId] || new Set();
    const total = state.activeWalk.stopsTotal;
    const done = visited.size;
    const pct = Math.round((done / total) * 100);
    $('#walk-percent').textContent = `${done} / ${total} (${pct}%)`;
    $('#walk-bar-fill').style.width = pct + '%';
    // 全タブ常時表示バーの更新
    updateActiveWalkBar();

    // Find next unvisited stop
    let nextIdx = -1;
    for (let i = 0; i < state.selected.length; i++) {
      if (!visited.has(i)) { nextIdx = i; break; }
    }
    const next = nextIdx >= 0 ? state.selected[nextIdx] : null;
    $('#walk-next').innerHTML = next ? `次：<strong>${escapeHtml(next.emoji || '📍')} ${escapeHtml(next.name)}</strong>` : '🏅 全スポット制覇！';

    // Update summary list visited markers
    $$('.summary-list .sum-stop').forEach((li, i) => {
      // Stops are positions 1, 3, 5, 7... (alternating with leg lines)
      // The "real" stop index in state.selected is (positionInList - 1) / 2
      // But easier: query by stop name OR data attribute. Let me use index.
      // Actually we have origin at 0, leg, stop1, leg, stop2, leg, stop3, leg, dest
      // Stops in DOM include endpoints. Real stops are indices 1..N in DOM
      // We need: given DOM stop pos, is it stop[i]?
    });

    // Re-render summary so visited stops show check
    renderSummary();
  }

  // ---------- Init ----------

  async function init() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        // Detect updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version is ready
              showUpdateBanner();
            }
          });
        });
      }).catch(e => console.warn('SW reg failed', e));

      // Listen for the new SW taking over
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }

    function showUpdateBanner() {
      let banner = document.getElementById('update-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'update-banner';
        banner.className = 'update-banner';
        banner.innerHTML = `
          ✨ 新しいバージョンが利用できます
          <button id="update-apply">更新</button>
          <button id="update-dismiss" aria-label="閉じる">✕</button>
        `;
        document.body.appendChild(banner);
        document.getElementById('update-apply').onclick = () => {
          navigator.serviceWorker.getRegistration().then(reg => {
            if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          });
        };
        document.getElementById('update-dismiss').onclick = () => banner.remove();
      }
    }

    // Stripe Checkout からのリダイレクトを検出してコインを付与
    // （URL に ?coins=success&session_id=... が付いている場合）
    verifyAndGrantCoinsFromUrl().catch(e => console.warn('verify coins failed', e));

    // サブスク購読の戻り処理
    verifySubscriptionFromUrl().catch(e => console.warn('verify sub failed', e));

    // 起動時にプレミアム状態を更新
    refreshPremiumStatus().catch(() => {});

    // 招待リンク（?ref=uuid）の処理
    try { processInviteParam(); } catch (e) { console.warn('invite param failed', e); }

    // 共有コースリンク（?course=xxx）の処理
    try { processCourseShareLink(); } catch (e) { console.warn('course share failed', e); }

    // Online/offline detection
    window.addEventListener('offline', () => {
      showToast('📡 オフラインです。地図とルート計算が制限されます', 'error', 5000);
    });
    window.addEventListener('online', () => {
      showToast('📡 オンラインに復帰しました', 'success', 2500);
    });

    // PWA install prompt (Android Chrome) — エンゲージメント高い人にだけ出す
    let deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      // ガチャ1回引いた後（より価値を体感した後）にバナー表示
      // 30秒で出すよりエンゲージメント検出ベースで出す
      const checkAndShow = () => {
        // 1ガチャ以上引いた人 or 1コース以上発見済み or 60秒以上滞在で表示
        if (gacha.pulls >= 1 || state.discoveredCourses.size >= 1) {
          setTimeout(showPwaInstallBanner, 1500);
        } else {
          setTimeout(checkAndShow, 5000);
        }
      };
      setTimeout(checkAndShow, 30000);
    });

    function showPwaInstallBanner() {
      let dismissCount = 0;
      let dismissed = false;
      try {
        dismissCount = parseInt(localStorage.getItem('yorimichi-pwa-dismiss-count') || '0', 10) || 0;
        dismissed = localStorage.getItem('yorimichi-pwa-dismissed') === '1';
      } catch (e) {}
      // 3回以上閉じられたら諦める
      if (dismissed || dismissCount >= 3) return;
      if (window.matchMedia('(display-mode: standalone)').matches) return;
      // 既存バナーがあれば破棄
      const existing = document.getElementById('pwa-install-banner');
      if (existing) existing.remove();

      const banner = document.createElement('div');
      banner.id = 'pwa-install-banner';
      banner.className = 'pwa-install-banner';
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const benefit = (gacha.pulls >= 3)
        ? '気に入ってくれてありがとう！ホーム画面に追加すると2タップで起動できます'
        : 'ホーム画面に追加すると、アプリ感覚で使えてオフラインでも一部動作します';
      if (isIOS) {
        banner.innerHTML = `
          <div class="pwa-banner-icon">📱</div>
          <div class="pwa-banner-body">
            <div class="pwa-banner-title">${escapeHtml(benefit)}</div>
            <div class="pwa-banner-sub">画面下の「共有」 → 「ホーム画面に追加」をタップ</div>
          </div>
          <button class="pwa-dismiss" aria-label="閉じる">✕</button>
        `;
      } else if (deferredInstallPrompt) {
        banner.innerHTML = `
          <div class="pwa-banner-icon">📱</div>
          <div class="pwa-banner-body">
            <div class="pwa-banner-title">${escapeHtml(benefit)}</div>
            <div class="pwa-banner-sub">通信量も節約できます</div>
          </div>
          <button class="pwa-install">追加</button>
          <button class="pwa-dismiss" aria-label="閉じる">✕</button>
        `;
        banner.querySelector('.pwa-install').onclick = async () => {
          try {
            deferredInstallPrompt.prompt();
            const result = await deferredInstallPrompt.userChoice;
            if (result.outcome === 'accepted') {
              showToast('🎉 ホーム画面に追加しました！', 'success', 4000);
              try { localStorage.setItem('yorimichi-pwa-dismissed', '1'); } catch {}
            }
          } catch (e) { console.warn('install failed', e); }
          banner.remove();
          deferredInstallPrompt = null;
        };
      } else {
        return;
      }
      banner.querySelector('.pwa-dismiss').onclick = () => {
        try {
          localStorage.setItem('yorimichi-pwa-dismiss-count', String(dismissCount + 1));
          if (dismissCount + 1 >= 3) localStorage.setItem('yorimichi-pwa-dismissed', '1');
        } catch (e) {}
        banner.remove();
      };
      document.body.appendChild(banner);
    }

    // For iOS: show after 60s of usage if not standalone
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches) {
      setTimeout(showPwaInstallBanner, 60000);
    }

    initMap();
    setupPreviewZoomListener();
    initTheme();
    buildCategories();
    initMobilePanel();

    // Slider
    const slider = $('#budget-slider');
    slider.addEventListener('input', () => { updateSliderFill(); saveStateToHash(); });
    updateSliderFill();

    // Travel mode
    $$('input[name="travel"]').forEach(r => {
      r.addEventListener('change', (e) => {
        state.travel = e.target.value;
        if (state.candidates.length > 0) {
          // re-rank with new travel speed
          state.candidates = rankPois(state.candidates);
          renderCandidates();
          updateCompareBadge();
        }
        saveStateToHash();
      });
    });

    // Mode tabs
    $('#tab-course').addEventListener('click', () => setMode('course'));
    $('#tab-route').addEventListener('click', () => setMode('route'));
    $('#tab-stroll').addEventListener('click', () => setMode('stroll'));

    // Build area + tag selectors
    buildAreaSelector();
    buildTagFilter();
    $('#tag-clear').addEventListener('click', () => {
      state.activeTags.clear();
      buildTagFilter();
      state.currentPlans = [];
      updateFilterStat();
      renderCoursePreview();
    });

    // Visual filters (photo / perk)
    const fp = $('#filter-has-photo');
    const fk = $('#filter-has-perk');
    const fu = $('#filter-unwalked');
    const fr = $('#filter-rain-ok');
    const fn = $('#filter-night-ok');
    if (fp) fp.addEventListener('change', () => {
      state.filterHasPhoto = fp.checked;
      updateFilterStat();
      renderCoursePreview();
      renderPoolPreview();
    });
    if (fk) fk.addEventListener('change', () => {
      state.filterHasPerk = fk.checked;
      updateFilterStat();
      renderCoursePreview();
      renderPoolPreview();
    });
    if (fu) fu.addEventListener('change', () => {
      state.filterUnwalked = fu.checked;
      updateFilterStat();
      renderCoursePreview();
      renderPoolPreview();
    });
    if (fr) fr.addEventListener('change', () => {
      state.filterRainOk = fr.checked;
      updateFilterStat();
      renderCoursePreview();
      renderPoolPreview();
    });
    if (fn) fn.addEventListener('change', () => {
      state.filterNightOk = fn.checked;
      updateFilterStat();
      renderCoursePreview();
      renderPoolPreview();
    });

    // Load persisted state
    try {
      const saved = JSON.parse(localStorage.getItem('yorimichi-discovered') || '[]');
      state.discoveredCourses = new Set(saved);
    } catch (e) {}
    loadStreak();
    loadCompletion();

    // Walking session
    loadVoicePref();
    $('#walk-start').addEventListener('click', startWalk);
    $('#walk-stop').addEventListener('click', stopWalk);

    // 「現在地に戻る」ボタン
    const recenterBtn = $('#map-recenter-btn');
    if (recenterBtn) recenterBtn.addEventListener('click', () => {
      if (state.userMarker && state.map) {
        const ll = state.userMarker.getLatLng();
        state.map.flyTo([ll.lat, ll.lng], 16, { duration: 0.6 });
      } else if (navigator.geolocation && state.map) {
        // userMarker がまだなければ現在地取得
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            state.map.flyTo([pos.coords.latitude, pos.coords.longitude], 16, { duration: 0.6 });
          },
          () => showToast('現在地が取得できませんでした', 'error', 3000),
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }
    });

    // マップ全画面トグル
    const fsBtn = $('#map-fullscreen-btn');
    if (fsBtn) fsBtn.addEventListener('click', () => {
      const isFs = document.body.classList.toggle('map-fullscreen');
      fsBtn.textContent = isFs ? '⛔' : '⛶';
      fsBtn.setAttribute('aria-label', isFs ? 'パネルを表示' : '地図を全画面表示');
      // map invalidateSize でサイズ再計算
      if (state.map) {
        setTimeout(() => state.map.invalidateSize(), 350);
      }
    });

    // Walk HUD ボタン
    const hudEnd = $('#walk-hud-end');
    if (hudEnd) hudEnd.addEventListener('click', () => {
      if (confirm('ウォークを終了しますか？')) stopWalk();
    });
    const hudPause = $('#walk-hud-pause');
    if (hudPause) hudPause.addEventListener('click', togglePauseWalk);
    const hudHeadup = $('#walk-hud-headup');
    if (hudHeadup) hudHeadup.addEventListener('click', toggleHeadup);

    const hudVoice = $('#walk-hud-voice');
    if (hudVoice) {
      const refreshIcon = () => { hudVoice.textContent = voice.enabled ? '🔊' : '🔇'; };
      refreshIcon();
      hudVoice.addEventListener('click', () => {
        voice.enabled = !voice.enabled;
        saveVoicePref();
        refreshIcon();
        if (voice.enabled) speak('音声ナビをオンにしました');
        else { try { window.speechSynthesis.cancel(); } catch {} }
      });
    }
    const hudCheckin = $('#walk-hud-checkin');
    if (hudCheckin) hudCheckin.addEventListener('click', () => {
      if (!state.activeWalk) return;
      const courseId = state.activeWalk.courseId;
      const visited = state.completedStops[courseId] || new Set();
      let nextIdx = -1;
      for (let i = 0; i < state.selected.length; i++) {
        if (!visited.has(i)) { nextIdx = i; break; }
      }
      if (nextIdx >= 0) checkInStop(nextIdx, true);
      else showToast('全スポット訪問済みです', 'info', 2500);
    });
    // ⏭ スキップボタン: 現在の目標を「スキップ済」として記録、未訪問のまま次へ進む
    const hudSkip = $('#walk-hud-skip');
    if (hudSkip) hudSkip.addEventListener('click', () => {
      if (!state.activeWalk) return;
      const courseId = state.activeWalk.courseId;
      const visited = state.completedStops[courseId] || new Set();
      let nextIdx = -1;
      for (let i = 0; i < state.selected.length; i++) {
        if (!visited.has(i)) { nextIdx = i; break; }
      }
      if (nextIdx < 0) { showToast('スキップ可能なスポットがありません', 'info', 2200); return; }
      const stop = state.selected[nextIdx];
      const ok = confirm(`「${stop?.name || 'このスポット'}」をスキップしますか？\n（完走扱いにはなりませんが、次のスポットに進めます）`);
      if (!ok) return;
      // skipped セットを初期化
      if (!state.skippedStops) state.skippedStops = {};
      if (!state.skippedStops[courseId]) state.skippedStops[courseId] = new Set();
      state.skippedStops[courseId].add(nextIdx);
      // visited にも入れて未訪問扱いから外す（再描画と進捗を進める）
      visited.add(nextIdx);
      state.completedStops[courseId] = visited;
      saveCompletion();
      try { localStorage.setItem('yorimichi-skipped-stops', JSON.stringify(
        Object.fromEntries(Object.entries(state.skippedStops).map(([k, v]) => [k, [...v]]))
      )); } catch {}
      showToast(`⏭ 「${stop?.name || 'スポット'}」をスキップしました`, 'info', 2500);
      updateWalkUI();
      renderSelectedMarkers();
      // 次のスポット案内
      let after = -1;
      for (let i = 0; i < state.selected.length; i++) {
        if (!visited.has(i)) { after = i; break; }
      }
      if (after < 0) {
        // 全部訪問済 / スキップ済 → コース完了として扱う
        const course = (window.YORIMICHI_COURSES || []).find(c => c.id === courseId);
        if (course) finishWalk();
      } else {
        const next = state.selected[after];
        speak(`次のスポットは${next.name}です`);
      }
    });
    const hudPhoto = $('#walk-hud-photo');
    if (hudPhoto) hudPhoto.addEventListener('click', () => {
      // Phase 2 で実装。今はファイル選択にフォールバック
      capturePhotoForCurrentStop();
    });

    // Walk中シェアボタン
    const hudShare = $('#walk-hud-share');
    if (hudShare) hudShare.addEventListener('click', () => {
      if (!state.activeWalk) return;
      const courseId = state.activeWalk.courseId;
      const course = (window.YORIMICHI_COURSES || []).find(c => c.id === courseId);
      if (!course) {
        showToast('シェアできるコース情報がありません', 'info', 2500);
        return;
      }
      showShareSheet(course);
    });
    const voiceBtn = $('#walk-voice-toggle');
    if (voiceBtn) {
      voiceBtn.textContent = voice.enabled ? '🔊' : '🔇';
      voiceBtn.classList.toggle('muted', !voice.enabled);
      voiceBtn.addEventListener('click', () => {
        voice.enabled = !voice.enabled;
        saveVoicePref();
        voiceBtn.textContent = voice.enabled ? '🔊' : '🔇';
        voiceBtn.classList.toggle('muted', !voice.enabled);
        if (!voice.enabled) {
          try { window.speechSynthesis.cancel(); } catch (e) {}
        } else {
          speak('音声ガイドオン');
        }
      });
    }

    // GPS explainer
    $('#gps-explain-close').addEventListener('click', () => $('#gps-explain').hidden = true);
    $('#gps-allow').addEventListener('click', () => {
      try { localStorage.setItem('yorimichi-gps-explained', '1'); } catch (e) {}
      $('#gps-explain').hidden = true;
      beginWalk(true);
    });
    $('#gps-manual').addEventListener('click', () => {
      try { localStorage.setItem('yorimichi-gps-explained', '1'); } catch (e) {}
      $('#gps-explain').hidden = true;
      beginWalk(false);
    });

    // Language toggle
    loadLang();
    $('#lang-label').textContent = currentLang === 'ja' ? 'JP' : 'EN';
    applyLang();
    $('#lang-btn').addEventListener('click', () => {
      const next = currentLang === 'ja' ? 'en' : 'ja';
      setLang(next);
      $('#lang-label').textContent = next === 'ja' ? 'JP' : 'EN';
    });

    // Map style picker
    $('#map-style-btn').addEventListener('click', () => {
      $('#mapstyle-modal').hidden = false;
    });
    $('#mapstyle-close').addEventListener('click', () => $('#mapstyle-modal').hidden = true);
    $$('.mapstyle-card').forEach(card => {
      card.addEventListener('click', () => {
        setMapStyle(card.dataset.style);
        $('#mapstyle-modal').hidden = true;
        showToast('🗺 マップスタイルを変更しました', 'success', 2000);
      });
    });

    // Privacy modal
    const openPrivacy = $('#open-privacy');
    if (openPrivacy) {
      openPrivacy.addEventListener('click', (e) => {
        e.preventDefault();
        $('#privacy-modal').hidden = false;
      });
    }
    $('#privacy-close').addEventListener('click', () => $('#privacy-modal').hidden = true);

    // Certificate close
    $('#cert-close').addEventListener('click', () => $('#cert-modal').hidden = true);

    // Profile
    $('#profile-btn').addEventListener('click', showProfile);
    $('#profile-close').addEventListener('click', () => $('#profile-modal').hidden = true);
    loadEarnedBadges();
    updateProfileButton();
    setInterval(updateProfileButton, 5000);

    // Data management
    $('#data-export').addEventListener('click', exportData);
    $('#data-import').addEventListener('click', importData);
    $('#data-reset').addEventListener('click', resetData);
    // 撮影アルバム
    const albumBtn = $('#show-photo-album');
    if (albumBtn) albumBtn.addEventListener('click', () => {
      $('#profile-modal').hidden = true;
      renderPhotoAlbum();
      $('#photo-album-modal').hidden = false;
    });
    const albumClose = $('#photo-album-close');
    if (albumClose) albumClose.addEventListener('click', () => { $('#photo-album-modal').hidden = true; });

    // 散歩履歴モーダル
    const walkLogBtn = $('#show-walk-log');
    if (walkLogBtn) walkLogBtn.addEventListener('click', () => {
      $('#profile-modal').hidden = true;
      renderWalkLog();
      $('#walk-log-modal').hidden = false;
    });
    const walkLogClose = $('#walk-log-close');
    if (walkLogClose) walkLogClose.addEventListener('click', () => { $('#walk-log-modal').hidden = true; });
    // フィルタ/ソート連動
    const wlFilter = $('#walk-log-filter');
    const wlSort = $('#walk-log-sort');
    if (wlFilter) wlFilter.addEventListener('change', () => renderWalkLog());
    if (wlSort) wlSort.addEventListener('change', () => renderWalkLog());

    // 設定モーダル
    const settingsBtn = $('#show-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', () => {
      $('#profile-modal').hidden = true;
      openSettingsModal();
    });
    const settingsClose = $('#settings-close');
    if (settingsClose) settingsClose.addEventListener('click', () => { $('#settings-modal').hidden = true; });
    setupSettingsControls();

    // ヘルプモーダル
    const helpBtn = $('#show-help');
    if (helpBtn) helpBtn.addEventListener('click', () => {
      $('#profile-modal').hidden = true;
      $('#help-modal').hidden = false;
    });
    const helpClose = $('#help-close');
    if (helpClose) helpClose.addEventListener('click', () => { $('#help-modal').hidden = true; });

    // Tutorial replay
    const tutBtn = $('#show-tutorial');
    if (tutBtn) tutBtn.addEventListener('click', () => {
      $('#profile-modal').hidden = true;
      try { localStorage.removeItem('yorimichi-onboarded'); } catch (e) {}
      // コーチマーク seen フラグもリセット → 再度ガイドが流れる
      try { resetCoachSeen(); } catch {}
      $('#onboard-modal').hidden = false;
      setOnboardStep(1);
      showToast('チュートリアルとガイドをリセットしました', 'info', 3000);
    });
    // Invite link
    setupInviteLink();

    // 公開プロフィール生成
    const ppBtn = $('#btn-public-profile');
    if (ppBtn) ppBtn.addEventListener('click', async () => {
      ppBtn.disabled = true;
      ppBtn.textContent = '🔄 生成中...';
      const result = await generatePublicProfile();
      ppBtn.disabled = false;
      ppBtn.textContent = '🎴 公開プロフィールを再生成';
      if (!result || !result.url) {
        showToast('生成に失敗しました', 'error', 3500);
        return;
      }
      const resultDiv = $('#public-profile-result');
      const linkEl = $('#public-profile-link');
      if (resultDiv && linkEl) {
        linkEl.value = result.url;
        resultDiv.hidden = false;
      }
      showToast('🎴 公開プロフィールを生成しました', 'success', 3500);
    });
    const ppCopy = $('#public-profile-copy');
    if (ppCopy) ppCopy.addEventListener('click', async () => {
      const linkEl = $('#public-profile-link');
      if (!linkEl || !linkEl.value) return;
      try {
        await navigator.clipboard.writeText(linkEl.value);
        showToast('📋 コピーしました', 'success', 2500);
      } catch {
        linkEl.select();
        document.execCommand('copy');
        showToast('📋 コピーしました', 'success', 2500);
      }
    });

    // Pool undiscovered toggle
    const poolToggle = $('#pool-undiscovered-only');
    if (poolToggle) {
      poolToggle.addEventListener('change', () => {
        renderPoolPreview();
      });
    }

    // Quick mode chips
    $$('.quick-mode').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.quick-mode').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        quickMode = chip.dataset.quickmode;
        const labels = {
          'all': 'ハンドルを回してコースを引こう',
          'undiscovered': '未発見コースのみから1つ引きます',
          'rare-up': '✨ レア確率UP！LR/SR が出やすくなります'
        };
        $('#capsule-hint').textContent = labels[quickMode];
        renderPoolPreview();
      });
    });

    // Handle PWA shortcut URL params
    const params = new URLSearchParams(location.search);
    if (params.has('gacha')) setTimeout(() => showGachaModal(), 800);
    if (params.has('collection')) setTimeout(() => showCollection(), 800);

    // Course detail modal
    $('#course-detail-close').addEventListener('click', () => $('#course-detail-modal').hidden = true);

    // Daily bonus
    $('#daily-bonus-close').addEventListener('click', () => $('#daily-bonus-modal').hidden = true);

    // Collection search
    const colSearch = $('#col-search');
    if (colSearch) {
      colSearch.addEventListener('input', (e) => {
        collectionSearch = e.target.value.trim();
        renderCollection(collectionFilter);
      });
    }
    // Collection sort
    const colSort = $('#col-sort');
    if (colSort) {
      colSort.addEventListener('change', (e) => {
        collectionSort = e.target.value;
        renderCollection(collectionFilter);
      });
    }

    // Today's pick + onboarding
    setupOnboardListeners();
    renderTodaysPick();
    maybeShowOnboarding();
    setTimeout(() => {
      if (!document.querySelector('#onboard-modal').hidden) return; // wait if onboarding
      maybeShowDailyBonus();
      checkResumableWalk();
    }, 1200);

    // Default to course mode (re-render today after setMode finalises layout)
    setMode(state.mode);
    renderTodaysPick();

    // Address inputs
    setupAddressInput('origin-input', 'origin-suggestions', (item) => {
      state.origin = item;
      setEndpointMarker('origin', item);
      fitToEndpoints();
      saveStateToHash();
    });
    setupAddressInput('dest-input', 'dest-suggestions', (item) => {
      state.dest = item;
      setEndpointMarker('dest', item);
      fitToEndpoints();
      $('#dest-clear').hidden = false;
      saveStateToHash();
    });

    $('#dest-input').addEventListener('input', (e) => {
      $('#dest-clear').hidden = !e.target.value;
    });
    $('#dest-clear').addEventListener('click', () => {
      $('#dest-input').value = '';
      state.dest = null;
      setEndpointMarker('dest', null);
      $('#dest-clear').hidden = true;
      drawRoutes();
      updateCompareBadge();
      saveStateToHash();
    });

    // Locate button
    $('#locate-btn').addEventListener('click', async () => {
      try {
        showLoader('現在地を取得中...');
        const p = await getCurrentLocation();
        const label = await reverseGeocode(p) || '現在地';
        p.shortLabel = label;
        p.label = label;
        state.origin = p;
        $('#origin-input').value = label;
        setEndpointMarker('origin', p);
        state.map.flyTo([p.lat, p.lng], 15);
        saveStateToHash();
        hideLoader();
      } catch (e) {
        hideLoader();
        showToast('現在地が取得できませんでした', 'error');
      }
    });

    // Action buttons
    $('#search-btn').addEventListener('click', searchDetours);

    // Gacha system
    gachaLoad();
    setupGachaListeners();
    gachaUpdateUI();
    $('#share-btn').addEventListener('click', async () => {
      saveStateToHash();
      const url = location.href;
      try {
        await navigator.clipboard.writeText(url);
        showToast('🔗 URLをコピーしました', 'success');
      } catch {
        showToast('URL: ' + url, 'info', 4000);
      }
    });
    $('#clear-summary').addEventListener('click', () => {
      state.selected = [];
      state.routeLegs = null;
      state.routeTotalM = null;
      state.routeTotalS = null;
      clearRoutes();
      clearPoiMarkers();
      setEndpointMarker('origin', null);
      setEndpointMarker('dest', null);
      renderCandidates();
      renderSummary();
      updateCompareBadge();
      renderCoursePreview(); // Show preview pins again
      saveStateToHash();
    });

    // Sort
    $('#sort-btn').addEventListener('click', () => {
      state.sortMode = state.sortMode === 'near' ? 'time' : 'near';
      $('#sort-btn').textContent = '並び替え：' + (state.sortMode === 'near' ? '近い順' : '時間順') + ' ▾';
      if (state.candidates.length > 0) {
        state.candidates = rankPois(state.candidates);
        renderCandidates();
      }
    });

    // Detail close
    $('#detail-close').addEventListener('click', () => {
      $('#detail-card').hidden = true;
    });

    // Map click closes detail
    state.map.on('click', () => {
      $('#detail-card').hidden = true;
    });

    // Restore from hash
    const restored = loadStateFromHash();
    if (restored) {
      // Apply restored state to UI
      $('#budget-slider').value = state.budgetMin;
      updateSliderFill();
      const radio = $(`input[name="travel"][value="${state.travel}"]`);
      if (radio) radio.checked = true;
      setMode(state.mode);
      buildCategories(); // re-render with active state
      if (state.origin) {
        $('#origin-input').value = state.origin.shortLabel;
        setEndpointMarker('origin', state.origin);
      }
      if (state.dest) {
        $('#dest-input').value = state.dest.shortLabel;
        setEndpointMarker('dest', state.dest);
        $('#dest-clear').hidden = false;
      }
      fitToEndpoints();
      drawRoutes();
      updateCompareBadge();
    } else {
      // Try to acquire current location softly (don't demand)
      try {
        const p = await Promise.race([
          getCurrentLocation(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
        ]);
        const label = await reverseGeocode(p) || '現在地';
        p.shortLabel = label;
        p.label = label;
        state.origin = p;
        $('#origin-input').value = label;
        $('#origin-input').placeholder = '出発地を入力...';
        setEndpointMarker('origin', p);
        state.map.flyTo([p.lat, p.lng], 14);
        saveStateToHash();
      } catch (e) {
        // Fall back: keep Tokyo Station as map center
        $('#origin-input').placeholder = '出発地を入力...';
      }
    }
  }

  function safeInit() {
    Promise.resolve()
      .then(() => init())
      .catch((err) => {
        console.error('init failed', err);
        reportClientError({
          message: 'init_failed: ' + String(err && err.message ? err.message : err),
          stack: err && err.stack ? String(err.stack).slice(0, 2000) : '',
        });
        showFatalErrorBanner('初期化中にエラーが発生しました');
      });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInit);
  } else {
    safeInit();
  }
})();
