# Computer use

The harness follows the Responses API [computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) guide for code execution. The app does not have structured computer actions, so the model gets one function tool, `exec_js`, and a Playwright browser.

The loop lives in `scripts/computer-use/loop.mjs`. The browser lives in `scripts/computer-use/sandbox.mjs`. One session id keeps the same browser, page, and JavaScript realm between calls. Each call can return text (`console.log`) and a PNG (`display`, or a screenshot when the script did not call `display`). Images are sent back as `input_image` with `detail: "original"`.

## What the browser may open

Only loopback (`127.0.0.1`, `localhost`, `::1`). Any other host is blocked. The sandbox does not receive environment variables, so it cannot see API keys.

## Local check

`/harness/kb` is a local page, off unless `COMPUTER_USE_FIXTURE=1`. `POST /api/harness/kb` answers from a three-paragraph fixture in `lib/computer/retrieve.ts`, or from `COMPUTER_USE_VECTOR_STORE` when that is set to one store id. The request body cannot choose a store. The route returns 404 when the flag is off and 403 when the host is not loopback. It does not read or modify the team library.

The known fact in the fixture (`lib/computer/fixture-corpus.mjs`) is the pickup code `6249` in “Prueba aislada CU-1842”. A different passage contains `1001` and should not be the one Fuentes shows for the fixture question.

```bash
pnpm computer-use
```

That starts the app on `127.0.0.1:3317` with the fixture flag, opens `/login`, refuses the production host, then asks the fixture question and opens Fuentes. Screenshots are written to `/tmp/computer-use-kb/` (`login.png`, `fuentes.png`). Without `OPENAI_API_KEY` the script does not call the Responses API. It runs the same loop with a scripted stand-in and says so in the result. With a key, the model is `OPENAI_MODEL_COMPUTER` (default `gpt-6-astra`).

Do not set `COMPUTER_USE_FIXTURE` or `COMPUTER_USE_VECTOR_STORE` on production. Do not point the store variable at a team library.
