/**
 * Crossword Grid Layout Engine
 * Places 5-10 words into a compact, 100% connected, mathematically verified crossword grid.
 *
 * Guarantees (enforced both during placement and by `assertValidCrosswordLayout`):
 * 1. Single connected component: every word after the first intersects the connected graph.
 * 2. Exact intersection consistency: any horizontal & vertical words sharing `(r, c)` MUST
 *    have the exact same uppercase A-Z character at `(r, c)` (`acrossWord[iA] === downWord[iD] === cell.solution`).
 * 3. Zero parallel overlaps & zero accidental un-clued runs: every maximal contiguous horizontal
 *    or vertical run of >= 2 active cells corresponds to an exact clued word.
 * 4. Difficulty-aware word length priors: favors shorter/accessible words (including occasional
 *    3-4 letter words) on beginner puzzles and substantially longer words on expert/grandmaster puzzles.
 */

export const MIN_WORD_LENGTH = 2;
export const MAX_WORD_LENGTH = 18;
const MAX_GRID_DIM = 30;

export const WORD_LENGTH_PRIORS = {
  elementary: {
    id: 'elementary',
    minLength: 3,
    maxLength: 8,
    targetMean: 4.7,
    targetStd: 1.35,
    weight: 34,
    areaWeight: 0.9,
    encourageShortWords: true,
  },
  middle: {
    id: 'middle',
    minLength: 4,
    maxLength: 10,
    targetMean: 6.2,
    targetStd: 1.5,
    weight: 28,
    areaWeight: 0.7,
    encourageShortWords: false,
  },
  high: {
    id: 'high',
    minLength: 5,
    maxLength: 13,
    targetMean: 7.8,
    targetStd: 1.8,
    weight: 32,
    areaWeight: 0.5,
    encourageShortWords: false,
  },
  college: {
    id: 'college',
    minLength: 6,
    maxLength: 15,
    targetMean: 9.5,
    targetStd: 2.0,
    weight: 42,
    areaWeight: 0.3,
    encourageShortWords: false,
  },
  grandmaster: {
    id: 'grandmaster',
    minLength: 7,
    maxLength: 18,
    targetMean: 11.2,
    targetStd: 2.2,
    weight: 50,
    areaWeight: 0.2,
    encourageShortWords: false,
  },
};

function expandLigaturesAndDiacritics(raw) {
  return String(raw || '')
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae')
    .replace(/Œ/g, 'OE')
    .replace(/œ/g, 'oe')
    .replace(/ß/g, 'SS')
    .replace(/Ø/g, 'O')
    .replace(/ø/g, 'o')
    .replace(/Ł/g, 'L')
    .replace(/ł/g, 'l')
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Transliterates Unicode diacritics/ligatures (e.g. "Schrödinger" -> "SCHRODINGER",
 * "Möbius" -> "MOBIUS", "Poincaré" -> "POINCARE") before stripping non-A-Z characters,
 * preventing accented vowels from being silently dropped and shifting crossing indices.
 */
export function sanitizeWord(raw) {
  return expandLigaturesAndDiacritics(raw)
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .trim();
}

/**
 * Returns true only if `raw` is a clean single lexical word (no spaces, hyphens, digits,
 * or punctuation that would glue multi-word phrases or strip characters unexpectedly).
 */
export function isCleanSingleLexicalWord(raw) {
  const trimmed = expandLigaturesAndDiacritics(raw).trim();
  return /^[A-Za-z]+$/.test(trimmed) && trimmed.length >= MIN_WORD_LENGTH && trimmed.length <= MAX_WORD_LENGTH;
}

/**
 * Computes the log-prior score for a candidate word length given a difficulty level.
 * - Elementary/Beginner: peaks around 4-5 letters, welcomes 3-4 letter words, penalizes >8.
 * - College & Grandmaster: peaks around 9.5-11.5+ letters, rewards long scholarly words, penalizes short words.
 */
export function scoreWordLengthPrior(wordLength, difficultyKey = null) {
  if (!difficultyKey || !WORD_LENGTH_PRIORS[difficultyKey]) {
    return 0;
  }
  const prior = WORD_LENGTH_PRIORS[difficultyKey];
  const z = (wordLength - prior.targetMean) / prior.targetStd;
  let score = prior.weight * (1 - 0.55 * z * z);

  if (wordLength < prior.minLength) {
    score -= (prior.minLength - wordLength) * 48;
  } else if (wordLength > prior.maxLength) {
    score -= (wordLength - prior.maxLength) * 48;
  }

  if (prior.encourageShortWords && (wordLength === 3 || wordLength === 4)) {
    score += 14;
  }

  if (difficultyKey === 'college') {
    score += Math.min(wordLength, prior.maxLength) * 3.5;
  } else if (difficultyKey === 'grandmaster') {
    score += Math.min(wordLength, prior.maxLength) * 5.5;
  }

  return score;
}

/**
 * Generates an optimal, 100% connected, invariant-checked crossword layout.
 * Accepts `options.difficulty` ('elementary' | 'middle' | 'high' | 'college' | 'grandmaster')
 * to apply word-length priors during candidate ranking, placement, and layout selection.
 */
export function buildCrosswordLayout(rawItems, maxWords = 10, options = {}) {
  const difficulty = options?.difficulty || null;
  const seen = new Set();
  const validItems = [];

  for (const item of rawItems || []) {
    const clean = sanitizeWord(item.word);
    if (clean.length >= MIN_WORD_LENGTH && clean.length <= MAX_WORD_LENGTH && !seen.has(clean)) {
      seen.add(clean);
      validItems.push({
        ...item,
        word: clean,
      });
    }
  }

  if (validItems.length === 0) {
    return { rows: 5, cols: 5, words: [], cells: [] };
  }

  const targetCount = Math.min(maxWords, validItems.length);

  // Build diverse candidate orderings informed by connectivity AND word-length priors
  const byPriorAndBridge = [...validItems].sort(
    (a, b) =>
      scoreCandidatePriority(b.word, validItems, difficulty) -
      scoreCandidatePriority(a.word, validItems, difficulty)
  );
  const byLengthDesc = [...validItems].sort((a, b) => b.word.length - a.word.length);
  const byLengthAsc = [...validItems].sort((a, b) => a.word.length - b.word.length);
  const byBridgeDensity = [...validItems].sort(
    (a, b) => scoreMutualConnectivity(b.word, validItems) - scoreMutualConnectivity(a.word, validItems)
  );

  const orderings = [
    byPriorAndBridge,
    byBridgeDensity,
    difficulty === 'elementary' ? byLengthAsc : byLengthDesc,
    byLengthDesc,
    [...validItems],
  ];

  // Try starting with each candidate word as the root anchor word, ordered by prior+bridge
  for (let i = 0; i < validItems.length; i++) {
    const rest = validItems.filter((_, idx) => idx !== i);
    rest.sort(
      (a, b) =>
        scoreCandidatePriority(b.word, validItems, difficulty) -
        scoreCandidatePriority(a.word, validItems, difficulty)
    );
    orderings.push([validItems[i], ...rest]);
  }

  // Deterministic pseudo-random shuffles for extra search breadth on tricky word sets
  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let s = 0; s < 14; s++) {
    const arr = [...validItems];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(nextRand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    orderings.push(arr);
  }

  let bestAttempt = null;

  for (const ordered of orderings) {
    for (const startDir of ['across', 'down']) {
      const attempt = attemptPlacement(ordered, startDir, targetCount, difficulty);
      if (isBetterAttempt(attempt, bestAttempt, difficulty)) {
        bestAttempt = attempt;
      }
    }
  }

  const finalized = finalizeGrid(bestAttempt.placed);
  assertValidCrosswordLayout(finalized);
  return finalized;
}

function isBetterAttempt(candidate, currentBest, difficulty) {
  if (!currentBest) return true;
  if (candidate.placed.length !== currentBest.placed.length) {
    return candidate.placed.length > currentBest.placed.length;
  }
  if (difficulty && WORD_LENGTH_PRIORS[difficulty]) {
    if (Math.abs(candidate.qualityScore - currentBest.qualityScore) > 1e-6) {
      return candidate.qualityScore > currentBest.qualityScore;
    }
  }
  if (candidate.intersections !== currentBest.intersections) {
    return candidate.intersections > currentBest.intersections;
  }
  return candidate.area < currentBest.area;
}

function scoreLetterCommonality(word) {
  const bridges = new Set(['A', 'E', 'I', 'O', 'U', 'R', 'S', 'T', 'L', 'N', 'C', 'D']);
  let hits = 0;
  for (const ch of word) {
    if (bridges.has(ch)) hits += 1;
  }
  // Normalized bridge density + gentle cap on length so raw length doesn't blindly dominate beginner priors
  return (hits / Math.max(1, word.length)) * 24 + Math.min(word.length, 10) * 1.5;
}

function scoreMutualConnectivity(word, allItems) {
  const freq = new Map();
  for (const it of allItems) {
    for (const ch of new Set(it.word)) {
      freq.set(ch, (freq.get(ch) || 0) + 1);
    }
  }
  let shared = 0;
  for (const ch of new Set(word)) {
    shared += Math.max(0, (freq.get(ch) || 1) - 1);
  }
  // Combine distinct letter bridge potential with normalized density
  return scoreLetterCommonality(word) + shared * 3.2;
}

function scoreCandidatePriority(word, allItems, difficulty) {
  return scoreMutualConnectivity(word, allItems) + scoreWordLengthPrior(word.length, difficulty) * 1.35;
}

function attemptPlacement(items, firstDir = 'across', targetCount = 10, difficulty = null) {
  // Sparse coordinate map: key "r,c" -> { char, across: wordIdx|null, down: wordIdx|null }
  const board = new Map();
  const placed = [];
  let totalIntersections = 0;

  const priorCfg = (difficulty && WORD_LENGTH_PRIORS[difficulty]) || null;
  const areaWeight = priorCfg ? priorCfg.areaWeight : 0.85;

  const key = (r, c) => `${r},${c}`;

  function canPlace(word, startR, startC, dir) {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'across' ? 1 : 0;
    const perpDir = dir === 'across' ? 'down' : 'across';

    // Cell immediately before start and immediately after end must be empty
    const beforeKey = key(startR - dr, startC - dc);
    const afterKey = key(startR + dr * word.length, startC + dc * word.length);
    if (board.has(beforeKey) || board.has(afterKey)) {
      return -1;
    }

    let intersections = 0;

    for (let i = 0; i < word.length; i++) {
      const r = startR + dr * i;
      const c = startC + dc * i;
      const ch = word[i];
      const existing = board.get(key(r, c));

      if (existing) {
        // STRICT INVARIANT: overlapping cell MUST have the exact same character
        if (existing.char !== ch) return -1;
        // Cannot overlap in the same direction, and must cross a perpendicular word
        if (existing[dir] !== null) return -1;
        if (existing[perpDir] === null) return -1;
        intersections++;
      } else {
        // Perpendicular neighbors of a non-crossing cell MUST be empty (prevents side-by-side un-clued runs)
        const n1 = board.get(key(r + dc, c + dr));
        const n2 = board.get(key(r - dc, c - dr));
        if (n1 || n2) return -1;
      }
    }

    return intersections;
  }

  function putWord(item, startR, startC, dir, idx) {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'across' ? 1 : 0;
    const word = item.word;

    for (let i = 0; i < word.length; i++) {
      const r = startR + dr * i;
      const c = startC + dc * i;
      const k = key(r, c);
      const existing = board.get(k);
      if (existing) {
        if (existing.char !== word[i]) {
          throw new Error(
            `Invariant violation while placing "${word}" at (${r},${c}): expected "${existing.char}", got "${word[i]}"`
          );
        }
        if (existing[dir] !== null) {
          throw new Error(`Same-direction overlap violation at (${r},${c}) for direction "${dir}"`);
        }
        existing[dir] = idx;
      } else {
        board.set(k, {
          char: word[i],
          across: dir === 'across' ? idx : null,
          down: dir === 'down' ? idx : null,
        });
      }
    }

    placed.push({
      ...item,
      row: startR,
      col: startC,
      direction: dir,
    });
  }

  function getBounds(extraWord = null) {
    let minR = Infinity,
      maxR = -Infinity,
      minC = Infinity,
      maxC = -Infinity;
    for (const k of board.keys()) {
      const [r, c] = k.split(',').map(Number);
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    if (extraWord) {
      const dr = extraWord.dir === 'down' ? 1 : 0;
      const dc = extraWord.dir === 'across' ? 1 : 0;
      const endR = extraWord.r + dr * (extraWord.len - 1);
      const endC = extraWord.c + dc * (extraWord.len - 1);
      minR = Math.min(minR, extraWord.r, endR);
      maxR = Math.max(maxR, extraWord.r, endR);
      minC = Math.min(minC, extraWord.c, endC);
      maxC = Math.max(maxC, extraWord.c, endC);
    }
    if (minR === Infinity) return { minR: 0, maxR: 0, minC: 0, maxC: 0, width: 1, height: 1, area: 1 };
    const height = maxR - minR + 1;
    const width = maxC - minC + 1;
    return { minR, maxR, minC, maxC, width, height, area: width * height };
  }

  // Place root word at origin
  putWord(items[0], 0, 0, firstDir, 0);
  const remaining = items.slice(1);

  let madeProgress = true;
  while (madeProgress && remaining.length > 0 && placed.length < targetCount) {
    madeProgress = false;
    let bestCandidate = null;
    const hasShortWordAlready = placed.some((p) => p.word.length <= 4);

    for (let rIdx = 0; rIdx < remaining.length; rIdx++) {
      const candidateItem = remaining[rIdx];
      const w = candidateItem.word;
      let lengthBonus = scoreWordLengthPrior(w.length, difficulty);
      if (priorCfg?.encourageShortWords && !hasShortWordAlready && w.length <= 4) {
        lengthBonus += 38;
      }

      for (const p of placed) {
        const targetDir = p.direction === 'across' ? 'down' : 'across';
        const pDr = p.direction === 'down' ? 1 : 0;
        const pDc = p.direction === 'across' ? 1 : 0;
        const tDr = targetDir === 'down' ? 1 : 0;
        const tDc = targetDir === 'across' ? 1 : 0;

        for (let pi = 0; pi < p.word.length; pi++) {
          const boardR = p.row + pDr * pi;
          const boardC = p.col + pDc * pi;
          const ch = p.word[pi];

          for (let wi = 0; wi < w.length; wi++) {
            if (w[wi] !== ch) continue;
            const startR = boardR - tDr * wi;
            const startC = boardC - tDc * wi;
            const ints = canPlace(w, startR, startC, targetDir);
            if (ints > 0) {
              const b = getBounds({ r: startR, c: startC, dir: targetDir, len: w.length });
              if (b.width > MAX_GRID_DIM || b.height > MAX_GRID_DIM) continue;
              const aspectPenalty = Math.abs(b.width - b.height) * 3.5;
              const score = ints * 125 + lengthBonus - b.area * areaWeight - aspectPenalty;
              if (!bestCandidate || score > bestCandidate.score) {
                bestCandidate = {
                  rIdx,
                  item: candidateItem,
                  startR,
                  startC,
                  dir: targetDir,
                  ints,
                  score,
                };
              }
            }
          }
        }
      }
    }

    if (bestCandidate) {
      remaining.splice(bestCandidate.rIdx, 1);
      putWord(
        bestCandidate.item,
        bestCandidate.startR,
        bestCandidate.startC,
        bestCandidate.dir,
        placed.length
      );
      totalIntersections += bestCandidate.ints;
      madeProgress = true;
    }
  }

  const finalBounds = getBounds();
  const priorSum = placed.reduce((acc, w) => acc + scoreWordLengthPrior(w.word.length, difficulty), 0);
  const shortDiversityBonus =
    priorCfg?.encourageShortWords && placed.some((p) => p.word.length <= 4) ? 28 : 0;
  const qualityScore =
    priorSum + shortDiversityBonus + totalIntersections * 35 - finalBounds.area * areaWeight;

  return {
    placed,
    intersections: totalIntersections,
    area: finalBounds.area,
    qualityScore,
  };
}

function finalizeGrid(placedWords) {
  let minR = Infinity,
    maxR = -Infinity,
    minC = Infinity,
    maxC = -Infinity;

  for (const w of placedWords) {
    const dr = w.direction === 'down' ? 1 : 0;
    const dc = w.direction === 'across' ? 1 : 0;
    const endR = w.row + dr * (w.word.length - 1);
    const endC = w.col + dc * (w.word.length - 1);
    minR = Math.min(minR, w.row, endR);
    maxR = Math.max(maxR, w.row, endR);
    minC = Math.min(minC, w.col, endC);
    maxC = Math.max(maxC, w.col, endC);
  }

  const rows = maxR - minR + 1;
  const cols = maxC - minC + 1;

  // Normalize coordinates to 0..rows-1, 0..cols-1
  const normalizedWords = placedWords.map((w) => ({
    ...w,
    row: w.row - minR,
    col: w.col - minC,
  }));

  // Sort in reading order (top-to-bottom, left-to-right; Across before Down on identical start square)
  normalizedWords.sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    if (a.col !== b.col) return a.col - b.col;
    return a.direction === 'across' ? -1 : 1;
  });

  // Assign unique clue numbers 1..N
  normalizedWords.forEach((w, idx) => {
    w.number = idx + 1;
    w.id = `word-${idx + 1}`;
  });

  // Build 2D cells array
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({
      row: r,
      col: c,
      active: false,
      solution: '',
      acrossWordId: null,
      downWordId: null,
      wordIds: [],
      startNumbers: [],
      isFirstLetterOfAny: false,
    }))
  );

  for (const w of normalizedWords) {
    const dr = w.direction === 'down' ? 1 : 0;
    const dc = w.direction === 'across' ? 1 : 0;
    for (let i = 0; i < w.word.length; i++) {
      const r = w.row + dr * i;
      const c = w.col + dc * i;
      const cell = cells[r][c];
      if (cell.active && cell.solution !== w.word[i]) {
        throw new Error(
          `Crossword intersection conflict at (${r},${c}): "${cell.solution}" vs "${w.word[i]}"`
        );
      }
      if (w.direction === 'across') {
        if (cell.acrossWordId !== null) {
          throw new Error(`Duplicate across word at (${r},${c})`);
        }
        cell.acrossWordId = w.id;
      } else {
        if (cell.downWordId !== null) {
          throw new Error(`Duplicate down word at (${r},${c})`);
        }
        cell.downWordId = w.id;
      }
      cell.active = true;
      cell.solution = w.word[i];
      cell.wordIds.push(w.id);
      if (i === 0) {
        cell.startNumbers.push({
          number: w.number,
          direction: w.direction,
          wordId: w.id,
        });
        cell.isFirstLetterOfAny = true;
      }
    }
  }

  return {
    rows,
    cols,
    words: normalizedWords,
    cells,
  };
}

/**
 * Exhaustive structural & intersection verifier.
 * Throws immediately if ANY horizontal/vertical crossing cell is inconsistent,
 * if two words overlap in the same direction, if un-clued adjacent runs exist,
 * or if the crossword graph is disconnected.
 */
export function assertValidCrosswordLayout(layout) {
  if (!layout || !Array.isArray(layout.words) || !Array.isArray(layout.cells)) {
    throw new Error('Invalid layout structure');
  }
  if (layout.words.length === 0) {
    return true;
  }

  const { rows, cols, words, cells } = layout;
  if (cells.length !== rows || cells.some((row) => row.length !== cols)) {
    throw new Error('Grid cell dimensions do not match layout rows/cols');
  }

  const wordById = new Map();
  const expectedCells = new Map();
  const acrossSpans = new Set();
  const downSpans = new Set();

  for (const w of words) {
    if (!w.word || !/^[A-Z]+$/.test(w.word) || w.word.length < MIN_WORD_LENGTH) {
      throw new Error(`Invalid word string in layout: "${w.word}"`);
    }
    if (w.direction !== 'across' && w.direction !== 'down') {
      throw new Error(`Invalid word direction "${w.direction}" for "${w.word}"`);
    }
    if (wordById.has(w.id)) {
      throw new Error(`Duplicate word id "${w.id}"`);
    }
    wordById.set(w.id, w);

    const dr = w.direction === 'down' ? 1 : 0;
    const dc = w.direction === 'across' ? 1 : 0;

    // Verify empty boundary before start and after end
    const beforeR = w.row - dr;
    const beforeC = w.col - dc;
    if (beforeR >= 0 && beforeR < rows && beforeC >= 0 && beforeC < cols) {
      if (cells[beforeR][beforeC].active) {
        throw new Error(`Active cell immediately precedes word "${w.word}" at (${beforeR},${beforeC})`);
      }
    }
    const afterR = w.row + dr * w.word.length;
    const afterC = w.col + dc * w.word.length;
    if (afterR >= 0 && afterR < rows && afterC >= 0 && afterC < cols) {
      if (cells[afterR][afterC].active) {
        throw new Error(`Active cell immediately follows word "${w.word}" at (${afterR},${afterC})`);
      }
    }

    if (w.direction === 'across') {
      acrossSpans.add(`${w.row},${w.col},${w.word.length}`);
    } else {
      downSpans.add(`${w.row},${w.col},${w.word.length}`);
    }

    for (let i = 0; i < w.word.length; i++) {
      const r = w.row + dr * i;
      const c = w.col + dc * i;
      if (r < 0 || r >= rows || c < 0 || c >= cols) {
        throw new Error(`Word "${w.word}" out of grid bounds at (${r},${c})`);
      }
      const k = `${r},${c}`;
      const ch = w.word[i];
      const prev = expectedCells.get(k);
      if (prev) {
        if (prev.char !== ch) {
          throw new Error(
            `Overlapping cell mismatch at (${r},${c}): "${prev.char}" vs "${ch}" between "${prev.words.join(',')}" and "${w.word}"`
          );
        }
        if (prev.directions.has(w.direction)) {
          throw new Error(`Same-direction word overlap at (${r},${c}) in direction "${w.direction}"`);
        }
        prev.directions.add(w.direction);
        prev.words.push(w.word);
      } else {
        expectedCells.set(k, {
          char: ch,
          directions: new Set([w.direction]),
          words: [w.word],
        });
      }

      const cell = cells[r][c];
      if (!cell.active || cell.solution !== ch || !cell.wordIds.includes(w.id)) {
        throw new Error(
          `Grid cell (${r},${c}) solution "${cell?.solution}" is inconsistent with word "${w.word}" letter "${ch}"`
        );
      }
    }
  }

  // Verify every active cell in `cells` matches `expectedCells` and has <= 2 perpendicular words
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r][c];
      const exp = expectedCells.get(`${r},${c}`);
      if (cell.active) {
        if (!exp || cell.solution !== exp.char || cell.wordIds.length !== exp.words.length) {
          throw new Error(`Orphan or mismatched active cell at (${r},${c})`);
        }
        if (cell.wordIds.length > 2) {
          throw new Error(`Cell (${r},${c}) belongs to more than 2 words`);
        }
      } else if (exp) {
        throw new Error(`Expected active cell at (${r},${c}) was marked inactive`);
      }
    }
  }

  // Verify every maximal horizontal contiguous run of >= 2 active cells is an exact Across word
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!cells[r][c].active) {
        c++;
        continue;
      }
      const startC = c;
      while (c < cols && cells[r][c].active) c++;
      const len = c - startC;
      if (len >= 2 && !acrossSpans.has(`${r},${startC},${len}`)) {
        throw new Error(`Un-clued horizontal adjacent letter run at row ${r}, col ${startC}, len ${len}`);
      }
    }
  }

  // Verify every maximal vertical contiguous run of >= 2 active cells is an exact Down word
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (!cells[r][c].active) {
        r++;
        continue;
      }
      const startR = r;
      while (r < rows && cells[r][c].active) r++;
      const len = r - startR;
      if (len >= 2 && !downSpans.has(`${startR},${c},${len}`)) {
        throw new Error(`Un-clued vertical adjacent letter run at row ${startR}, col ${c}, len ${len}`);
      }
    }
  }

  // Verify 100% single-component connectivity
  if (words.length > 1) {
    const adj = new Map(words.map((w) => [w.id, new Set()]));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wIds = cells[r][c].wordIds;
        if (wIds.length === 2) {
          adj.get(wIds[0]).add(wIds[1]);
          adj.get(wIds[1]).add(wIds[0]);
        }
      }
    }
    const visited = new Set([words[0].id]);
    const queue = [words[0].id];
    while (queue.length > 0) {
      const curr = queue.shift();
      for (const nxt of adj.get(curr) || []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
    if (visited.size !== words.length) {
      throw new Error(`Disconnected crossword layout: ${visited.size} of ${words.length} words connected`);
    }
  }

  return true;
}
