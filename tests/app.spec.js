import { test, expect } from '@playwright/test';

test('renders Kids Crossword board, switches themed puzzles (replacing full board & clues), and celebrates clues & victory', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');

  // 1. Verify header and default Baby Animals puzzle with 7 clues
  await expect(page.locator('#active-puzzle-title')).toHaveText('Baby Animals Crossword');
  await expect(page.locator('#total-word-count')).toHaveText('7');
  await expect(page.locator('.clue-card')).toHaveCount(7);

  const initialWords = await page.evaluate(() =>
    window.__KIDS_XW__.getState().layout.words.map((w) => w.word)
  );
  expect(initialWords).toContain('KITTEN');

  // 2. Test switching to Dinosaur World (6 clues) and Solar System (7 clues)
  await page.locator('[data-quick-preset-id="dinosaurs"]').click();
  await expect(page.locator('#active-puzzle-title')).toHaveText('Dinosaur World Crossword');
  await expect(page.locator('#total-word-count')).toHaveText('6');
  await expect(page.locator('.clue-card')).toHaveCount(6);
  const dinoWords = await page.evaluate(() =>
    window.__KIDS_XW__.getState().layout.words.map((w) => w.word)
  );
  expect(dinoWords).toContain('TREX');
  expect(dinoWords).not.toContain('KITTEN');

  // Also test clicking a Featured Theme gallery card at the bottom
  await page.locator('[data-preset-id="pirate-treasure"]').click();
  await expect(page.locator('#active-puzzle-title')).toHaveText('Pirates & Treasure Crossword');
  await expect(page.locator('.clue-card')).toHaveCount(7);
  const pirateWords = await page.evaluate(() =>
    window.__KIDS_XW__.getState().layout.words.map((w) => w.word)
  );
  expect(pirateWords).toContain('TREASURE');
  expect(pirateWords).not.toContain('TREX');

  // Switch back to Baby Animals and take screenshot
  await page.locator('[data-quick-preset-id="baby-animals"]').click();
  await expect(page.locator('#active-puzzle-title')).toHaveText('Baby Animals Crossword');
  await page.screenshot({ path: 'test-results/01-board.png', fullPage: false });

  // 3. Solve a single clue and verify the "YAAAY!" floating toast & solved state
  await page.evaluate(() => {
    window.__KIDS_XW__.solveCurrentWord();
  });

  await expect(page.locator('#solved-count')).toHaveText('1');
  await expect(page.locator('.clue-yay-toast').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/02-clue-yay.png', fullPage: false });

  // 4. Solve the entire puzzle and verify the Grand Victory Animation & Modal
  await page.evaluate(() => {
    window.__KIDS_XW__.solveAllWords();
  });

  await expect(page.locator('#solved-count')).toHaveText('7');
  await expect(page.locator('#victory-overlay')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#victory-title')).toContainText('YAAAY! PUZZLE SOLVED!');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/03-victory-celebration.png', fullPage: false });

  expect(pageErrors).toEqual([]);
});

test('mobile viewport (390x844) renders single-screen playable layout with grid above clues and zero horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  // AI generator should start collapsed on mobile so the board is immediately accessible
  await expect(page.locator('#theme-generator-card')).toHaveClass(/mobile-collapsed/);

  const bannerBox = await page.locator('#active-clue-banner').boundingBox();
  const gridBox = await page.locator('#crossword-grid').boundingBox();
  const keyboardBox = await page.locator('#virtual-keyboard').boundingBox();
  const leftCluesBox = await page.locator('#clues-col-left').boundingBox();

  // Grid must fit inside the 390px mobile screen without overflowing horizontally
  expect(gridBox.width).toBeLessThanOrEqual(390);
  expect(gridBox.x).toBeGreaterThanOrEqual(0);

  // Grid and Virtual Keyboard must appear ABOVE the clue card lists on mobile
  expect(gridBox.y).toBeGreaterThan(bannerBox.y);
  expect(keyboardBox.y).toBeGreaterThan(gridBox.y);
  expect(leftCluesBox.y).toBeGreaterThan(keyboardBox.y);

  // Test 1-tap clue jump pills on mobile
  await page.locator('.clue-jump-pill').nth(2).click();
  await expect(page.locator('.clue-jump-pill').nth(2)).toHaveClass(/selected/);

  await page.screenshot({ path: 'test-results/04-mobile-board.png', fullPage: false });
});

test('custom AI theme generation works end-to-end with backend hardcoded gemini-3.5-flash-lite', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');

  await page.selectOption('#clue-count-select', '5');
  await page.selectOption('#clue-style-select', 'questions');
  await page.fill('#theme-input', 'Farm Animals');
  await page.click('#btn-generate-theme');

  await expect(page.locator('#active-puzzle-title')).toHaveText('Farm Animals Crossword', { timeout: 25000 });
  await expect(page.locator('#total-word-count')).toHaveText('5');
  await expect(page.locator('.clue-card')).toHaveCount(5);

  const generatedWords = await page.evaluate(() =>
    window.__KIDS_XW__.getState().layout.words.map((w) => w.word)
  );
  expect(generatedWords.length).toBe(5);
  expect(pageErrors).toEqual([]);
});
