04.1 pass; 04.2 pass; 04.3 pass; 04.4 pass; 04.5 pass; 62.1-62.5 pass; 63.2 63.4 63.5 pass
63.1 fail: link depends_on to parent refused (ancestor rule)
63.3 fail: status decided refused (option ok but kill criterion missing)
08.1-08.6 pass; 66.1-66.5 pass; 09.1-09.5 pass; 11.1-11.5 pass; 68.1 pass; 68.5 pass
68.2/68.3/68.4 fail: inbox prints only person's (actor you) notes; agent notes print nothing
64.1-64.5 pass; 65.2 65.5 pass
65.1 fail: stale list entry says "from #a, rejected" but names no depends_on link (show b's trace does)
65.4 fail: rederive b refused: basis a is open (reopened rejected) -> cannot confirm
06.1 pass; 12.2 12.3 12.4 12.5 pass; 67.1-67.5 pass
12.1 fail: message position is 2 (zero-based), step says 3; everything else matched
26.1-26.5 pass
27.3 pass
27.1 27.2 27.4 27.5 fail: `werk ticket list` does not exist (no subverb list); refusals themselves (no reason, done archive) work; restore needs full id
Product has no build pass / sample / review launcher (only plan writers + chat call projectAgentArgs): 19.1 19.3 19.4 76.3 76.4 76.5(partly) -> fail missing feature
28.1-28.5 pass; 82.2 82.3 82.4 pass (check 82.4 exact)
82.1 fail: first board event is plan.started, no `tier` event with tier feature
82.5 fail: ticket writer returning only login does not archive logout (old file stays, still delivers story 2); archive only when spec drops the story
29.1-29.5 pass; 76.1 pass
(browser tests next; use ../e2e/project.ts and ../e2e/harness.ts helpers)
notes.e2e: 10.1-10.5, 06.2 pass
view.e2e: 14.1 14.2 15.1-15.5 71.1-71.5 17.1-17.5 pass (verify final run)
view2.e2e: 18.1-18.5 69.1-69.3 70.1-70.5 72.1 72.3 72.5 pass
72.2 fail: paused cards B,C show no paused mark on map tiles (only grey paused tag on the card page)
72.4 fail: paused card view heading is "Why this card is paused", step wants "Why this card is stale" (content ok)
serve.e2e: 13.1-13.5 14.3 pass
69.4 fail: second server prints no "waiting for pid" line while it waits; only the final refusal naming pid (and port) after ~5s
dev.e2e: 14.4 14.5 pass
chat.e2e: 20.1-20.5 21.1-21.5 22.1-22.5 76.2 pass (22.2 judged by mechanism: answer carries updatedPermissions; restart launch carries the rule flag; fake agent always asks) (21.5 label is "Sonnet + Opus advisor") (73.3 turn starts "[the map is now at #pr-log")
73.1 73.2 73.4 fail (no tabs, no image paste: single conversation "main")
73.5 test below
73.5 fail: clipboard stays empty after outside note (note event + thread ok)
