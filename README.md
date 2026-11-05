# Crosswords for Kids 🧩✨

An interactive, AI-powered kids crossword puzzle generator and web application modeled after [Crosswords-for-Kids.com](https://www.crosswords-for-kids.com/).

## Live Endpoints
- **Tailscale:** `http://anduril.tail53be5b.ts.net:5185`
- **LAN:** `http://192.168.87.25:5185`
- **Localhost:** `http://localhost:5185`

## Key Features
1. **5–10 Clues per Puzzle:** Compact, automatically intersecting crossword grids (`src/crosswordLayout.js`) tailored for children, with selectable 5–10 clues per puzzle.
2. **AI-Generated Picture Clues & Question Clues:**
   - Supports **Picture Clues** (powered by Gemini `gemini-2.5-flash-image`), **Question/Riddle Clues**, or a **Mix** of both.
   - Includes 6 ready-to-play themed crosswords (*Baby Animals, Solar System, Dinosaur World, Ocean Animals, Back to School, Pirates & Treasure*) with 41 pre-generated AI cartoon illustrations in `public/images/presets/`.
3. **Custom User-Specified Themes:**
   - Kids or parents can type **any theme** (e.g., *Construction Trucks, Jungle Safari, Musical Instruments, Fairy Tale Kingdom*) and choose 5–10 clues.
   - Gemini (`gemini-2.5-flash` + `gemini-2.5-flash-image`) generates intersecting kid-friendly words, riddles, and custom cartoon illustrations on the fly via `/api/gemini`.
4. **"Yaaay!" Per-Clue Celebration & Sound Effects:**
   - Solving any clue triggers the cheerful `"Yaaay!"` voice & chime audio (`public/sounds/kids_yeah.mp3`, `wordFound.mp3`, plus WebAudio arpeggio) and a minimal floating **`YAAAY! ⭐`** toast with a local burst of star sparkles and cell pop animations.
5. **Grand Puzzle Victory Animation:**
   - Solving the entire puzzle launches a full-screen multi-wave fireworks & confetti celebration (`src/soundAndFx.js`), trophy bounce modal, and cheering fanfare (`kids_yeah2.mp3`).

## Development & Tests
```bash
npm test          # Unit tests for crossword layout engine
npm run test:e2e  # Playwright browser tests
npm run dev       # Start Vite server on port 5185
npm run build     # Production build
```
