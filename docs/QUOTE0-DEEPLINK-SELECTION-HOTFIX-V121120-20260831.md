# Quote0 Deep-link Selection Hotfix · v1.21.120 · 2026-08-31

## User-visible regression

After v1.21.119 introduced shareable news deep links, opening a URL such as `/annotate?...&delivery=<id>&subject=<fingerprint>...` correctly restored that exact news item, but clicking another news row did not switch the selected news. The page stayed on the deep-linked item.

## Root cause

`ContentAnnotationPage.handleSelectRecord()` performed two `setSearchParams` writes in the same click:

1. write new `delivery + subject`;
2. write `pane=preview`.

React Router `setSearchParams` does not queue same-tick functional updates the way React `setState` does. The second call was based on the old URL and overwrote the first update, restoring the old deep-link delivery. The same class of bug also existed in search, where query and selection reset were two separate URL writes.

## Fix

`annotation-web/src/components/AnnotationPage.tsx`

- News selection now atomically writes `{ delivery, subject, pane: 'preview' }` in one URL patch.
- Search now atomically writes `{ query, delivery: null, subject: null }` in one URL patch.
- No Research, scheduler, backend identity, or delivery semantics changed.

## Regression test

Added a browser regression to `annotation-web/e2e/mobile-shell.spec.ts`:

1. enter on a deep link to delivery `343999` outside the current subject page;
2. click visible news delivery `343565`;
3. assert URL changes to `delivery=343565` and its stable subject fingerprint;
4. assert new processed body appears;
5. assert old deep-linked body disappears.

Before the fix this test failed deterministically: URL remained `delivery=343999`.
After the fix it passes.

## Validation

Annotation Web:
- `bun run build`: PASS, 1605 modules.
- Focused regression: 1/1 PASS.
- URL/browser suite: 7 PASS / 5 project-design skips / 0 fail.

Full repository final gate after release bump:
- `bun test`: 340 pass / 1 skip / 0 fail / 7479 expectations.
- `bun run build`: PASS.
- `git diff --check`: PASS.

## Production release

App release: `1.21.120`.

Minimal image change:
- annotation-web: `dev.logic.heiyu.space/friday/quote0-annotation-web:v1.21.120`
  - registry digest: `sha256:f2048b686c519365b735940eb72fd6130c86273fb7aecfea5e7fa9229e7aae1c`
- news-api deliberately remains `v1.21.119`.
- label-web remains `v1.21.29`.

LPK install via current supported route:
`TMPDIR=/tmp lzc-cli lpk install me.friday.quote0-mcp-v1.21.120.lpk --apk n`

All 7 Quote0 containers healthy after install. All 7 restart policies restored to `unless-stopped`.

## Production browser proof

Real production API + real deployed annotation-web were tested through an SSH tunnel directly to the annotation container, bypassing only LazyCat SSO.

Initial deep-linked production item:
- delivery `366230`
- subject `a5a707093a63034da9feef135b5807cf`
- title `欧盟将ChatGPT等纳入DSA最严监管`

Clicked another real news row:
- delivery changed to `366229`
- subject changed to `d8150fe985de267b88d5712903b6c348`
- title `少数派编辑部推出最新App精选`
- resulting URL updated to the second identity.

Detail freshness was separately verified: after the click, the visible `查看原文` href became `https://sspai.com/post/114041`, exactly matching backend detail for delivery `366229`; therefore this is not a URL-only switch with stale detail content.

## Device safety check

E-Ink pipeline remained healthy after the UI release:
- `eink-2` runtime state: `healthy`
- `consecutive_failures=0`
- last success at `2026-08-31 23:43:14 +08`

## Git boundary

No commit / push / merge / rebase / reset / stash / clean performed. The worktree still contains the preceding v1.21.114–119 uncommitted governance work plus this v1.21.120 hotfix.
