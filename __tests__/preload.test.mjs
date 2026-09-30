import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));
const html = readFileSync(join(__dirname, "../src/index.html"), "utf-8");
const norm = (s) => s.replace(/\s+/g, " ").trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const preload = manifest.preload ?? {};

// The hub runs `manifest.preload` while rendering the document and answers the
// app's matching api/db request from the embedded rows — matching on the
// statement text with whitespace collapsed. A drifted copy is not an error
// anywhere: it is a preload that silently never answers. So the manifest is
// checked against the source here.
describe("manifest.preload mirrors the app's first-render reads", () => {
  const prefix = `app_${manifest.id.replace(/-/g, "_")}__`;
  // src/index.html names every table as `${T}name` inside a template literal,
  // so the declared text never appears in the file verbatim. Expand T to the
  // prefix first — and pin T to it, or the expansion would prove nothing.
  const T = /const T = "([^"]*)";/.exec(html)?.[1];
  const body = norm(html.replaceAll("${T}", T ?? ""));

  it("expands ${T} to this app's table prefix", () => expect(T).toBe(prefix));
  it("declares at least one statement", () => expect(Object.keys(preload).length).toBeGreaterThan(0));

  it("declares statements the app posts, byte-for-byte after whitespace collapse", () => {
    // The whole db(`…`) call, not a substring of it: a declared statement that
    // is only a PREFIX of what is posted (a LIMIT/OFFSET or extra predicate
    // appended) would pass a substring check and never answer. The call also
    // carries no params argument, so the app posts params [] — which is what
    // an absent manifest `params` means.
    for (const [name, { sql, params = [] }] of Object.entries(preload)) {
      expect(params, `preload.${name} params`).toEqual([]);
      const call = new RegExp(`db\\( ?\`${escapeRe(norm(sql))}\` ?\\)`);
      expect(call.test(body), `preload.${name} is not the text src/index.html posts`).toBe(true);
    }
  });

  it("stays within the hub's caps and reads only this app's tables", () => {
    expect(Object.keys(preload).length).toBeLessThanOrEqual(6);
    for (const [name, { sql, params = [] }] of Object.entries(preload)) {
      expect(sql, name).toMatch(/^(SELECT|WITH) /);
      expect(sql, name).not.toMatch(/;|--/);
      for (const table of sql.match(/(?:FROM|JOIN)\s+(\w+)/g) ?? []) expect(table, name).toMatch(new RegExp(`\\s${prefix}`));
      expect((sql.match(/\?/g) ?? []).length, `${name}: placeholders vs params`).toBe(params.length);
    }
  });
});
