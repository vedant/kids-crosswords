import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrosswordLayout, sanitizeWord } from '../src/crosswordLayout.js';
import { PRESET_PUZZLES } from '../src/presets.js';

test('sanitizeWord cleans uppercase A-Z letters', () => {
  assert.equal(sanitizeWord('t-rex 123!'), 'TREX');
  assert.equal(sanitizeWord('  puppy '), 'PUPPY');
});

test('buildCrosswordLayout places 5-10 clues without conflicts for all presets', () => {
  for (const preset of PRESET_PUZZLES) {
    const layout = buildCrosswordLayout(preset.items, 10);
    assert.ok(layout.words.length >= 5 && layout.words.length <= 10, `Preset ${preset.id} has ${layout.words.length} words`);
    assert.equal(layout.words.length, preset.items.length, `All words placed for ${preset.id}`);

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
