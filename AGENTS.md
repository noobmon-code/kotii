This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Nooky — project notes

- Product copy and UI text are in Brazilian Portuguese; code identifiers in English.
- Visual identity (Headspace-inspired, lightly glassy): warm cream/indigo backgrounds with soft pastel blobs (`Backdrop`, already inside `Screen`; add it to full-screen modals), translucent glass cards (`Card`, or `useGlassStyle()` for custom surfaces; `glass`/`glassStrong`/`glassBorder` colors and `shadows` in the theme), pill buttons, big rounded cards, Nunito font and friendly round characters. Use the tokens in `src/ui/theme.ts` (`useColors`, `useTint`, `fonts`, `radius`, `shadows`) and the SVG art in `src/ui/art.tsx` (`Mascot`, `Spot`, `SkyArt`, `Logo`). The Nuke is a glass bubble: `NukeLive` (`src/ui/NukeLive.tsx`, animated, moods idle/joy/think/talk/wow/sleep/oops) and the static `NukeAvatar` for lists (`src/ui/NukeArt.tsx`); no sparkles around it; product categories render their illustration via `CategoryIcon` (images in `assets/categories/`, mapped in `src/ui/categoryArt.ts`; a new category needs a new image); pass `name` so common items (banana, arroz, leite…) get their own art (name rules in `src/domain/itemArt.ts`, images in `assets/items/` mapped in `src/ui/itemArt.ts`); never hardcode colors or font weights in screens (Nunito picks the weight by family, not `fontWeight`).
- `src/domain/` holds pure business rules (no React, no Supabase) with Jest tests in `src/domain/__tests__/`. Keep logic there and screens thin.
- Database changes go in a new file under `supabase/migrations/`; every household table uses `household_id = current_household_id()` RLS. Run `npm run test:db` (temporary Postgres + Supabase stubs in `scripts/db/`) after schema changes.
- `supabase/functions/` is Deno (excluded from tsconfig/ESLint): verify with `deno check`, `deno lint`, `deno test` inside the function folder. AI calls (Anthropic/OpenRouter) live in `_shared/vision.ts` (images, shared by `parse-receipt` and `parse-health`) and `_shared/chat.ts` (conversation, used by `nuke`, the household assistant; the app builds the household snapshot in `src/domain/nuke.ts` and runs suggested actions only after the user taps); `_shared` has its own `deno.json` for its tests.
- Category keys live in `src/domain/categories.ts` and are mirrored in `supabase/functions/_shared/categories.ts`; a Jest test fails if they diverge.
- Run `npm test`, `npm run typecheck` and `npm run lint` before declaring work done.
