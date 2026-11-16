import { test, expect } from '@playwright/test';

test('renders Magic Crossword board, toggles desktop keypad, switches curated collections, and celebrates victory', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');

  await expect(page).toHaveTitle(/Magic Crossword/);
  await expect(page.locator('.site-logo-title')).toContainText('Magic');
  await expect(page.locator('.site-logo-title')).toContainText('Crossword');

  // Verify default difficulty is Elementary and Grandmaster option exists above College
  await expect(page.locator('#difficulty-select')).toHaveValue('elementary');
  const difficultyValues = await page
    .locator('#difficulty-select option')
    .evaluateAll((opts) => opts.map((o) => o.value));
  expect(difficultyValues).toEqual(['elementary', 'middle', 'high', 'college', 'grandmaster']);

  // Verify decluttered desktop defaults: virtual keyboard & clue jump bar hidden on wide desktop
  await expect(page.locator('#virtual-keyboard')).toBeHidden();
  await expect(page.locator('#clue-jump-bar')).toBeHidden();
  await page.click('#btn-keyboard-toggle');
  await expect(page.locator('#virtual-keyboard')).toBeVisible();
  await page.click('#btn-keyboard-toggle');
  await expect(page.locator('#virtual-keyboard')).toBeHidden();

  await expect(page.locator('#active-puzzle-title')).toHaveText('Young Wildlife');
  await expect(page.locator('#total-word-count')).toHaveText('7');
  await expect(page.locator('.clue-card')).toHaveCount(7);

  // Switch curated collections
  await page.locator('[data-quick-preset-id="dinosaurs"]').click();
  await expect(page.locator('#active-puzzle-title')).toHaveText('Ancient Giants');
  await expect(page.locator('#total-word-count')).toHaveText('6');

  await page.locator('[data-preset-id="pirate-treasure"]').click();
  await expect(page.locator('#active-puzzle-title')).toHaveText('High Seas Voyage');
  await expect(page.locator('.clue-card')).toHaveCount(7);

  // Verify typing over a wrong tentative crossing letter overwrites cleanly instead of skipping & shifting
  await page.click('#btn-first-letter-toggle');
  await page.evaluate(() => {
    const st = window.__KIDS_XW__.getState();
    let crossCell = null;
    for (let r = 0; r < st.layout.rows && !crossCell; r++) {
      for (let c = 0; c < st.layout.cols && !crossCell; c++) {
        if (st.layout.cells[r][c].wordIds.length === 2) {
          crossCell = st.layout.cells[r][c];
        }
      }
    }
    const [w1Id, w2Id] = crossCell.wordIds;
    const w1 = st.layout.words.find((w) => w.id === w1Id);
    const dr1 = w1.direction === 'down' ? 1 : 0;
    const dc1 = w1.direction === 'across' ? 1 : 0;
    for (let i = 0; i < w1.word.length; i++) {
      const rr = w1.row + dr1 * i;
      const cc = w1.col + dc1 * i;
      st.userGrid[rr][cc] = st.layout.cells[rr][cc].solution === 'Z' ? 'Q' : 'Z';
    }
    window.__TEST_W2_ID__ = w2Id;
  });

  const w2Word = await page.evaluate(() => {
    const st = window.__KIDS_XW__.getState();
    const w2 = st.layout.words.find((w) => w.id === window.__TEST_W2_ID__);
    document.querySelector(`[data-clue-word-id="${w2.id}"]`).click();
    return w2.word;
  });

  for (const ch of w2Word) {
    await page.keyboard.press(ch);
  }
  await expect(page.locator('#solved-count')).toHaveText('1');

  await page.evaluate(() => {
    window.__KIDS_XW__.solveAllWords();
  });
  await expect(page.locator('#solved-count')).toHaveText('7');
  await expect(page.locator('#victory-overlay')).toBeVisible({ timeout: 3000 });

  expect(pageErrors).toEqual([]);
});

test('mobile viewport (390x844) renders single-screen playable layout with grid above clues and zero horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.locator('#theme-generator-card')).toHaveClass(/mobile-collapsed/);
  await expect(page.locator('#virtual-keyboard')).toBeVisible();
  await expect(page.locator('#clue-jump-bar')).toBeVisible();

  const bannerBox = await page.locator('#active-clue-banner').boundingBox();
  const gridBox = await page.locator('#crossword-grid').boundingBox();
  const keyboardBox = await page.locator('#virtual-keyboard').boundingBox();
  const leftCluesBox = await page.locator('#clues-col-left').boundingBox();

  expect(gridBox.width).toBeLessThanOrEqual(390);
  expect(gridBox.x).toBeGreaterThanOrEqual(0);
  expect(gridBox.y).toBeGreaterThan(bannerBox.y);
  expect(keyboardBox.y).toBeGreaterThan(gridBox.y);
  expect(leftCluesBox.y).toBeGreaterThan(keyboardBox.y);

  await page.locator('.clue-jump-pill').nth(2).click();
  await expect(page.locator('.clue-jump-pill').nth(2)).toHaveClass(/selected/);
});

test('custom AI generation supports Grandmaster (above College) & Elementary word-length priors with 100% consistent intersections', async ({ page }) => {
  test.setTimeout(60000);
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');

  // 1. Generate Elementary puzzle
  await page.selectOption('#difficulty-select', 'elementary');
  await page.selectOption('#clue-count-select', '6');
  await page.selectOption('#clue-style-select', 'questions');
  await page.fill('#theme-input', 'Farm Animals and Nature');
  await page.click('#btn-generate-theme');

  await expect(page.locator('#active-puzzle-title')).toHaveText('Farm Animals and Nature', { timeout: 30000 });
  const elemAudit = await page.evaluate(() => {
    const layout = window.__KIDS_XW__.getState().layout;
    const avgLen = layout.words.reduce((s, w) => s + w.word.length, 0) / layout.words.length;
    return {
      wordCount: layout.words.length,
      avgLen,
      words: layout.words.map((w) => w.word),
    };
  });

  // 2. Generate Grandmaster (above College) puzzle
  await page.selectOption('#difficulty-select', 'grandmaster');
  await page.selectOption('#clue-count-select', '6');
  await page.selectOption('#clue-style-select', 'questions');
  await page.fill('#theme-input', 'Quantum Field Theory and Cosmology');
  await page.click('#btn-generate-theme');

  await expect(page.locator('#active-puzzle-title')).toHaveText('Quantum Field Theory and Cosmology', { timeout: 35000 });
  await expect(page.locator('#active-theme-pill')).toContainText('Grandmaster');

  const gmAudit = await page.evaluate(() => {
    const layout = window.__KIDS_XW__.getState().layout;
    let allCrossingsConsistent = true;
    const adj = new Map(layout.words.map((w) => [w.id, new Set()]));

    for (let r = 0; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        const cell = layout.cells[r][c];
        if (!cell.active) continue;
        for (const wid of cell.wordIds) {
          const w = layout.words.find((it) => it.id === wid);
          const idx = w.direction === 'across' ? c - w.col : r - w.row;
          if (w.word[idx] !== cell.solution) {
            allCrossingsConsistent = false;
          }
        }
        if (cell.wordIds.length > 1) {
          for (const a of cell.wordIds) {
            for (const b of cell.wordIds) {
              if (a !== b) adj.get(a).add(b);
            }
          }
        }
      }
    }

    const visited = new Set([layout.words[0].id]);
    const q = [layout.words[0].id];
    while (q.length > 0) {
      const curr = q.shift();
      for (const nxt of adj.get(curr) || []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          q.push(nxt);
        }
      }
    }

    const avgLen = layout.words.reduce((s, w) => s + w.word.length, 0) / layout.words.length;
    const anyClueLeaksWord = layout.words.some(
      (w) =>
        w.questionClue.trim().toUpperCase() === w.word ||
        new RegExp(`\\b${w.word}\\b`, 'i').test(w.questionClue)
    );

    return {
      wordCount: layout.words.length,
      allCrossingsConsistent,
      allConnected: visited.size === layout.words.length,
      anyClueLeaksWord,
      avgLen,
      words: layout.words.map((w) => ({ word: w.word, clue: w.questionClue })),
    };
  });

  expect(elemAudit.wordCount).toBeGreaterThanOrEqual(5);
  expect(gmAudit.wordCount).toBeGreaterThanOrEqual(5);
  expect(gmAudit.allCrossingsConsistent).toBe(true);
  expect(gmAudit.allConnected).toBe(true);
  expect(gmAudit.anyClueLeaksWord).toBe(false);
  expect(gmAudit.avgLen).toBeGreaterThan(elemAudit.avgLen);
  expect(pageErrors).toEqual([]);
});
