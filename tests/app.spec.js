import { test, expect } from '@playwright/test';

test('renders Kids Crossword board, celebrates single clue with YAAAY, and celebrates full puzzle victory', async ({ page }) => {
  await page.goto('/');

  // 1. Verify header and default Baby Animals puzzle with 7 clues
  await expect(page.locator('#active-puzzle-title')).toHaveText('Baby Animals Crossword');
  await expect(page.locator('#total-word-count')).toHaveText('7');

  const clueCards = page.locator('.clue-card');
  await expect(clueCards).toHaveCount(7);

  // Check that both AI picture clues and question clues exist
  await expect(page.locator('.clue-visual-box img').first()).toBeVisible();
  await expect(page.locator('.clue-question-icon-box').first()).toBeVisible();

  // Take screenshot of the main playable board
  await page.screenshot({ path: 'test-results/01-board.png', fullPage: false });

  // 2. Solve a single clue and verify the "YAAAY!" floating toast & solved state
  await page.evaluate(() => {
    window.__KIDS_XW__.solveCurrentWord();
  });

  await expect(page.locator('#solved-count')).toHaveText('1');
  await expect(page.locator('.clue-yay-toast').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/02-clue-yay.png', fullPage: false });

  // 3. Solve the entire puzzle and verify the Grand Victory Animation & Modal
  await page.evaluate(() => {
    window.__KIDS_XW__.solveAllWords();
  });

  await expect(page.locator('#solved-count')).toHaveText('7');
  await expect(page.locator('#victory-overlay')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#victory-title')).toContainText('YAAAY! PUZZLE SOLVED!');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/03-victory-celebration.png', fullPage: false });
});
