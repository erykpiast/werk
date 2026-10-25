import { expect, test } from "bun:test";
import { injectToken, tokenOf } from "./page-html.ts";

const META = (token: string) => `<meta name="werk-token" content="${token}">`;

test("the token meta tag is the first element of the head", () => {
  const html = injectToken("<html><head><title>w</title></head></html>", "abc");
  expect(html).toBe(`<html><head>${META("abc")}<title>w</title></head></html>`);
});

test("a head with attributes still gets the tag", () => {
  expect(injectToken('<head lang="en"></head>', "t")).toBe(
    `<head lang="en">${META("t")}</head>`,
  );
});

test("a page with no head gets one", () => {
  expect(injectToken("<!doctype html><p>hi</p>", "t")).toBe(
    `<!doctype html><head>${META("t")}</head><p>hi</p>`,
  );
  expect(injectToken("<p>hi</p>", "t")).toBe(
    `<!doctype html><head>${META("t")}</head><p>hi</p>`,
  );
});

test("a token that holds a quote cannot end the attribute", () => {
  const html = injectToken("<head></head>", 'a"><script>');
  expect(html).not.toContain('"><script>');
  expect(html).toContain("&#34;&#62;&#60;script&#62;");
});

test("the token of a page is read back, also when it held a quote", () => {
  expect(tokenOf(injectToken("<head></head>", "abc"))).toBe("abc");
  expect(tokenOf(injectToken("<head></head>", 'a"><b'))).toBe('a"><b');
  expect(tokenOf("<p>no head</p>")).toBeNull();
});
