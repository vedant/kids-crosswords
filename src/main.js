/**
 * Main Application Controller for Crosswords
 * - Renders 100% connected, invariant-verified crossword grids (5-10 clues)
 * - Supports 5 difficulty levels: Elementary (default), Middle School, High School, College, and Grandmaster
 * - Applies difficulty-aware word length priors (shorter beginner words vs. longer expert/grandmaster words)
 * - Clean, decluttered interface on both desktop and mobile viewports
 */

import { buildCrosswordLayout, assertValidCrosswordLayout } from './crosswordLayout.js';
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
  userGrid: [], // 2D array of entered uppercase letters (single source of truth per (r,c))
  prefilledCells: new Set(), // keys "r,c" pre-populated by First-Letter helper or Hint
  wrongCells: new Set(), // keys "r,c"
  solvedWordIds: new Set(),
  activeWordId: null,
  focusedCell: null, // { row, col }
  revealFirstLetter: true,
  showDesktopKeyboard: false,
  stopVictoryFn: null,
  isGenerating: false,
  generationRunId: 0,
  generatorCollapsedOnMobile: true,
};

// --- DOM Elements ---
const els = {
  soundToggleBtn: document.getElementById('btn-sound-toggle'),
  firstLetterToggleBtn: document.getElementById('btn-first-letter-toggle'),
  keyboardToggleBtn: document.getElementById('btn-keyboard-toggle'),
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
  spotlightDirBadge: document.getElementById('spotlight-dir-badge'),
  spotlightQuestion: document.getElementById('spotlight-question'),
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
  syncDesktopKeyboardVisibility();
  bindEvents();

  // Load default preset ("Baby Animals Crossword")
  loadPuzzle(PRESET_PUZZLES[0]);

  // Expose helper for automated testing & inspection
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
    els.toggleGeneratorBtn.textContent = 'Create Theme ▾';
  } else {
    els.generatorCard.classList.remove('mobile-collapsed');
    els.toggleGeneratorBtn.setAttribute('aria-expanded', 'true');
    els.toggleGeneratorBtn.textContent = isMobileViewport() ? 'Hide ▴' : 'Create Theme';
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

function syncDesktopKeyboardVisibility() {
  if (!els.virtualKeyboard) return;
  els.virtualKeyboard.classList.toggle('desktop-hidden', !state.showDesktopKeyboard);
  if (els.keyboardToggleBtn) {
    els.keyboardToggleBtn.classList.toggle('active', state.showDesktopKeyboard);
  }
}

function setFirstLetterHintState(enabled) {
  state.revealFirstLetter = Boolean(enabled);
  if (els.firstLetterToggleBtn) {
    els.firstLetterToggleBtn.textContent = state.revealFirstLetter
      ? 'First Letter: ON'
      : 'First Letter: OFF';
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
    els.soundToggleBtn.textContent = muted ? 'Sound: OFF' : 'Sound: ON';
    els.soundToggleBtn.classList.toggle('active', !muted);
  });

  els.firstLetterToggleBtn.addEventListener('click', () => {
    setFirstLetterHintState(!state.revealFirstLetter);
    if (state.currentPuzzleMeta) {
      resetCurrentPuzzle();
    }
  });

  if (els.keyboardToggleBtn) {
    els.keyboardToggleBtn.addEventListener('click', () => {
      state.showDesktopKeyboard = !state.showDesktopKeyboard;
      syncDesktopKeyboardVisibility();
    });
  }

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
 * Loads a puzzle object ({ id, title, theme, difficultyLevel?, targetClueCount?, items }),
 * builds the difficulty-prioritized connected crossword layout, and verifies all crossing invariants.
 */
export function loadPuzzle(puzzleMeta) {
  closeVictoryOverlay();
  closeImageZoom();

  state.currentPuzzleMeta = JSON.parse(JSON.stringify(puzzleMeta));
  const targetCount = state.currentPuzzleMeta.targetClueCount || 10;
  const difficulty = state.currentPuzzleMeta.difficultyLevel || 'elementary';

  state.layout = buildCrosswordLayout(state.currentPuzzleMeta.items, targetCount, { difficulty });
  assertValidCrosswordLayout(state.layout);

  state.solvedWordIds.clear();
  state.wrongCells.clear();
  state.prefilledCells.clear();
  state.activeWordId = null;
  state.focusedCell = null;

  // Initialize userGrid from canonical layout dimensions
  state.userGrid = Array.from({ length: state.layout.rows }, () =>
    Array.from({ length: state.layout.cols }, () => '')
  );

  // Pre-populate first letters strictly from canonical cell.solution so crossings can never diverge
  if (state.revealFirstLetter) {
    for (const w of state.layout.words) {
      const canonicalChar = state.layout.cells[w.row][w.col].solution;
      state.userGrid[w.row][w.col] = canonicalChar;
      state.prefilledCells.add(`${w.row},${w.col}`);
    }
  }

  const diffProfile = getDifficultyProfile(difficulty);
  els.activeThemePill.textContent = `${state.currentPuzzleMeta.theme} · ${diffProfile.badge}`;
  els.activePuzzleTitle.textContent = state.currentPuzzleMeta.title;
  els.totalWordCount.textContent = String(state.layout.words.length);
  els.solvedCount.textContent = '0';

  renderBoard();

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
  els.loadingTitle.textContent = `Building "${theme}" (${diffProfile.label})...`;
  els.loadingDetail.textContent = `Generating & verifying ${diffProfile.label.toLowerCase()} vocabulary, clues, and intersections...`;

  try {
    const items = await generateThemedPuzzleItems(theme, {
      clueCount,
      clueStyle,
      difficulty,
    });
    if (runId !== state.generationRunId) return;

    items.forEach((item) => {
      if (item.clueType !== 'question' && !item.imageUrl) {
        item.imageUrl = createFallbackStickerDataUrl(item);
        item._needsAiImage = true;
      }
    });

    setFirstLetterHintState(diffProfile.revealFirstLetterDefault);

    const customPuzzle = {
      id: `custom-${Date.now()}`,
      title: `${theme} Crossword`,
      theme,
      difficultyLevel: difficulty,
      targetClueCount: clueCount,
      items,
    };

    if (isMobileViewport()) {
      toggleMobileGenerator(false);
    }

    loadPuzzle(customPuzzle);
    document.getElementById('puzzle-stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const itemsToIllustrate = state.layout.words.filter((w) => w.clueType !== 'question');
    if (itemsToIllustrate.length > 0) {
      els.loadingTitle.textContent = `Illustrating "${theme}"...`;
      els.loadingDetail.textContent = `Painting picture 1 of ${itemsToIllustrate.length}...`;

      await generatePuzzleIllustrations(
        itemsToIllustrate,
        theme,
        (updatedItem, dataUrl, doneCount, totalCount) => {
          if (runId !== state.generationRunId) return;
          els.loadingDetail.textContent = `Painted ${doneCount} of ${totalCount} illustrations...`;

          const metaItem = state.currentPuzzleMeta?.items?.find(
            (it) => it.word.toUpperCase() === updatedItem.word.toUpperCase()
          );
          if (metaItem) {
            metaItem.imageUrl = dataUrl;
            metaItem._needsAiImage = false;
          }

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
    const row = wordObj.row + dr * i;
    const col = wordObj.col + dc * i;
    const canonicalSolution = state.layout?.cells?.[row]?.[col]?.solution || wordObj.word[i];
    coords.push({
      row,
      col,
      index: i,
      solution: canonicalSolution,
    });
  }
  return coords;
}

/**
 * Returns true if `(row, col)` already holds a verified/confirmed letter
 * (either part of an already-solved crossing word or a pre-filled hint letter),
 * so cursor navigation skips confirmed crossings while still stepping onto
 * unverified/wrong guesses that the solver may need to overwrite.
 */
function isCellConfirmedCorrect(row, col) {
  const current = state.userGrid[row]?.[col];
  if (!current) return false;
  const cell = state.layout?.cells?.[row]?.[col];
  if (!cell || current !== cell.solution) return false;
  if (state.prefilledCells.has(`${row},${col}`)) return true;
  return cell.wordIds.some((id) => state.solvedWordIds.has(id));
}

function selectWord(wordId, playSound = true) {
  if (!state.layout) return;
  const wordObj = state.layout.words.find((w) => w.id === wordId);
  if (!wordObj) return;

  state.activeWordId = wordObj.id;
  const coords = getWordCoordinates(wordObj);

  const firstUnconfirmed = coords.find((c) => !isCellConfirmedCorrect(c.row, c.col));
  const target = firstUnconfirmed || coords[0];
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

function updateGridCellSize() {
  if (!state.layout || !els.crosswordGrid) return;
  const { rows, cols } = state.layout;
  const maxDim = Math.max(rows, cols);

  const wrapperWidth =
    els.crosswordGridWrapper?.clientWidth ||
    Math.min(window.innerWidth - 28, 680);

  const gap = window.innerWidth <= 600 ? 2 : 3;
  const gridPadding = 12;
  const maxAvailableCellWidth = Math.floor((wrapperWidth - gridPadding - (cols - 1) * gap) / cols);

  let desktopIdeal =
    maxDim > 18 ? 28 : maxDim > 15 ? 32 : maxDim > 12 ? 36 : maxDim > 9 ? 42 : 48;
  if (window.innerWidth <= 600) {
    desktopIdeal = maxDim > 12 ? 28 : maxDim > 9 ? 34 : 40;
  }

  const cellSize = Math.max(20, Math.min(desktopIdeal, maxAvailableCellWidth));
  els.crosswordGrid.style.setProperty('--cell-size', `${cellSize}px`);
  els.crosswordGrid.style.setProperty('--grid-gap', `${gap}px`);
  els.crosswordGrid.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;
}

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
        const hasStartNum = cellData.startNumbers.length > 0;
        cellEl.className = `xw-cell letter-cell${hasStartNum ? ' has-start-num' : ''}`;
        cellEl.setAttribute('role', 'gridcell');
        cellEl.setAttribute('aria-label', `Row ${r + 1} Column ${c + 1}`);

        if (hasStartNum) {
          const numSpan = document.createElement('span');
          numSpan.className = 'cell-corner-num';
          numSpan.textContent = cellData.startNumbers.map((sn) => sn.number).join('/');
          cellEl.appendChild(numSpan);
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

  renderClueJumpBar(words);

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

  words.forEach((w) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clue-jump-pill';
    btn.dataset.jumpWordId = w.id;
    btn.innerHTML = `<span class="jump-num">${w.number}</span>`;
    btn.title = `Clue ${w.number} (${w.direction}): ${w.questionClue}`;
    btn.addEventListener('click', () => {
      selectWord(w.id, true);
    });
    els.clueJumpBar.appendChild(btn);
  });
}

function createClueCardElement(wordObj) {
  const card = document.createElement('div');
  const isQuestionOnly = wordObj.clueType === 'question';
  card.className = `clue-card${isQuestionOnly ? ' text-only-clue' : ''}`;
  card.dataset.clueWordId = wordObj.id;

  const dirLabel = wordObj.direction === 'across' ? 'Across' : 'Down';

  card.innerHTML = `
    <div class="clue-number-badge">${wordObj.number}</div>
    ${
      isQuestionOnly
        ? ''
        : `<div class="clue-visual-box" title="Tap to select or enlarge">
             <img src="${wordObj.imageUrl || createFallbackStickerDataUrl(wordObj)}" alt="Clue ${wordObj.number} illustration" loading="lazy" />
           </div>`
    }
    <div class="clue-body">
      <span class="clue-card-tag">${dirLabel} · ${wordObj.word.length}</span>
      <p class="clue-text">${wordObj.questionClue}</p>
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

function handleCellClick(row, col) {
  if (!state.layout) return;
  const cellData = state.layout.cells[row]?.[col];
  if (!cellData || !cellData.active) return;

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
  const r = state.focusedCell.row + dr;
  const c = state.focusedCell.col + dc;
  if (r >= 0 && r < state.layout.rows && c >= 0 && c < state.layout.cols) {
    const target = state.layout.cells[r]?.[c];
    if (target && target.active) {
      handleCellClick(r, c);
    }
  }
}

function handleLetterInput(letter, isHint = false) {
  if (!state.layout || !state.focusedCell) return;
  const { row, col } = state.focusedCell;
  if (!state.userGrid[row]) return;

  state.userGrid[row][col] = letter;
  if (isHint) {
    state.prefilledCells.add(`${row},${col}`);
  }
  state.wrongCells.delete(`${row},${col}`);
  soundFx.playKeyClick();

  advanceCursorInActiveWord(1);

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
    state.prefilledCells.delete(`${row},${col}`);
    state.wrongCells.delete(`${row},${col}`);
  } else {
    advanceCursorInActiveWord(-1);
    const prev = state.focusedCell;
    if (state.userGrid[prev.row]) {
      state.userGrid[prev.row][prev.col] = '';
      state.prefilledCells.delete(`${prev.row},${prev.col}`);
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
    // Advance past confirmed/solved crossing squares, but DO step onto empty OR unverified tentative squares
    const nextTarget = coords
      .slice(idx + 1)
      .find((c) => !state.userGrid[c.row]?.[c.col] || !isCellConfirmedCorrect(c.row, c.col));
    if (nextTarget) {
      state.focusedCell = { row: nextTarget.row, col: nextTarget.col };
    } else if (idx + 1 < coords.length) {
      state.focusedCell = { row: coords[idx + 1].row, col: coords[idx + 1].col };
    }
  } else if (step < 0 && idx > 0) {
    state.focusedCell = { row: coords[idx - 1].row, col: coords[idx - 1].col };
  }
}

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

    if (state.solvedWordIds.size === state.layout.words.length) {
      setTimeout(() => {
        triggerPuzzleVictory();
      }, 550);
    } else {
      const nextUnsolved = state.layout.words.find((w) => !state.solvedWordIds.has(w.id));
      if (nextUnsolved) {
        selectWord(nextUnsolved.id, false);
      }
    }
  }
}

function celebrateSolvedWord(wordObj) {
  soundFx.playClueSolvedSound();

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
    .map((w) => `<span class="victory-word-pill">${w.word}</span>`)
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
      state.prefilledCells.add(`${c.row},${c.col}`);
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
    handleLetterInput(solution, true);
  }
}

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

  state.layout.words.forEach((w) => {
    const isSelected = w.id === state.activeWordId;
    const isSolved = state.solvedWordIds.has(w.id);

    const card = document.querySelector(`[data-clue-word-id="${w.id}"]`);
    if (card) {
      card.classList.toggle('selected', isSelected);
      card.classList.toggle('solved', isSolved);
    }

    const jumpPill = els.clueJumpBar?.querySelector(`[data-jump-word-id="${w.id}"]`);
    if (jumpPill) {
      jumpPill.classList.toggle('selected', isSelected);
      jumpPill.classList.toggle('solved', isSolved);
      const numEl = jumpPill.querySelector('.jump-num');
      if (numEl) {
        numEl.textContent = isSolved ? `${w.number} ✓` : `${w.number}`;
      }
    }
  });
}

function updateSpotlightBanner() {
  const activeWord = getActiveWord();
  if (!activeWord) return;

  els.spotlightNumber.textContent = String(activeWord.number);
  const isQuestion = activeWord.clueType === 'question';

  els.spotlightDirBadge.textContent = `${activeWord.direction.toUpperCase()} · ${
    activeWord.word.length
  } LETTERS`;
  els.spotlightQuestion.textContent = activeWord.questionClue;

  if (activeWord.imageUrl && !isQuestion) {
    els.spotlightThumbWrap.classList.remove('hidden');
    els.spotlightImg.src = activeWord.imageUrl;
  } else {
    els.spotlightThumbWrap.classList.add('hidden');
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
      btn.textContent = key === '⌫' ? '⌫' : key;
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

  PRESET_PUZZLES.forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-preset-pill';
    btn.dataset.quickPresetId = preset.id;
    btn.textContent = preset.theme;
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
      .map((it) => `<img src="${it.imageUrl}" alt="${preset.theme} clue preview" loading="lazy" />`)
      .join('');

    card.innerHTML = `
      <div class="card-preview-strip">${previewImages}</div>
      <div class="card-footer-meta">
        <h5 class="card-title">${preset.title}</h5>
        <span class="card-clue-count">${preset.items.length} clues</span>
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
