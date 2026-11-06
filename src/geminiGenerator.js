/**
 * Gemini AI Generator for Kids Crosswords
 * - Generates 5-10 themed crossword words + question clues + image prompts
 * - Uses the backend's hardcoded cheapest Gemini Flash-Lite model (gemini-3.5-flash-lite)
 * - Generates AI cartoon illustrations for image clues using Gemini Flash-Lite Image model (gemini-3.1-flash-lite-image)
 */

const PROXY_URL = '/api/gemini';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TEXT_MODEL = 'gemini-3.5-flash-lite';
const IMAGE_MODEL = 'gemini-3.1-flash-lite-image';

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
    const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${userKey}`, {
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
    // Try extracting the first [...] block
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
 * Generates a themed crossword word & clue list (5-10 clues) using Gemini.
 */
export async function generateThemedPuzzleItems(theme, options = {}) {
  const clueCount = Math.min(10, Math.max(5, Number(options.clueCount) || 7));
  const clueStyle = options.clueStyle || 'mixed'; // 'mixed' | 'images' | 'questions'
  const ageGroup = options.ageGroup || 'ages 5-9';

  const prompt = `Create a fun, educational crossword puzzle word list for kids (${ageGroup}) around the theme: "${theme}".

Return EXACTLY ${clueCount} items as a JSON array.
Rules for words:
1. Single English words only (A-Z letters only, no spaces, no hyphens, no punctuation).
2. Length between 3 and 9 letters.
3. Choose words that share common vowels (A, E, I, O, U) and consonants (R, S, T, L, N) so they intersect well in a crossword grid!
4. Every item MUST include:
   - "word": uppercase word (e.g. "PUPPY")
   - "questionClue": a playful, kid-friendly question or riddle clue (1 short sentence, e.g., "What do we call a playful baby dog that wags its tail?")
   - "imagePrompt": a concrete visual description of the object/character for a children's picture book illustrator (without mentioning any text or letters)
   - "clueType": ${
     clueStyle === 'images'
       ? '"image" for all items'
       : clueStyle === 'questions'
       ? '"question" for all items'
       : 'a mix of "image" (about 60% of items, especially concrete visual nouns) and "question" (about 40% of items)'
   }

Output JSON schema:
[
  {
    "word": "STRING",
    "questionClue": "STRING",
    "imagePrompt": "STRING",
    "clueType": "image" | "question"
  }
]`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json',
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

  return parsed
    .map((item, idx) => {
      const word = String(item.word || '')
        .toUpperCase()
        .replace(/[^A-Z]/g, '');
      let clueType = item.clueType;
      if (clueStyle === 'images') clueType = 'image';
      else if (clueStyle === 'questions') clueType = 'question';
      else if (clueType !== 'image' && clueType !== 'question') {
        clueType = idx % 2 === 0 ? 'image' : 'question';
      }
      return {
        word,
        questionClue: item.questionClue || `Can you spell this ${theme} word?`,
        imagePrompt: item.imagePrompt || `A cute children's illustration of ${word.toLowerCase()}`,
        clueType,
        imageUrl: null,
      };
    })
    .filter((item) => item.word.length >= 2)
    .slice(0, clueCount);
}

/**
 * Generates an AI illustration for a single clue using Gemini image generation.
 * Returns a data URL (`data:image/png;base64,...`) or falls back to a colorful SVG card if offline.
 */
export async function generateClueIllustration(item, theme = '') {
  const subject = item.imagePrompt || item.word;
  const prompt = `Cute, vibrant, friendly children's picture book vector illustration of: ${subject} (Theme: ${theme}). Centered single subject on a clean soft white background, bold outlines, joyful colors, high contrast, easy for a child to recognize immediately. CRITICAL: NO text, NO words, NO letters, NO numbers anywhere in the image.`;

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
    console.warn(`AI image fallback for ${item.word}:`, err);
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
 * Colorful SVG fallback sticker if offline or loading
 */
export function createFallbackStickerDataUrl(item) {
  const text = (item.questionClue || item.word || '?').replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fff8db"/>
        <stop offset="100%" stop-color="#ffe0f0"/>
      </linearGradient>
    </defs>
    <rect width="240" height="240" rx="28" fill="url(#bg)" stroke="#29b1e9" stroke-width="6"/>
    <circle cx="120" cy="88" r="44" fill="#29b1e9" opacity="0.15"/>
    <text x="120" y="104" text-anchor="middle" font-size="52">✨</text>
    <foreignObject x="20" y="138" width="200" height="85">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Verdana,sans-serif;font-size:13px;font-weight:bold;color:#3f006a;text-align:center;line-height:1.25;">
        ${text}
      </div>
    </foreignObject>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
