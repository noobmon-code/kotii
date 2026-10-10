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

## Kotii — project notes

- Product copy and UI text are in Brazilian Portuguese; code identifiers in English.
- Visual identity (Headspace-inspired, lightly glassy): warm cream/indigo backgrounds with soft pastel blobs (`Backdrop`, already inside `Screen`; add it to full-screen modals), translucent glass cards (`Card`, or `useGlassStyle()` for custom surfaces; `glass`/`glassStrong`/`glassBorder` colors and `shadows` in the theme), pill buttons, big rounded cards, Nunito font and friendly round characters. Use the tokens in `src/ui/theme.ts` (`useColors`, `useTint`, `fonts`, `radius`, `shadows`) and the SVG art in `src/ui/art.tsx` (`Mascot`, `Spot`, `SkyArt`, `Logo`). The Nuke is a glass bubble: `NukeLive` (`src/ui/NukeLive.tsx`, animated, moods idle/joy/think/talk/wow/sleep/oops) and the static `NukeAvatar` for lists (`src/ui/NukeArt.tsx`); no sparkles around it; product categories render their illustration via `CategoryIcon` (images in `assets/categories/`, mapped in `src/ui/categoryArt.ts`; a new category needs a new image); pass `name` so common items (banana, arroz, leite…) get their own art (name rules in `src/domain/itemArt.ts`, images in `assets/items/` mapped in `src/ui/itemArt.ts`); never hardcode colors or font weights in screens (Nunito picks the weight by family, not `fontWeight`).
- `src/domain/` holds pure business rules (no React, no Supabase) with Jest tests in `src/domain/__tests__/`. Keep logic there and screens thin.
- Database changes go in a new file under `supabase/migrations/`; every household table uses `household_id = current_household_id()` RLS. Run `npm run test:db` (temporary Postgres + Supabase stubs in `scripts/db/`) after schema changes.
- `supabase/functions/` is Deno (excluded from tsconfig/ESLint): verify with `deno check`, `deno lint`, `deno test` inside the function folder. AI calls (Anthropic/OpenRouter) live in `_shared/vision.ts` (images, shared by `parse-receipt` and `parse-health`) and `_shared/chat.ts` (conversation, used by `nuke`, the household assistant, and by `nuke-finance`; the app builds the household snapshot in `src/domain/nuke.ts` and runs suggested actions only after the user taps); `_shared` has its own `deno.json` for its tests.
- Notifications: `src/lib/reminders.ts` schedules everything. On native it uses local `expo-notifications`; on web the same calls go to `src/lib/webPush.ts`, which stores the schedule in `push_schedule`, and the `send-push` function (fired every minute by pg_cron) delivers it via Web Push to `public/sw.js`. Keep both paths behind the same reminders API.
- Shopping list ↔ receipt: list items are free text, so `confirm_receipt` removes the list items the user ticked in the review and learns `list_item_links` (list name key → product). Matching and keys live in `src/domain/listLinks.ts` (`listNameKey` must match the SQL check on `name_key`); the cart/receipt pantry de-duplication (`src/domain/cartPantry.ts`) uses the same links.
- Category keys live in `src/domain/categories.ts` and are mirrored in `supabase/functions/_shared/categories.ts`; a Jest test fails if they diverge. Finance categories (`FINANCE_CATEGORIES` in `src/domain/finance.ts`, `outros` always last) have the same mirror plus the `finance_category` domain in the database: a new one needs a migration that replaces `finance_category_check`, a redeploy of `nuke` and `nuke-finance` (their schemas enumerate the keys), and a look at the bank rules in `src/domain/bankCategories.ts`.
- Finance advisor beta ("Consultor", shadow mode): bank data from Pluggy (MeuPluggy items whose Item IDs the owner pastes in `src/app/consultor/`) lives in private `fin_connections`/`fin_accounts`/`fin_transactions`, readable only by that user (`user_id = auth.uid()` + `current_household_id()` + `has_beta('finance')`, granted by a manual SQL insert into `beta_access`) and written only by the service role in the `finance` function (`map.ts` pure mapping, `sync.ts` orchestration with an injected Pluggy client and db, `index.ts` the service-role adapter; `_shared/pluggy.ts` is a plain-fetch client, no pluggy-sdk; sync on open if > 6 h or forced, 365 days until Pluggy has data then a window from a week before the last covered date (at least 60 days) with `deleted_at` tombstones; no webhooks; CPF hashes are HMAC with the `FIN_DOC_HASH_KEY` secret and CPFs are stripped from stored descriptions and names). It must not change the existing finance tables, the Resumo/budget math or the household Nuke snapshot; reconciliation with Kotii records (`src/domain/bankMatch.ts`) is read-only suggestions. Installment purchases count month by month: one `BankPurchase` per parcel the bank sent, dated purchase date + (n-1) months with its own amount, and `installment` carries the whole purchase (series key, purchase date and amount) for the comprometido (`futureInstallments`, once per purchase), refunds of the whole purchase and the Kotii receipt of the whole purchase (`reconcileWindow`, with records fetched from `kotiiRecordsStart`); parcels are read 24 months back (`financeInstallmentFetchStart`) so the first parcel dates the purchase (Pluggy only gives 12 months on the first sync; without the first parcel, the date comes from `purchase_on` or an estimate). The one thing the app writes is the user's own category choices (`fin_category_rules`, own rows only, same RLS plus the beta FK; `src/app/consultor/lancamentos.tsx`): a rule per purchase (`p:<purchase key>`; on an installment purchase, a rule on any parcel's key covers all of them, read via `ruleKeys` and written to `ruleKey`) or for similar ones (`doc:<CPF hash>` or `m:<name without digits>`), applied in `groupPurchases` via `src/domain/bankRules.ts`; a chosen category never lets a person-like name reach the snapshot (`storeName` keeps using the automatic category) and choosing saúde makes the purchase sensitive for good: a trigger on `fin_category_rules` records the match_key in `fin_sensitive_keys` (read-only for the owner, same RLS and beta FK), plus the purchase's similar key on a "Só esta" choice (`similar_key`, so the mark survives a new transaction id), and changing or undoing the choice, or a "Só esta" over a saúde rule for similar ones, keeps it sensitive (`chosenSensitive` in `bankRules.ts`); a refund inherits its purchase's sensitivity (`linkRefunds`, or `refundOfSaudeStore` without a pair), and the consultor screen re-saves older per-purchase saúde choices with their similar key (`missingSimilarMarks`, `useRepairSimilarMarks`). Rules live in `src/domain/bank*.ts` and `financeAdvisor.ts`; the LLM never does arithmetic (numbers come precomputed in the snapshot), and the snapshot never carries CPF, account/agency numbers, boleto lines or people's names (names only from an allowlist: Pluggy merchant, non-MEI company, card purchase, and a person-like name only with a store category; sensitive categories only as totals). The chat (`nuke-finance`) is Anthropic-only (`FINANCE_MODEL`, default `claude-haiku-5-5`; fails closed without `ANTHROPIC_API_KEY`, never OpenRouter), uses the `finance` AI quota, and its history is memory-only (`src/features/finance/advisorConversation.ts`; never AsyncStorage/localStorage, and no `fin_*` queries in the persisted query cache).
- Run `npm test`, `npm run typecheck` and `npm run lint` before declaring work done.
