# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: heldout.spec.ts >> 21.4 a login problem shows its error at once with no retry
- Location: .werk-heldout/e2e-a/heldout.spec.ts:415:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('complementary', { name: 'Chat pane' }).getByText('Your message was not delivered. Send it again.')
Expected: visible
Timeout: 3000ms
Error: element(s) not found

Call log:
  - Expect "soft toBeVisible" getByRole('complementary', { name: 'Chat pane' }).getByText('Your message was not delivered. Send it again.') with timeout 3000ms
  - waiting for getByRole('complementary', { name: 'Chat pane' }).getByText('Your message was not delivered. Send it again.')

```

```yaml
- region "Map pane":
  - button "project ▾"
  - navigation "Breadcrumbs":
    - strong: Home
  - navigation "Views":
    - button "Home"
    - button "Map"
    - button "Board"
  - searchbox "Search the map"
  - article:
    - region "Card":
      - button "Remove this card": ✕
      - button "#root"
      - text: card open
      - heading "We build software with agents" [level=1]
      - paragraph: One repeating pipeline keeps the work in step.
  - article:
    - region "Build rules":
      - heading "Build rules" [level=2]
      - paragraph: This map has no build rules yet.
- complementary "Chat pane":
  - log "Conversation":
    - article: "Hello the agent exited: Not logged in - Please run /login claude auth login to sign in again Fix the problem above, then send it again."
  - text: Not logged in - Please run /login claude auth login to sign in again Fix the problem above, then send it again. idle
  - combobox "Model":
    - option "Sonnet"
    - option "Opus"
    - option "Sonnet + Opus advisor" [selected]
  - button "Context 0% full"
  - textbox "Message":
    - /placeholder: Message the agent
  - button "main"
  - button "New conversation": +
```

# Test source

```ts
  325 |     [],
  326 |     async (server) => {
  327 |       await page.goto(server.url);
  328 |       await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  329 |       await model(page).selectOption({ label: "Opus" });
  330 |       await expect(model(page)).toHaveValue("opus");
  331 |       await send(page, "Hello");
  332 |       await expect(chat(page).getByText("First answer")).toBeVisible();
  333 |       await expect(pie(page)).toHaveAttribute("aria-label", "Context 21% full");
  334 |       const before = await pie(page).getAttribute("aria-label");
  335 |       await server.stop();
  336 |       await server.start();
  337 |       await page.goto(server.url);
  338 |       await expect(model(page)).toHaveValue("opus");
  339 |       await expect(model(page).locator("option:checked")).toHaveText("Opus");
  340 |       await expect(pie(page)).toHaveAttribute("aria-label", before as string);
  341 |       await send(page, "What did I ask you before?");
  342 |       await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
  343 |       const all = launched(server);
  344 |       const first = resumeOf(all[0] as string[]);
  345 |       expect(first).toBeUndefined();
  346 |       const last = all[all.length - 1] as string[];
  347 |       expect(resumeOf(last)).toBe("fake-session-1");
  348 |       expect(last[last.indexOf("--model") + 1]).toContain("opus");
  349 |       expect(messages(server).at(-1)).toMatch(/What did I ask you before\?$/);
  350 |     },
  351 |   );
  352 | });
  353 | 
  354 | test("21.2 a dead stored session starts again and the message is delivered", async ({ page }) => {
  355 |   await withServer(
  356 |     {
  357 |       script: chatScript(
  358 |         [say("m1", "First answer")],
  359 |         [{ stderr: "No conversation found with session ID: fake-session-1" }, { crash: 1 }],
  360 |         [say("m3", "Fresh session answer")],
  361 |       ),
  362 |     },
  363 |     [],
  364 |     async (server) => {
  365 |       await page.goto(server.url);
  366 |       await send(page, "Hello");
  367 |       await expect(chat(page).getByText("First answer")).toBeVisible();
  368 |       await server.stop();
  369 |       await server.start();
  370 |       await page.goto(server.url);
  371 |       await expect(model(page)).toBeVisible();
  372 |       await send(page, "A new message");
  373 |       await expect(chat(page).getByText("Fresh session answer")).toBeVisible();
  374 |       await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toHaveCount(0);
  375 |       const all = launched(server);
  376 |       expect(all).toHaveLength(3);
  377 |       expect(resumeOf(all[1] as string[])).toBe("fake-session-1");
  378 |       expect(resumeOf(all[2] as string[])).toBeUndefined();
  379 |       expect(messages(server).filter((m) => m.endsWith("A new message"))).toHaveLength(2);
  380 |     },
  381 |   );
  382 | });
  383 | 
  384 | test("21.3 another crash retries once, asks to send again, shows the whole error", async ({ page }) => {
  385 |   const err = "agent boom line one\nagent boom line two\nagent boom line three";
  386 |   await withServer(
  387 |     {
  388 |       script: chatScript(
  389 |         [say("m1", "First answer")],
  390 |         [{ stderr: err }, { crash: 1 }],
  391 |         [{ stderr: err }, { crash: 1 }],
  392 |         [say("m4", "Answer after retry")],
  393 |       ),
  394 |     },
  395 |     [],
  396 |     async (server) => {
  397 |       await page.goto(server.url);
  398 |       await send(page, "Hello");
  399 |       await expect(chat(page).getByText("First answer")).toBeVisible();
  400 |       expect(launched(server)).toHaveLength(1);
  401 |       await send(page, "Second message");
  402 |       await expect(chat(page).getByText("Your message was not delivered. Send it again.").first()).toBeVisible();
  403 |       for (const l of err.split("\n")) await expect(chat(page).getByText(l).first()).toBeVisible();
  404 |       // Launch 1 crashed, launch 2 is the one retry.
  405 |       expect(launched(server)).toHaveLength(2);
  406 |       await send(page, "Second message");
  407 |       await expect(chat(page).getByText("Answer after retry")).toBeVisible();
  408 |       const all = launched(server);
  409 |       expect(all).toHaveLength(3);
  410 |       expect(resumeOf(all[2] as string[])).toBe("fake-session-1");
  411 |     },
  412 |   );
  413 | });
  414 | 
  415 | test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  416 |   const err = "Not logged in - Please run /login\nclaude auth login to sign in again";
  417 |   await withServer(
  418 |     { script: chatScript([{ stderr: err }, { crash: 1 }], [say("m2", "should not run")]) },
  419 |     [],
  420 |     async (server) => {
  421 |       await page.goto(server.url);
  422 |       await send(page, "Hello");
  423 |       for (const l of err.split("\n")) await expect(chat(page).getByText(l).first()).toBeVisible();
  424 |       expect(launched(server)).toHaveLength(1);
> 425 |       await expect.soft(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 3000 });
      |                                                                                                 ^ Error: expect(locator).toBeVisible() failed
  426 |     },
  427 |   );
  428 | });
  429 | 
  430 | test("21.5 model switch and clear context refuse during a turn and restart quietly when idle", async ({ page }) => {
  431 |   await withServer(
  432 |     {
  433 |       script: chatScript(
  434 |         [say("m1", "Working", { input_tokens: 30000, output_tokens: 1000 }), { pause: 5000 }, say("m2", "Turn finished")],
  435 |         [say("m3", "Answer after clear")],
  436 |       ),
  437 |     },
  438 |     [],
  439 |     async (server) => {
  440 |       await page.goto(server.url);
  441 |       await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  442 |       // The product default is "Sonnet + Opus advisor"; the step starts from plain Sonnet, so pick it first.
  443 |       await model(page).selectOption("sonnet");
  444 |       await expect(model(page).locator("option:checked")).toHaveText("Sonnet");
  445 |       await expect(pie(page)).toHaveAttribute("data-level", "blue");
  446 |       await send(page, "Make a long turn");
  447 |       await expect(chat(page).getByText("Working")).toBeVisible();
  448 |       // A person cannot pick Opus while the turn runs: the selector is disabled.
  449 |       await expect(model(page)).toBeDisabled();
  450 |       await expect(model(page).locator("option:checked")).toHaveText("Sonnet");
  451 |       await expect(chat(page).getByText("Turn finished")).toBeVisible({ timeout: 20000 });
  452 |       await expect(model(page)).toBeEnabled();
  453 |       await model(page).selectOption("sonnet+opus");
  454 |       await expect.soft(model(page).locator("option:checked")).toHaveText("Sonnet with Opus advisor");
  455 |       await expect(page.locator("[data-slot=dead-line], [data-slot=dead-error]")).toHaveCount(0);
  456 |       await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
  457 |       await pie(page).click();
  458 |       const dialog = chat(page).getByRole("dialog");
  459 |       await expect(dialog).toContainText(/\d+%/);
  460 |       await expect(dialog.getByRole("button", { name: "Clear context" })).toBeVisible();
  461 |       await dialog.getByRole("button", { name: "Clear context" }).click();
  462 |       await expect(page.locator("[data-slot=dead-line], [data-slot=dead-error]")).toHaveCount(0);
  463 |       await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
  464 |       await send(page, "Next message");
  465 |       await expect(chat(page).getByText("Answer after clear")).toBeVisible();
  466 |     },
  467 |   );
  468 | });
  469 | 
```