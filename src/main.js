/**
 * Main Application Controller for Crosswords for Kids
 * - Renders 100% connected crossword grids (5-10 clues) with Crosswords-for-Kids.com styling
 * - Supports 4 difficulty levels: Elementary (default), Middle School, High School, and College
 * - Supports both AI-generated Picture Clues and Question/Riddle Clues with spoiler-free validation
 * - Allows user-specified custom themes with real-time Gemini Flash-Lite AI word/clue & image generation
 * - Plays "Yaaay!" sound effects + minimal sparkle animation on each solved clue
 * - Plays grand victory fanfare + full-screen fireworks/confetti animation on solving the puzzle
 * - Fully optimized for mobile phones and tablets (responsive grid sizing, 1-tap clue pills, tap-to-zoom pictures)
 */

import { buildCrosswordLayout } from './crosswordLayout.js';
import { PRESET_PUZZLES } from './presets.js';
import {
  generateThemedPuzzleItems,
  generatePuzzleIllustrations,
  createFallbackStickerDataUrl,
  getDifficultyProfile,
} from './geminiGenerator.js';
import {
  soundFx,
  triggerClueSolvedAnimation,
  startGrandVictoryAnimation,
} from './soundAndFx.js';

const PRESET_ICONS = {
  'baby-animals': '🐾',
  'solar-system': '🪐',
  dinosaurs: '🦖',
  'sea-animals': '🐙',
  'school-adventure': '🎒',
  'pirate-treasure': '🏴‍☠️',
};

const state = {
  currentPuzzleMeta: null,
  layout: null,
  userGrid: [], // 2D array of entered uppercase letters
  wrongCells: new Set(), // keys "r,c"
  solvedWordIds: new Set(),
  activeWordId: null,
  focusedCell: null, // { row, col }
  revealFirstLetter: true,
  stopVictoryFn: null,
  isGenerating: false,
  generationRunId: 0,
  generatorCollapsedOnMobile: true,
};

// --- DOM Elements ---
const els = {
  soundToggleBtn: document.getElementById('btn-sound-toggle'),
  firstLetterToggleBtn: document.getElementById('btn-first-letter-toggle'),
  browseThemesBtn: document.getElementById('btn-Browse-themes'),
  generatorCard: document.getElementById('theme-generator-card'),
  toggleGeneratorBtn: document.getElementById('btn-toggle-generator'),
  generatorCollapsibleBody: document.getElementById('generator-collapsible-body'),
  themeForm: document.getElementById('theme-generator-form'),
  themeInput: document.getElementById('theme-input'),
  difficultySelect: document.getElementById('difficulty-select'),
  clueCountSelect: document.getElementById('clue-count-select'),
  clueStyleSelect: document.getElementById('clue-style-select'),
  generateBtn: document.getElementById('btn-generate-theme'),
  loadingBanner: document.getElementById('ai-loading-banner'),
  loadingTitle: document.getElementById('ai-loading-title'),
  loadingDetail: document.getElementById('ai-loading-detail'),
  quickPresetsStrip: document.getElementById('quick-presets-strip'),
  activeThemePill: document.getElementById('active-theme-pill'),
  activePuzzleTitle: document.getElementById('active-puzzle-title'),
  solvedCount: document.getElementById('solved-count'),
  totalWordCount: document.getElementById('total-word-count'),
  hintLetterBtn: document.getElementById('btn-hint-letter'),
  checkGridBtn: document.getElementById('btn-check-grid'),
  resetPuzzleBtn: document.getElementById('btn-reset-puzzle'),
  clueJumpBar: document.getElementById('clue-jump-bar'),
  spotlightNumber: document.getElementById('spotlight-number'),
  spotlightThumbWrap: document.getElementById('spotlight-thumb-wrap'),
  spotlightImg: document.getElementById('spotlight-img'),
  spotlightTypeBadge: document.getElementById('spotlight-type-badge'),
  spotlightDirBadge: document.getElementById('spotlight-dir-badge'),
  spotlightQuestion: document.getElementById('spotlight-question'),
  spotlightWordSlots: document.getElementById('spotlight-word-slots'),
  prevClueBtn: document.getElementById('btn-prev-clue'),
  nextClueBtn: document.getElementById('btn-next-clue'),
  cluesColLeft: document.getElementById('clues-col-left'),
  cluesColRight: document.getElementById('clues-col-right'),
  crosswordGridWrapper: document.getElementById('crossword-grid-wrapper'),
  crosswordGrid: document.getElementById('crossword-grid'),
  virtualKeyboard: document.getElementById('virtual-keyboard'),
  presetCardsList: document.getElementById('preset-cards-list'),
  themesGallerySection: document.getElementById('themes-gallery-section'),
  victoryOverlay: document.getElementById('victory-overlay'),
  victoryCanvas: document.getElementById('victory-canvas'),
  victorySubtitle: document.getElementById('victory-subtitle'),
  victoryWordPills: document.getElementById('victory-word-pills'),
  victoryReplayBtn: document.getElementById('btn-victory-replay'),
  victoryNewThemeBtn: document.getElementById('btn-victory-new-theme'),
  imageZoomOverlay: document.getElementById('image-zoom-overlay'),
  zoomModalImg: document.getElementById('zoom-modal-img'),
  zoomModalCaption: document.getElementById('zoom-modal-caption'),
  closeZoomBtn: document.getElementById('btn-close-zoom'),
};

function initApp() {
  renderVirtualKeyboard();
  renderQuickPresetsStrip();
  renderPresetGallery();
  syncMobileGeneratorCollapseState();
  bindEvents();

  // Load default preset ("Baby Animals Crossword")
  loadPuzzle(PRESET_PUZZLES[0]);

  // Expose helper for automated testing & quick inspection
  window.__KIDS_XW__ = {
    getState: () => state,
    loadPresetById: (id) => {
      const found = PRESET_PUZZLES.find((p) => p.id === id);
      if (found) loadPuzzle(found);
    },
    solveCurrentWord: () => {
      const wordObj = getActiveWord();
      if (wordObj) fillWordSolution(wordObj);
    },
    solveAllWords: () => {
      if (!state.layout) return;
      for (const w of state.layout.words) {
        fillWordSolution(w, false);
      }
      evaluateSolvedWords(true);
    },
  };
}

function isMobileViewport() {
  return window.innerWidth <= 768;
}

function syncMobileGeneratorCollapseState() {
  if (!els.generatorCard || !els.toggleGeneratorBtn) return;
  if (isMobileViewport() && state.generatorCollapsedOnMobile) {
    els.generatorCard.classList.add('mobile-collapsed');
    els.toggleGeneratorBtn.setAttribute('aria-expanded', 'false');
    els.toggleGeneratorBtn.textContent = '🪄 Custom AI Theme ▾';
  } else {
    els.generatorCard.classList.remove('mobile-collapsed');
    els.toggleGeneratorBtn.setAttribute('aria-expanded', 'true');
    els.toggleGeneratorBtn.textContent = isMobileViewport() ? '✕ Hide AI Builder ▴' : '🪄 Custom AI Theme';
  }
}

function toggleMobileGenerator(forceOpen) {
  if (typeof forceOpen === 'boolean') {
    state.generatorCollapsedOnMobile = !forceOpen;
  } else {
    state.generatorCollapsedOnMobile = !state.generatorCollapsedOnMobile;
  }
  syncMobileGeneratorCollapseState();
}

function setFirstLetterHintState(enabled) {
  state.revealFirstLetter = Boolean(enabled);
  if (els.firstLetterToggleBtn) {
    els.firstLetterToggleBtn.textContent = state.revealFirstLetter
      ? '🔤 First Letter: ON'
      : '🔤 First Letter: OFF';
    els.firstLetterToggleBtn.classList.toggle('active', state.revealFirstLetter);
  }
}

function openImageZoom(imgUrl, captionText) {
  if (!imgUrl || !els.imageZoomOverlay) return;
  els.zoomModalImg.src = imgUrl;
  els.zoomModalCaption.textContent = captionText || '';
  els.imageZoomOverlay.classList.remove('hidden');
}

function closeImageZoom() {
  if (!els.imageZoomOverlay) return;
  els.imageZoomOverlay.classList.add('hidden');
}

function bindEvents() {
  els.soundToggleBtn.addEventListener('click', () => {
    const muted = soundFx.toggleMute();
    els.soundToggleBtn.textContent = muted ? '🔇 Sound: OFF' : '🔊 Sound: ON';
    els.soundToggleBtn.classList.toggle('active', !muted);
  });

  els.firstLetterToggleBtn.addEventListener('click', () => {
    setFirstLetterHintState(!state.revealFirstLetter);
    if (state.currentPuzzleMeta) {
      resetCurrentPuzzle();
    }
  });

  els.browseThemesBtn.addEventListener('click', () => {
    els.themesGallerySection.scrollIntoView({ behavior: 'smooth' });
  });

  if (els.toggleGeneratorBtn) {
    els.toggleGeneratorBtn.addEventListener('click', () => {
      toggleMobileGenerator();
    });
  }

  els.themeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const customTheme = els.themeInput.value.trim();
    if (!customTheme || state.isGenerating) return;
    await handleGenerateCustomTheme(customTheme);
  });

  document.querySelectorAll('[data-quick-theme]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const theme = chip.getAttribute('data-quick-theme');
      const quickDiff = chip.getAttribute('data-quick-difficulty');
      if (!theme || state.isGenerating) return;
      els.themeInput.value = theme;
      if (quickDiff && els.difficultySelect) {
        els.difficultySelect.value = quickDiff;
      }
      await handleGenerateCustomTheme(theme);
    });
  });

  els.prevClueBtn.addEventListener('click', () => cycleActiveWord(-1));
  els.nextClueBtn.addEventListener('click', () => cycleActiveWord(1));

  els.spotlightThumbWrap.addEventListener('click', () => {
    const activeWord = getActiveWord();
    if (activeWord && activeWord.imageUrl) {
      openImageZoom(activeWord.imageUrl, `Clue #${activeWord.number}: ${activeWord.questionClue}`);
    }
  });

  if (els.closeZoomBtn && els.imageZoomOverlay) {
    els.closeZoomBtn.addEventListener('click', closeImageZoom);
    els.imageZoomOverlay.addEventListener('click', (e) => {
      if (e.target === els.imageZoomOverlay) closeImageZoom();
    });
  }

  els.hintLetterBtn.addEventListener('click', () => provideHintLetter());
  els.checkGridBtn.addEventListener('click', () => checkGridMistakes());
  els.resetPuzzleBtn.addEventListener('click', () => resetCurrentPuzzle());

  els.victoryReplayBtn.addEventListener('click', () => {
    closeVictoryOverlay();
    resetCurrentPuzzle();
  });

  els.victoryNewThemeBtn.addEventListener('click', () => {
    closeVictoryOverlay();
    toggleMobileGenerator(true);
    els.themeInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('keydown', handlePhysicalKeyDown);
  window.addEventListener('resize', () => {
    syncMobileGeneratorCollapseState();
    updateGridCellSize();
  });
}

/**
 * Loads a puzzle object ({ id, title, theme, difficultyLevel?, targetClueCount?, items })
 * and builds the connected crossword layout.
 * IMPORTANT: Renders the new board DOM BEFORE selecting/highlighting cells so that
 * switching from a larger grid to a smaller grid never indexes stale DOM coordinates!
 */
export function loadPuzzle(puzzleMeta) {
  closeVictoryOverlay();
  closeImageZoom();

  state.currentPuzzleMeta = JSON.parse(JSON.stringify(puzzleMeta));
  const targetCount = state.currentPuzzleMeta.targetClueCount || 10;
  state.layout = buildCrosswordLayout(state.currentPuzzleMeta.items, targetCount);
  state.solvedWordIds.clear();
  state.wrongCells.clear();
  state.activeWordId = null;
  state.focusedCell = null;

  // Initialize userGrid
  state.userGrid = Array.from({ length: state.layout.rows }, () =>
    Array.from({ length: state.layout.cols }, () => '')
  );

  // If revealFirstLetter is enabled, pre-populate the first letter of each word
  if (state.revealFirstLetter) {
    for (const w of state.layout.words) {
      state.userGrid[w.row][w.col] = w.word[0];
    }
  }

  const diffProfile = getDifficultyProfile(state.currentPuzzleMeta.difficultyLevel || 'elementary');
  els.activeThemePill.textContent = `Theme: ${state.currentPuzzleMeta.theme} • ${diffProfile.badge}`;
  els.activePuzzleTitle.textContent = state.currentPuzzleMeta.title;
  els.totalWordCount.textContent = String(state.layout.words.length);
  els.solvedCount.textContent = '0';

  // Render the new grid and clue cards FIRST so DOM matches state.layout
  renderBoard();

  // Then select the first word and its first empty cell
  if (state.layout.words.length > 0) {
    selectWord(state.layout.words[0].id, false);
  }

  updateActivePresetHighlight();
}

function resetCurrentPuzzle() {
  if (!state.currentPuzzleMeta) return;
  loadPuzzle(state.currentPuzzleMeta);
}

/**
 * Custom AI Theme Generation Flow
 */
async function handleGenerateCustomTheme(theme) {
  const runId = ++state.generationRunId;
  state.isGenerating = true;
  els.generateBtn.disabled = true;

  const difficulty = els.difficultySelect?.value || 'elementary';
  const diffProfile = getDifficultyProfile(difficulty);
  const clueCount = Number(els.clueCountSelect.value) || 7;
  const clueStyle = els.clueStyleSelect.value || 'mixed';

  els.loadingBanner.classList.remove('hidden');
  els.loadingTitle.textContent = `Designing "${theme}" (${diffProfile.label}) Crossword...`;
  els.loadingDetail.textContent = `Asking Gemini Flash-Lite for interconnected ${diffProfile.label.toLowerCase()} vocabulary & clues...`;

  try {
    const items = await generateThemedPuzzleItems(theme, {
      clueCount,
      clueStyle,
      difficulty,
    });
    if (runId !== state.generationRunId) return;

    // Prepare temporary spoiler-free placeholder stickers while AI images stream in
    items.forEach((item) => {
      if (item.clueType !== 'question' && !item.imageUrl) {
        item.imageUrl = createFallbackStickerDataUrl(item);
        item._needsAiImage = true;
      }
    });

    // Adjust First Letter Hint default based on difficulty level (Elementary/Middle -> ON, High/College -> OFF)
    setFirstLetterHintState(diffProfile.revealFirstLetterDefault);

    const customPuzzle = {
      id: `custom-${Date.now()}`,
      title: `${theme} Crossword`,
      theme,
      difficultyLevel: difficulty,
      targetClueCount: clueCount,
      items,
    };

    // Collapse generator on mobile so the newly created puzzle is front and center
    if (isMobileViewport()) {
      toggleMobileGenerator(false);
    }

    // Render the playable crossword immediately so the player can start right away
    loadPuzzle(customPuzzle);
    document.getElementById('puzzle-stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Now generate the AI cartoon illustrations for the placed picture clues!
    const itemsToIllustrate = state.layout.words.filter((w) => w.clueType !== 'question');
    if (itemsToIllustrate.length > 0) {
      els.loadingTitle.textContent = `Painting AI Illustrations for "${theme}"...`;
      els.loadingDetail.textContent = `Generating picture 1 of ${itemsToIllustrate.length}...`;

      await generatePuzzleIllustrations(
        itemsToIllustrate,
        theme,
        (updatedItem, dataUrl, doneCount, totalCount) => {
          if (runId !== state.generationRunId) return;
          els.loadingDetail.textContent = `Painted ${doneCount} of ${totalCount} AI illustrations...`;

          // Persist generated image into currentPuzzleMeta so Reset / First-Letter toggle preserves it
          const metaItem = state.currentPuzzleMeta?.items?.find(
            (it) => it.word.toUpperCase() === updatedItem.word.toUpperCase()
          );
          if (metaItem) {
            metaItem.imageUrl = dataUrl;
            metaItem._needsAiImage = false;
          }

          // Update image in live DOM
          const cardImg = document.querySelector(
            `[data-clue-word-id="${updatedItem.id}"] .clue-visual-box img`
          );
          if (cardImg) {
            cardImg.src = dataUrl;
          }
          const activeWord = getActiveWord();
          if (activeWord && activeWord.id === updatedItem.id) {
            updateSpotlightBanner();
          }
        }
      );
    }
  } catch (err) {
    console.error('Custom theme generation error:', err);
    alert(`Could not reach AI generator (${err.message}). Try again or pick a featured theme!`);
  } finally {
    if (runId === state.generationRunId) {
      state.isGenerating = false;
      els.generateBtn.disabled = false;
      els.loadingBanner.classList.add('hidden');
    }
  }
}

function getActiveWord() {
  if (!state.layout) return null;
  return state.layout.words.find((w) => w.id === state.activeWordId) || state.layout.words[0] || null;
}

function getWordCoordinates(wordObj) {
  const coords = [];
  const dr = wordObj.direction === 'down' ? 1 : 0;
  const dc = wordObj.direction === 'across' ? 1 : 0;
  for (let i = 0; i < wordObj.word.length; i++) {
    coords.push({
      row: wordObj.row + dr * i,
      col: wordObj.col + dc * i,
      index: i,
      solution: wordObj.word[i],
    });
  }
  return coords;
}

function selectWord(wordId, playSound = true) {
  if (!state.layout) return;
  const wordObj = state.layout.words.find((w) => w.id === wordId);
  if (!wordObj) return;

  state.activeWordId = wordObj.id;
  const coords = getWordCoordinates(wordObj);

  // Pick first empty cell in this word, or the first cell if all filled
  const firstEmpty = coords.find((c) => !state.userGrid[c.row]?.[c.col]);
  const target = firstEmpty || coords[0];
  state.focusedCell = { row: target.row, col: target.col };

  if (playSound) {
    soundFx.playSelectClue();
  }

  updateBoardHighlights();
  updateSpotlightBanner();
}

function cycleActiveWord(delta) {
  if (!state.layout || state.layout.words.length === 0) return;
  const words = state.layout.words;
  const currentIdx = words.findIndex((w) => w.id === state.activeWordId);
  const nextIdx = (currentIdx + delta + words.length) % words.length;
  selectWord(words[nextIdx].id, true);
}

/**
 * Dynamically calculates and applies the optimal --cell-size so that the entire
 * crossword grid fits comfortably inside the viewport width on mobile and desktop.
 */
function updateGridCellSize() {
  if (!state.layout || !els.crosswordGrid) return;
  const { rows, cols } = state.layout;
  const maxDim = Math.max(rows, cols);

  const wrapperWidth =
    els.crosswordGridWrapper?.clientWidth ||
    Math.min(window.innerWidth - 28, 640);

  const gap = window.innerWidth <= 600 ? 2 : 3;
  const gridPadding = 12;
  const maxAvailableCellWidth = Math.floor((wrapperWidth - gridPadding - (cols - 1) * gap) / cols);

  let desktopIdeal = maxDim > 13 ? 34 : maxDim > 11 ? 38 : maxDim > 9 ? 44 : 50;
  if (window.innerWidth <= 600) {
    desktopIdeal = maxDim > 10 ? 34 : maxDim > 8 ? 38 : 42;
  }

  const cellSize = Math.max(20, Math.min(desktopIdeal, maxAvailableCellWidth));
  els.crosswordGrid.style.setProperty('--cell-size', `${cellSize}px`);
  els.crosswordGrid.style.setProperty('--grid-gap', `${gap}px`);
  els.crosswordGrid.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;
}

/**
 * Renders the Crossword Grid, Quick Clue Jump Pills, and Left/Right Clue Columns
 */
function renderBoard() {
  if (!state.layout) return;
  const { rows, cols, cells, words } = state.layout;

  els.crosswordGrid.innerHTML = '';
  updateGridCellSize();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellData = cells[r][c];
      const cellEl = document.createElement('div');
      cellEl.dataset.row = String(r);
      cellEl.dataset.col = String(c);

      if (!cellData.active) {
        cellEl.className = 'xw-cell empty';
      } else {
        cellEl.className = 'xw-cell letter-cell';
        cellEl.setAttribute('role', 'gridcell');
        cellEl.setAttribute('aria-label', `Row ${r + 1} Column ${c + 1}`);

        if (cellData.startNumbers.length > 0) {
          const badgeWrap = document.createElement('div');
          badgeWrap.className = 'cell-num-badges';
          for (const sn of cellData.startNumbers) {
            const b = document.createElement('span');
            b.className = 'cell-num-bubble';
            b.textContent = `${sn.number}`;
            badgeWrap.appendChild(b);
          }
          cellEl.appendChild(badgeWrap);
        }

        const charSpan = document.createElement('span');
        charSpan.className = 'cell-char';
        charSpan.textContent = state.userGrid[r][c] || '';
        cellEl.appendChild(charSpan);

        cellEl.addEventListener('click', () => handleCellClick(r, c));
      }

      els.crosswordGrid.appendChild(cellEl);
    }
  }

  // Render 1-tap Clue Jump Bar (1..N)
  renderClueJumpBar(words);

  // Split clues evenly between left and right columns (like Crosswords-for-Kids picture frame)
  els.cluesColLeft.innerHTML = '';
  els.cluesColRight.innerHTML = '';
  const half = Math.ceil(words.length / 2);

  words.forEach((w, index) => {
    const card = createClueCardElement(w);
    if (index < half) {
      els.cluesColLeft.appendChild(card);
    } else {
      els.cluesColRight.appendChild(card);
    }
  });

  updateBoardHighlights();
  updateSpotlightBanner();
}

function renderClueJumpBar(words) {
  if (!els.clueJumpBar) return;
  els.clueJumpBar.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'clue-jump-label';
  label.textContent = 'Clues:';
  els.clueJumpBar.appendChild(label);

  words.forEach((w) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clue-jump-pill';
    btn.dataset.jumpWordId = w.id;
    const icon = w.clueType === 'question' ? '❓' : '🖼️';
    btn.innerHTML = `<span class="jump-num">${w.number}</span><span class="jump-icon">${icon}</span>`;
    btn.title = `Clue ${w.number}: ${w.questionClue}`;
    btn.addEventListener('click', () => {
      selectWord(w.id, true);
    });
    els.clueJumpBar.appendChild(btn);
  });
}

function createClueCardElement(wordObj) {
  const card = document.createElement('div');
  card.className = 'clue-card';
  card.dataset.clueWordId = wordObj.id;

  const isQuestionOnly = wordObj.clueType === 'question';
  const dirLabel = wordObj.direction === 'across' ? 'Across →' : 'Down ↓';

  card.innerHTML = `
    <div class="solved-check-stamp" title="Solved!">✓</div>
    <div class="clue-number-badge">${wordObj.number}</div>
    ${
      isQuestionOnly
        ? `<div class="clue-question-icon-box" aria-hidden="true">❓</div>`
        : `<div class="clue-visual-box" title="Tap to select or zoom">
             <img src="${wordObj.imageUrl || createFallbackStickerDataUrl(wordObj)}" alt="Clue ${wordObj.number} picture" loading="lazy" />
           </div>`
    }
    <div class="clue-body">
      <span class="clue-card-tag ${isQuestionOnly ? 'is-question' : ''}">
        ${isQuestionOnly ? '❓ Question Clue' : '🖼️ AI Picture Clue'} • ${dirLabel}
      </span>
      <p class="clue-text">${wordObj.questionClue}</p>
      <div class="clue-word-slots" data-slots-for="${wordObj.id}">
        ${formatWordSlotsPreview(wordObj)}
      </div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (
      state.activeWordId === wordObj.id &&
      e.target.tagName === 'IMG' &&
      wordObj.imageUrl
    ) {
      openImageZoom(wordObj.imageUrl, `Clue #${wordObj.number}: ${wordObj.questionClue}`);
      return;
    }
    selectWord(wordObj.id, true);
    if (isMobileViewport()) {
      document.getElementById('active-clue-banner')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  return card;
}

function formatWordSlotsPreview(wordObj) {
  const coords = getWordCoordinates(wordObj);
  return coords
    .map((c) => {
      const ch = state.userGrid[c.row]?.[c.col];
      return ch ? ch : '_';
    })
    .join(' ');
}

function handleCellClick(row, col) {
  if (!state.layout) return;
  const cellData = state.layout.cells[row]?.[col];
  if (!cellData || !cellData.active) return;

  // If clicking the already focused cell and it belongs to 2 words, toggle direction!
  if (
    state.focusedCell &&
    state.focusedCell.row === row &&
    state.focusedCell.col === col &&
    cellData.wordIds.length > 1
  ) {
    const otherWordId = cellData.wordIds.find((id) => id !== state.activeWordId) || cellData.wordIds[0];
    state.activeWordId = otherWordId;
  } else if (!cellData.wordIds.includes(state.activeWordId)) {
    state.activeWordId = cellData.wordIds[0];
  }

  state.focusedCell = { row, col };
  soundFx.playSelectClue();
  updateBoardHighlights();
  updateSpotlightBanner();
}

function handlePhysicalKeyDown(e) {
  if (e.key === 'Escape') {
    closeImageZoom();
    return;
  }

  // Ignore if typing inside the theme generator input
  if (
    document.activeElement &&
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
  ) {
    return;
  }
  if (!state.layout || !state.focusedCell) return;

  if (e.key === 'Tab') {
    e.preventDefault();
    cycleActiveWord(e.shiftKey ? -1 : 1);
    return;
  }

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    moveFocusByDelta(0, 1);
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    moveFocusByDelta(0, -1);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveFocusByDelta(1, 0);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveFocusByDelta(-1, 0);
    return;
  }

  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    handleBackspaceInput();
    return;
  }

  if (/^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    handleLetterInput(e.key.toUpperCase());
  }
}

function moveFocusByDelta(dr, dc) {
  if (!state.layout || !state.focusedCell) return;
  let r = state.focusedCell.row + dr;
  let c = state.focusedCell.col + dc;
  if (r >= 0 && r < state.layout.rows && c >= 0 && c < state.layout.cols) {
    const target = state.layout.cells[r]?.[c];
    if (target && target.active) {
      handleCellClick(r, c);
    }
  }
}

function handleLetterInput(letter) {
  if (!state.layout || !state.focusedCell) return;
  const { row, col } = state.focusedCell;
  if (!state.userGrid[row]) return;

  state.userGrid[row][col] = letter;
  state.wrongCells.delete(`${row},${col}`);
  soundFx.playKeyClick();

  // Advance focus to next cell in active word
  advanceCursorInActiveWord(1);

  // Check if any word was just completed!
  evaluateSolvedWords(true);
  updateBoardHighlights();
  updateSpotlightBanner();
}

function handleBackspaceInput() {
  if (!state.layout || !state.focusedCell) return;
  const { row, col } = state.focusedCell;
  if (!state.userGrid[row]) return;

  if (state.userGrid[row][col]) {
    state.userGrid[row][col] = '';
    state.wrongCells.delete(`${row},${col}`);
  } else {
    advanceCursorInActiveWord(-1);
    const prev = state.focusedCell;
    if (state.userGrid[prev.row]) {
      state.userGrid[prev.row][prev.col] = '';
      state.wrongCells.delete(`${prev.row},${prev.col}`);
    }
  }

  soundFx.playKeyClick();
  evaluateSolvedWords(false);
  updateBoardHighlights();
  updateSpotlightBanner();
}

function advanceCursorInActiveWord(step) {
  const activeWord = getActiveWord();
  if (!activeWord || !state.focusedCell) return;
  const coords = getWordCoordinates(activeWord);
  const idx = coords.findIndex(
    (c) => c.row === state.focusedCell.row && c.col === state.focusedCell.col
  );
  if (idx === -1) return;

  if (step > 0) {
    // Prefer next empty cell in this word, otherwise just step + 1
    const nextEmpty = coords.slice(idx + 1).find((c) => !state.userGrid[c.row]?.[c.col]);
    if (nextEmpty) {
      state.focusedCell = { row: nextEmpty.row, col: nextEmpty.col };
    } else if (idx + 1 < coords.length) {
      state.focusedCell = { row: coords[idx + 1].row, col: coords[idx + 1].col };
    }
  } else if (step < 0 && idx > 0) {
    state.focusedCell = { row: coords[idx - 1].row, col: coords[idx - 1].col };
  }
}

/**
 * Checks all words in the grid to see if any newly completed word is solved!
 * Triggers "Yaaay!" audio + minimal sparkle animation for newly solved clues,
 * and triggers the Grand Victory Animation when all words are solved!
 */
function evaluateSolvedWords(triggerCelebrations = true) {
  if (!state.layout) return;
  const newlySolved = [];

  for (const w of state.layout.words) {
    const coords = getWordCoordinates(w);
    const isCompleteAndCorrect = coords.every(
      (c) => state.userGrid[c.row]?.[c.col] === c.solution
    );

    if (isCompleteAndCorrect) {
      if (!state.solvedWordIds.has(w.id)) {
        state.solvedWordIds.add(w.id);
        newlySolved.push(w);
      }
    } else {
      state.solvedWordIds.delete(w.id);
    }
  }

  els.solvedCount.textContent = String(state.solvedWordIds.size);

  if (triggerCelebrations && newlySolved.length > 0) {
    for (const w of newlySolved) {
      celebrateSolvedWord(w);
    }

    // Check if the ENTIRE puzzle is now solved!
    if (state.solvedWordIds.size === state.layout.words.length) {
      setTimeout(() => {
        triggerPuzzleVictory();
      }, 550);
    } else {
      // Auto-advance to the next unsolved word for smooth gameplay
      const nextUnsolved = state.layout.words.find((w) => !state.solvedWordIds.has(w.id));
      if (nextUnsolved) {
        selectWord(nextUnsolved.id, false);
      }
    }
  }
}

function celebrateSolvedWord(wordObj) {
  // 1. Play "Yaaay!" voice + sparkle chime
  soundFx.playClueSolvedSound();

  // 2. Pop-animate each cell of the solved word
  const coords = getWordCoordinates(wordObj);
  coords.forEach((c, idx) => {
    const cellEl = els.crosswordGrid.querySelector(
      `[data-row="${c.row}"][data-col="${c.col}"]`
    );
    if (cellEl) {
      setTimeout(() => {
        cellEl.classList.remove('cell-celebrate');
        void cellEl.offsetWidth;
        cellEl.classList.add('cell-celebrate');
      }, idx * 45);
    }
  });

  // 3. Pop-animate the clue card & show floating "YAAAY! ⭐" + sparkles
  const clueCard = document.querySelector(`[data-clue-word-id="${wordObj.id}"]`);
  if (clueCard) {
    clueCard.classList.remove('just-solved-pop');
    void clueCard.offsetWidth;
    clueCard.classList.add('just-solved-pop');
  }

  const midCoord = coords[Math.floor(coords.length / 2)];
  const anchorCell =
    els.crosswordGrid.querySelector(
      `[data-row="${midCoord.row}"][data-col="${midCoord.col}"]`
    ) || clueCard;

  triggerClueSolvedAnimation(anchorCell, wordObj.word);
}

function triggerPuzzleVictory() {
  soundFx.playPuzzleVictorySound();

  els.victorySubtitle.textContent = `You solved all ${state.layout.words.length} clues in "${state.currentPuzzleMeta.title}"!`;
  els.victoryWordPills.innerHTML = state.layout.words
    .map((w) => `<span class="victory-word-pill">⭐ ${w.word}</span>`)
    .join('');

  els.victoryOverlay.classList.remove('hidden');
  if (state.stopVictoryFn) state.stopVictoryFn();
  state.stopVictoryFn = startGrandVictoryAnimation(els.victoryCanvas);
}

function closeVictoryOverlay() {
  if (state.stopVictoryFn) {
    state.stopVictoryFn();
    state.stopVictoryFn = null;
  }
  els.victoryOverlay.classList.add('hidden');
}

function fillWordSolution(wordObj, celebrate = true) {
  const coords = getWordCoordinates(wordObj);
  for (const c of coords) {
    if (state.userGrid[c.row]) {
      state.userGrid[c.row][c.col] = c.solution;
    }
    state.wrongCells.delete(`${c.row},${c.col}`);
  }
  if (celebrate) {
    evaluateSolvedWords(true);
  }
  updateBoardHighlights();
  updateSpotlightBanner();
}

function provideHintLetter() {
  if (!state.layout) return;
  let targetRow = state.focusedCell?.row;
  let targetCol = state.focusedCell?.col;

  const activeWord = getActiveWord();
  if (activeWord) {
    const coords = getWordCoordinates(activeWord);
    const needsHelp = coords.find(
      (c) => state.userGrid[c.row]?.[c.col] !== c.solution
    );
    if (needsHelp) {
      targetRow = needsHelp.row;
      targetCol = needsHelp.col;
      state.focusedCell = { row: targetRow, col: targetCol };
    }
  }

  if (targetRow == null || targetCol == null) return;
  const solution = state.layout.cells[targetRow]?.[targetCol]?.solution;
  if (solution) {
    handleLetterInput(solution);
  }
}

/**
 * "Check Grid" button from Crosswords-for-Kids.com:
 * Highlights any wrong filled letters in red with a gentle buzz
 */
function checkGridMistakes() {
  if (!state.layout) return;
  state.wrongCells.clear();
  let mistakes = 0;

  for (let r = 0; r < state.layout.rows; r++) {
    for (let c = 0; c < state.layout.cols; c++) {
      const cell = state.layout.cells[r]?.[c];
      if (!cell || !cell.active) continue;
      const entered = state.userGrid[r]?.[c];
      if (entered && entered !== cell.solution) {
        state.wrongCells.add(`${r},${c}`);
        mistakes++;
      }
    }
  }

  if (mistakes > 0) {
    soundFx.playMistakeBuzz();
  } else {
    soundFx.playSelectClue();
  }
  updateBoardHighlights();
}

function updateBoardHighlights() {
  if (!state.layout) return;
  const activeWord = getActiveWord();
  const activeCoordsSet = new Set();
  if (activeWord) {
    for (const c of getWordCoordinates(activeWord)) {
      activeCoordsSet.add(`${c.row},${c.col}`);
    }
  }

  // Update grid cells with safe bounds check
  const cellEls = els.crosswordGrid.querySelectorAll('.xw-cell.letter-cell');
  cellEls.forEach((cellEl) => {
    const r = Number(cellEl.dataset.row);
    const c = Number(cellEl.dataset.col);
    const cellData = state.layout.cells[r]?.[c];
    if (!cellData) return;

    const k = `${r},${c}`;
    const charSpan = cellEl.querySelector('.cell-char');
    if (charSpan) {
      charSpan.textContent = state.userGrid[r]?.[c] || '';
    }

    const isFocused =
      state.focusedCell && state.focusedCell.row === r && state.focusedCell.col === c;
    const isInActiveWord = activeCoordsSet.has(k);
    const belongsToSolvedWord = cellData.wordIds.some((id) => state.solvedWordIds.has(id));
    const isWrong = state.wrongCells.has(k);

    cellEl.classList.toggle('focused', Boolean(isFocused));
    cellEl.classList.toggle('in-active-word', Boolean(isInActiveWord));
    cellEl.classList.toggle('word-solved', Boolean(belongsToSolvedWord));
    cellEl.classList.toggle('cell-wrong', Boolean(isWrong));
  });

  // Update clue cards & jump pills
  state.layout.words.forEach((w) => {
    const isSelected = w.id === state.activeWordId;
    const isSolved = state.solvedWordIds.has(w.id);

    const card = document.querySelector(`[data-clue-word-id="${w.id}"]`);
    if (card) {
      card.classList.toggle('selected', isSelected);
      card.classList.toggle('solved', isSolved);
      const slotsEl = card.querySelector(`[data-slots-for="${w.id}"]`);
      if (slotsEl) {
        slotsEl.textContent = formatWordSlotsPreview(w);
      }
    }

    const jumpPill = els.clueJumpBar?.querySelector(`[data-jump-word-id="${w.id}"]`);
    if (jumpPill) {
      jumpPill.classList.toggle('selected', isSelected);
      jumpPill.classList.toggle('solved', isSolved);
      const iconEl = jumpPill.querySelector('.jump-icon');
      if (iconEl) {
        iconEl.textContent = isSolved ? '✓' : w.clueType === 'question' ? '❓' : '🖼️';
      }
    }
  });
}

function updateSpotlightBanner() {
  const activeWord = getActiveWord();
  if (!activeWord) return;

  els.spotlightNumber.textContent = String(activeWord.number);
  const isQuestion = activeWord.clueType === 'question';
  els.spotlightTypeBadge.textContent = isQuestion
    ? '❓ Question Clue'
    : '🖼️ Picture Clue';
  els.spotlightTypeBadge.classList.toggle('question-mode', isQuestion);

  els.spotlightDirBadge.textContent = `${activeWord.direction.toUpperCase()} • ${
    activeWord.word.length
  } Letters`;
  els.spotlightQuestion.textContent = activeWord.questionClue;

  if (activeWord.imageUrl && (!isQuestion || !activeWord._needsAiImage)) {
    els.spotlightThumbWrap.classList.remove('hidden');
    els.spotlightImg.src = activeWord.imageUrl;
  } else {
    els.spotlightThumbWrap.classList.add('hidden');
  }

  // Render interactive letter boxes in the spotlight banner for quick mobile glance & tap
  if (els.spotlightWordSlots) {
    const coords = getWordCoordinates(activeWord);
    els.spotlightWordSlots.innerHTML = '';
    coords.forEach((c) => {
      const box = document.createElement('button');
      box.type = 'button';
      const ch = state.userGrid[c.row]?.[c.col] || '';
      const isFocused =
        state.focusedCell &&
        state.focusedCell.row === c.row &&
        state.focusedCell.col === c.col;
      const isWrong = state.wrongCells.has(`${c.row},${c.col}`);
      box.className = `spotlight-slot-box ${ch ? 'filled' : ''} ${isFocused ? 'focused' : ''} ${
        isWrong ? 'wrong' : ''
      }`;
      box.textContent = ch || '_';
      box.addEventListener('click', () => {
        state.focusedCell = { row: c.row, col: c.col };
        updateBoardHighlights();
        updateSpotlightBanner();
      });
      els.spotlightWordSlots.appendChild(box);
    });
  }
}

function renderVirtualKeyboard() {
  const rows = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫'],
  ];

  els.virtualKeyboard.innerHTML = '';
  rows.forEach((r) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'vk-row';
    r.forEach((key) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `vk-key ${key === '⌫' ? 'vk-wide' : ''}`;
      btn.textContent = key === '⌫' ? '⌫ Erase' : key;
      btn.dataset.vkKey = key;
      btn.addEventListener('click', () => {
        if (key === '⌫') {
          handleBackspaceInput();
        } else {
          handleLetterInput(key);
        }
      });
      rowEl.appendChild(btn);
    });
    els.virtualKeyboard.appendChild(rowEl);
  });
}

function renderQuickPresetsStrip() {
  if (!els.quickPresetsStrip) return;
  els.quickPresetsStrip.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'quick-presets-label';
  label.textContent = 'Play Theme:';
  els.quickPresetsStrip.appendChild(label);

  PRESET_PUZZLES.forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-preset-pill';
    btn.dataset.quickPresetId = preset.id;
    const icon = PRESET_ICONS[preset.id] || '🧩';
    btn.textContent = `${icon} ${preset.theme}`;
    btn.addEventListener('click', () => {
      loadPuzzle(preset);
    });
    els.quickPresetsStrip.appendChild(btn);
  });
}

function updateActivePresetHighlight() {
  const currentId = state.currentPuzzleMeta?.id;
  document.querySelectorAll('[data-quick-preset-id]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.quickPresetId === currentId);
  });
  document.querySelectorAll('[data-preset-id]').forEach((card) => {
    card.classList.toggle('active-preset-card', card.dataset.presetId === currentId);
  });
}

function renderPresetGallery() {
  els.presetCardsList.innerHTML = '';
  PRESET_PUZZLES.forEach((preset) => {
    const card = document.createElement('div');
    card.className = `element ${preset.accent || 'orange'}`;
    card.dataset.presetId = preset.id;

    const previewImages = preset.items
      .filter((it) => it.imageUrl)
      .slice(0, 3)
      .map((it) => `<img src="${it.imageUrl}" alt="${it.word}" loading="lazy" />`)
      .join('');

    const stars = '⭐'.repeat(preset.difficulty || 1);

    card.innerHTML = `
      <span class="card-badge-ribbon">${preset.badge || 'PLAY'}</span>
      <div class="card-preview-strip">${previewImages}</div>
      <h5 class="card-title">${preset.title}</h5>
      <div class="card-infos">
        <span>Words to find: ${preset.items.length}</span>
        <span>Difficulty: ${stars}</span>
      </div>
    `;

    card.addEventListener('click', () => {
      loadPuzzle(preset);
      document.getElementById('puzzle-stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    els.presetCardsList.appendChild(card);
  });
}

initApp();
