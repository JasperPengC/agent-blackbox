# Contributing

The project has one rule: **every claim must be verifiable**. A behaviour change
needs a test that fails without it, a performance claim needs numbers, a UI change
needs a screenshot.

## Requirements

- Node **>= 22.19** (TypeScript sources are executed through Node's type stripping)
- Optional: Chrome, for screenshots, the performance probe and asset generation

```bash
npm install          # installs typescript and @types/node only
npm test             # test suite
npm run typecheck    # tsc --noEmit
```

## Three ways to run the project

| Mode | Entry point | Purpose |
| --- | --- | --- |
| Development (recommended) | `node src/cli.ts <cmd>` | Runs TypeScript directly; no build step |
| Build output | `npm run build` then `node bin/blackbox.js` | Verifies the published entry point (`bin` prefers `dist/`) |
| Package | `npm pack` and install in an empty project | Required before release; see `scripts/verify-pack.sh` |

`dist/` is a build artefact and is not committed. `prepare` builds it on publish.

## Useful commands

```bash
npm run demo             # terminal replay of the bundled fixture
npm run ui               # local dashboard on http://127.0.0.1:7077
npm run bench            # projector / seek benchmarks
npm run perf -- "http://127.0.0.1:7077/" 1600 1000      # browser performance probe
npm run audit:contrast -- "http://127.0.0.1:7077/" --strict   # WCAG AA audit
npm run fixture          # regenerate the bundled fixture
npm run fixtures:multi   # regenerate multi-runtime demo data
npm run fixtures:dsh-demo   # regenerate the synthetic DSH session used by the README recordings
bash scripts/make-assets.sh   # regenerate README screenshots (the playback GIFs are recordings, not generated)
bash scripts/verify-pack.sh   # package smoke test (install, CLI, server, static assets)
```

## Change requirements

| Change | Required alongside it |
| --- | --- |
| Behaviour, parsing, caching | A test that fails without the change |
| Performance | `npm run perf` or `npm run bench` numbers before and after |
| UI | Screenshots in `docs/` (synthetic data only) |
| Adapter or data source | A sanitised real log sample and a regression test |

### Adding a runtime adapter

1. Create a file in `src/adapters/` implementing `detect()` and `create()` (about 80 lines).
2. Register it in `src/adapters/index.ts`.
3. Add a regression test with a real log sample in `test/`.
4. Mark its status honestly (`verified`, `heuristic` or `fallback`) in the README compatibility table.

### Adding a session source

1. Add discovery logic to `discoverAll()` in `src/sources.ts` (path rule plus format).
2. Add an incremental reader branch to `createReader()` when the format supports it.
3. Add a test in `test/sources.test.ts` that builds a temporary directory and does not depend on local data.

## Commits

- One commit per verifiable milestone.
- Use Conventional Commits: `feat(web): ...`, `fix(projector): ...`, `docs: ...`,
  `test: ...`, `chore: ...`.
- The body should explain **why** and what alternative was rejected.

## Pull request checklist

- [ ] `npm test` passes; new behaviour has a test
- [ ] `npm run typecheck` reports no errors
- [ ] Manually ran `node src/cli.ts demo` and `npm run ui`
- [ ] `bash scripts/verify-pack.sh` passes when packaging changed
- [ ] Performance changes include before/after numbers
- [ ] UI changes include screenshots (synthetic data)
- [ ] Docs updated (`README.md`, `README.en.md`, `CHANGELOG.md`, `CHANGELOG.en.md`)
- [ ] No real session logs, secrets or local absolute paths
