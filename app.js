const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const list = $('#surah-list');
const verses = $('#verses');
const template = $('#verse-template');
let chapters = [];
let tafsirChapters = [];
let recitationData = {};
const officialChapterTimings = new Map();
let current = Number(localStorage.getItem('quran-last-surah')) || 1;
let lastReadAyah = Number(localStorage.getItem('quran-last-ayah')) || 1;
const ARABIC_SIZE_MIN = 16;
const ARABIC_SIZE_MAX = 64;
let size = Number(localStorage.getItem('quran-arabic-size')) || 42;
let activeLibrary = localStorage.getItem('quran-library') || 'surahs';
let libraryOpen = localStorage.getItem('quran-library-open') !== 'false';
const TAJWEED_SETTING_VERSION = 'v3';
if (localStorage.getItem('quran-tajweed-setting-version') !== TAJWEED_SETTING_VERSION) {
  localStorage.setItem('quran-tajweed-setting-version', TAJWEED_SETTING_VERSION);
  localStorage.setItem('quran-tajweed', 'true');
}
let tajweedEnabled = localStorage.getItem('quran-tajweed') !== 'false';
let readingMode = localStorage.getItem('quran-reading-mode') || 'both';
const AUDIO_CACHE_NAME = 'quran-reader-audio-v3';
const NATIVE_AUDIO_DOWNLOADS_KEY = 'quran-native-recitation-downloads-v1';
const BROWSER_AUDIO_DOWNLOADS_KEY = 'quran-browser-recitation-downloads-v1';
const QF_CONTENT_SYNC_STATE_KEY = 'quran-content-sync-state-v1';
const NATIVE_AUDIO_DIRECTORY = 'DATA';
// Reserved for the isolated Content Sync implementation while QF support work
// continues. The active temporary offline policy is defined below.
const QF_CONTENT_SYNC_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;
const QF_CONTENT_SYNC_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;
// Temporary ordinary QF storage limit: a local MP3 is valid only from the
// moment a fresh Worker-served QF copy is written, for at most seven days.
const OFFLINE_AUDIO_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_AUDIO_REFRESH_EARLY_MS = 6 * 24 * 60 * 60 * 1000;
const QF_CHAPTER_RECITER_IDS = Object.freeze({ maher: 159, 'abdul-basit': 1, minshawi: 9, yasser: 174 });
const QF_WORKER_ORIGIN = 'https://quran-reader.muhammedwaheed741.workers.dev';
let preparedAudioSurah = 0;
let reciter = localStorage.getItem('quran-reciter') || 'maher';
let highlightedAyah = 0;
let activeAudioSource = null;
let nativeAudioPlugins = null;
let nativeAudioDownloadRegistry = {};
let nativeAudioRegistryLoaded = false;
let browserAudioDownloadRegistry = {};
let contentSyncState = {};
let contentSyncStateLoaded = false;
let isScrubbingAudio = false;
let activeReaderOverlay = null;
let audioSurface = null;
let resetHomeWhenVisible = false;
let readerControlsHidden = false;
let lastReaderScrollY = 0;
let readerScrollDirection = 0;
let readerScrollDistance = 0;
const juzStarts = [[1,1],[2,142],[2,253],[3,93],[4,24],[4,148],[5,82],[6,111],[7,88],[8,41],[9,93],[11,6],[12,53],[15,1],[17,1],[18,75],[21,1],[23,1],[25,21],[27,56],[29,46],[33,31],[36,28],[39,32],[41,47],[46,1],[51,31],[58,1],[67,1],[78,1]];

function resetScreenScroll() {
  setReaderControlsHidden(false);
  lastReaderScrollY = 0;
  readerScrollDirection = 0;
  readerScrollDistance = 0;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
}

function readerIsActive() {
  return !$('#reader').hidden
    && $('#home-screen').hidden
    && $('#surahs').classList.contains('collapsed')
    && $('#listen-page').hidden
    && !$('#reader-content').hidden;
}

function readerControlInteractionOpen() {
  return !$('#reader-options-sheet').hidden || !$('#reader-audio-panel').hidden;
}

function setReaderControlsHidden(hidden) {
  const next = Boolean(hidden);
  if (readerControlsHidden === next) return;
  readerControlsHidden = next;
  document.body.classList.toggle('reader-controls-hidden', next);
}

function handleReaderScroll() {
  const nextY = Math.max(0, window.scrollY);
  const delta = nextY - lastReaderScrollY;
  lastReaderScrollY = nextY;

  if (!readerIsActive() || readerControlInteractionOpen()) {
    setReaderControlsHidden(false);
    readerScrollDirection = 0;
    readerScrollDistance = 0;
    return;
  }
  if (nextY < 48) {
    setReaderControlsHidden(false);
    readerScrollDirection = 0;
    readerScrollDistance = 0;
    return;
  }
  if (Math.abs(delta) < 2) return;

  const direction = delta > 0 ? 1 : -1;
  if (direction !== readerScrollDirection) {
    readerScrollDirection = direction;
    readerScrollDistance = 0;
  }
  readerScrollDistance += Math.abs(delta);
  if (readerScrollDistance < 12) return;

  setReaderControlsHidden(direction === 1);
  readerScrollDistance = 0;
}

function renderList(filter = '') {
  const needle = filter.toLowerCase();
  list.innerHTML = '';
  chapters.filter((chapter) => `${chapter.number} ${chapter.englishName} ${chapter.name}`.toLowerCase().includes(needle)).forEach((chapter) => {
    const button = document.createElement('button');
    button.className = `surah-card ${chapter.number === current ? 'current' : ''}`;
    button.innerHTML = `<span class="chapter-no">${chapter.number}</span><span><strong>${chapter.englishName}</strong><small>${chapter.englishNameTranslation} · ${chapter.arabic.length} verses</small></span><span class="card-arabic" dir="rtl">${chapter.name}</span>`;
    button.onclick = () => loadSurah(chapter.number);
    list.append(button);
  });
}

function renderJuzList(filter = '') {
  const needle = filter.toLowerCase();
  const juzList = $('#juz-list');
  juzList.innerHTML = '';
  juzStarts.forEach(([surahNumber, ayahNumber], index) => {
    const chapter = chapters[surahNumber - 1];
    const label = `Juz ${index + 1} ${chapter.englishName} ${surahNumber}:${ayahNumber}`;
    if (!label.toLowerCase().includes(needle)) return;
    const button = document.createElement('button');
    button.className = 'juz-card';
    button.innerHTML = `<span class="juz-number">${String(index + 1).padStart(2, '0')}</span><span><strong>Juz ${index + 1}</strong><small>Starts at ${chapter.englishName}, verse ${ayahNumber}</small></span><span class="card-arabic" dir="rtl">الجزء ${index + 1}</span>`;
    button.onclick = () => loadSurah(surahNumber, ayahNumber);
    juzList.append(button);
  });
}

function switchLibrary(kind) {
  activeLibrary = kind;
  localStorage.setItem('quran-library', kind);
  const isSurahs = kind === 'surahs';
  $('#surah-list').hidden = !isSurahs;
  $('#juz-list').hidden = isSurahs;
  $('#library-title').textContent = isSurahs ? 'Choose a Surah' : 'Choose a Juz';
  $('#surah-search').placeholder = isSurahs ? 'Search name or number' : 'Search juz number or surah';
  $$('.library-tab').forEach((tab) => {
    const selected = tab.dataset.library === kind;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', selected);
  });
  (isSurahs ? renderList : renderJuzList)($('#surah-search').value);
}

function setLibraryOpen(open, shouldScroll = false) {
  libraryOpen = open;
  localStorage.setItem('quran-library-open', open);
  $('#surahs').classList.toggle('collapsed', !open);
  $('#library-toggle').setAttribute('aria-expanded', open);
  $('#library-toggle').innerHTML = open ? '<span>×</span> Close browser' : '<span>☷</span> Browse Quran';
  if (open && shouldScroll) resetScreenScroll();
}

function showHome({ resetScroll = true } = {}) {
  setReaderOptionsOpen(false);
  closeReaderAudioPanel();
  closeListenPage();
  closeUtilityPanel();
  $('#reader').hidden = true;
  $('#home-screen').hidden = false;
  $('#home-last-surah').textContent = $('#last-surah').textContent;
  $('#home-last-verse').textContent = $('#last-verse').textContent;
  if (resetScroll) resetScreenScroll();
}

function showReader({ browse = false } = {}) {
  $('#home-screen').hidden = true;
  $('#reader').hidden = false;
  closeUtilityPanel();
  setReaderOptionsOpen(false);
  setLibraryOpen(browse, false);
  setReaderControlsHidden(false);
  resetScreenScroll();
}

function setActiveReaderOverlay(nextOverlay = null) {
  activeReaderOverlay = nextOverlay;
  const sheet = $('#reader-options-sheet');
  const optionsOpen = nextOverlay === 'reader-options';
  if (optionsOpen) setReaderControlsHidden(false);
  sheet.hidden = !optionsOpen;
  $('#reader-options-button').setAttribute('aria-expanded', String(optionsOpen));
  if (optionsOpen) {
    requestAnimationFrame(() => {
      const button = $('#reader-options-button').getBoundingClientRect();
      const needsUpwardPosition = sheet.offsetHeight > window.innerHeight - button.bottom - 14 && button.top > window.innerHeight - button.bottom;
      sheet.classList.toggle('opens-upward', needsUpwardPosition);
    });
  }
}

function setReaderOptionsOpen(open) {
  setActiveReaderOverlay(open ? 'reader-options' : null);
}

function openListenPage() {
  setReaderOptionsOpen(false);
  closeListenSelection();
  $('#reader-audio-panel').hidden = true;
  moveAudioPlayerTo('listen');
  $('#listen-page').hidden = false;
  document.body.classList.add('listen-page-open');
  $('#listen-page-title').textContent = chapters[current - 1]?.englishName || `Surah ${current}`;
  $('#listen-surah-select').value = String(current);
  $('#audio-player').hidden = false;
  audioSurface = 'listen';
  updateListenPresentation();
  resetScreenScroll();
}

function closeListenPage() {
  closeListenSelection();
  $('#listen-page').hidden = true;
  document.body.classList.remove('listen-page-open');
  if (audioSurface === 'listen') {
    $('#audio-player').hidden = true;
    audioSurface = null;
  }
}

function openReaderAudioPanel() {
  setReaderOptionsOpen(false);
  closeListenPage();
  setReaderControlsHidden(false);
  moveAudioPlayerTo('reader');
  $('#reader-audio-panel').hidden = false;
  $('#audio-player').hidden = false;
  audioSurface = 'reader';
}

function closeReaderAudioPanel() {
  $('#reader-audio-panel').hidden = true;
  if (audioSurface === 'reader') {
    $('#audio-player').hidden = true;
    audioSurface = null;
  }
}

function closeAudioSurface() {
  if (audioSurface === 'reader') closeReaderAudioPanel();
  else closeListenPage();
}

function moveAudioPlayerTo(surface) {
  const slot = surface === 'reader' ? $('#reader-audio-slot') : $('#listen-audio-slot');
  const player = $('#audio-player');
  if (player.parentElement !== slot) slot.append(player);
  player.classList.remove('audio-popover');
  player.classList.toggle('listen-page-player', surface === 'listen');
  player.classList.toggle('reader-audio-player', surface === 'reader');
}

function closeDrawer() {
  $('#main-drawer').classList.remove('open');
  $('#drawer-backdrop').hidden = true;
  $('.mobile-menu').setAttribute('aria-expanded', 'false');
}

function openDrawer() {
  $('#main-drawer').classList.add('open');
  $('#drawer-backdrop').hidden = false;
  $('.mobile-menu').setAttribute('aria-expanded', 'true');
}

function setDrawerSection(section) {
  $$('[data-drawer-action]').forEach((item) => item.classList.toggle('active', item.dataset.drawerAction === section));
}

function closeUtilityPanel() {
  const panel = $('#utility-panel');
  panel.hidden = true;
  panel.innerHTML = '';
  document.body.classList.remove('utility-view');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function reciterLabel(reciterId) {
  return $('#reciter-select').querySelector(`option[value="${reciterId}"]`)?.textContent || reciterId;
}

function updateListenPresentation() {
  const chapter = chapters[current - 1];
  if (!chapter) return;
  $('#listen-page-title').textContent = chapter.englishName;
  $('#listen-page-meaning').textContent = chapter.englishNameTranslation;
  $('#listen-art-number').textContent = `SURAH ${chapter.number}`;
  $('#listen-reciter-name').textContent = reciterLabel(reciter);
  document.body.classList.toggle('listen-is-playing', !$('#recitation-audio').paused && !$('#listen-page').hidden);
  refreshListenDownloadStatus();
}

async function refreshListenDownloadStatus() {
  const button = $('#listen-download-action');
  const selectedSurah = current;
  const selectedReciter = reciter;
  const remoteUrl = reciterAudioUrl(selectedSurah);
  const key = nativeAudioKey(selectedReciter, selectedSurah);
  button.disabled = true;
  button.textContent = 'Checking offline availability…';
  let downloaded = false;
  let expired = false;
  if (isNativeApp() && remoteUrl) {
    const local = await verifiedNativeAudio(selectedSurah, remoteUrl);
    downloaded = Boolean(local.source);
    expired = Boolean(local.expired);
  } else {
    const local = await verifiedBrowserAudio(selectedReciter, selectedSurah, remoteUrl);
    downloaded = local.available;
    expired = local.expired;
  }
  // Ignore a delayed check after the user has chosen a different track.
  if (selectedSurah !== current || selectedReciter !== reciter) return;
  button.disabled = false;
  button.classList.toggle('downloaded', downloaded);
  if (downloaded) button.innerHTML = '✓ Available Offline <span aria-hidden="true">Remove</span>';
  else if (expired) button.innerHTML = 'Expired · Refresh Online <span aria-hidden="true">↓</span>';
  else if (!navigator.onLine) button.innerHTML = 'Not Available Offline <span aria-hidden="true">!</span>';
  else button.innerHTML = 'Download for Offline <span aria-hidden="true">↓</span>';
}

function audioDownloadedAt(item) {
  const value = Date.parse(item?.downloadedAt || '');
  return Number.isFinite(value) ? value : NaN;
}

function offlineAudioIsValid(item, now = Date.now()) {
  const downloadedAt = audioDownloadedAt(item);
  return item?.status === 'complete'
    && Number.isFinite(downloadedAt)
    && downloadedAt <= now
    && now - downloadedAt < OFFLINE_AUDIO_VALIDITY_MS;
}

function offlineAudioNeedsRefresh(item, now = Date.now()) {
  const downloadedAt = audioDownloadedAt(item);
  return offlineAudioIsValid(item, now) && now - downloadedAt >= OFFLINE_AUDIO_REFRESH_EARLY_MS;
}

function browserAudioKey(reciterId, surahNumber) {
  return nativeAudioKey(reciterId, surahNumber);
}

function loadBrowserAudioDownloads() {
  try {
    browserAudioDownloadRegistry = JSON.parse(localStorage.getItem(BROWSER_AUDIO_DOWNLOADS_KEY) || '{}');
  } catch {
    browserAudioDownloadRegistry = {};
  }
}

function saveBrowserAudioDownloads(downloads) {
  browserAudioDownloadRegistry = downloads;
  localStorage.setItem(BROWSER_AUDIO_DOWNLOADS_KEY, JSON.stringify(downloads));
}

async function verifiedBrowserAudio(reciterId, surahNumber, remoteUrl) {
  if (!remoteUrl || !('caches' in window)) return { available: false, expired: false };
  const key = browserAudioKey(reciterId, surahNumber);
  const item = browserAudioDownloadRegistry[key];
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const cached = await cache.match(remoteUrl);
    if (!cached) {
      if (item) {
        delete browserAudioDownloadRegistry[key];
        saveBrowserAudioDownloads(browserAudioDownloadRegistry);
      }
      return { available: false, expired: false };
    }
    if (!offlineAudioIsValid(item)) {
      await cache.delete(remoteUrl);
      if (item) {
        delete browserAudioDownloadRegistry[key];
        saveBrowserAudioDownloads(browserAudioDownloadRegistry);
      }
      return { available: false, expired: true };
    }
    return { available: true, expired: false, item };
  } catch {
    return { available: false, expired: false };
  }
}

async function removeBrowserAudioDownload(remoteUrl) {
  if (!remoteUrl || !('caches' in window)) return;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    await cache.delete(remoteUrl);
    Object.keys(browserAudioDownloadRegistry).forEach((key) => {
      if (browserAudioDownloadRegistry[key]?.remoteUrl === remoteUrl) delete browserAudioDownloadRegistry[key];
    });
    saveBrowserAudioDownloads(browserAudioDownloadRegistry);
  } catch {
    // A failed cache cleanup must not prevent normal streaming.
  }
}

async function downloadedRecitationEntries() {
  if (isNativeApp()) {
    // The native registry is written only after Filesystem.stat has succeeded.
    // Do not use insertion order: it represents download history, not Quran order.
    return Object.entries(nativeAudioDownloads())
      .filter(([, item]) => item?.status === 'complete' && Number.isInteger(Number(item.surah)))
      .map(([key, item]) => ({ key, ...item, expired: !offlineAudioIsValid(item), storage: 'native' }));
  }

  if (!('caches' in window)) return [];
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const entries = [];
    for (const [key, item] of Object.entries(browserAudioDownloadRegistry)) {
      const cached = item?.remoteUrl && await cache.match(item.remoteUrl);
      if (cached && offlineAudioIsValid(item)) entries.push({ key, ...item, storage: 'browser' });
      else if (cached) await cache.delete(item.remoteUrl);
      else if (item) delete browserAudioDownloadRegistry[key];
    }
    saveBrowserAudioDownloads(browserAudioDownloadRegistry);
    return entries;
  } catch {
    return [];
  }
}

async function renderDownloadedRecitations(panel) {
  const entries = (await downloadedRecitationEntries())
    .sort((a, b) => Number(a.surah) - Number(b.surah)
      || reciterLabel(a.reciter).localeCompare(reciterLabel(b.reciter)));
  if (panel.hidden || !document.body.contains(panel)) return;

  const header = '<header class="utility-header"><div><p class="eyebrow">AVAILABLE OFFLINE</p><h2>Downloads</h2></div><button class="utility-browse" id="utility-browse" type="button">Browse Quran</button><button class="utility-close" aria-label="Close downloads">×</button></header>';
  panel.innerHTML = `${header}${entries.length ? `<div class="utility-list">${entries.map((item, index) => `<div class="utility-item download-item"><span class="utility-number">${item.surah}</span><span><strong>${escapeHtml(chapters[item.surah - 1]?.englishName || `Surah ${item.surah}`)}</strong><small>${escapeHtml(reciterLabel(item.reciter))}${item.expired ? ' · Expired — refresh online' : ' · Available offline'}</small></span><button class="download-delete" data-download-index="${index}" aria-label="Delete downloaded recitation">Delete</button></div>`).join('')}</div>` : '<p class="utility-empty">No recitations have been downloaded yet. Play a surah while online to save it for offline listening.</p>'}`;
  panel.querySelector('.utility-close')?.addEventListener('click', closeUtilityPanel);
  panel.querySelector('#utility-browse')?.addEventListener('click', () => {
    closeUtilityPanel();
    setDrawerSection('browse');
    setLibraryOpen(true, true);
  });
  panel.querySelectorAll('[data-download-index]').forEach((button) => {
    button.onclick = async () => {
      const item = entries[Number(button.dataset.downloadIndex)];
      if (!item) return;
      if (item.storage === 'native') await removeNativeAudioDownload(item.key, true);
      else await removeBrowserAudioDownload(item.remoteUrl);
      await renderDownloadedRecitations(panel);
      await refreshListenDownloadStatus();
    };
  });
}

function closeListenSelection() {
  $('#listen-selection-sheet').hidden = true;
  $('#listen-selection-search').value = '';
}

function openListenSelection(kind) {
  const sheet = $('#listen-selection-sheet');
  const list = $('#listen-selection-list');
  $('#listen-selection-title').textContent = kind === 'surah' ? 'Choose Surah' : 'Choose Reciter';
  $('#listen-selection-search').placeholder = kind === 'surah' ? 'Search surah' : 'Search reciter';
  sheet.dataset.kind = kind;
  sheet.hidden = false;
  const render = () => {
    const query = $('#listen-selection-search').value.trim().toLowerCase();
    if (kind === 'surah') {
      list.innerHTML = chapters.filter((chapter) => `${chapter.number} ${chapter.englishName} ${chapter.englishNameTranslation} ${chapter.name}`.toLowerCase().includes(query)).map((chapter) => `<button type="button" data-listen-surah="${chapter.number}"><span>${chapter.number}</span><strong>${escapeHtml(chapter.englishName)}</strong><small>${escapeHtml(chapter.name)} · ${escapeHtml(chapter.englishNameTranslation)}</small></button>`).join('');
      list.querySelectorAll('[data-listen-surah]').forEach((button) => { button.onclick = async () => { await loadSurah(Number(button.dataset.listenSurah), 1, false); openListenPage(); closeListenSelection(); }; });
      return;
    }
    list.innerHTML = Array.from($('#reciter-select').options).filter((option) => option.textContent.toLowerCase().includes(query)).map((option) => `<button type="button" data-listen-reciter="${escapeHtml(option.value)}"><strong>${escapeHtml(option.textContent)}</strong><small>${option.value === reciter ? 'Selected' : 'Choose reciter'}</small></button>`).join('');
    list.querySelectorAll('[data-listen-reciter]').forEach((button) => { button.onclick = () => { $('#reciter-select').value = button.dataset.listenReciter; $('#reciter-select').dispatchEvent(new Event('change')); updateListenPresentation(); closeListenSelection(); }; });
  };
  $('#listen-selection-search').oninput = render;
  render();
  requestAnimationFrame(() => $('#listen-selection-search').focus());
}

function openUtilityPanel(section) {
  showReader();
  const panel = $('#utility-panel');
  panel.hidden = false;
  document.body.classList.add('utility-view');
  setLibraryOpen(false);
  setDrawerSection(section);

  if (section === 'bookmarks') {
    const bookmarks = Object.keys(localStorage)
      .filter((key) => key.startsWith('quran-bookmark-'))
      .map((key) => key.match(/^quran-bookmark-(\d+)-(\d+)$/))
      .filter(Boolean)
      .map(([, surah, ayah]) => ({ surah: Number(surah), ayah: Number(ayah) }))
      .sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);
    panel.innerHTML = `<header class="utility-header"><div><p class="eyebrow">SAVED VERSES</p><h2>Bookmarks</h2></div><button class="utility-close" aria-label="Close bookmarks">×</button></header>${bookmarks.length ? `<div class="utility-list">${bookmarks.map(({ surah, ayah }) => `<button class="utility-item" data-bookmark-surah="${surah}" data-bookmark-ayah="${ayah}"><span class="utility-number">${surah}:${ayah}</span><span><strong>${escapeHtml(chapters[surah - 1]?.englishName || `Surah ${surah}`)}</strong><small>Open saved verse</small></span><span>›</span></button>`).join('')}</div>` : '<p class="utility-empty">No bookmarks yet. Tap the heart beside any verse to save it here.</p>'}`;
    panel.querySelectorAll('[data-bookmark-surah]').forEach((button) => {
      button.onclick = () => { closeUtilityPanel(); loadSurah(Number(button.dataset.bookmarkSurah), Number(button.dataset.bookmarkAyah)); };
    });
  }

  if (section === 'downloads') {
    panel.innerHTML = '<header class="utility-header"><div><p class="eyebrow">AVAILABLE OFFLINE</p><h2>Downloads</h2></div><button class="utility-close" aria-label="Close downloads">×</button></header><p class="utility-empty">Checking downloaded recitations…</p>';
    renderDownloadedRecitations(panel);
  }

  if (section === 'settings') {
    const reciterOptions = Array.from($('#reciter-select').options).map((option) => `<option value="${option.value}" ${option.value === reciter ? 'selected' : ''}>${escapeHtml(option.textContent)}</option>`).join('');
    panel.innerHTML = `<header class="utility-header"><div><p class="eyebrow">READER PREFERENCES</p><h2>Settings</h2></div><button class="utility-close" aria-label="Close settings">×</button></header><div class="settings-list"><label>Theme<select id="setting-theme"><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Default reading mode<select id="setting-mode"><option value="both">Arabic &amp; translation</option><option value="arabic">Arabic only</option><option value="transliteration">Arabic &amp; transliteration</option><option value="tafsir">Tafsir</option></select></label><label class="setting-toggle">Tajweed colours<input id="setting-tajweed" type="checkbox" ${tajweedEnabled ? 'checked' : ''} /></label><label>Quran font size <output id="setting-size-output">${size}px</output><input id="setting-size" type="range" min="${ARABIC_SIZE_MIN}" max="${ARABIC_SIZE_MAX}" value="${size}" /></label><label>Preferred reciter<select id="setting-reciter">${reciterOptions}</select></label></div>`;
    $('#setting-theme').value = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
    $('#setting-mode').value = readingMode;
    $('#setting-theme').onchange = (event) => setTheme(event.target.value === 'dark');
    $('#setting-mode').onchange = (event) => setReadingMode(event.target.value);
    $('#setting-tajweed').onchange = (event) => setTajweedEnabled(event.target.checked);
    $('#setting-size').oninput = (event) => { setArabicSize(event.target.value); $('#setting-size-output').textContent = `${size}px`; };
    $('#setting-reciter').onchange = (event) => { $('#reciter-select').value = event.target.value; $('#reciter-select').dispatchEvent(new Event('change')); };
  }

  if (section === 'about') {
    panel.innerHTML = '<header class="utility-header"><div><p class="eyebrow">QURAN READER</p><h2>About</h2></div><button class="utility-close" aria-label="Close about">×</button></header><div class="about-copy"><p>Quran Reader 1.0</p><p>An offline-first Quran reader with IndoPak script, tajweed colours, translation, tafsir and recitation downloads.</p><p>Support and privacy details can be added before public release.</p></div>';
  }

  const closeButton = panel.querySelector('.utility-close');
  closeButton?.insertAdjacentHTML('beforebegin', '<button class="utility-browse" id="utility-browse" type="button">Browse Quran</button>');
  closeButton?.addEventListener('click', closeUtilityPanel);
  $('#utility-browse')?.addEventListener('click', () => {
    closeUtilityPanel();
    setDrawerSection('browse');
    setLibraryOpen(true, true);
  });
  resetScreenScroll();
}

async function runDrawerAction(section) {
  closeDrawer();
  if (section === 'read') {
    closeUtilityPanel();
    setDrawerSection('read');
    await loadSurah(current, lastReadAyah, false);
    return;
  }
  if (section === 'browse') {
    closeUtilityPanel();
    setDrawerSection('browse');
    showReader({ browse: true });
    return;
  }
  openUtilityPanel(section);
}

async function runHomeAction(section) {
  if (section === 'read') {
    showReader();
    await loadSurah(current, lastReadAyah, false);
    return;
  }
  if (section === 'browse') {
    showReader({ browse: true });
    return;
  }
  if (section === 'listen') {
    showReader();
    openListenPage();
    return;
  }
  showReader();
  openUtilityPanel(section);
}

async function loadSurah(number, targetAyah = 1, collapseLibrary = true) {
  current = number;
  lastReadAyah = targetAyah;
  localStorage.setItem('quran-last-surah', number);
  localStorage.setItem('quran-last-ayah', targetAyah);
  const chapter = chapters[number - 1];
  if (!chapter) return;
  $('#surah-number').textContent = String(number).padStart(2, '0');
  $('#surah-name').textContent = chapter.englishName;
  $('#crumb-surah').textContent = chapter.englishName;
  $('#reader-meta-title').textContent = `${number} · ${chapter.englishNameTranslation}`;
  $('#listen-page-title').textContent = chapter.englishName;
  $('#listen-surah-select').value = String(number);
  updateListenPresentation();
  $('#surah-english').textContent = chapter.englishNameTranslation;
  $('#surah-meta').textContent = `${chapter.revelationType.toUpperCase()} · ${chapter.arabic.length} VERSES`;
  $('#last-surah').textContent = chapter.englishName;
  $('#last-verse').textContent = `Verse ${targetAyah}`;
  $('#home-last-surah').textContent = chapter.englishName;
  $('#home-last-verse').textContent = `Verse ${targetAyah}`;
  $('#previous-surah').disabled = number === 1;
  $('#next-surah').disabled = number === 114;
  $('#bismillah').style.display = number === 9 ? 'none' : 'flex';
  setActiveReaderOverlay(null);
  const recitationAudio = $('#recitation-audio');
  recitationAudio.pause();
  recitationAudio.removeAttribute('src');
  recitationAudio.load();
  resetAudioControls();
  preparedAudioSurah = 0;
  setHighlightedAyah(0);
  if (collapseLibrary) setLibraryOpen(false);
  renderList($('#surah-search').value);
  verses.innerHTML = '<div class="loader">Opening the Quran…</div>';
  if (targetAyah <= 1) resetScreenScroll();

  renderVerses({ arabic: chapter.arabic, translation: chapter.translation, transliteration: chapter.transliteration, tajweed: chapter.tajweed });
  if (targetAyah > 1) requestAnimationFrame(() => document.getElementById(`ayah-${targetAyah}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

function resetAudioControls() {
  const audio = $('#recitation-audio');
  $('#audio-play-pause').textContent = '▶';
  $('#audio-play-pause').setAttribute('aria-label', 'Play recitation');
  // This control prepares the source on its first press, so it must remain
  // available before an audio URL has been assigned.
  $('#audio-play-pause').disabled = false;
  $('#audio-current-time').textContent = '0:00';
  $('#audio-duration').textContent = '0:00';
  $('#audio-seek').min = '0';
  $('#audio-seek').max = '0';
  $('#audio-seek').value = '0';
  $('#audio-seek').disabled = true;
}

function syncAudioControls() {
  const audio = $('#recitation-audio');
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const seek = $('#audio-seek');
  $('#audio-play-pause').disabled = false;
  $('#audio-play-pause').textContent = audio.paused ? '▶' : 'Ⅱ';
  $('#audio-play-pause').setAttribute('aria-label', audio.paused ? 'Play recitation' : 'Pause recitation');
  $('#audio-current-time').textContent = formatAudioTime(audio.currentTime);
  $('#audio-duration').textContent = formatAudioTime(duration);
  seek.max = String(duration || 0);
  seek.disabled = !duration;
  if (!isScrubbingAudio) seek.value = String(Math.min(audio.currentTime || 0, duration || 0));
}

function qfApiUrl(path) {
  // Capacitor serves bundled files from capacitor://localhost, not from the
  // Worker. Native playback and local development therefore need the public
  // Worker origin; deployed web/PWA requests stay same-origin.
  const localHost = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
  return isNativeApp() || localHost ? new URL(path, QF_WORKER_ORIGIN).toString() : path;
}

function reciterAudioUrlFor(reciterId, surahNumber) {
  const qfReciterId = QF_CHAPTER_RECITER_IDS[reciterId];
  const chapterNumber = Number(surahNumber);
  if (!qfReciterId || !Number.isInteger(chapterNumber) || chapterNumber < 1 || chapterNumber > 114) return '';
  return qfApiUrl(`/api/qf/chapter-audio/${qfReciterId}/${chapterNumber}/file`);
}

function reciterAudioUrl(surahNumber) {
  return reciterAudioUrlFor(reciter, surahNumber);
}

function contentSyncAudioUrlFor(reciterId, surahNumber, resourceId) {
  const qfReciterId = QF_CHAPTER_RECITER_IDS[reciterId];
  const chapterNumber = Number(surahNumber);
  const syncResourceId = Number(resourceId);
  if (!qfReciterId || !Number.isInteger(chapterNumber) || !Number.isInteger(syncResourceId) || syncResourceId <= 0) return '';
  return qfApiUrl(`/api/qf/content-sync/audio/${qfReciterId}/${chapterNumber}?resource_id=${syncResourceId}`);
}

function contentSyncIsCurrent(item) {
  const validatedAt = Date.parse(item?.contentSync?.validatedAt || '');
  return item?.contentSync?.source === 'content-sync'
    && Number.isFinite(validatedAt)
    && Date.now() - validatedAt < QF_CONTENT_SYNC_VALIDITY_MS;
}

function contentSyncNeedsCheck(item) {
  const validatedAt = Date.parse(item?.contentSync?.validatedAt || '');
  return !item?.contentSync?.source
    || !Number.isFinite(validatedAt)
    || Date.now() - validatedAt >= QF_CONTENT_SYNC_INTERVAL_MS;
}

async function validateContentSyncTrack(reciterId, surahNumber, item = {}) {
  const qfReciterId = QF_CHAPTER_RECITER_IDS[reciterId];
  if (!qfReciterId || !navigator.onLine) throw new Error('Content Sync requires an internet connection');
  if (!contentSyncStateLoaded) await loadContentSyncState();
  const state = item.contentSync || {};
  const resourceState = contentSyncState[String(state.resourceId)] || {};
  const response = await fetch(qfApiUrl(`/api/qf/content-sync/validate/${qfReciterId}/${Number(surahNumber)}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: {
        resource_id: state.resourceId,
        sync_token: resourceState.syncToken || state.syncToken,
        record_key: state.recordKey,
      },
    }),
  });
  if (!response.ok) throw new Error('Content Sync validation is unavailable');
  const result = await response.json();
  if (!['unchanged', 'replace', 'delete'].includes(result?.action) || !Number.isInteger(Number(result.resource_id))) {
    throw new Error('Invalid Content Sync validation response');
  }
  contentSyncState[String(result.resource_id)] = {
    syncToken: result.sync_token || resourceState.syncToken || '',
    validatedAt: result.validated_at,
  };
  await saveContentSyncState(contentSyncState);
  return result;
}

function contentSyncMetadata(result) {
  return {
    source: 'content-sync',
    resourceId: Number(result.resource_id),
    recordKey: result.record_key || '',
    validatedAt: result.validated_at,
  };
}

async function loadOfficialChapterTimings(reciterId, surahNumber) {
  const qfReciterId = QF_CHAPTER_RECITER_IDS[reciterId];
  const chapterNumber = Number(surahNumber);
  if (!qfReciterId || !Number.isInteger(chapterNumber)) return;
  const key = `${reciterId}:${chapterNumber}`;
  if (officialChapterTimings.has(key)) return;
  try {
    const response = await fetch(qfApiUrl(`/api/qf/chapter-audio/${qfReciterId}/${chapterNumber}`));
    if (!response.ok) throw new Error('Official recitation metadata unavailable');
    const payload = await response.json();
    const timings = (payload.timestamps || [])
      .map((timestamp) => ({
        time_from: Number(timestamp.timestamp_from),
        time_to: Number(timestamp.timestamp_to),
        duration: Number(timestamp.duration),
        segments: timestamp.segments || [],
      }))
      .filter((timestamp) => Number.isFinite(timestamp.time_from) && Number.isFinite(timestamp.time_to));
    if (timings.length) officialChapterTimings.set(key, timings);
  } catch (error) {
    // The bundled timing data remains the fallback. Do not block playback if
    // official timing metadata is temporarily unavailable.
    audioDiagnostic('official chapter timing unavailable', { reciter: reciterId, surah: chapterNumber, error: String(error) });
  }
}

function isNativeApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

async function ensureNativePluginBridge() {
  if (!isNativeApp() || window.Capacitor?.registerPlugin) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/capacitor.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Capacitor JavaScript bridge could not be loaded'));
    document.head.append(script);
  });
  if (!window.Capacitor?.registerPlugin) throw new Error('Capacitor plugin bridge is unavailable');
  audioDiagnostic('Capacitor JavaScript bridge loaded', { platform: window.Capacitor.getPlatform?.() });
}

function getNativeAudioPlugins() {
  if (!isNativeApp() || !window.Capacitor?.registerPlugin) {
    if (isNativeApp()) audioDiagnostic('native audio plugins unavailable', { hasRegisterPlugin: Boolean(window.Capacitor?.registerPlugin) });
    return null;
  }
  if (!nativeAudioPlugins) {
    nativeAudioPlugins = {
      filesystem: window.Capacitor.registerPlugin('Filesystem'),
      fileTransfer: window.Capacitor.registerPlugin('FileTransfer'),
      preferences: window.Capacitor.registerPlugin('Preferences'),
    };
  }
  return nativeAudioPlugins;
}

function nativeAudioKey(reciterId, surahNumber) {
  return `${reciterId}:${Number(surahNumber)}`;
}

function nativeAudioPath(reciterId, surahNumber) {
  const safeReciter = reciterId.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `recitations/${safeReciter}/surah-${String(Number(surahNumber)).padStart(3, '0')}.mp3`;
}

function audioDiagnostic(event, details) {
  console.info(`[Quran audio] ${event}`, details);
}

function nativeAudioDownloads() {
  return nativeAudioDownloadRegistry;
}

async function saveNativeAudioDownloads(downloads) {
  nativeAudioDownloadRegistry = downloads;
  const plugins = getNativeAudioPlugins();
  if (plugins?.preferences) {
    try {
      await plugins.preferences.set({ key: NATIVE_AUDIO_DOWNLOADS_KEY, value: JSON.stringify(downloads) });
      audioDiagnostic('registry saved to Preferences', { keys: Object.keys(downloads) });
    } catch (error) {
      // The deterministic file path can rebuild the record on the next launch.
      audioDiagnostic('registry save failed; file will be rediscovered by path', { error: String(error) });
    }
    return;
  }
  localStorage.setItem(NATIVE_AUDIO_DOWNLOADS_KEY, JSON.stringify(downloads));
}

async function loadContentSyncState() {
  const plugins = getNativeAudioPlugins();
  try {
    const saved = plugins?.preferences
      ? (await plugins.preferences.get({ key: QF_CONTENT_SYNC_STATE_KEY })).value
      : localStorage.getItem(QF_CONTENT_SYNC_STATE_KEY);
    contentSyncState = saved ? JSON.parse(saved) : {};
  } catch (error) {
    contentSyncState = {};
    audioDiagnostic('Content Sync state load failed', { error: String(error) });
  }
  contentSyncStateLoaded = true;
}

async function saveContentSyncState(state) {
  contentSyncState = state;
  const plugins = getNativeAudioPlugins();
  if (plugins?.preferences) {
    await plugins.preferences.set({ key: QF_CONTENT_SYNC_STATE_KEY, value: JSON.stringify(state) });
    return;
  }
  localStorage.setItem(QF_CONTENT_SYNC_STATE_KEY, JSON.stringify(state));
}

async function loadNativeAudioDownloads() {
  const plugins = getNativeAudioPlugins();
  try {
    const saved = plugins?.preferences
      ? (await plugins.preferences.get({ key: NATIVE_AUDIO_DOWNLOADS_KEY })).value
      : localStorage.getItem(NATIVE_AUDIO_DOWNLOADS_KEY);
    nativeAudioDownloadRegistry = saved ? JSON.parse(saved) : {};
  } catch (error) {
    nativeAudioDownloadRegistry = {};
    audioDiagnostic('registry load failed', { error: String(error) });
  }
  nativeAudioRegistryLoaded = true;
  audioDiagnostic('registry loaded', { native: Boolean(plugins), keys: Object.keys(nativeAudioDownloadRegistry) });
}

function localAudioSrc(uri) {
  return window.Capacitor?.convertFileSrc ? window.Capacitor.convertFileSrc(uri) : uri;
}

async function removeNativeAudioDownload(key, deleteFile = false) {
  const downloads = nativeAudioDownloads();
  const item = downloads[key];
  if (!item) return;
  if (deleteFile) {
    try {
      await getNativeAudioPlugins()?.filesystem.deleteFile({ path: item.localPath, directory: NATIVE_AUDIO_DIRECTORY });
    } catch {
      // The file may already have been removed by iOS or an interrupted download.
    }
  }
  delete downloads[key];
  await saveNativeAudioDownloads(downloads);
}

async function verifiedNativeAudio(surahNumber, remoteUrl) {
  const plugins = getNativeAudioPlugins();
  if (!plugins) return { source: '', missing: false, nativeUnavailable: isNativeApp() };
  if (!nativeAudioRegistryLoaded) await loadNativeAudioDownloads();
  const normalisedSurah = Number(surahNumber);
  const key = nativeAudioKey(reciter, normalisedSurah);
  const localPath = nativeAudioPath(reciter, normalisedSurah);
  const item = nativeAudioDownloads()[key];
  const diagnostic = { reciter, surah: normalisedSurah, key, localPath, metadata: item || null };
  audioDiagnostic('checking native download', diagnostic);

  try {
    // The stable relative path is authoritative. Metadata and old absolute URIs
    // are never trusted across a native app relaunch.
    const stat = await plugins.filesystem.stat({ path: localPath, directory: NATIVE_AUDIO_DIRECTORY });
    audioDiagnostic('Filesystem.stat result', { ...diagnostic, stat });
    if (stat.size != null && Number(stat.size) <= 0) throw new Error('Downloaded audio file is empty');
    const file = await plugins.filesystem.getUri({ path: localPath, directory: NATIVE_AUDIO_DIRECTORY });
    audioDiagnostic('Filesystem.getUri result', { ...diagnostic, uri: file?.uri || null });
    if (!file?.uri) throw new Error('Downloaded audio file has no URI');
    // A file without a verifiable fresh-download timestamp is not permitted
    // offline. Do not create a new timestamp while rediscovering an old file.
    if (!item || item.localPath !== localPath || item.status !== 'complete' || item.remoteUrl !== remoteUrl) {
      await removeNativeAudioDownload(key, true);
      return { source: '', missing: false, expired: true };
    }
    if (!offlineAudioIsValid(item)) {
      await removeNativeAudioDownload(key, true);
      return { source: '', missing: false, expired: true, metadata: item };
    }
    return { source: localAudioSrc(file.uri), missing: false, metadata: item };
  } catch (error) {
    audioDiagnostic('native download not found or invalid', { ...diagnostic, error: String(error) });
    if (item) await removeNativeAudioDownload(key);
    return { source: '', missing: Boolean(item) };
  }
}

async function playRecitation() {
  const audio = $('#recitation-audio');
  const status = $('#audio-status');
  const remoteUrl = reciterAudioUrl(current);
  if (!remoteUrl) {
    status.textContent = 'Recitation data is still loading. Please try again in a moment.';
    return;
  }

  // Fetch QF's matching chapter timestamps in the background before playback.
  // Existing bundled timings remain the safe fallback until this succeeds.
  await loadOfficialChapterTimings(reciter, current);

  const local = await verifiedNativeAudio(current, remoteUrl);
  if (local.nativeUnavailable) {
    status.textContent = 'Native audio storage is unavailable in this build. Please update the app.';
    return;
  }
  if (!local.source && isNativeApp() && !navigator.onLine) {
    status.textContent = local.missing
      ? 'Saved audio is missing or damaged. Connect to download it again.'
      : local.expired
        ? 'This offline recitation has expired. Connect to the internet to download a fresh copy.'
        : 'This recitation has not been downloaded on this device yet.';
    return;
  }
  if (!isNativeApp()) {
    const browserLocal = await verifiedBrowserAudio(reciter, current, remoteUrl);
    if (!browserLocal.available && !navigator.onLine) {
      status.textContent = browserLocal.expired
        ? 'This offline recitation has expired. Connect to the internet to download a fresh copy.'
        : 'This recitation has not been downloaded on this device yet.';
      return;
    }
  }
  const source = local.source || remoteUrl;
  const isLocal = Boolean(local.source);
  if (preparedAudioSurah === current && audio.src === source) {
    try {
      await audio.play();
      return;
    } catch {
      status.textContent = 'Press play in the audio controls below.';
      return;
    }
  }
  audio.src = source;
  audio.load();
  syncAudioControls();
  preparedAudioSurah = current;
  activeAudioSource = { surah: current, reciter, remoteUrl, local: isLocal };
  status.textContent = isLocal ? 'Downloaded on this device · playing offline copy' : 'Streaming now · saving this surah for offline listening…';
  try {
    await audio.play();
  } catch {
    status.textContent = 'Press play in the audio controls below.';
  }
  if (!isLocal) saveRecitationForOffline(remoteUrl, current, reciter, status);
}

async function saveRecitationForOffline(url, surahNumber, reciterId, status, options = {}) {
  const plugins = getNativeAudioPlugins();
  if (isNativeApp() && !plugins) {
    if (status) status.textContent = 'Native audio storage is unavailable in this build. The recitation was not saved.';
    audioDiagnostic('native download prevented because plugins are unavailable', { reciter: reciterId, surah: Number(surahNumber) });
    return;
  }
  const key = nativeAudioKey(reciterId, surahNumber);
  const existing = nativeAudioDownloads()[key] || {};
  // Content Sync stays isolated for future use. This temporary policy uses a
  // fresh copy from the existing secured QF chapter-audio Worker route.
  if (!navigator.onLine) {
    if (status) status.textContent = 'Connect to the internet to download this recitation.';
    return;
  }
  if (!options.forceRefresh && offlineAudioIsValid(existing)) {
    if (status) status.textContent = 'Saved on this device · available offline';
    return;
  }
  if (plugins) {
    const localPath = nativeAudioPath(reciterId, surahNumber);
    try {
      if (status) status.textContent = options.background ? 'Updating saved recitation…' : 'Downloading this surah for offline listening…';
      try {
        await plugins.filesystem.mkdir({
          path: localPath.slice(0, localPath.lastIndexOf('/')),
          directory: NATIVE_AUDIO_DIRECTORY,
          recursive: true,
        });
      } catch (error) {
        if (!/exist/i.test(String(error?.message || error))) throw error;
      }
      const destination = await plugins.filesystem.getUri({ path: localPath, directory: NATIVE_AUDIO_DIRECTORY });
      if (!destination?.uri) throw new Error('Could not create a local audio destination');
      // The Worker proxies QF audio; protected upstream URLs never reach the WebView.
      await plugins.fileTransfer.downloadFile({ url, path: destination.uri, progress: false });
      const stat = await plugins.filesystem.stat({ path: localPath, directory: NATIVE_AUDIO_DIRECTORY });
      audioDiagnostic('download Filesystem.stat result', { reciter: reciterId, surah: Number(surahNumber), key, localPath, stat });
      if (stat.size != null && Number(stat.size) <= 0) throw new Error('Downloaded audio file is empty');
      const file = await plugins.filesystem.getUri({ path: localPath, directory: NATIVE_AUDIO_DIRECTORY });
      audioDiagnostic('download Filesystem.getUri result', { reciter: reciterId, surah: Number(surahNumber), key, localPath, uri: file?.uri || null });
      if (!file?.uri) throw new Error('Downloaded audio file is unavailable');
      const downloads = nativeAudioDownloads();
      downloads[key] = {
        trackId: `surah-${surahNumber}`,
        surah: surahNumber,
        reciter: reciterId,
        qfReciterId: QF_CHAPTER_RECITER_IDS[reciterId],
        remoteUrl: url,
        localPath,
        status: 'complete',
        downloadedAt: new Date().toISOString(),
        bytes: stat.size ?? null,
        policy: { source: 'qf-chapter-audio', validForMs: OFFLINE_AUDIO_VALIDITY_MS },
      };
      await saveNativeAudioDownloads(downloads);
      if (surahNumber === current && reciterId === reciter) {
        if (status) status.textContent = 'Saved on this device · available offline';
        await refreshListenDownloadStatus();
      }
    } catch (error) {
      await removeNativeAudioDownload(key, true);
      if (surahNumber === current && reciterId === reciter && status) status.textContent = navigator.onLine ? 'Audio download could not be completed. Streaming is still available.' : 'Audio download paused. Connect to finish saving it.';
    }
    return;
  }

  // The browser/PWA keeps its existing cache fallback. Native iOS never uses it:
  // native downloads above are written to the persistent Capacitor Data directory.
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const existingBrowser = await verifiedBrowserAudio(reciterId, surahNumber, url);
    if (!options.forceRefresh && existingBrowser.available) return;
    if (status) status.textContent = options.background ? 'Updating saved recitation…' : 'Downloading this surah for offline listening…';
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error('Audio download failed');
    const headers = new Headers(response.headers);
    const downloadedAt = new Date().toISOString();
    headers.set('X-Nur-Audio-Downloaded-At', downloadedAt);
    const cachedResponse = new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
    await cache.put(url, cachedResponse);
    saveBrowserAudioDownloads({
      ...browserAudioDownloadRegistry,
      [browserAudioKey(reciterId, surahNumber)]: {
        trackId: `surah-${surahNumber}`,
        surah: Number(surahNumber),
        reciter: reciterId,
        qfReciterId: QF_CHAPTER_RECITER_IDS[reciterId],
        remoteUrl: url,
        status: 'complete',
        downloadedAt,
        policy: { source: 'qf-chapter-audio', validForMs: OFFLINE_AUDIO_VALIDITY_MS },
      },
    });
    if (surahNumber === current && reciterId === reciter) {
      if (status) status.textContent = 'Saved on this device · available offline';
      await refreshListenDownloadStatus();
    }
  } catch {
    if (surahNumber === current && !navigator.onLine) status.textContent = 'Audio is not saved on this device yet.';
  }
}

let nativeContentSyncInFlight = false;

async function syncNativeDownloadedRecitations() {
  if (!isNativeApp() || !navigator.onLine || nativeContentSyncInFlight) return;
  nativeContentSyncInFlight = true;
  try {
    if (!nativeAudioRegistryLoaded) await loadNativeAudioDownloads();
    const entries = Object.entries(nativeAudioDownloads())
      .filter(([, item]) => item?.status === 'complete' && Number.isInteger(Number(item.surah)) && QF_CHAPTER_RECITER_IDS[item.reciter]);
    for (const [key, item] of entries) {
      if (!offlineAudioNeedsRefresh(item) && offlineAudioIsValid(item)) continue;
      if (activeAudioSource?.local && !$('#recitation-audio').paused
        && activeAudioSource.reciter === item.reciter && activeAudioSource.surah === item.surah) continue;
      try {
        await saveRecitationForOffline(
          reciterAudioUrlFor(item.reciter, item.surah),
          item.surah,
          item.reciter,
          item.surah === current && item.reciter === reciter ? $('#audio-status') : null,
          { forceRefresh: true, background: true },
        );
      } catch (error) {
        audioDiagnostic('seven-day audio refresh failed', { reciter: item.reciter, surah: item.surah, error: String(error) });
      }
    }
  } finally {
    nativeContentSyncInFlight = false;
    await refreshListenDownloadStatus();
  }
}

async function syncBrowserDownloadedRecitations() {
  if (isNativeApp() || !navigator.onLine || !('caches' in window)) return;
  const entries = Object.values(browserAudioDownloadRegistry)
    .filter((item) => item?.status === 'complete' && (offlineAudioNeedsRefresh(item) || !offlineAudioIsValid(item)));
  for (const item of entries) {
    await saveRecitationForOffline(item.remoteUrl, item.surah, item.reciter, null, { forceRefresh: true, background: true });
  }
}

function ayahAtPlaybackTime(seconds, duration) {
  const timings = officialChapterTimings.get(`${reciter}:${current}`)
    || recitationData[reciter]?.chapters?.[current - 1];
  if (!timings?.length || !Number.isFinite(seconds)) return 0;
  const milliseconds = seconds * 1000;
  let previousAyah = 0;
  for (let index = 0; index < timings.length; index += 1) {
    const timing = timings[index];
    if (!timing) continue;
    if (milliseconds < timing.time_from) return previousAyah;
    if (milliseconds <= timing.time_to) return index + 1;
    previousAyah = index + 1;
  }
  return previousAyah;
}

function setHighlightedAyah(ayahNumber) {
  // Verse markup can be rebuilt when a reading preference changes. Keep the
  // active state in sync with the newly-created DOM even when the ayah number
  // itself has not changed.
  if (highlightedAyah === ayahNumber) {
    if (ayahNumber) document.getElementById(`ayah-${ayahNumber}`)?.classList.add('playing');
    return;
  }
  if (highlightedAyah) document.getElementById(`ayah-${highlightedAyah}`)?.classList.remove('playing');
  highlightedAyah = ayahNumber;
  if (ayahNumber) document.getElementById(`ayah-${ayahNumber}`)?.classList.add('playing');
}

function syncAyahHighlight() {
  const audio = $('#recitation-audio');
  setHighlightedAyah(ayahAtPlaybackTime(audio.currentTime, audio.duration));
}

function renderVerses(data) {
  verses.innerHTML = '';
  data.arabic.forEach((ayah, index) => {
    const item = template.content.cloneNode(true);
    $('.verse', item).id = `ayah-${index + 1}`;
    $('.verse-number', item).textContent = index + 1;
    renderArabic($('.arabic', item), ayah, data.tajweed?.[index] || []);
    const verseEnd = document.createElement('span');
    verseEnd.className = 'verse-end';
    verseEnd.textContent = index + 1;
    $('.arabic', item).append(' ', verseEnd, ' ');
    $('.translation', item).textContent = data.translation[index] || '';
    $('.transliteration', item).textContent = data.transliteration?.[index] || '';
    $('.tafsir-inline-content', item).innerHTML = tafsirChapters[current - 1]?.[index]
      || '<p class="tafsir-unavailable">This abridged edition has no separate tafsir passage for this ayah.</p>';
    const bookmark = $('.bookmark', item);
    const key = `quran-bookmark-${current}-${index + 1}`;
    if (localStorage.getItem(key)) { bookmark.classList.add('saved'); bookmark.textContent = '♥'; }
    bookmark.onclick = () => {
      bookmark.classList.toggle('saved');
      const saved = bookmark.classList.contains('saved');
      bookmark.textContent = saved ? '♥' : '♡';
      saved ? localStorage.setItem(key, '1') : localStorage.removeItem(key);
    };
    verses.append(item);
  });
  // `renderVerses` replaces all ayah elements, so restore the current audio
  // highlight without changing timing state or the Tajweed spans within them.
  if (highlightedAyah) document.getElementById(`ayah-${highlightedAyah}`)?.classList.add('playing');
}

function openTafsir(index) {
  const chapter = chapters[current - 1];
  const sheet = $('#tafsir-sheet');
  const tafsir = tafsirChapters[current - 1]?.[index];
  $('#tafsir-reference').textContent = `${current}:${index + 1}`;
  $('#tafsir-arabic').textContent = chapter.arabic[index] || '';
  $('#tafsir-translation').textContent = chapter.translation[index] || '';
  $('#tafsir-content').innerHTML = tafsir || '<p class="tafsir-unavailable">This abridged edition has no separate tafsir passage for this ayah. The Quran, translation, and all available tafsir passages are already stored on this device.</p>';
  sheet.hidden = false;
  sheet.setAttribute('aria-hidden', 'false');
  document.body.classList.add('tafsir-open');
  $('.tafsir-panel', sheet).scrollTop = 0;
  $('#tafsir-close').focus();
}

function closeTafsir() {
  const sheet = $('#tafsir-sheet');
  sheet.hidden = true;
  sheet.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('tafsir-open');
}

function renderArabic(element, text, wordRules) {
  const parts = text.split(/(\s+)/u);
  let wordIndex = 0;
  parts.forEach((part) => {
    if (!part) return;
    if (/^\s+$/u.test(part)) {
      element.append(document.createTextNode(part));
      return;
    }
    const word = document.createElement('span');
    word.textContent = part;
    if (tajweedEnabled && wordRules[wordIndex]?.length) {
      word.className = wordRules[wordIndex].map((rule) => `tajweed-${rule}`).join(' ');
      const colour = tajweedColour(wordRules[wordIndex]);
      if (colour) word.style.color = colour;
    }
    wordIndex += 1;
    element.append(word);
  });
}

function tajweedColour(rules) {
  const joined = rules.join(' ');
  const dark = document.body.classList.contains('dark-mode');
  if (joined.includes('madda')) return dark ? '#68b9ff' : '#2675b6';
  if (joined.includes('ghunnah') || joined.includes('idgham')) return dark ? '#72e0a8' : '#1d9064';
  if (joined.includes('ikhafa')) return dark ? '#ffad78' : '#bd6334';
  if (joined.includes('iqlab')) return dark ? '#e69de0' : '#9a438b';
  if (joined.includes('qalaqah')) return dark ? '#ff8d8d' : '#bd4040';
  if (joined.includes('ham_wasl')) return dark ? '#73ceec' : '#075d87';
  if (joined.includes('laam_shamsiyah')) return dark ? '#e1bc72' : '#8c692e';
  if (joined.includes('slnt')) return dark ? '#aab3ae' : '#929b96';
  return '';
}

function renderTajweed(element, text, annotations) {
  const characters = Array.from(text);
  const rules = Array(characters.length).fill('');
  annotations.forEach(({ rule, start, end }) => {
    for (let position = start; position < end && position < rules.length; position += 1) rules[position] = rule;
  });
  let activeRule = null;
  let buffer = '';
  const append = () => {
    if (!buffer) return;
    const span = document.createElement('span');
    span.textContent = buffer;
    if (activeRule) {
      span.className = `tajweed-${activeRule}`;
      if (activeRule === 'hamzat_wasl') span.title = 'Wasl: join to the preceding word when reciting';
    }
    else if (/^[\u06D6-\u06ED]$/.test(buffer)) span.className = 'stop-sign';
    element.append(span);
    buffer = '';
  };
  characters.forEach((character, index) => {
    if (/^[\u06D6-\u06ED]$/.test(character)) {
      append();
      const stop = document.createElement('span');
      stop.className = 'stop-sign';
      stop.textContent = character;
      element.append(stop);
      activeRule = null;
      return;
    }
    if (rules[index] !== activeRule) { append(); activeRule = rules[index]; }
    buffer += character;
  });
  append();
}

async function initialise() {
  try {
    await ensureNativePluginBridge();
    const [quranResponse, tafsirResponse, timingResponse] = await Promise.all([
      fetch('/data/quran-v14.json'),
      fetch('/data/tafsir-ibn-kathir-v1.json'),
      fetch('/data/recitation-timings-v1.json'),
    ]);
    if (!quranResponse.ok) throw new Error('Offline Quran data is missing');
    chapters = (await quranResponse.json()).chapters;
    $('#listen-surah-select').innerHTML = chapters.map((chapter) => `<option value="${chapter.number}">${chapter.number}. ${escapeHtml(chapter.englishName)}</option>`).join('');
    if (tafsirResponse.ok) tafsirChapters = (await tafsirResponse.json()).chapters || [];
    if (timingResponse.ok) recitationData = (await timingResponse.json()).reciters || {};
    if (!QF_CHAPTER_RECITER_IDS[reciter]) reciter = 'maher';
    $('#reciter-select').value = reciter;
    await loadNativeAudioDownloads();
    loadBrowserAudioDownloads();
    // Content Sync remains isolated for later QF support work. This temporary
    // download path applies the ordinary seven-day lifetime instead.
    if (isNativeApp() && navigator.onLine) void syncNativeDownloadedRecitations();
    if (!isNativeApp() && navigator.onLine) void syncBrowserDownloadedRecitations();
    renderList();
    renderJuzList();
    switchLibrary(activeLibrary);
    setLibraryOpen(libraryOpen);
    loadSurah(current, lastReadAyah, false);
    // Reading preferences and last-read details remain available, but a new
    // launch always presents the calm Home screen rather than restoring a view.
    showHome();
  } catch {
    list.innerHTML = '<div class="loader">Offline Quran data is unavailable. Please reload the app.</div>';
    verses.innerHTML = '<div class="loader">The local Quran file could not be opened.</div>';
  }
}

function setReadingMode(mode) {
  readingMode = mode;
  localStorage.setItem('quran-reading-mode', mode);
  $$('.translation-toggle').forEach((item) => item.classList.remove('selected'));
  $(`.translation-toggle[data-mode="${mode}"]`).classList.add('selected');
  document.body.classList.toggle('arabic-only', mode === 'arabic');
  document.body.classList.toggle('transliteration-mode', mode === 'transliteration');
  document.body.classList.toggle('tafsir-mode', mode === 'tafsir');
}

function setTajweedEnabled(enabled) {
  tajweedEnabled = Boolean(enabled);
  localStorage.setItem('quran-tajweed', tajweedEnabled);
  $('#tajweed-toggle').classList.toggle('selected', tajweedEnabled);
  $('#tajweed-toggle').setAttribute('aria-pressed', tajweedEnabled);
  if (chapters.length) {
    const chapter = chapters[current - 1];
    renderVerses({ arabic: chapter.arabic, translation: chapter.translation, transliteration: chapter.transliteration, tajweed: chapter.tajweed });
  }
}

function setTheme(enabled) {
  document.body.classList.toggle('dark-mode', enabled);
  localStorage.setItem('quran-dark-mode', enabled);
  $$('[data-theme-toggle]').forEach((themeToggle) => {
    themeToggle.textContent = enabled ? '☀' : '☾';
    themeToggle.setAttribute('aria-label', enabled ? 'Disable dark mode' : 'Enable dark mode');
  });
  if (chapters.length) {
    const chapter = chapters[current - 1];
    renderVerses({ arabic: chapter.arabic, translation: chapter.translation, transliteration: chapter.transliteration, tajweed: chapter.tajweed });
  }
}

function setArabicSize(nextSize) {
  size = Math.max(ARABIC_SIZE_MIN, Math.min(ARABIC_SIZE_MAX, Number(nextSize)));
  document.documentElement.style.setProperty('--arabic-size', `${size}px`);
  const lineHeight = size <= 20 ? 2.12 : size <= 26 ? 2 : 1.85;
  document.documentElement.style.setProperty('--arabic-line-height', lineHeight);
  document.documentElement.style.setProperty('--arabic-flow-line-height', size <= 20 ? 2.42 : size <= 26 ? 2.32 : 2.25);
  $('#size-slider').value = size;
  localStorage.setItem('quran-arabic-size', String(size));
}

$$('.translation-toggle').forEach((button) => button.onclick = () => setReadingMode(button.dataset.mode));
moveAudioPlayerTo('listen');
$$('.size-button').forEach((button) => button.onclick = () => {
  setArabicSize(size + (button.dataset.size === 'up' ? 3 : -3));
});
$('#size-slider').oninput = (event) => {
  setArabicSize(event.target.value);
};
$('#surah-search').oninput = (event) => (activeLibrary === 'surahs' ? renderList : renderJuzList)(event.target.value);
$$('.library-tab').forEach((tab) => tab.onclick = () => switchLibrary(tab.dataset.library));
$('.search-trigger')?.addEventListener('click', () => { showReader({ browse: true }); $('#surah-search').focus(); });
$('.mobile-menu')?.addEventListener('click', () => ($('#main-drawer').classList.contains('open') ? closeDrawer() : openDrawer()));
$('#drawer-close')?.addEventListener('click', closeDrawer);
$('#drawer-backdrop')?.addEventListener('click', closeDrawer);
$$('[data-drawer-action]').forEach((button) => { button.onclick = () => runDrawerAction(button.dataset.drawerAction); });
$$('[data-home-action]').forEach((button) => { button.onclick = () => runHomeAction(button.dataset.homeAction); });
$('#home-continue').onclick = () => runHomeAction('read');
$('#reader-back').onclick = showHome;
$('#reader-bookmarks').onclick = () => openUtilityPanel('bookmarks');
$('#reader-options-button').onclick = () => setReaderOptionsOpen($('#reader-options-sheet').hidden);
$('#reader-options-close').onclick = () => setReaderOptionsOpen(false);
$('#reader-listen-toggle').onclick = openReaderAudioPanel;
$('#audio-popover-close').onclick = closeAudioSurface;
$('#listen-page-back').onclick = closeListenPage;
$('#listen-surah-picker').onclick = () => openListenSelection('surah');
$('#listen-reciter-picker').onclick = () => openListenSelection('reciter');
$('#listen-selection-close').onclick = closeListenSelection;
$('#listen-download-action').onclick = async () => {
  const key = nativeAudioKey(reciter, current);
  const url = reciterAudioUrl(current);
  const downloaded = isNativeApp()
    ? offlineAudioIsValid(nativeAudioDownloads()[key])
    : (await verifiedBrowserAudio(reciter, current, url)).available;
  if (downloaded) {
    if (isNativeApp()) await removeNativeAudioDownload(key, true);
    else await removeBrowserAudioDownload(url);
    await refreshListenDownloadStatus();
    return;
  }
  if (!navigator.onLine) { await refreshListenDownloadStatus(); return; }
  if (url) await saveRecitationForOffline(url, current, reciter, $('#audio-status'));
  await refreshListenDownloadStatus();
};
window.addEventListener('online', () => {
  if (isNativeApp()) void syncNativeDownloadedRecitations();
  else void syncBrowserDownloadedRecitations();
});
$('#listen-surah-select').onchange = async (event) => {
  await loadSurah(Number(event.target.value), 1, false);
  openListenPage();
};
$('#listen-previous-surah').onclick = async () => {
  if (current > 1) await loadSurah(current - 1, 1, false);
  openListenPage();
};
$('#listen-next-surah').onclick = async () => {
  if (current < 114) await loadSurah(current + 1, 1, false);
  openListenPage();
};
$('#previous-surah').onclick = () => loadSurah(current - 1);
$('#next-surah').onclick = () => loadSurah(current + 1);
$('#resume').onclick = () => loadSurah(current, lastReadAyah);
$('#audio-play-pause').onclick = async () => {
  const audio = $('#recitation-audio');
  if (!audio.paused) {
    audio.pause();
    return;
  }
  // Always re-check the local copy before resuming: an app left open across
  // the seven-day boundary must not continue playing an expired QF MP3.
  await playRecitation();
};
$('#audio-seek').addEventListener('pointerdown', () => { isScrubbingAudio = true; });
$('#audio-seek').addEventListener('pointerup', () => { isScrubbingAudio = false; });
$('#audio-seek').addEventListener('input', (event) => {
  const audio = $('#recitation-audio');
  const nextTime = Number(event.target.value);
  if (Number.isFinite(nextTime)) {
    audio.currentTime = nextTime;
    $('#audio-current-time').textContent = formatAudioTime(nextTime);
    // Update while the thumb is being dragged; do not wait for timeupdate.
    syncAyahHighlight();
  }
});
$('#reciter-select').onchange = (event) => {
  reciter = event.target.value;
  localStorage.setItem('quran-reciter', reciter);
  const audio = $('#recitation-audio');
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  preparedAudioSurah = 0;
  resetAudioControls();
  setHighlightedAyah(0);
  updateListenPresentation();
};
$('#recitation-audio').addEventListener('timeupdate', syncAyahHighlight);
$('#recitation-audio').addEventListener('seeking', syncAyahHighlight);
$('#recitation-audio').addEventListener('loadedmetadata', () => {
  syncAudioControls();
  syncAyahHighlight();
});
$('#recitation-audio').addEventListener('durationchange', syncAudioControls);
$('#recitation-audio').addEventListener('timeupdate', syncAudioControls);
$('#recitation-audio').addEventListener('play', () => {
  syncAudioControls();
  syncAyahHighlight();
  updateListenPresentation();
});
$('#recitation-audio').addEventListener('pause', () => { syncAudioControls(); updateListenPresentation(); });
$('#recitation-audio').addEventListener('ended', () => { setHighlightedAyah(0); syncAudioControls(); });
$('#recitation-audio').addEventListener('error', async () => {
  const source = activeAudioSource;
  if (!source?.local) return;
  const status = $('#audio-status');
  await removeNativeAudioDownload(nativeAudioKey(source.reciter, source.surah), true);
  preparedAudioSurah = 0;
  activeAudioSource = null;
  if (!navigator.onLine) {
    status.textContent = 'Saved audio is damaged or missing. Connect to download it again.';
    return;
  }
  status.textContent = 'Saved audio could not be read. Streaming a fresh copy now.';
  const audio = $('#recitation-audio');
  audio.src = source.remoteUrl;
  audio.load();
  activeAudioSource = { ...source, local: false };
  try {
    await audio.play();
  } catch {
    status.textContent = 'Press play in the audio controls below.';
  }
});
$('#library-toggle').onclick = () => setLibraryOpen(!libraryOpen, true);
$('#tajweed-toggle').classList.toggle('selected', tajweedEnabled);
$('#tajweed-toggle').setAttribute('aria-pressed', tajweedEnabled);
$('#tajweed-toggle').onclick = () => setTajweedEnabled(!tajweedEnabled);
setArabicSize(size);
setReadingMode(readingMode);
$('#tafsir-close').onclick = closeTafsir;
$('#tafsir-backdrop').onclick = closeTafsir;
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeTafsir();
    setReaderOptionsOpen(false);
    closeAudioSurface();
  }
});
document.addEventListener('pointerdown', (event) => {
  const toolbar = $('.reader-toolbar');
  if (!toolbar.contains(event.target)) {
    if (!$('#reader-options-sheet').hidden) setReaderOptionsOpen(false);
  }
});
window.addEventListener('scroll', handleReaderScroll, { passive: true });
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('pageshow', (event) => {
  if (event.persisted) showHome();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    resetHomeWhenVisible = true;
    return;
  }
  if (resetHomeWhenVisible) {
    resetHomeWhenVisible = false;
    showHome();
  }
});
const darkMode = localStorage.getItem('quran-dark-mode') === 'true';
setTheme(darkMode);
$$('[data-theme-toggle]').forEach((button) => button.addEventListener('click', () => setTheme(!document.body.classList.contains('dark-mode'))));
initialise();
