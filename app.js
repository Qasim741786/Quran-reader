const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const list = $('#surah-list');
const verses = $('#verses');
const template = $('#verse-template');
let chapters = [];
let current = Number(localStorage.getItem('quran-last-surah')) || 1;
let size = 42;
let activeLibrary = localStorage.getItem('quran-library') || 'surahs';
let libraryOpen = localStorage.getItem('quran-library-open') !== 'false';
const TAJWEED_SETTING_VERSION = 'v3';
if (localStorage.getItem('quran-tajweed-setting-version') !== TAJWEED_SETTING_VERSION) {
  localStorage.setItem('quran-tajweed-setting-version', TAJWEED_SETTING_VERSION);
  localStorage.setItem('quran-tajweed', 'true');
}
let tajweedEnabled = localStorage.getItem('quran-tajweed') !== 'false';
const juzStarts = [[1,1],[2,142],[2,253],[3,93],[4,24],[4,148],[5,82],[6,111],[7,88],[8,41],[9,93],[11,6],[12,53],[15,1],[17,1],[18,75],[21,1],[23,1],[25,21],[27,56],[29,46],[33,31],[36,28],[39,32],[41,47],[46,1],[51,31],[58,1],[67,1],[78,1]];

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
  $$('.library-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.library === kind));
  (isSurahs ? renderList : renderJuzList)($('#surah-search').value);
}

function setLibraryOpen(open, shouldScroll = false) {
  libraryOpen = open;
  localStorage.setItem('quran-library-open', open);
  $('#surahs').classList.toggle('collapsed', !open);
  $('#library-toggle').setAttribute('aria-expanded', open);
  $('#library-toggle').innerHTML = open ? '<span>×</span> Close browser' : '<span>☷</span> Browse Quran';
  if (open && shouldScroll) $('#surahs').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadSurah(number, targetAyah = 1, collapseLibrary = true) {
  current = number;
  localStorage.setItem('quran-last-surah', number);
  const chapter = chapters[number - 1];
  if (!chapter) return;
  $('#surah-number').textContent = String(number).padStart(2, '0');
  $('#surah-name').textContent = chapter.englishName;
  $('#crumb-surah').textContent = chapter.englishName;
  $('#surah-english').textContent = chapter.englishNameTranslation;
  $('#surah-meta').textContent = `${chapter.revelationType.toUpperCase()} · ${chapter.arabic.length} VERSES`;
  $('#last-surah').textContent = chapter.englishName;
  $('#last-verse').textContent = `Verse ${targetAyah}`;
  $('#previous-surah').disabled = number === 1;
  $('#next-surah').disabled = number === 114;
  $('#bismillah').style.display = number === 9 ? 'none' : 'flex';
  if (collapseLibrary) setLibraryOpen(false);
  renderList($('#surah-search').value);
  verses.innerHTML = '<div class="loader">Opening the Quran…</div>';
  $('#reader').scrollIntoView({ behavior: 'smooth', block: 'start' });

  renderVerses({ arabic: chapter.arabic, translation: chapter.translation, tajweed: chapter.tajweed });
  if (targetAyah > 1) requestAnimationFrame(() => document.getElementById(`ayah-${targetAyah}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}

function renderVerses(data) {
  verses.innerHTML = '';
  data.arabic.forEach((ayah, index) => {
    const item = template.content.cloneNode(true);
    $('.verse', item).id = `ayah-${index + 1}`;
    $('.verse-number', item).textContent = index + 1;
    renderArabic($('.arabic', item), ayah, data.tajweed?.[index] || []);
    $('.translation', item).textContent = data.translation[index] || '';
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
    const response = await fetch('/data/quran.json');
    if (!response.ok) throw new Error('Offline Quran data is missing');
    chapters = (await response.json()).chapters;
    renderList();
    renderJuzList();
    switchLibrary(activeLibrary);
    setLibraryOpen(libraryOpen);
    loadSurah(current, 1, false);
  } catch {
    list.innerHTML = '<div class="loader">Offline Quran data is unavailable. Please reload the app.</div>';
    verses.innerHTML = '<div class="loader">The local Quran file could not be opened.</div>';
  }
}

$$('.translation-toggle').forEach((button) => button.onclick = () => {
  $$('.translation-toggle').forEach((item) => item.classList.remove('selected'));
  button.classList.add('selected');
  document.body.classList.toggle('arabic-only', button.dataset.mode === 'arabic');
});
$$('.size-button').forEach((button) => button.onclick = () => {
  size += button.dataset.size === 'up' ? 3 : -3;
  size = Math.max(30, Math.min(58, size));
  document.documentElement.style.setProperty('--arabic-size', `${size}px`);
});
$('#surah-search').oninput = (event) => (activeLibrary === 'surahs' ? renderList : renderJuzList)(event.target.value);
$$('.library-tab').forEach((tab) => tab.onclick = () => switchLibrary(tab.dataset.library));
$('.search-trigger').onclick = () => { location.hash = 'surahs'; $('#surah-search').focus(); };
$('.mobile-menu').onclick = () => $('.sidebar').classList.toggle('open');
$('#previous-surah').onclick = () => loadSurah(current - 1);
$('#next-surah').onclick = () => loadSurah(current + 1);
$('#resume').onclick = () => loadSurah(current);
$('#library-toggle').onclick = () => setLibraryOpen(!libraryOpen, true);
$('#tajweed-toggle').classList.toggle('selected', tajweedEnabled);
$('#tajweed-toggle').setAttribute('aria-pressed', tajweedEnabled);
$('#tajweed-toggle').onclick = () => {
  tajweedEnabled = !tajweedEnabled;
  localStorage.setItem('quran-tajweed', tajweedEnabled);
  $('#tajweed-toggle').classList.toggle('selected', tajweedEnabled);
  $('#tajweed-toggle').setAttribute('aria-pressed', tajweedEnabled);
  loadSurah(current);
};
const darkMode = localStorage.getItem('quran-dark-mode') === 'true';
document.body.classList.toggle('dark-mode', darkMode);
$('#theme-toggle').textContent = darkMode ? '☀' : '☾';
$('#theme-toggle').setAttribute('aria-label', darkMode ? 'Disable dark mode' : 'Enable dark mode');
$('#theme-toggle').onclick = () => {
  const enabled = document.body.classList.toggle('dark-mode');
  localStorage.setItem('quran-dark-mode', enabled);
  $('#theme-toggle').textContent = enabled ? '☀' : '☾';
  $('#theme-toggle').setAttribute('aria-label', enabled ? 'Disable dark mode' : 'Enable dark mode');
  if (chapters.length) {
    const chapter = chapters[current - 1];
    renderVerses({ arabic: chapter.arabic, translation: chapter.translation, tajweed: chapter.tajweed });
  }
};
initialise();
