/**
 * Gemini AI Generator for Crosswords
 * - Supports 5 difficulty tiers: Elementary (default), Middle School, High School, College, and Grandmaster (above College)
 * - Enforces difficulty-specific word-length priors (shorter 3-4 letter words welcomed in Beginner; longer 9-16 letter words favored in Expert/Grandmaster)
 * - Runs a two-stage Generation + Strict Spelling/Clue-Consistency Verification pass so horizontal & vertical clues never suffer from misspelled words or mismatched clues
 * - Enforces strict anti-spoiler validation so picture & question clues never leak the raw answer word string
 * - Uses the backend's hardcoded cheapest Gemini Flash-Lite models (gemini-3.5-flash-lite + gemini-3.1-flash-lite-image)
 */

import {
  sanitizeWord,
  isCleanSingleLexicalWord,
  scoreWordLengthPrior,
  WORD_LENGTH_PRIORS,
  MIN_WORD_LENGTH,
  MAX_WORD_LENGTH,
} from './crosswordLayout.js';

const PROXY_URL = '/api/gemini';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TEXT_MODEL = 'gemini-3.5-flash-lite';
const IMAGE_MODEL = 'gemini-3.1-flash-lite-image';

export const DIFFICULTY_PROFILES = {
  elementary: {
    id: 'elementary',
    label: 'Elementary',
    badge: 'Elementary',
    audience: 'Elementary school kids and beginners (ages 6–10, grades 1–5)',
    wordLengthRange: '3 to 8 letters',
    lengthPriorGuidance:
      'Favor shorter, approachable words (mean ~4.7 letters): include 2–4 crisp 3–4 letter words alongside 5–7 letter words, and avoid words longer than 8 letters.',
    vocabGuidance:
      'Use fun, familiar, concrete everyday words appropriate for elementary school children.',
    clueGuidance:
      'Write a warm, playful, kid-friendly question or riddle clue (1 full sentence, 6–16 words) that clearly and unambiguously describes the exact answer word without ever using it.',
    mixedImageRatioGuidance:
      'a mix of "image" (about 65% of items, especially concrete visualizable nouns) and "question" (about 35% of items)',
    revealFirstLetterDefault: true,
  },
  middle: {
    id: 'middle',
    label: 'Middle School',
    badge: 'Middle School',
    audience: 'Middle school students (ages 11–13, grades 6–8)',
    wordLengthRange: '4 to 10 letters',
    lengthPriorGuidance:
      'Use balanced medium-length words (mean ~6.2 letters, mostly 5–8 letters with occasional 4-letter connectors or 9–10 letter anchors).',
    vocabGuidance:
      'Use intermediate middle-school vocabulary, curriculum concepts, science/history/literature terms, and engaging domain words.',
    clueGuidance:
      'Write a clever, clear middle-school trivia or conceptual clue (1 sentence, 7–18 words) that uniquely identifies the answer word without giving it away.',
    mixedImageRatioGuidance:
      'a mix of "image" (about 55% of items) and "question" (about 45% of items)',
    revealFirstLetterDefault: true,
  },
  high: {
    id: 'high',
    label: 'High School',
    badge: 'High School',
    audience: 'High school students (ages 14–18, grades 9–12, AP / SAT level)',
    wordLengthRange: '5 to 13 letters',
    lengthPriorGuidance:
      'Favor medium-to-long academic words (mean ~7.8 letters, mostly 6–11 letters; avoid 3–4 letter filler words).',
    vocabGuidance:
      'Use challenging high-school, AP, and SAT-level vocabulary, precise terminology, and nuanced concepts related to the theme. Avoid overly basic child words.',
    clueGuidance:
      'Write an analytical, indirect high-school/AP-level clue or definition (1 concise sentence, 7–20 words) that tests deeper comprehension while uniquely pinning down the exact answer word.',
    mixedImageRatioGuidance:
      'a mix of "image" (about 45% of items) and "question" (about 55% of items)',
    revealFirstLetterDefault: false,
  },
  college: {
    id: 'college',
    label: 'College',
    badge: 'College',
    audience: 'College, graduate, and seasoned adult crossword solvers',
    wordLengthRange: '6 to 15 letters',
    lengthPriorGuidance:
      'Strong prior toward longer words (mean ~9.5 letters): the majority of words should be 8–14 letters long, with minimum 6 letters.',
    vocabGuidance:
      'Use advanced, erudite college/graduate-level vocabulary, technical domain terminology, and sophisticated lexicon. Make the vocabulary genuinely challenging.',
    clueGuidance:
      'Write a sophisticated, oblique NYT-Friday-style or scholarly clue (6–20 words) using subtle wordplay, rigorous technical precision, or indirect allusion that still resolves to a 100% unique, unmistakable answer.',
    mixedImageRatioGuidance:
      'a mix of "question" (about 65% of items) and "image" (about 35% symbolic/conceptual illustrations)',
    revealFirstLetterDefault: false,
  },
  grandmaster: {
    id: 'grandmaster',
    label: 'Grandmaster',
    badge: 'Grandmaster',
    audience: 'Championship tournament crossword solvers, PhD/postdoctoral specialists, and polymaths',
    wordLengthRange: '7 to 17 letters',
    lengthPriorGuidance:
      'Strong prior toward long polysyllabic words (mean ~11.2 letters): predominantly 9–16 letter specialist/scholarly words, minimum 7 letters, zero short filler words.',
    vocabGuidance:
      'Use extremely challenging, rare, PhD/research-grade terminology, arcane literary/philosophical/historical/scientific lexicon, and polysyllabic domain terms. Strictly forbid introductory, everyday, or textbook-101 words.',
    clueGuidance:
      'Write an ultra-challenging NYT-Saturday / Championship-tournament-caliber clue (7–22 words) featuring deep lateral framing, etymological or historical obliqueness, or multi-step conceptual synthesis — while remaining 100% factually exact so a master solver uniquely arrives at this exact word and spelling.',
    mixedImageRatioGuidance:
      'mostly "question" (about 80% of items) with at most 20% abstract/symbolic "image" clues that never visually give away a surface object',
    revealFirstLetterDefault: false,
  },
};

export function getDifficultyProfile(difficultyKey) {
  return DIFFICULTY_PROFILES[difficultyKey] || DIFFICULTY_PROFILES.elementary;
}

export function getStoredApiKey() {
  try {
    return localStorage.getItem('kids_xw_gemini_api_key') || '';
  } catch {
    return '';
  }
}

export function setStoredApiKey(key) {
  try {
    if (key) {
      localStorage.setItem('kids_xw_gemini_api_key', key.trim());
    } else {
      localStorage.removeItem('kids_xw_gemini_api_key');
    }
  } catch {
    // ignore storage errors
  }
}

async function callGemini(task, model, payload) {
  const userKey = getStoredApiKey();
  if (userKey) {
    const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(userKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res;
  }

  return fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, model, payload }),
  });
}

function extractJsonArray(rawText) {
  const cleaned = String(rawText || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
    if (parsed && Array.isArray(parsed.words)) return parsed.words;
    if (parsed && Array.isArray(parsed.clues)) return parsed.clues;
  } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end > start) {
      const sub = cleaned.slice(start, end + 1);
      const parsedSub = JSON.parse(sub);
      if (Array.isArray(parsedSub)) return parsedSub;
    }
  }
  return null;
}

function isAdvancedDifficulty(profileId) {
  return profileId === 'high' || profileId === 'college' || profileId === 'grandmaster';
}

/**
 * Strips any occurrence of the answer word (or simple plural) from a clue string
 * and guarantees that a bare word string is NEVER used as the clue text.
 */
export function sanitizeAndValidateClueText(item, word, theme, difficultyProfile) {
  const rawCandidate = String(
    item?.questionClue ||
      item?.clue ||
      item?.question ||
      item?.riddle ||
      item?.definition ||
      item?.hint ||
      ''
  )
    .replace(/^(question|clue|riddle|definition|hint)\s*[:\-–]\s*/i, '')
    .trim();

  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRegex = new RegExp(`\\b${escapedWord}(?:S|ES|'S)?\\b`, 'gi');

  let cleaned = rawCandidate.replace(wordRegex, '_____').trim();

  const meaningfulWords = cleaned
    .replace(/[^a-zA-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && w.toUpperCase() !== word);

  if (
    !cleaned ||
    cleaned.toUpperCase().replace(/[^A-Z]/g, '') === word ||
    meaningfulWords.length < 3 ||
    cleaned.length < 12
  ) {
    const promptSource = String(item?.imagePrompt || '')
      .replace(wordRegex, 'subject')
      .replace(/^(a|an|the)\s+(cute|vibrant|friendly|cartoon|illustration|picture|drawing|vector)\s+(of\s+)?/i, '')
      .trim();

    const promptWords = promptSource
      .replace(/[^a-zA-Z\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && w.toUpperCase() !== word);

    if (promptWords.length >= 4 && !promptSource.toUpperCase().includes(word)) {
      const capitalized = promptSource.charAt(0).toUpperCase() + promptSource.slice(1);
      cleaned = isAdvancedDifficulty(difficultyProfile?.id)
        ? `Identify this ${theme} term: ${capitalized.replace(/\.$/, '')}.`
        : `Which ${word.length}-letter ${theme} word matches this clue: ${capitalized.replace(/\.$/, '')}?`;
    } else {
      cleaned = isAdvancedDifficulty(difficultyProfile?.id)
        ? `Key ${word.length}-letter ${theme} term starting with "${word[0]}" and ending with "${word[word.length - 1]}".`
        : `Look closely! Which ${word.length}-letter ${theme} word starts with "${word[0]}"?`;
    }
  }

  return cleaned;
}

/**
 * Stage-2 Verification Pass:
 * Audits every candidate `{ word, questionClue }` at low temperature (0.1) to guarantee:
 * 1. `word` is a real, canonically spelled single standard American English word (fixes any typo so crossing letters are 100% accurate).
 * 2. `questionClue` uniquely, factually, and grammatically matches `word` (same singular/plural, tense, and part of speech; never confuses sister terms like MITOSIS/MEIOSIS or ENTROPY/ENTHALPY).
 */
async function verifyAndRepairPuzzleItems(candidates, theme, profile) {
  if (!Array.isArray(candidates) || candidates.length === 0) return candidates;

  const compactInput = candidates.map((c, idx) => ({
    index: idx,
    word: c.word,
    length: c.word.length,
    questionClue: c.questionClue,
  }));

  const auditPrompt = `You are a strict crossword fact-checker and copy editor auditing entries for a "${theme}" crossword (${profile.label} difficulty).

Review every candidate entry below and verify ALL FOUR rules:
1. EXACT SPELLING & SINGLE WORD: "word" MUST be a real, 100% accurately spelled standard American English single word (A-Z letters only, NOT a multi-word phrase glued together, NOT hyphenated, NOT misspelled). Pay extreme attention to vowels and double consonants in scientific/scholarly words! If misspelled, provide the exact standard American spelling in "correctedWord". If it is a multi-word phrase or nonsense token, set "keep": false.
2. UNIQUE 1-TO-1 CLUE CONSISTENCY: A knowledgeable solver reading "questionClue" and seeing the exact letter count MUST arrive uniquely at "word" — NEVER a sister term (e.g. mitosis vs meiosis, entropy vs enthalpy, stalactite vs stalagmite, fission vs fusion, abscissa vs ordinate), NEVER the scientist's surname when the word is the phenomenon (or vice versa).
3. GRAMMATICAL AGREEMENT: "questionClue" MUST match "word" in exact part of speech, tense, and singular/plural number.
4. NO SPOILERS: "verifiedClue" MUST NOT contain "word" (or its direct plural/inflection) and must be 6–22 words long.

Entries to audit:
${JSON.stringify(compactInput)}

Return a JSON array with one object per input entry:
- "index": matching input index
- "keep": boolean (false ONLY if entry is irredeemably multi-word/invalid)
- "correctedWord": exact uppercase A-Z standard American spelling of the single word
- "verifiedClue": the original clue if already 100% exact and unambiguous, or a corrected clue that uniquely and unmistakably clues "correctedWord" at ${profile.label} level without containing "correctedWord".`;

  try {
    const payload = {
      contents: [{ parts: [{ text: auditPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              index: { type: 'INTEGER' },
              keep: { type: 'BOOLEAN' },
              correctedWord: { type: 'STRING' },
              verifiedClue: { type: 'STRING' },
            },
            required: ['index', 'keep', 'correctedWord', 'verifiedClue'],
          },
        },
      },
    };

    const res = await callGemini('text', TEXT_MODEL, payload);
    if (!res.ok) return candidates;

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p) => typeof p.text === 'string' && p.text.trim()) || parts[0];
    const audits = extractJsonArray(textPart?.text);
    if (!Array.isArray(audits) || audits.length === 0) return candidates;

    const auditByIndex = new Map(audits.map((a) => [Number(a.index), a]));
    const seen = new Set();
    const repaired = [];

    candidates.forEach((orig, idx) => {
      const audit = auditByIndex.get(idx);
      if (audit && audit.keep === false) return;

      const rawWord = audit?.correctedWord ? audit.correctedWord : orig.word;
      if (!isCleanSingleLexicalWord(rawWord)) return;
      const cleanWord = sanitizeWord(rawWord);
      if (cleanWord.length < MIN_WORD_LENGTH || cleanWord.length > MAX_WORD_LENGTH || seen.has(cleanWord)) {
        return;
      }
      seen.add(cleanWord);

      const updatedClueSource = {
        ...orig,
        questionClue: audit?.verifiedClue || orig.questionClue,
      };
      const finalClue = sanitizeAndValidateClueText(updatedClueSource, cleanWord, theme, profile);

      repaired.push({
        ...orig,
        word: cleanWord,
        questionClue: finalClue,
      });
    });

    // Only accept repaired list if it retained enough candidates to form a full puzzle
    if (repaired.length >= Math.min(5, candidates.length)) {
      return repaired;
    }
  } catch (err) {
    console.warn('Stage-2 clue consistency verification skipped:', err);
  }

  return candidates;
}

/**
 * Generates a themed crossword word & clue candidate list using Gemini.
 * Requests extra candidate words (clueCount + 6) engineered to share common bridge letters
 * and follow difficulty-specific word-length priors.
 */
export async function generateThemedPuzzleItems(theme, options = {}) {
  const clueCount = Math.min(10, Math.max(5, Number(options.clueCount) || 7));
  const candidatePoolSize = clueCount + 6;
  const clueStyle = options.clueStyle || 'mixed';
  const profile = getDifficultyProfile(options.difficulty || 'elementary');
  const prior = WORD_LENGTH_PRIORS[profile.id] || WORD_LENGTH_PRIORS.elementary;

  const prompt = `Design a tightly interconnected crossword puzzle word and clue list around the theme: "${theme}".

TARGET DIFFICULTY LEVEL: ${profile.label.toUpperCase()} (${profile.audience})
- Vocabulary Level: ${profile.vocabGuidance}
- Word Length Range: ${profile.wordLengthRange} (strict bounds: ${prior.minLength}–${prior.maxLength} letters; target mean ~${prior.targetMean} letters)
- Word Length Prior: ${profile.lengthPriorGuidance}
- Clue Writing Style: ${profile.clueGuidance}

Return ${candidatePoolSize} candidate items as a JSON array (ordered with the best ${clueCount} interconnected words matching the word-length prior first, plus 6 bridgeable backup words).

CRITICAL SPELLING, CONSISTENCY & INTERCONNECTIVITY RULES:
1. SINGLE CANONICAL WORDS ONLY: Every "word" MUST be a single, unhyphenated, accurately spelled standard American English word (A-Z uppercase letters only, NO spaces, NO hyphens, NO numbers, NO multi-word phrases glued together, NO typos). Double-check every vowel and consonant in technical/scholarly words!
2. STRICT 1-TO-1 CLUE ACCURACY: Each "questionClue" MUST uniquely, factually, and grammatically match its exact "word" (matching singular/plural, tense, and part of speech). Never confuse sister concepts (e.g. mitosis vs meiosis, entropy vs enthalpy) or person vs phenomenon.
3. MUTUALLY INTERSECTING WEB: Every word MUST share at least 3 common crossword bridge letters (E, A, R, I, O, T, N, S, L, C) with at least 4 other words in your list so the grid connects cleanly.
4. RESPECT WORD LENGTH PRIORS: Follow "${profile.lengthPriorGuidance}".

CRITICAL ANTI-SPOILER & FORMAT RULES:
1. Every item (BOTH "image" and "question" clue types!) MUST have a complete, descriptive "questionClue" (6–22 words long).
2. NEVER set "questionClue" to the answer word itself, and NEVER include "word" (or its plural/inflection) anywhere inside "questionClue".
3. Every item MUST include:
   - "word": uppercase single English word (A-Z only)
   - "questionClue": a complete clue/riddle/definition (6–22 words) that uniquely clues "word" without containing "word"
   - "imagePrompt": a concrete visual or symbolic illustration description (with zero text, letters, or numbers)
   - "clueType": ${
     clueStyle === 'images'
       ? '"image" for all items'
       : clueStyle === 'questions'
       ? '"question" for all items'
       : profile.mixedImageRatioGuidance
   }`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: isAdvancedDifficulty(profile.id) ? 0.55 : 0.5,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            word: { type: 'STRING' },
            questionClue: { type: 'STRING' },
            imagePrompt: { type: 'STRING' },
            clueType: { type: 'STRING', enum: ['image', 'question'] },
          },
          required: ['word', 'questionClue', 'imagePrompt', 'clueType'],
        },
      },
    },
  };

  const res = await callGemini('text', TEXT_MODEL, payload);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI theme generation failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const textPart = parts.find((p) => typeof p.text === 'string' && p.text.trim()) || parts[0];
  const rawText = textPart?.text;
  if (!rawText) {
    throw new Error('No puzzle data returned from AI model.');
  }

  const parsed = extractJsonArray(rawText);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Invalid puzzle item list returned from AI.');
  }

  const seenWords = new Set();
  const validatedItems = [];

  parsed.forEach((item, idx) => {
    if (!isCleanSingleLexicalWord(item?.word)) return;
    const word = sanitizeWord(item.word);
    if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH || seenWords.has(word)) return;
    seenWords.add(word);

    let clueType = item.clueType;
    if (clueStyle === 'images') clueType = 'image';
    else if (clueStyle === 'questions') clueType = 'question';
    else if (clueType !== 'image' && clueType !== 'question') {
      clueType = idx % 2 === 0 ? 'image' : 'question';
    }

    const questionClue = sanitizeAndValidateClueText(item, word, theme, profile);

    validatedItems.push({
      word,
      questionClue,
      imagePrompt: item.imagePrompt || `A clear illustration representing ${theme}`,
      clueType,
      imageUrl: null,
    });
  });

  if (validatedItems.length === 0) {
    throw new Error('No valid words returned from AI model.');
  }

  // Stage 2: Audit canonical spelling and 1-to-1 clue/answer consistency
  const verifiedItems = await verifyAndRepairPuzzleItems(validatedItems, theme, profile);

  // Order candidates by difficulty word-length prior (stable tie-break) so preferred lengths anchor first
  verifiedItems.sort(
    (a, b) =>
      scoreWordLengthPrior(b.word.length, profile.id) -
      scoreWordLengthPrior(a.word.length, profile.id)
  );

  return verifiedItems;
}

/**
 * Generates an AI illustration for a single clue using Gemini image generation.
 * Returns a data URL (`data:image/png;base64,...`) or falls back to a spoiler-free SVG card if offline.
 */
export async function generateClueIllustration(item, theme = '') {
  const subject = item.imagePrompt || item.questionClue || theme;
  const prompt = `Clean, vibrant vector illustration of: ${subject} (Theme: ${theme}). Centered single subject on a clean soft white background, crisp lines, high contrast, easy to recognize. CRITICAL: NO text, NO words, NO letters, NO numbers anywhere in the image.`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  try {
    const res = await callGemini('image', IMAGE_MODEL, payload);
    if (!res.ok) {
      throw new Error(`Image HTTP ${res.status}`);
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find((p) => p.inlineData && p.inlineData.data);
    if (imgPart) {
      const mime = imgPart.inlineData.mimeType || 'image/png';
      return `data:${mime};base64,${imgPart.inlineData.data}`;
    }
    throw new Error('No inlineData in Gemini image response');
  } catch (err) {
    console.warn(`AI image fallback for clue:`, err);
    return createFallbackStickerDataUrl(item);
  }
}

/**
 * Generates AI illustrations for all items that need an image (in parallel batches of 3)
 * Calls `onProgress(item, imageUrl, doneCount, totalCount)` as each finishes.
 */
export async function generatePuzzleIllustrations(items, theme, onProgress) {
  const targets = items.filter((it) => it.clueType !== 'question' && (!it.imageUrl || it._needsAiImage));
  let completed = 0;
  const total = targets.length;
  const concurrency = 3;

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (item) => {
        const dataUrl = await generateClueIllustration(item, theme);
        item.imageUrl = dataUrl;
        item._needsAiImage = false;
        completed++;
        if (onProgress) {
          onProgress(item, dataUrl, completed, total);
        }
      })
    );
  }
  return items;
}

/**
 * Spoiler-free colorful SVG placeholder sticker (never displays the answer word!)
 */
export function createFallbackStickerDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fff8db"/>
        <stop offset="100%" stop-color="#e0f2fe"/>
      </linearGradient>
    </defs>
    <rect width="240" height="240" rx="28" fill="url(#bg)" stroke="#29b1e9" stroke-width="6"/>
    <circle cx="120" cy="96" r="46" fill="#29b1e9" opacity="0.16"/>
    <text x="120" y="114" text-anchor="middle" font-size="56">🎨</text>
    <text x="120" y="176" text-anchor="middle" font-family="Verdana,sans-serif" font-size="15" font-weight="bold" fill="#0369a1">
      Picture Clue
    </text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
