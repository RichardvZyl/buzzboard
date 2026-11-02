# Collapsible boards verification

## Scope

Add an independent collapse/expand control beside each swimlane name. Hide its
columns and cards while retaining its heading, description, and actions.
This is presentation-only: no relay events or board data are changed by toggling.
State persists through filtering and polling within the page, but not reloads.
Creating a card expands the target lane before opening its dialog.

## Baseline and regression proof

The implementation was based on the fork's current default-branch commit
`88a1512fc1b65e1c44e7bbf525c19f456e974d40`, matching the clean local checkout.
No open pull requests existed when the feature branch was created.

On the original production build, the collapse regression test failed waiting
for the absent `Collapse Mobile app` button. The same interaction passes after
the implementation; it is not merely a build or snapshot assertion.

## Verification run

Commands run from `spa`:

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run test:e2e
```

The browser run used an existing Chromium executable selected through
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The tests run against Vite's production
preview, not its development server.

Results:
- Unit tests: 44 passed across board, signing, and rank suites.
- Browser tests: 8 passed, with no browser console or page errors.
- Production build: TypeScript and Vite completed successfully.
- Visual inspection: 1440px desktop and 375px narrow viewport; collapsed headings
  and their toggles remain visible.
- Keyboard: Enter and Space toggle without losing focus.
- Scope: one collapsed lane does not collapse its neighbors.
- Data preservation: expanding restores the same card identities.
- Accessibility: collapsed card content is absent from the accessible snapshot.
- Existing flows: filtering, card details, card creation, drag/drop, new-lane
  cancellation, polling, and exiting demo remain functional.

All write-interaction tests used the in-memory demo. No live relay data or
credentials were used.

## Known baseline issues

The existing dependency lockfile reports six audit findings (three moderate and
three high). This change adds no dependencies and does not attempt an unrelated
dependency upgrade. Existing narrow-screen column layout is unchanged; this
verification covers the new collapse controls rather than a mobile redesign.

## Local release procedure

The existing static server can serve a new production build without a process
restart. Transfer content-hashed assets first and `dist/index.html` last, retain
the previous index for rollback, then verify the served asset hashes and exercise
the controls in a fresh browser page. Do not stop an unrelated app to reuse its
port. Do not replace the source checkout with a dirty working copy.
