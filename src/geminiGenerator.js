/**
 * Gemini AI Generator for Crosswords
 * - Supports 4 difficulty tiers: Elementary (default), Middle School, High School, and College
 * - Prompts for mutually-intersecting crossword word webs (with extra candidate buffer so grids are 100% connected)
 * - Enforces strict validation so picture & question clues never leak or repeat the raw answer word string
 * - Uses the backend's hardcoded cheapest Gemini Flash-Lite models (gemini-3.5-flash-lite + gemini-3.1-flash-lite-image)
 */

const PROXY_URL = '/api/gemini';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TEXT_MODEL = 'gemini-3.5-flash-lite';
const IMAGE_MODEL = 'gemini-3.1-flash-lite-image';

export const DIFFICULTY_PROFILES = {
  elementary: {
    id: 'elementary',
    label: 'Elementary',
    badge: '🌱 Elementary',
    audience: 'Elementary school kids (ages 6–10, grades 1–5)',
    wordLengthRange: '3 to 8 letters',
    vocabGuidance:
      'Use fun, familiar, concrete everyday words appropriate for elementary school children.',
    clueGuidance:
      'Write a warm, playful, kid-friendly question or riddle clue (1 full sentence, 6–16 words) that clearly describes the concept without ever using the answer word.',
    revealFirstLetterDefault: true,
  },
  middle: {
    id: 'middle',
    label: 'Middle School',
    badge: '📘 Middle School',
    audience: 'Middle school students (ages 11–13, grades 6–8)',
    wordLengthRange: '4 to 10 letters',
    vocabGuidance:
      'Use intermediate middle-school vocabulary, curriculum concepts, science/history/literature terms, and engaging domain words.',
    clueGuidance:
      'Write a clever, thought-provoking middle-school trivia or conceptual clue (1 sentence, 7–18 words) that requires middle-school subject knowledge without giving away the answer word.',
    revealFirstLetterDefault: true,
  },
  high: {
    id: 'high',
    label: 'High School',
    badge: '🎓 High School',
    audience: 'High school students (ages 14–18, grades 9–12, AP / SAT level)',
    wordLengthRange: '5 to 12 letters',
    vocabGuidance:
      'Use challenging high-school, AP, and SAT-level vocabulary, precise terminology, and nuanced concepts related to the theme. Avoid overly basic child words.',
    clueGuidance:
      'Write an analytical, indirect, high-school/AP-level clue or definition (1 concise sentence, 7–20 words) that tests deeper comprehension and avoids obvious surface synonyms.',
    revealFirstLetterDefault: false,
  },
  college: {
    id: 'college',
    label: 'College',
    badge: '🏛️ College / Expert',
    audience: 'College, graduate, and expert adult crossword solvers',
    wordLengthRange: '5 to 14 letters',
    vocabGuidance:
      'Use advanced, erudite, college/graduate-level vocabulary, technical domain terminology, and sophisticated lexicon. Make the vocabulary genuinely challenging!',
    clueGuidance:
      'Write a sophisticated, oblique, NYT-late-week-style or scholarly crossword clue (6–20 words) using subtle wordplay, rigorous technical precision, or indirect allusion so the solver must think deeply.',
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
    const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=***}`, {
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
  // Match the answer word or its simple plural/possessive (case-insensitive)
  const wordRegex = new RegExp(`\\b${escapedWord}(?:S|ES|'S)?\\b`, 'gi');

  let cleaned = rawCandidate.replace(wordRegex, '_____').trim();

  // Count how many actual non-blank words remain
  const meaningfulWords = cleaned
    .replace(/[^a-zA-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && w.toUpperCase() !== word);

  // If the model put only the word itself (e.g. "BULLDOZER") or a tiny 1-2 word label,
  // try salvaging a spoiler-free description from imagePrompt, or construct a proper clue
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
      cleaned =
        difficultyProfile?.id === 'college' || difficultyProfile?.id === 'high'
          ? `Identify this ${theme} term: ${capitalized.replace(/\.$/, '')}.`
          : `Which ${word.length}-letter ${theme} word matches this clue: ${capitalized.replace(/\.$/, '')}?`;
    } else {
      cleaned =
        difficultyProfile?.id === 'college' || difficultyProfile?.id === 'high'
          ? `Key ${word.length}-letter ${theme} term starting with "${word[0]}" and ending with "${word[word.length - 1]}".`
          : `Look closely! Which ${word.length}-letter ${theme} word starts with "${word[0]}"?`;
    }
  }

  return cleaned;
}

/**
 * Generates a themed crossword word & clue candidate list using Gemini.
 * Requests extra candidate words (clueCount + 5) engineered to share common bridge letters
 * so `buildCrosswordLayout(items, clueCount)` always forms a 100% connected grid!
 */
export async function generateThemedPuzzleItems(theme, options = {}) {
  const clueCount = Math.min(10, Math.max(5, Number(options.clueCount) || 7));
  const candidatePoolSize = clueCount + 5; // Extra candidates ensure 100% grid connectivity
  const clueStyle = options.clueStyle || 'mixed'; // 'mixed' | 'images' | 'questions'
  const profile = getDifficultyProfile(options.difficulty || 'elementary');

  const prompt = `Design a tightly interconnected crossword puzzle word and clue list around the theme: "${theme}".

TARGET DIFFICULTY LEVEL: ${profile.label.toUpperCase()} (${profile.audience})
- Vocabulary Level: ${profile.vocabGuidance}
- Word Length Range: ${profile.wordLengthRange}
- Clue Writing Style: ${profile.clueGuidance}

Return ${candidatePoolSize} candidate items as a JSON array (ordered with the best ${clueCount} interconnected words first, plus 5 backup words that bridge with them).

CRITICAL CROSSWORD INTERCONNECTIVITY RULES (TO PREVENT DISCONNECTED WORDS):
1. Single English words only (A-Z uppercase letters only, no spaces, no hyphens, no numbers).
2. Design the words as a MUTUALLY INTERSECTING WEB: every word MUST share at least 3 common crossword bridge letters (especially E, A, R, I, O, T, N, S, L, C) with at least 4 other words in your list.
3. NEVER include isolated words made mostly of rare consonants (J, Q, X, Z, K, V, W) that fail to cross other words.
4. Vary word lengths across the range (${profile.wordLengthRange}) so long anchor words can cross multiple medium/short words cleanly.

CRITICAL CLUE QUALITY & ANTI-SPOILER RULES:
1. Every item (BOTH "image" and "question" clue types!) MUST have a complete, descriptive "questionClue" (at least 6 words long).
2. NEVER set "questionClue" to the answer word itself! For example, if "word" is "BULLDOZER", "questionClue" must NEVER be "Bulldozer" or "BULLDOZER".
3. NEVER include the answer "word" (or its plural/root) anywhere inside "questionClue"! Even when "clueType" is "image", "questionClue" is displayed right next to the picture and MUST be a genuine riddle, question, or definition that does not name the answer word.
4. Every item MUST include:
   - "word": uppercase word (A-Z only)
   - "questionClue": a complete sentence clue/riddle/definition (6–20 words) that NEVER contains "word"
   - "imagePrompt": a concrete visual scene or symbolic illustration description of the concept (without any text or letters)
   - "clueType": ${
     clueStyle === 'images'
       ? '"image" for all items'
       : clueStyle === 'questions'
       ? '"question" for all items'
       : 'a mix of "image" (about 60% of items, especially visualizable nouns/concepts) and "question" (about 40% of items)'
   }`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: profile.id === 'college' || profile.id === 'high' ? 0.65 : 0.6,
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
    const word = String(item.word || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '');
    if (word.length < 2 || word.length > 15 || seenWords.has(word)) return;
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

  return validatedItems;
}

/**
 * Generates an AI illustration for a single clue using Gemini image generation.
 * Returns a data URL (`data:image/png;base64,...`) or falls back to a spoiler-free SVG card if offline.
 */
export async function generateClueIllustration(item, theme = '') {
  const subject = item.imagePrompt || item.questionClue || theme;
  const prompt = `Cute, vibrant, friendly vector illustration of: ${subject} (Theme: ${theme}). Centered single subject on a clean soft white background, bold outlines, joyful colors, high contrast, easy to recognize immediately. CRITICAL: NO text, NO words, NO letters, NO numbers anywhere in the image.`;

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
