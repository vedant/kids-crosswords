/**
 * Crossword Grid Layout Engine
 * Places 5-10 words into a compact, 100% connected crossword grid.
 * Follows strict standard crossword rules:
 * - Every word after the first MUST intersect the connected crossword component (no disconnected islands!)
 * - Words only intersect at matching letters (perpendicularly)
 * - No adjacent parallel words touching side-by-side without a valid crossing
 * - Cell before word start and after word end must be empty
 */

export function sanitizeWord(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .trim();
}

/**
 * Generates an optimal, connected crossword layout from a list of candidate clue items.
 * Accepts extra candidate items (e.g. targetCount + 5) and selects up to `maxWords` items
 * that form a single connected crossword grid.
 */
export function buildCrosswordLayout(rawItems, maxWords = 10) {
  const seen = new Set();
  const validItems = [];

  for (const item of rawItems || []) {
    const clean = sanitizeWord(item.word);
    if (clean.length >= 2 && clean.length <= 15 && !seen.has(clean)) {
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

  // Build diverse candidate orderings so we always find a 100% connected layout
  const byLengthDesc = [...validItems].sort((a, b) => b.word.length - a.word.length);
  const byBridgeScore = [...validItems].sort(
    (a, b) => scoreMutualConnectivity(b.word, validItems) - scoreMutualConnectivity(a.word, validItems)
  );
  const byVowelScore = [...validItems].sort(
    (a, b) => scoreLetterCommonality(b.word) - scoreLetterCommonality(a.word)
  );

  const orderings = [
    byBridgeScore,
    byLengthDesc,
    byVowelScore,
    [...validItems],
    [...byBridgeScore].reverse(),
  ];

  // Also try starting with each candidate word as the root anchor word
  for (let i = 0; i < validItems.length; i++) {
    const rest = validItems.filter((_, idx) => idx !== i);
    rest.sort(
      (a, b) => scoreMutualConnectivity(b.word, validItems) - scoreMutualConnectivity(a.word, validItems)
    );
    orderings.push([validItems[i], ...rest]);
  }

  // Deterministic pseudo-random shuffles for extra search breadth on tricky word sets
  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let s = 0; s < 12; s++) {
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
      const attempt = attemptPlacement(ordered, startDir, targetCount);
      if (isBetterAttempt(attempt, bestAttempt)) {
        bestAttempt = attempt;
      }
    }
    // Early exit if we found a well-connected full layout
    if (
      bestAttempt &&
      bestAttempt.placed.length === targetCount &&
      bestAttempt.intersections >= targetCount
    ) {
      break;
    }
  }

  return finalizeGrid(bestAttempt.placed);
}

function isBetterAttempt(candidate, currentBest) {
  if (!currentBest) return true;
  if (candidate.placed.length !== currentBest.placed.length) {
    return candidate.placed.length > currentBest.placed.length;
  }
  if (candidate.intersections !== currentBest.intersections) {
    return candidate.intersections > currentBest.intersections;
  }
  return candidate.area < currentBest.area;
}

function scoreLetterCommonality(word) {
  const bridges = new Set(['A', 'E', 'I', 'O', 'U', 'R', 'S', 'T', 'L', 'N', 'C', 'D']);
  let score = word.length * 2;
  for (const ch of word) {
    if (bridges.has(ch)) score += 3;
  }
  return score;
}

function scoreMutualConnectivity(word, allItems) {
  const freq = new Map();
  for (const it of allItems) {
    for (const ch of new Set(it.word)) {
      freq.set(ch, (freq.get(ch) || 0) + 1);
    }
  }
  let score = scoreLetterCommonality(word);
  for (const ch of word) {
    score += (freq.get(ch) || 0) * 4;
  }
  return score;
}

function attemptPlacement(items, firstDir = 'across', targetCount = 10) {
  // Sparse coordinate map: key "r,c" -> { char, across: wordIdx|null, down: wordIdx|null }
  const board = new Map();
  const placed = [];
  let totalIntersections = 0;

  const key = (r, c) => `${r},${c}`;

  function canPlace(word, startR, startC, dir) {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'across' ? 1 : 0;

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
        if (existing.char !== ch) return -1;
        // Cannot overlap in the same direction
        if (dir === 'across' && existing.across !== null) return -1;
        if (dir === 'down' && existing.down !== null) return -1;
        intersections++;
      } else {
        // Check perpendicular neighbors — must be empty if not an intersection cell
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
      const existing = board.get(k) || { char: word[i], across: null, down: null };
      existing.char = word[i];
      existing[dir] = idx;
      board.set(k, existing);
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

  // Place first word at origin
  putWord(items[0], 0, 0, firstDir, 0);
  const remaining = items.slice(1);

  // Iteratively place remaining words that intersect the connected component
  let madeProgress = true;
  while (madeProgress && remaining.length > 0 && placed.length < targetCount) {
    madeProgress = false;
    let bestCandidate = null;

    for (let rIdx = 0; rIdx < remaining.length; rIdx++) {
      const candidateItem = remaining[rIdx];
      const w = candidateItem.word;

      // Find all valid intersection placements against already placed words
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
              if (b.width > 22 || b.height > 22) continue;
              const aspectPenalty = Math.abs(b.width - b.height) * 4;
              const score = ints * 120 - b.area - aspectPenalty;
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

  // NOTE: We intentionally NEVER place disconnected orphan words!
  // Every word in `placed` is guaranteed to be part of a single connected crossword component.

  const finalBounds = getBounds();
  return {
    placed,
    intersections: totalIntersections,
    area: finalBounds.area,
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

  // Sort in reading order (top-to-bottom, left-to-right) and assign clue numbers 1..N
  normalizedWords.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));

  // Assign unique word numbers 1..N
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
