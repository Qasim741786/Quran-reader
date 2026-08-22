import { mkdir, writeFile } from 'node:fs/promises';

const sources = await Promise.all([
  fetch('https://api.alquran.cloud/v1/quran/quran-uthmani').then((response) => response.json()),
  fetch('https://api.alquran.cloud/v1/quran/en.sahih').then((response) => response.json()),
]);

if (sources.some((source) => source.code !== 200)) throw new Error('Could not download Quran data.');

const chapters = sources[0].data.surahs.map((surah, index) => {
  const translation = sources[1].data.surahs[index];
  return {
    number: surah.number,
    name: surah.name,
    englishName: surah.englishName,
    englishNameTranslation: surah.englishNameTranslation,
    revelationType: surah.revelationType,
    numberOfAyahs: surah.numberOfAyahs,
    arabic: surah.ayahs.map((ayah) => ayah.text),
    translation: translation.ayahs.map((ayah) => ayah.text),
    tajweed: surah.ayahs.map(() => []),
  };
});

function tajweedRulesByWord(markup) {
  const marked = markup
    .replace(/<span class=end>.*?<\/span>/g, '')
    .replace(/<tajweed class=([^ >]+)>/g, '⟦$1⟧')
    .replace(/<\/tajweed>/g, '⟧');
  return marked.split(/\s+/).filter(Boolean).map((word) =>
    [...word.matchAll(/⟦([^⟧]+)⟧/g)].map((match) => match[1])
  );
}

for (let start = 1; start <= 114; start += 6) {
  const batch = await Promise.all(Array.from({ length: Math.min(6, 115 - start) }, async (_, offset) => {
    const number = start + offset;
    const response = await fetch(`https://api.quran.com/api/v4/verses/by_chapter/${number}?fields=text_indopak,text_uthmani_tajweed&per_page=300`);
    if (!response.ok) throw new Error(`Could not download IndoPak text for surah ${number}.`);
    return { number, verses: (await response.json()).verses };
  }));
  batch.forEach(({ number, verses }) => {
    chapters[number - 1].arabic = verses.map((verse) => verse.text_indopak);
    chapters[number - 1].tajweed = verses.map((verse) => tajweedRulesByWord(verse.text_uthmani_tajweed));
  });
}

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const bundledQuran = JSON.stringify({ chapters });
await writeFile(new URL('../data/quran.json', import.meta.url), bundledQuran);
await writeFile(new URL('../data/quran-v13.json', import.meta.url), bundledQuran);
const fontResponse = await fetch('https://verses.quran.foundation/fonts/quran/hafs/nastaleeq/indopak/indopak-nastaleeq-waqf-lazim-v4.2.1.woff2');
if (!fontResponse.ok) throw new Error('Could not download the IndoPak font.');
await mkdir(new URL('../assets/fonts/', import.meta.url), { recursive: true });
await writeFile(new URL('../assets/fonts/indopak-nastaleeq.woff2', import.meta.url), Buffer.from(await fontResponse.arrayBuffer()));
console.log(`Saved ${chapters.length} surahs for offline reading.`);
