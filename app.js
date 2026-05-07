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
  // i18n (basic)
  // ============================================================
  const I18N = {
    ja: {
      brandName: '寄り道マップ',
      brandTagline: 'あと◯分あったら、どこ寄る？',
      tabCourse: '📖 既存コース',
      tabRoute: '🎯 自由ルート',
      tabStroll: '🌿 散歩',
      todayLabel: '✨ 今日のおすすめ',
      todayCta: '引く',
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
      brandName: 'Yorimichi Map',
      brandTagline: 'Got a few extra minutes? Where to stop by?',
      tabCourse: '📖 Curated',
      tabRoute: '🎯 Free Route',
      tabStroll: '🌿 Stroll',
      todayLabel: '✨ Today\'s Pick',
      todayCta: 'Try',
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

  function showToast(msg, type = 'info', duration = 2400) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ' + type;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, duration);
    // Mirror to screen-reader live region
    const sr = $('#sr-live');
    if (sr) sr.textContent = msg;
  }

  function showLoader(text = '読み込み中...') {
    $('#loader-text').textContent = text;
    $('#loader').hidden = false;
  }
  function hideLoader() { $('#loader').hidden = true; }

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
    state.selected.forEach((stop, i) => {
      const emoji = stop.emoji || (categoryById(stop.cat) || { emoji: '📍' }).emoji;
      const isVisited = visited.has(i);
      const display = isVisited ? '✓' : emoji;
      const html = `
        <span class="poi-num">${i + 1}</span>
        <span class="poi-emo">${display}</span>
        <span class="poi-name-label">${escapeHtml(stop.name)}</span>
      `;
      const cls = 'poi-marker numbered' + (isVisited ? ' visited' : '');
      const marker = L.marker([stop.lat, stop.lng], {
        icon: makeIcon(html, cls, 44),
        title: stop.name,
        zIndexOffset: 100 + i,
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
    const perk = (window.YORIMICHI_PERKS || {})[stop.name];
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
      <div class="actions">
        <button class="add-btn" id="detail-fly">📍 地図でズーム</button>
        <a class="add-btn wiki-btn" id="detail-nav" target="_blank" rel="noopener">📱 ナビ起動</a>
      </div>
      ${state.activeWalk && !isVisited ? `<button class="add-btn" id="detail-checkin" style="background:#16a34a;margin-top:8px;width:100%">✓ チェックイン</button>` : ''}
    `;
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
        return { ...p, detourMin, distKm };
      })
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
    if (gachaTitle) gachaTitle.textContent = (mode === 'course') ? 'コースガチャを回す' : '寄り道ガチャを回す';
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
      all = all.filter(c => c.stops.some(s => perks[s.name]));
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
        (state.filterHasPhoto ? 1 : 0) + (state.filterHasPerk ? 1 : 0);
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
  }

  function gachaSave() {
    try {
      localStorage.setItem('yorimichi-gacha', JSON.stringify(gacha));
    } catch (e) {}
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

      if (freeRemain > 0) {
        turnCost.innerHTML = `残り <span id="free-remaining">${freeRemain}</span>回（無料）${pityHint}`;
        turnBtn.disabled = false;
      } else if (gacha.coins >= 10) {
        turnCost.textContent = `🪙 10コイン${pityHint}`;
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

    // Pick theme
    const theme = pickTheme(annotated, tr);

    // Filter candidates by theme
    let pool = theme.cats === null
      ? annotated
      : annotated.filter(p => theme.cats.includes(p.cat));
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

  async function turnGachapon() {
    const turnBtn = $('#btn-turn');
    if (turnBtn.disabled) return;

    // Cost check / deduct
    const freeRemain = Math.max(0, 3 - gacha.freeUsedToday);
    if (freeRemain > 0) {
      gacha.freeUsedToday += 1;
    } else {
      if (gacha.coins < 10) {
        showStage('empty');
        return;
      }
      gacha.coins -= 10;
    }
    gachaSave();
    gachaUpdateUI();

    state.sessionPullCount = (state.sessionPullCount || 0) + 1;

    // Pick the route up front
    const route = pickOneCourse();
    if (!route) {
      showToast('該当するコースがありません', 'error');
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

  function showGachaModal() {
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
      if (state.candidates.length === 0) {
        showToast('まず「寄り道候補を探す」を押してください', 'error');
        return;
      }
      const ctx = `📍 ${state.origin.shortLabel || '出発地'}` + (state.dest ? ` → 🚩 ${state.dest.shortLabel || '目的地'}` : '（散歩モード）');
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

    // Description (only for curated courses)
    const descEl = $('#route-description');
    if (route.description) {
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
      const perk = (window.YORIMICHI_PERKS || {})[stop.name];
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

    // Share result
    const shareBtn = $('#result-share');
    if (shareBtn) {
      shareBtn.onclick = () => shareGachaResult(route);
    }

    // Confetti for top rarities
    if (route.rarity === 'legendary') {
      fireConfetti(120, ['#ff5722', '#ffd700', '#e91e63', '#9c27b0', '#00bcd4']);
    } else if (route.rarity === 'sr') {
      fireConfetti(60, ['#ff9800', '#ffc107', '#ff5722']);
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
  }

  function fireConfetti(count, colors) {
    const container = $('#confetti');
    container.hidden = false;
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      const c = colors[i % colors.length];
      piece.style.setProperty('--c', c);
      piece.style.setProperty('--r', (Math.random() * 360) + 'deg');
      piece.style.setProperty('--d', (2 + Math.random() * 2) + 's');
      piece.style.left = (Math.random() * 100) + 'vw';
      piece.style.animationDelay = (Math.random() * 0.5) + 's';
      container.appendChild(piece);
    }
    setTimeout(() => { container.hidden = true; container.innerHTML = ''; }, 4500);
  }

  // ---------- Shop ----------

  function showShop() {
    $('#gacha-modal').hidden = true;
    $('#shop-modal').hidden = false;
  }
  function hideShop() {
    $('#shop-modal').hidden = true;
  }

  function purchaseCoins(coins, yen, bonus = 0) {
    const total = coins + bonus;
    gacha.coins += total;
    gachaSave();
    gachaUpdateUI();
    hideShop();
    showToast(`🪙 ${total} コイン購入完了！(¥${yen})`, 'success', 3000);
    // Re-open gacha
    setTimeout(() => { $('#gacha-modal').hidden = false; showStage('select'); gachaUpdateUI(); }, 300);
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
    // Pokedex-style: show ALL canonical courses; discovered ones are revealed, others are silhouettes
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
        <span class="meta-pill">💴 ${escapeHtml(course.budget || '無料')}</span>
        <span class="meta-pill">🚶 ${course.travelMode === 'walk' ? '徒歩' : course.travelMode === 'bike' ? '自転車' : '車'}</span>
      </div>
      <div class="cd-desc">${escapeHtml(tField(course, 'description'))}</div>

      ${course.tags?.length ? `<div class="detail-tags">${course.tags.map(t => `<span class="detail-tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}

      ${renderTimeline(course.stops)}

      <div class="cd-stops-title">📍 経由スポット</div>
      <div class="cd-stops">
        ${course.stops.map((s, i) => {
          const photoUrl = (window.YORIMICHI_PHOTOS || {})[s.name];
          const perk = (window.YORIMICHI_PERKS || {})[s.name];
          const thumb = photoUrl
            ? `<span class="cd-stop-thumb" style="background-image:url('${photoUrl}')"></span>`
            : `<span class="cd-stop-emoji">${s.emoji || '📍'}</span>`;
          return `
          <div class="cd-stop">
            <span class="cd-stop-num">${i + 1}</span>
            ${thumb}
            <div class="cd-stop-info">
              <div class="cd-stop-name">${escapeHtml(tField(s, 'name'))}${perk ? ' <span class="cd-perk-tag">🎫 特典あり</span>' : ''}</div>
              <div class="cd-stop-desc">${s.bestTime ? `<span class="cd-besttime">🕐 ${escapeHtml(s.bestTime)}</span> ` : ''}${escapeHtml(tField(s, 'desc'))}</div>
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
      if (gacha.coins < 10) {
        showStage('empty');
        return;
      }
      gacha.coins -= 10;
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
        const c = parseInt(item.dataset.coins, 10);
        const y = parseInt(item.dataset.yen, 10);
        const b = parseInt(item.dataset.bonus || '0', 10);
        purchaseCoins(c, y, b);
      });
    });
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
  const STREAK_REWARDS = [
    { day: 2, coins: 10, msg: '2日目！🪙10ゲット' },
    { day: 3, coins: 20, msg: '三日坊主突破！🪙20' },
    { day: 5, coins: 30, msg: '5日連続！🪙30' },
    { day: 7, coins: 50, msg: '一週間皆勤！🪙50＋限定LR解禁の可能性' },
    { day: 14, coins: 100, msg: '半月達成！🪙100' },
    { day: 30, coins: 300, msg: '1か月皆勤！🪙300の大盤振る舞い' },
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
    if (!reward && state.loginStreak >= 2) reward = { day: state.loginStreak, coins: 5, msg: `連続${state.loginStreak}日目！🪙5` };
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
    [1, 2, 3].forEach(i => {
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
    };

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
    // Welcome voice
    const first = state.selected[0];
    if (first) speak(`ウォーク開始！最初のスポット、${first.name}を目指しましょう`);
  }

  function stopWalk() {
    if (state.activeWalk && state.activeWalk.gpsWatchId != null) {
      navigator.geolocation.clearWatch(state.activeWalk.gpsWatchId);
    }
    state.activeWalk = null;
    if (state.userMarker) { state.userMarker.remove(); state.userMarker = null; }
    $('#walk-session').hidden = true;
    $('#walk-start').hidden = false;
    $('#walk-stop').hidden = true;
    renderSelectedMarkers();
    showToast('ウォーク終了', 'info');
  }

  function onGpsUpdate(pos) {
    const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
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
  }

  function checkInStop(idx, manual = false) {
    if (!state.activeWalk) return;
    const courseId = state.activeWalk.courseId;
    const visited = state.completedStops[courseId];
    if (visited.has(idx)) return;
    visited.add(idx);
    saveCompletion();

    const stop = state.selected[idx];
    showStampBurst(stop);
    fireConfetti(40, ['#ffd700', '#16a34a', '#ff7e3d']);
    playSfx('stamp');
    speak(`${stop.name}に到着しました。スタンプGET。${stop.desc ? stop.desc.slice(0, 50) : ''}`);
    updateWalkUI();
    renderSelectedMarkers();

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
    fireConfetti(150, ['#ffd700', '#16a34a', '#ff7e3d', '#ec4899', '#3b82f6']);
    speak('コース完走、おめでとうございます！');
    // Bonus coins for completion
    gacha.coins += 5;
    gachaSave();
    showToast('🪙 完走ボーナス +5コイン！', 'success', 4000);

    const course = (window.YORIMICHI_COURSES || []).find(c => c.id === courseId);
    setTimeout(() => {
      stopWalk();
      if (course) showCertificate(course);
      else showToast('🏅 完走おめでとう！', 'success', 4000);
      checkNewBadges();
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
    fireConfetti(300, ['#ffd700', '#ff7e3d', '#ec4899', '#9c27b0', '#3b82f6', '#16a34a']);
    speak('全コース発見コンプリート！おめでとう！');
    burst.querySelector('.cb-close').onclick = () => burst.remove();
    setTimeout(() => { if (burst.parentElement) burst.remove(); }, 6000);
  }

  // Generate certificate as PNG using Canvas
  function downloadCertPng(course) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');

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

    // Date
    const today = new Date();
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    ctx.font = '32px sans-serif';
    ctx.fillStyle = '#6b6b72';
    ctx.fillText(dateStr, canvas.width / 2, 1480);

    // Footer brand
    ctx.font = 'bold 56px sans-serif';
    ctx.fillStyle = '#ff7e3d';
    ctx.fillText('👣 寄り道マップ', canvas.width / 2, 1700);

    ctx.font = '28px sans-serif';
    ctx.fillStyle = '#6b6b72';
    ctx.fillText('あと◯分あったら、どこ寄る？', canvas.width / 2, 1760);

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

寄り道マップで散歩コースをガチャしてみよう👣`;
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

  function showCertificate(course) {
    $('#cert-modal').hidden = false;
    $('#cert-course').textContent = tField(course, 'name');
    $('#cert-area').textContent = `${course.areaIcon} ${tField(course, 'areaName')}`;

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

    const shareText = `${course.name} を完走しました！🏅\n${course.areaIcon} ${course.areaName}\n👣 寄り道マップ`;
    const shareUrl = location.href.split('#')[0];

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
    $('#cert-download').onclick = () => downloadCertPng(course);

    // Suggest next course (smart pick: prefer same area > undiscovered > others)
    const next = pickNextSuggestion(course);
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

    // Online/offline detection
    window.addEventListener('offline', () => {
      showToast('📡 オフラインです。地図とルート計算が制限されます', 'error', 5000);
    });
    window.addEventListener('online', () => {
      showToast('📡 オンラインに復帰しました', 'success', 2500);
    });

    // PWA install prompt (Android Chrome)
    let deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      // Show install banner after 30s if not dismissed
      setTimeout(showPwaInstallBanner, 30000);
    });

    function showPwaInstallBanner() {
      let dismissed = false;
      try { dismissed = localStorage.getItem('yorimichi-pwa-dismissed') === '1'; } catch (e) {}
      if (dismissed) return;
      if (window.matchMedia('(display-mode: standalone)').matches) return; // already installed
      const banner = document.createElement('div');
      banner.className = 'pwa-install-banner';
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
      if (isIOS) {
        banner.innerHTML = `
          📱 ホーム画面に追加すると、アプリ感覚で使えます
          <small>共有 → 「ホーム画面に追加」</small>
          <button class="pwa-dismiss">了解</button>
        `;
      } else if (deferredInstallPrompt) {
        banner.innerHTML = `
          📱 ホーム画面に追加？ ネイティブアプリのように使えます
          <button class="pwa-install">追加</button>
          <button class="pwa-dismiss">後で</button>
        `;
        banner.querySelector('.pwa-install').onclick = async () => {
          deferredInstallPrompt.prompt();
          const result = await deferredInstallPrompt.userChoice;
          if (result.outcome === 'accepted') {
            showToast('🎉 ホーム画面に追加しました', 'success');
          }
          banner.remove();
          deferredInstallPrompt = null;
        };
      } else {
        return; // no install possible
      }
      banner.querySelector('.pwa-dismiss').onclick = () => {
        try { localStorage.setItem('yorimichi-pwa-dismissed', '1'); } catch (e) {}
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
