import { test, expect } from '@playwright/test';

test('renders Kids Crossword board, switches themed puzzles, and celebrates clues & victory', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');

  // Verify default difficulty is Elementary
  await expect(page.locator('#difficulty-select')).toHaveValue('elementary');
  await expect(page.locator('#active-puzzle-title')).toHaveText('Baby Animals Crossword');
  await expect(page.locator('#total-word-count')).toHaveText('7');
  await expect(page.locator('.clue-card')).toHaveCount(7);

  // Switch to Dinosaur World (6 clues) and Pirates (7 clues)
  await page.locator('[data-quick-preset-id="dinosaurs"]').click();
  await expect(page.locator('#active-puzzle-title')).toHaveText('Dinosaur World Crossword');
  await expect(page.locator('#total-word-count')).toHaveText('6');

  await page.locator('[data-preset-id="pirate-treasure"]').click();
  await expect(page.locator('#active-puzzle-title')).toHaveText('Pirates & Treasure Crossword');
  await expect(page.locator('.clue-card')).toHaveCount(7);

  await page.locator('[data-quick-preset-id="baby-animals"]').click();
  await page.evaluate(() => {
    window.__KIDS_XW__.solveCurrentWord();
  });
  await expect(page.locator('#solved-count')).toHaveText('1');
  await expect(page.locator('.clue-yay-toast').first()).toBeVisible();

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

test('custom AI theme generation supports College difficulty, produces 100% connected grid, and never leaks word string in clues', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');

  await page.selectOption('#difficulty-select', 'college');
  await page.selectOption('#clue-count-select', '6');
  await page.selectOption('#clue-style-select', 'questions');
  await page.fill('#theme-input', 'Astrophysics and Relativity');
  await page.click('#btn-generate-theme');

  await expect(page.locator('#active-puzzle-title')).toHaveText('Astrophysics and Relativity Crossword', { timeout: 25000 });
  await expect(page.locator('#active-theme-pill')).toContainText('College');

  const audit = await page.evaluate(() => {
    const layout = window.__KIDS_XW__.getState().layout;
    // Check single-component connectivity
    const adj = new Map(layout.words.map((w) => [w.id, new Set()]));
    for (let r = 0; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        const cell = layout.cells[r][c];
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
    const allConnected = visited.size === layout.words.length;
    const anyClueLeaksWord = layout.words.some(
      (w) =>
        w.questionClue.trim().toUpperCase() === w.word ||
        new RegExp(`\\b${w.word}\\b`, 'i').test(w.questionClue)
    );
    return {
      wordCount: layout.words.length,
      allConnected,
      anyClueLeaksWord,
      words: layout.words.map((w) => ({ word: w.word, clue: w.questionClue })),
    };
  });

  expect(audit.wordCount).toBeGreaterThanOrEqual(5);
  expect(audit.allConnected).toBe(true);
  expect(audit.anyClueLeaksWord).toBe(false);
  expect(pageErrors).toEqual([]);
});
