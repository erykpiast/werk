# Held-out step 69.5: run `bunx playwright test --project spec --output .werk-heldout/results-e-spec --reporter=json > spec.json`,
# then run this script on spec.json. It counts per-test results and PNG attachments.
import json, sys
d = json.load(open(sys.argv[1]))
tests = []
def walk(s):
    for sp in s.get("specs", []):
        for t in sp["tests"]:
            for r in t["results"]:
                tests.append((sp["title"], r["status"], [a for a in r.get("attachments", []) if a.get("contentType") == "image/png"]))
    for c in s.get("suites", []): walk(c)
for s in d["suites"]: walk(s)
print(len(tests), "tests;", sum(len(t[2]) == 1 for t in tests), "with one PNG")
for t in tests:
    if len(t[2]) != 1: print("no single PNG:", t[0], t[1], len(t[2]))
