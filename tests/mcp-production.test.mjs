import assert from "node:assert/strict";

const baseUrl = process.env.PRODUCTION_BASE_URL ?? "https://incident-postmortem-checker.sidcraigau.workers.dev";
const mcpUrl = `${baseUrl}/mcp`;
const supportEmail = "sidcraigau@gmail.com";
const frozenTools = ["extract_incident_timeline", "extract_postmortem_actions", "check_postmortem_completeness"];
const cases = [];
const groups = new Map();

function addCase(group, name, fn) {
  groups.set(group, true);
  cases.push({ group, name, fn });
}

function assertNoExtraKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function assertErrorShape(error, code, field) {
  assertNoExtraKeys(error, ["code", "message", "field"]);
  assert.equal(error.code, code);
  assert.equal(typeof error.message, "string");
  assert.ok(error.message.length > 0);
  assert.equal(error.field, field);
}

async function rpc(method, params, id = `${method}-id`) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function page(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { response, body: await response.text() };
}

addCase("production pages", "review pages, health, and challenge are reachable", async () => {
  for (const path of ["/", "/privacy", "/terms", "/support"]) {
    const { response, body } = await page(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html;\s*charset=utf-8/i);
    assert.match(body, /Incident Postmortem Checker|Privacy Policy|Terms of Service|Support/);
    assert.match(body, new RegExp(supportEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(body, /ChatGPT should use|When ChatGPT should use it/i);
  }

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "incident-postmortem-checker", version: "1.0.0" });

  const challenge = await fetch(`${baseUrl}/.well-known/openai-apps-challenge`);
  assert.equal(challenge.status, 200);
  assert.match(challenge.headers.get("content-type") ?? "", /^text\/plain;\s*charset=utf-8/i);
  assert.equal(await challenge.text(), "test");
});

addCase("production routes", "GET /mcp and unknown route preserve expected status", async () => {
  const getMcp = await fetch(mcpUrl);
  assert.equal(getMcp.status, 405);
  assert.deepEqual(await getMcp.json(), { error: "method_not_allowed", message: "POST /mcp is required." });

  const missing = await fetch(`${baseUrl}/missing-page`);
  assert.equal(missing.status, 404);
});

addCase("production mcp", "initialize returns expected server identity", async () => {
  const response = await rpc("initialize", {}, "prod-init");
  assert.equal(response.id, "prod-init");
  assert.equal(response.result.serverInfo.name, "incident-postmortem-checker");
  assert.equal(response.result.serverInfo.version, "1.0.0");
  assert.deepEqual(response.result.capabilities.tools, {});
});

addCase("production mcp", "tools/list returns exactly the frozen tool names", async () => {
  const response = await rpc("tools/list", {});
  assert.deepEqual(response.result.tools.map((tool) => tool.name), frozenTools);
  for (const tool of response.result.tools) {
    for (const key of ["name", "title", "description", "inputSchema", "outputSchema", "annotations"]) assert.ok(key in tool);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
  }
});

addCase("production mcp", "positive tools/call returns structured timeline content", async () => {
  const response = await rpc("tools/call", {
    name: "extract_incident_timeline",
    arguments: {
      incident_text: "2026-07-18 08:45 UTC - Alerting detected elevated checkout errors.\nImpact: Customers experienced failed checkout attempts.",
      source_label: "production-regression"
    }
  });
  const data = response.result.structuredContent;
  assert.equal(data.status, "success");
  assert.equal(data.source_label, "production-regression");
  assert.equal(data.events.length, 1);
  assert.equal(data.impact_statements.length, 1);
  assert.deepEqual(data.errors, []);
});

addCase("production mcp", "missing input and out_of_scope return structured errors", async () => {
  const missing = await rpc("tools/call", { name: "extract_incident_timeline", arguments: {} });
  assert.equal(missing.result.structuredContent.status, "error");
  assertErrorShape(missing.result.structuredContent.errors[0], "missing_required_input", "incident_text");

  const outOfScope = await rpc("tools/call", {
    name: "extract_postmortem_actions",
    arguments: { postmortem_text: "Notify every action owner." }
  });
  assert.equal(outOfScope.result.structuredContent.status, "error");
  assertErrorShape(outOfScope.result.structuredContent.errors[0], "out_of_scope", "");
});

addCase("production mcp", "unknown tool and unknown method return stable errors", async () => {
  const unknownTool = await rpc("tools/call", { name: "unknown_tool", arguments: {} });
  assert.equal(unknownTool.result.structuredContent.status, "error");
  assertErrorShape(unknownTool.result.structuredContent.errors[0], "unknown_tool", "name");

  const unknownMethod = await rpc("unknown/method", {});
  assert.equal(unknownMethod.error.code, -32601);
  assert.equal(unknownMethod.error.data.structuredContent.errors[0].code, "unknown_method");
});

const results = [];
try {
  for (const testCase of cases) {
    try {
      await testCase.fn();
      results.push({ ...testCase, ok: true });
    } catch (error) {
      results.push({ ...testCase, ok: false, error });
      throw error;
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  const passed = results.filter((result) => result.ok).length;
  console.log(`Production MCP Test Groups: ${groups.size}`);
  console.log(`Production MCP Total Cases: ${cases.length}`);
  console.log(`Production MCP Passed Cases: ${passed}`);
  console.log(`Production MCP Failed Cases: ${cases.length - passed}`);
  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} [${result.group}] ${result.name}`);
}
