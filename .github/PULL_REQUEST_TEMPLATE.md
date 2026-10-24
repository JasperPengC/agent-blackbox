## What changed

<!-- One sentence. For a bug fix, state what was wrong before. -->

## Why

<!-- The problem, how it was found, and any alternative that was rejected. -->

## How it was verified

- [ ] `npm test` passes; new behaviour has a failing-without-it test
- [ ] `npm run typecheck` reports no errors
- [ ] Ran `node src/cli.ts demo` and `npm run ui` locally
- [ ] `bash scripts/verify-pack.sh` passes when packaging changed
- [ ] Performance changes include before/after numbers
- [ ] UI changes include screenshots (synthetic data)
- [ ] Docs updated (`README.md`, `README.zh.md`, `CHANGELOG.md`)

## Impact

<!-- Does this change the recording format? Existing replays? Does it require a restart? -->
