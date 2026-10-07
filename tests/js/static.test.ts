// Repository rules that would otherwise need a human to re-read the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml } from "../../src/lib/escape.ts";

const root = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(root, p), "utf8");
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(root, p)).isDirectory() ? files(p) : [p];
  });
}
const src = files("src").map((p) => [p, read(p)] as const);

test("escapeHtml escapes markup", () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>&'`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;");
});

test("no dangerouslySetInnerHTML, no Snap connect, no js-sha3, no CDN imports", () => {
  for (const [p, s] of src) {
    assert.ok(!s.includes("dangerouslySetInnerHTML"), p);
    assert.ok(!/\.connect\(\s*["']studionet["']\s*\)/.test(s), p);
    assert.ok(!s.includes("js-sha3") && !s.includes("sha3_256"), p);
    assert.ok(!/from\s+["']https?:/.test(s), p);
  }
  assert.ok(!read("index.html").includes("cdn"), "index.html");
});

test("no hard-coded wallet; the only address is the Project deployment in config.ts", () => {
  const dep = JSON.parse(read("deployments.json"));
  for (const [p, s] of src) {
    const hits = [...s.matchAll(/0x[0-9a-fA-F]{40}\b/g)].map((m) => m[0]).filter((a) => !/^0x0{40}$/.test(a));
    if (p.endsWith(join("lib", "config.ts"))) assert.deepEqual(hits, dep.project ? [dep.project] : [], p);
    else assert.deepEqual(hits, [], p);
  }
  if (dep.project && dep.intelligent_contract) assert.notEqual(dep.project.toLowerCase(), dep.intelligent_contract.toLowerCase());
});

test("proxy declared in both vite.config.ts and vercel.json; one RPC path in config", () => {
  assert.ok(read("vite.config.ts").includes('"/genlayer-rpc"'));
  assert.ok(JSON.parse(read("vercel.json")).rewrites.some((r: any) => r.source === "/genlayer-rpc"));
  assert.ok(read("src/lib/config.ts").includes('RPC_PATH = "/genlayer-rpc"'));
});

test("pins: genlayer-js 1.1.8 exact, one viem, build script, noEmit", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies["genlayer-js"], "1.1.8");
  assert.equal(pkg.overrides.viem, pkg.dependencies.viem);
  assert.equal(pkg.scripts.build, "tsc -b && vite build");
  assert.equal(JSON.parse(read("tsconfig.node.json")).compilerOptions.noEmit, true);
});

test("the concept is wired through the shared rules module", () => {
  const app = read("src/App.tsx");
  for (const call of ["openBlock(", "addApproverBlock(", "requestBlock(", "approveBlock(", "markPaidBlock(", "cancelBlock(",
    "openVerified(", "addApproverVerified(", "requestVerified(", "approveVerified(", "markPaidVerified(", "cancelVerified(", "nextPayable(", "stateLine("]) {
    assert.ok(app.includes(call), call);
  }
  for (const label of [">Approve<", ">Send request<", ">Open ledger<", ">Add approver<", ">Cancel<", "Check again", "Copy ledger link", "Verification"]) assert.ok(app.includes(label), label);
});

test("nothing is payable: every write sends value 0", () => {
  const app = read("src/App.tsx");
  assert.ok(app.includes("sendWrite(me, method, args, 0n)"));
  const methods = [...app.matchAll(/runWrite\("[^"]+", "(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(methods, ["add_approver", "approve", "cancel", "mark_paid", "open_ledger", "request"]);
});

test("each request is a render function (inputs elsewhere keep focus)", () => {
  const app = read("src/App.tsx");
  assert.ok(app.includes("renderRequest(r)") && !/<Request\b|<ReqCard\b/.test(app));
});

test("no seed or demo data in the app", () => {
  const app = read("src/App.tsx");
  assert.ok(!/0x[0-9a-f]{40}/i.test(app));
});
