import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrosswordLayout, sanitizeWord } from '../src/crosswordLayout.js';
import { PRESET_PUZZLES } from '../src/presets.js';
import { sanitizeAndValidateClueText, getDifficultyProfile } from '../src/geminiGenerator.js';

function isLayoutFullyConnected(layout) {
  if (layout.words.length <= 1) return true;
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
  const queue = [layout.words[0].id];
  while (queue.length > 0) {
    const curr = queue.shift();
    for (const next of adj.get(curr) || []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited.size === layout.words.length;
}

test('sanitizeWord cleans uppercase A-Z letters', () => {
  assert.equal(sanitizeWord('t-rex 123!'), 'TREX');
  assert.equal(sanitizeWord('  puppy '), 'PUPPY');
});

test('buildCrosswordLayout places 5-10 clues without conflicts and 100% connected for all presets', () => {
  for (const preset of PRESET_PUZZLES) {
    const layout = buildCrosswordLayout(preset.items, 10);
    assert.ok(layout.words.length >= 5 && layout.words.length <= 10, `Preset ${preset.id} has ${layout.words.length} words`);
    assert.equal(layout.words.length, preset.items.length, `All words placed for ${preset.id}`);
    assert.equal(isLayoutFullyConnected(layout), true, `Preset ${preset.id} must have zero disconnected words`);

    // Verify every word matches cells in the 2D grid
    for (const w of layout.words) {
      const dr = w.direction === 'down' ? 1 : 0;
      const dc = w.direction === 'across' ? 1 : 0;
      for (let i = 0; i < w.word.length; i++) {
        const r = w.row + dr * i;
        const c = w.col + dc * i;
        const cell = layout.cells[r][c];
        assert.equal(cell.active, true);
        assert.equal(cell.solution, w.word[i]);
        assert.ok(cell.wordIds.includes(w.id));
      }
    }
  }
});

test('sanitizeAndValidateClueText prevents bare word strings or answer leaks in picture clues', () => {
  const elem = getDifficultyProfile('elementary');
  const college = getDifficultyProfile('college');

  // Case 1: Model accidentally returns just the word string as questionClue for an image clue
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

  // Case 2: Model embeds the answer word inside a sentence
  const clue2 = sanitizeAndValidateClueText(
    {
      word: 'ENTROPY',
      questionClue: 'Thermodynamic quantity known as entropy that measures disorder in a closed system.',
      imagePrompt: 'particles dispersing in a chamber',
      clueType: 'question',
    },
    'ENTROPY',
    'Thermodynamics',
    college
  );
  assert.ok(!clue2.toUpperCase().includes('ENTROPY'), `Clue leaked word: ${clue2}`);
  assert.ok(clue2.includes('_____'));
});
