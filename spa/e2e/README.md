# Browser regression tests

Run against a production build:

```sh
npm ci
npm test
npm run build
npx playwright-core install chromium
npm run test:e2e
```

The suite starts its own loopback-only Vite preview server, exercises only the
in-memory demo, and closes its browser and server afterward. It never connects
to a real relay or uses a private key.

To use an existing Chromium installation, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable. Set
`BUZZBOARD_TEST_PORT` if the default test port is occupied.

The tests cover per-board collapse/expand, visible headings, restored card
identities, accessibility, Enter/Space, independent boards, filter preservation,
card creation, card details, drag/drop, new-lane cancellation, polling, reload,
mobile-width controls, and exiting the demo. Browser errors fail each test.

Collapse is presentation-only, lasts for the current page session, and does not
publish relay events. Reloading starts with all boards expanded.
