import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCrosswordLayout,
  sanitizeWord,
  isCleanSingleLexicalWord,
  scoreWordLengthPrior,
  assertValidCrosswordLayout,
} from '../src/crosswordLayout.js';
import { PRESET_PUZZLES } from '../src/presets.js';
import {
  sanitizeAndValidateClueText,
  getDifficultyProfile,
  DIFFICULTY_PROFILES,
} from '../src/geminiGenerator.js';

test('sanitizeWord transliterates diacritics/ligatures instead of dropping accented vowels', () => {
  assert.equal(sanitizeWord('t-rex 123!'), 'TREX');
  assert.equal(sanitizeWord('  puppy '), 'PUPPY');
  assert.equal(sanitizeWord('Schrödinger'), 'SCHRODINGER');
  assert.equal(sanitizeWord('Möbius'), 'MOBIUS');
  assert.equal(sanitizeWord('Poincaré'), 'POINCARE');
  assert.equal(sanitizeWord('Gödel'), 'GODEL');
  assert.equal(sanitizeWord('Ångström'), 'ANGSTROM');
  assert.equal(sanitizeWord('Encyclopædia'), 'ENCYCLOPAEDIA');

  assert.equal(isCleanSingleLexicalWord('Schrödinger'), true);
  assert.equal(isCleanSingleLexicalWord('BREMSSTRAHLUNG'), true);
  assert.equal(isCleanSingleLexicalWord('BLACK HOLE'), false);
  assert.equal(isCleanSingleLexicalWord('HALF-LIFE'), false);
  assert.equal(isCleanSingleLexicalWord('CO2'), false);
});

test('difficulty profiles include Grandmaster tier above College', () => {
  assert.ok(DIFFICULTY_PROFILES.grandmaster, 'Grandmaster profile exists');
  const gm = getDifficultyProfile('grandmaster');
  assert.equal(gm.id, 'grandmaster');
  assert.equal(gm.revealFirstLetterDefault, false);
});

test('assertValidCrosswordLayout enforces 100% consistent overlapping cells and rejects conflicts', () => {
  for (const preset of PRESET_PUZZLES) {
    const layout = buildCrosswordLayout(preset.items, 10, { difficulty: 'elementary' });
    assert.equal(assertValidCrosswordLayout(layout), true);
    assert.equal(layout.words.length, preset.items.length, `All words placed for ${preset.id}`);

    // Explicitly verify every crossing square agrees across both words and cells[r][c].solution
    for (let r = 0; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        const cell = layout.cells[r][c];
        if (cell.wordIds.length > 1) {
          assert.equal(cell.wordIds.length, 2);
          for (const wid of cell.wordIds) {
            const w = layout.words.find((it) => it.id === wid);
            const offset = w.direction === 'across' ? c - w.col : r - w.row;
            assert.equal(w.word[offset], cell.solution);
          }
        }
      }
    }
  }

  // Mutate one crossing word's letter to simulate an inconsistent overlap and ensure assertValidCrosswordLayout throws
  const valid = buildCrosswordLayout(PRESET_PUZZLES[0].items, 10);
  const broken = JSON.parse(JSON.stringify(valid));
  // Corrupt the first word's letters so an overlapping square disagrees
  const w0 = broken.words[0];
  const flippedChar = w0.word[0] === 'Z' ? 'Q' : 'Z';
  w0.word = flippedChar + w0.word.slice(1);
  assert.throws(
    () => assertValidCrosswordLayout(broken),
    /mismatch|inconsistent/i,
    'Must reject any layout where crossing words disagree on an overlapping cell'
  );
});

test('stress test: 40 diverse candidate pools produce 100% consistent intersections across all 5 difficulties', () => {
  const lexicon = [
    'CAT', 'SUN', 'OWL', 'FOX', 'CUB', 'BEE', 'ANT', 'DOG', 'MAP', 'ORB',
    'FROG', 'LAMB', 'STAR', 'MOON', 'ATOM', 'WAVE', 'IONS', 'CELL',
    'PLANET', 'ROCKET', 'PHOTON', 'QUARKS', 'TENSOR', 'VECTOR', 'MATRIX',
    'ENTROPY', 'GRAVITY', 'NEUTRON', 'ORBITAL', 'SPECTRA', 'THERMAL',
    'QUANTUM', 'FERMIONS', 'SOLITONS', 'MANIFOLD', 'GEODESIC', 'ISOTOPES',
    'RELATIVITY', 'DISPERSION', 'ANISOTROPY', 'DECOHERENCE', 'EIGENVALUE',
    'CHROMODYNAMICS', 'INTERFEROMETRY', 'THERMODYNAMICS', 'ELECTROMAGNETIC',
    'SUPERCONDUCTOR', 'RENORMALIZATION',
  ];

  let seed = 42;
  const rand = () => {
    seed = (seed * 48271) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const difficulties = ['elementary', 'middle', 'high', 'college', 'grandmaster'];

  for (let trial = 0; trial < 40; trial++) {
    const shuffled = [...lexicon].sort(() => rand() - 0.5).slice(0, 14);
    const items = shuffled.map((word) => ({ word, questionClue: `Test clue for ${word}` }));
    const diff = difficulties[trial % difficulties.length];

    const layout = buildCrosswordLayout(items, 7, { difficulty: diff });
    assert.equal(assertValidCrosswordLayout(layout), true);
    assert.ok(layout.words.length >= 4);
  }
});

test('word length priors favor shorter words (incl. 3-4 letters) in Elementary and longer words in College/Grandmaster', () => {
  assert.ok(scoreWordLengthPrior(4, 'elementary') > scoreWordLengthPrior(12, 'elementary'));
  assert.ok(scoreWordLengthPrior(3, 'elementary') > scoreWordLengthPrior(11, 'elementary'));
  assert.ok(scoreWordLengthPrior(12, 'college') > scoreWordLengthPrior(4, 'college'));
  assert.ok(scoreWordLengthPrior(14, 'grandmaster') > scoreWordLengthPrior(5, 'grandmaster'));
  assert.ok(scoreWordLengthPrior(13, 'grandmaster') > scoreWordLengthPrior(8, 'grandmaster'));

  // Shared bridgeable pool containing short (3-4), medium (6-7), and long (11-15) words
  const mixedPool = [
    { word: 'SUN', questionClue: 'Star at center' },
    { word: 'ORB', questionClue: 'Spherical body' },
    { word: 'ION', questionClue: 'Charged atom' },
    { word: 'RAY', questionClue: 'Beam of light' },
    { word: 'STAR', questionClue: 'Luminous sphere' },
    { word: 'ATOM', questionClue: 'Unit of matter' },
    { word: 'MOON', questionClue: 'Natural satellite' },
    { word: 'PLANET', questionClue: 'Orbiting world' },
    { word: 'ORBITAL', questionClue: 'Wavefunction region' },
    { word: 'NEUTRON', questionClue: 'Uncharged baryon' },
    { word: 'RELATIVITY', questionClue: 'Einsteinian spacetime theory' },
    { word: 'ANISOTROPY', questionClue: 'Directional dependence' },
    { word: 'INTERFEROMETRY', questionClue: 'Wave superposition measurement' },
    { word: 'THERMODYNAMICS', questionClue: 'Science of heat and entropy' },
    { word: 'SUPERCONDUCTOR', questionClue: 'Zero-resistance material' },
    { word: 'RENORMALIZATION', questionClue: 'Quantum field divergence removal' },
  ];

  const elemLayout = buildCrosswordLayout(mixedPool, 6, { difficulty: 'elementary' });
  const collegeLayout = buildCrosswordLayout(mixedPool, 6, { difficulty: 'college' });
  const gmLayout = buildCrosswordLayout(mixedPool, 6, { difficulty: 'grandmaster' });

  const avgLen = (layout) =>
    layout.words.reduce((sum, w) => sum + w.word.length, 0) / layout.words.length;

  const elemAvg = avgLen(elemLayout);
  const collegeAvg = avgLen(collegeLayout);
  const gmAvg = avgLen(gmLayout);

  assert.ok(
    elemLayout.words.some((w) => w.word.length <= 4),
    `Elementary layout should include short 3-4 letter words, got: ${elemLayout.words.map((w) => w.word).join(', ')}`
  );
  assert.ok(
    collegeAvg > elemAvg + 3,
    `College avg length (${collegeAvg.toFixed(2)}) should substantially exceed Elementary (${elemAvg.toFixed(2)})`
  );
  assert.ok(
    gmAvg >= collegeAvg && gmAvg > elemAvg + 4,
    `Grandmaster avg length (${gmAvg.toFixed(2)}) should exceed Elementary (${elemAvg.toFixed(2)})`
  );
});

test('sanitizeAndValidateClueText prevents bare word strings or answer leaks in picture clues', () => {
  const elem = getDifficultyProfile('elementary');
  const gm = getDifficultyProfile('grandmaster');

  const clue1 = sanitizeAndValidateClueText(
    {
      word: 'BULLDOZER',
      questionClue: 'BULLDOZER',
      imagePrompt: 'a heavy yellow construction vehicle pushing dirt and rocks with a wide metal blade',
      clueType: 'image',
    },
    'BULLDOZER',
    'Construction',
    elem
  );
  assert.notEqual(clue1.toUpperCase(), 'BULLDOZER');
  assert.ok(!clue1.toUpperCase().includes('BULLDOZER'), `Clue leaked word: ${clue1}`);
  assert.ok(clue1.split(/\s+/).length >= 5);

  const clue2 = sanitizeAndValidateClueText(
    {
      word: 'ENTROPY',
      questionClue: 'Thermodynamic quantity known as entropy that measures disorder in a closed system.',
      imagePrompt: 'particles dispersing in a chamber',
      clueType: 'question',
    },
    'ENTROPY',
    'Thermodynamics',
    gm
  );
  assert.ok(!clue2.toUpperCase().includes('ENTROPY'), `Clue leaked word: ${clue2}`);
  assert.ok(clue2.includes('_____'));
});
