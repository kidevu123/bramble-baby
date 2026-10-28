# Bramble — notes for Claude Code sessions

Baby tracker PWA (React + TypeScript, Vite) on a self-hosted Baby Buddy backend, plus a
small Python companion service (`server/`). Users are on iPhones (PWA added to the Home Screen). Read
`docs/DEVELOPMENT.md` for the layout, dev loop, isolated e2e run and the probe list, `docs/SELF-HOSTING.md` for
installing and deploying; `README.md` is the public front page (screenshots from `e2e/readme-shots.mjs`, a made-up baby).

## Working rules

- **Configuration lives in Settings.** Daily-use screens (log sheets, label sheet, Home) never carry their own
  settings panels or unit toggles. Settings is a grouped list of rows that open focused sheets (`MorePage.tsx`).
  When a daily-use screen needs one of those sheets, it renders the same shared sheet component nested in
  place (the milk label sheet opens `LabelSettingsSheet`), so closing it returns to where the user was; never
  deep-link with a query parameter (`?open=`), which strands the user on another page.
- **One way in, and Back goes where you came from.** A destination has one entry point: a bottom tab is it
  (no Home card duplicating the Stash tab, no Child-page row duplicating the Sleep Plans tab). Pages reached
  from the top bar or a band (Settings, Insights, Nap window, timers, Contractions) show Back, which pops
  history (`useGoBack`: `navigate(-1)`, Home when there is no history). Sheets open in place, never by
  navigating to another page.
- **Never abandon a feature or leave two ways to do the same thing.** Upgrade the existing feature in place,
  or migrate the data and remove the old path in the same change. Never ship a code path that silently
  produces the old behaviour (2026-09-30: the label sheet could still print a label with no volume, so no bag,
  no QR — "two kinds of label"). Before pushing, ask: is there any screen where the old version still shows?

- **Every user-visible release adds an entry to `RELEASES` in `src/lib/whats-new.ts`** with the new `package.json`
  version (a unit test fails otherwise): a few short items in the family's words, `{name}` for the child. Phones show it
  once after they update (Settings › What's new keeps them all).
- **Age-typical figures count from `ageBasis` (`src/lib/preterm.ts`), never from `child.birth_date` directly**: corrected age for a baby
  born early, and `ageHold` (NICU or before the due date) means no verdict by age. Shown ages and Mom's days since delivery stay on the birth.
- `npm run check` (typecheck, lint, unit tests, build) must pass before any push. Server tests:
  `python3 -m unittest server/test_server.py server/test_hatch.py server/test_people.py server/test_nudges.py` (needs a venv with `pywebpush py-vapid cryptography Pillow`).
- The mock backend in `e2e/mock-babybuddy.mjs` is not Baby Buddy; when in doubt about an API rule
  (required fields, unique periods, tag permissions), check Baby Buddy's source, not the mock.
- Baby Buddy stores bare numbers. Which units they are in is recorded once per child in the shared child
  settings (`storageUnits`, seeded by `StorageUnitsSeeder`, never changed). Each phone has its own display
  units (`prefs.units`); `useChildEvents`/`useGrowth` convert rows to display units on read and every
  write site converts back with `useUnitBoundary().toStorage` (`src/lib/storage-units.ts`). Never read
  `.amount`/`.weight`/`.temperature` from a raw endpoint result in UI code, and never rewrite stored rows.
- Milk stash volumes are millilitres on the companion: `volume_ml` is the label volume and never changes with use,
  `remaining_ml` is what is still in the bag; convert with `bagVolume`/`bagLeft`/`bagAmountIn`/`toMl` in `src/lib/milk.ts`.
  A bottle takes from bags only through `PUT /milk/feeding/<id> {takes}` (the feeding's whole allocation, one use row per
  bag, checked as a whole, adjusted on edit, `[]` on delete) or its one-bag case `POST /milk/<id>/use` (this bag and no
  other); every change to a balance is a `milk_uses` row (bottle/elsewhere/adjust); the bag becomes `used` only under
  1 mL left; `PATCH remaining_ml` sets the balance by hand; Undo is `PATCH status:'stored'`, which reverses the last use; a
  bag the feeding no longer draws on gets its milk back (`_give_back`). The app plans the split with `planTakes` (oldest
  picked bag empties first) and never writes bag balances itself.
  Night bottles (`kind: 'bottle'`, `spot` 1–5) are made only through `companion.milk.makeBottles` (Stash › Make night bottles):
  the milk leaves the bags then (`combined` uses), and a feed from a bottle takes it whole; an unfed bottle is undone only
  through `companion.milk.unmakeBottle` (the pours given back, the bottle removed), and changes spot only through
  `companion.milk.moveBottle` (`POST /milk/<id>/spot`; a bottle already in that spot swaps into the old one). Bags taken to the NICU leave only through
  `companion.milk.toNicu` (`POST /milk/nicu`, one `nicu` use each; Undo reverses it). A bag takes a travel sticker's
  code (printed ahead, `milk_travel_labels`) only through `travel_code` on create/update; codes come from `_fresh_code`. Bags are created only through `companion.milk.create`, from three places: the label sheet from a pumping session
  (registers on the explicit Add to stash step once a volume is typed, or at once when the caller supplies it, idempotent
  per `pumping_id`), saving a new pumping entry with a volume while auto-print is on (`useAutoPrint`, the same call with
  `pumping_id`, so the label sheet later finds that bag), and the Stash tab's "Add milk you already have" (`intake` mode:
  no pumping entry, idempotent per `client_key`). Never create Baby Buddy pumping entries for milk added that way. Expiry always counts from the real
  `pumped_at`, or from `thawed_at` for thawed milk; the server refuses future times; already-expired milk is accepted but
  shown as expired and gets no reminders. `milk_bags` is live: new columns go in `ADDED_COLUMNS` and indexes in
  `LATE_INDEXES` in `server/milk.py`, with a migration test from the old schema. Bags leave the stash only through
  `status: 'used' | 'discarded'`; reminders for a bag carry `tag: milk:<id>`.
- Run server tests with `PYTHONDONTWRITEBYTECODE=1 <venv>/bin/python -m unittest server/test_server.py`;
  `server/__pycache__` is untracked and ignored.
- A bottle's strength is a `kcal:<n>` tag (`src/lib/calories.ts`); a fortified bottle is tagged when it is saved and an edit sends
  the full tag list through `withKcalTag`, so a later recipe never rewrites the calories already logged. The household's
  fortification and calorie goal are `settings.fortify` / `settings.calorieGoal` (Settings › Calories & fortifying); recipes
  come only from `recipeFor` in `src/lib/fortify.ts`. Calories are a household switch (`settings.caloriesOn`, off by default):
  read them only through `calorieTracking(settings)` (null when off), and save a bottle's tag only through `strengthToSave`.
- A pumping entry's pump is a `pump:<name>` tag beside the `caregiver:` tag (`src/lib/pumps.ts`); every write of a pumping
  entry sends its full tag list through `withPumpTag`, so neither tag is lost on an edit. The pump list is `settings.pumps`
  (Settings › Pumps), never hard-coded in a sheet.
- Never put credentials, tokens or the root password in the repo, commit messages, or PR text.
