const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const list = $('#surah-list');
const verses = $('#verses');
const template = $('#verse-template');
let chapters = [];
let current = Number(localStorage.getItem('quran-last-surah')) || 1;
let size = 42;

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

async function loadSurah(number) {
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
  $('#last-verse').textContent = 'Verse 1';
  $('#previous-surah').disabled = number === 1;
  $('#next-surah').disabled = number === 114;
  $('#bismillah').style.display = number === 9 ? 'none' : 'flex';
  renderList($('#surah-search').value);
  verses.innerHTML = '<div class="loader">Opening the Quran…</div>';
  $('#reader').scrollIntoView({ behavior: 'smooth', block: 'start' });

  renderVerses({ arabic: chapter.arabic, translation: chapter.translation });
}

function renderVerses(data) {
  verses.innerHTML = '';
  data.arabic.forEach((ayah, index) => {
    const item = template.content.cloneNode(true);
    $('.verse-number', item).textContent = index + 1;
    $('.arabic', item).textContent = ayah;
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
    loadSurah(current);
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
$('#surah-search').oninput = (event) => renderList(event.target.value);
$('.search-trigger').onclick = () => { location.hash = 'surahs'; $('#surah-search').focus(); };
$('.mobile-menu').onclick = () => $('.sidebar').classList.toggle('open');
$('#previous-surah').onclick = () => loadSurah(current - 1);
$('#next-surah').onclick = () => loadSurah(current + 1);
$('#resume').onclick = () => loadSurah(current);
initialise();
