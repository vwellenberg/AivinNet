# Contributing to AivinNet

AivinNet is a Python/Flask backend (`src/`) and a Vue 3 client (`client/`) in one
repository. It began as a fork of [Swing Music](https://github.com/swingmx/swingmusic)
and has been developed independently since June 2025.

Bug reports and pull requests are welcome. There is no CLA and no contributor
checklist to sign — the two things that matter are below.

## Before you open a pull request

- **Branch from `master`** and merge back into it.
- **A bug fix comes with a test that fails without it.** Anything else is hard to
  keep: this project has re-broken the same layout rule twice, and only the tests
  that were red first caught it the second time.
- **Say how you verified it.** For UI work that means measuring in a browser, not
  a screenshot that looks right — `docs/verification.md` has the tooling.
- Keep the change focused. An unrelated cleanup in the same PR makes both harder
  to review and to revert.

## Running it

```sh
uv sync                        # backend dependencies
uv run aivinnet                # the server, on :1970

cd client && yarn install      # client dependencies
yarn dev                       # dev server
yarn test                      # vitest
```

Backend tests run in two lanes, and they must be separate processes — the fast
lane mocks modules the API lane needs:

```sh
pytest tests/                  # fast, heavy dependencies mocked
pytest tests_api/              # full stack, real request cycle
```

## Reporting a bug

Say what you did, what happened, and what you expected. If it is visual, a
screenshot is worth more than a description — the last three UI bugs in this
project were all found in one.
