import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const baseUrl = "http://127.0.0.1:8787";
const groups = new Map();
const cases = [];
const wranglerBin = "node";
const wranglerArgs = ["node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--port", "8787"];
const supportEmail = "sidcraigau@gmail.com";
const forbiddenPhrases = [/ChatGPT should use/i, /When ChatGPT should use it/i];
const frozenTools = ["extract_incident_timeline", "extract_postmortem_actions", "check_postmortem_completeness"];
const pageFiles = [
  { path: "src/pages/home.html", route: "/", title: "Incident Postmortem Checker", sections: ["What this app does", "When to use this app", "What input it accepts", "What output it returns", "Available tools", "MCP endpoint", "What this app does not do", "Data handling", "Support"] },
  { path: "src/pages/privacy.html", route: "/privacy", title: "Privacy Policy", sections: ["Data collected", "How input is used", "How output is generated", "Retention", "External sharing", "External API policy", "Account and login policy", "User controls", "Read-only boundary", "Contact", "Last updated"] },
  { path: "src/pages/terms.html", route: "/terms", title: "Terms of Service", sections: ["Service description", "Allowed use", "User responsibility", "Limitations", "No external execution", "No professional advice", "No destructive actions", "No guarantees", "Prohibited use", "Changes to service", "Contact", "Last updated"] },
  { path: "src/pages/support.html", route: "/support", title: "Support", sections: ["Support email", "What to include", "Sensitive information warning", "Support scope", "Non-support scope", "Data and privacy questions", "App boundary reminder", "Available tools"] }
];

function addCase(group, name, fn) {
  groups.set(group, true);
  cases.push({ group, name, fn });
}

function readPageFile(filePath) {
  assert.equal(existsSync(filePath), true, `${filePath} should exist`);
  return readFileSync(filePath, "utf8");
}

function assertIncludesAll(body, expectedItems) {
  for (const item of expectedItems) assert.match(body, new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

function navigationLabels(body) {
  const nav = body.match(/<nav aria-label="Primary">([\s\S]*?)<\/nav>/)?.[1] ?? "";
  return [...nav.matchAll(/<a href="[^"]+"(?: aria-current="page")?>(Home|Privacy|Terms|Support)<\/a>/g)].map((match) => match[1]);
}

function startWorker() {
  const child = spawn(wranglerBin, wranglerArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  return { child, getOutput: () => output };
}

async function waitForHealth() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Worker did not become healthy.");
}

async function rpc(method, params, id = `${method}-id`) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function rawMcp(body) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function callTool(name, args, extraParams = {}) {
  const response = await rpc("tools/call", { name, arguments: args, ...extraParams });
  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.result);
  assert.ok(response.result.structuredContent);
  return response.result.structuredContent;
}

async function callToolWithoutArguments(name) {
  const response = await rpc("tools/call", { name });
  return response.result.structuredContent;
}

function keys(value) {
  return Object.keys(value).sort();
}

function assertNoExtraKeys(value, expected) {
  assert.deepEqual(keys(value), [...expected].sort());
}

function assertErrorShape(error, code, field) {
  assertNoExtraKeys(error, ["code", "message", "field"]);
  assert.equal(error.code, code);
  assert.equal(typeof error.message, "string");
  assert.ok(error.message.length > 0);
  assert.equal(error.field, field);
}

function assertTimelineSchema(value) {
  assertNoExtraKeys(value, ["status", "events", "impact_statements", "source_label", "errors"]);
  assert.ok(value.status === "success" || value.status === "error");
  assert.ok(Array.isArray(value.events));
  assert.ok(Array.isArray(value.impact_statements));
  assert.equal(typeof value.source_label, "string");
  assert.ok(Array.isArray(value.errors));
  for (const event of value.events) {
    assertNoExtraKeys(event, ["timestamp", "event", "evidence"]);
    assert.equal(typeof event.timestamp, "string");
    assert.equal(typeof event.event, "string");
    assert.equal(typeof event.evidence, "string");
  }
}

function assertActionsSchema(value) {
  assertNoExtraKeys(value, ["status", "actions", "source_label", "errors"]);
  assert.ok(value.status === "success" || value.status === "error");
  assert.ok(Array.isArray(value.actions));
  assert.equal(typeof value.source_label, "string");
  assert.ok(Array.isArray(value.errors));
  for (const action of value.actions) {
    assertNoExtraKeys(action, ["action", "owner", "due_date", "evidence"]);
    assert.equal(typeof action.action, "string");
    assert.equal(typeof action.owner, "string");
    assert.equal(typeof action.due_date, "string");
    assert.equal(typeof action.evidence, "string");
  }
}

function assertCompletenessSchema(value) {
  assertNoExtraKeys(value, ["status", "is_complete", "checked_items", "present_items", "missing_items", "source_label", "errors"]);
  assert.ok(value.status === "success" || value.status === "error");
  assert.equal(typeof value.is_complete, "boolean");
  assert.ok(Array.isArray(value.checked_items));
  assert.ok(Array.isArray(value.present_items));
  assert.ok(Array.isArray(value.missing_items));
  assert.equal(typeof value.source_label, "string");
  assert.ok(Array.isArray(value.errors));
  for (const item of value.checked_items) {
    assertNoExtraKeys(item, ["requirement", "coverage_status", "evidence"]);
    assert.equal(typeof item.requirement, "string");
    assert.ok(item.coverage_status === "present" || item.coverage_status === "missing");
    assert.equal(typeof item.evidence, "string");
  }
  for (const item of value.present_items) assert.equal(typeof item, "string");
  for (const item of value.missing_items) assert.equal(typeof item, "string");
}

function assertToolError(value, schemaAssert, code, field) {
  schemaAssert(value);
  assert.equal(value.status, "error");
  assert.equal(value.errors.length, 1);
  assertErrorShape(value.errors[0], code, field);
}

const timelineText = `Source: Northstar Checkout Incident

2026-07-18 09:20 UTC - The team disabled the faulty cache rule.
2026-07-18 08:45 UTC - Alerting detected elevated checkout errors.
2026-07-18 09:05 UTC - The incident commander declared an incident.
2026-07-18 09:40 UTC - Checkout error rates returned to normal.

Impact: Customers experienced failed checkout attempts between 08:42 and 09:38 UTC.`;

const timelineNoTimeText = `Timeline:
The alerting service detected elevated checkout errors.
The incident commander opened the incident bridge.
The team disabled the faulty cache rule.
Checkout error rates returned to normal.`;

const timelineMaterialWithOperationalWords = `Timeline:
09:10 UTC - The team updated the cache rule.
09:15 UTC - The logs showed elevated latency.
09:20 UTC - The monitoring system generated an alert.
09:25 UTC - The team sent a customer notification.`;

const actionsText = `Postmortem: Northstar Checkout Incident

Follow-up actions:
- Add cache-rule validation to the deployment pipeline. Owner: Maya. Due: 2026-08-01.
- Document the rollback procedure. Due: 2026-08-05.
- Review alert thresholds. Owner: Operations Team.`;

const completenessText = `Postmortem: Northstar Checkout Incident

Impact:
Customers experienced failed checkout attempts for 56 minutes.

Timeline:
08:45 UTC - Alerting detected elevated checkout errors.
09:20 UTC - The faulty cache rule was disabled.

Follow-up actions:
- Add cache-rule validation to the deployment pipeline. Owner: Maya. Due: 2026-08-01.`;

for (const page of pageFiles) {
  addCase("page files", `${page.path} exists and is a complete HTML document`, async () => {
    const body = readPageFile(page.path);
    assert.match(body, /^<!doctype html>/i);
    assert.match(body, /<html lang="en">/);
    assert.match(body, /<meta charset="utf-8">/);
    assert.match(body, /<meta name="description" content="[^"]+">/);
    assert.match(body, new RegExp(`<title>[^<]*${page.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(body, /<main>/);
    assert.match(body, /<section>/);
    assertIncludesAll(body, ["Incident Postmortem Checker", supportEmail]);
    assert.deepEqual(navigationLabels(body), ["Home", "Privacy", "Terms", "Support"]);
  });

  addCase("page content", `${page.title} contains required sections`, async () => {
    const body = readPageFile(page.path);
    assertIncludesAll(body, page.sections);
  });

  addCase("page safety", `${page.path} excludes forbidden phrases and false execution claims`, async () => {
    const body = readPageFile(page.path);
    for (const phrase of forbiddenPhrases) assert.doesNotMatch(body, phrase);
    assert.doesNotMatch(body, /approved by OpenAI|auto(?:matically)? monitors incidents|auto(?:matically)? contacts teams|auto(?:matically)? updates tickets|auto(?:matically)? executes fixes/i);
  });
}

addCase("page content", "home page contains endpoint, tools, data handling, and support", async () => {
  const body = readPageFile("src/pages/home.html");
  assertIncludesAll(body, [
    "Organizes explicitly stated incident timelines and follow-up actions, and checks postmortem completeness using only the material supplied by the user.",
    "POST /mcp",
    "Data handling",
    "Support",
    ...frozenTools
  ]);
});

addCase("page content", "support page contains mailto link and sensitive information warning", async () => {
  const body = readPageFile("src/pages/support.html");
  assert.match(body, new RegExp(`mailto:${supportEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(body, /Do not send passwords, API keys, access tokens, or unrelated sensitive information\./);
});

addCase("page consistency", "all page files use consistent app name, email, navigation, and tool spelling", async () => {
  for (const page of pageFiles) {
    const body = readPageFile(page.path);
    assert.match(body, /Incident Postmortem Checker/);
    assert.match(body, new RegExp(supportEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(navigationLabels(body), ["Home", "Privacy", "Terms", "Support"]);
  }
  const allPages = pageFiles.map((page) => readPageFile(page.path)).join("\n");
  for (const tool of frozenTools) assert.match(allPages, new RegExp(tool, "g"));
  assert.doesNotMatch(allPages, /assigns tasks|contacts action owners|updates incident systems|runs remediation commands/i);
});

addCase("page safety", "README and independent HTML files exclude forbidden phrases", async () => {
  const bodies = [readFileSync("README.md", "utf8"), ...pageFiles.map((page) => readPageFile(page.path))];
  for (const body of bodies) {
    for (const phrase of forbiddenPhrases) assert.doesNotMatch(body, phrase);
  }
});

addCase("routes", "GET / returns the app page", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Incident Postmortem Checker/);
  assert.match(body, /What this app does/);
});

for (const [path, expectedText] of [
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Service"],
  ["/support", "Support Email:"]
]) {
  addCase("routes", `GET ${path} returns review shell page`, async () => {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(body, /chatgpt should use/i);
  });
}

addCase("routes", "GET /mcp returns method not allowed", async () => {
  const response = await fetch(`${baseUrl}/mcp`);
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "method_not_allowed", message: "POST /mcp is required." });
});

addCase("routes", "GET challenge returns exact plain text test token", async () => {
  const response = await fetch(`${baseUrl}/.well-known/openai-apps-challenge`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain;\s*charset=utf-8/i);
  assert.equal(await response.text(), "test");
});

addCase("routes", "unknown page returns 404", async () => {
  const response = await fetch(`${baseUrl}/missing-page`);
  assert.equal(response.status, 404);
});

addCase("routes", "review pages do not include forbidden phrase", async () => {
  for (const path of ["/", "/privacy", "/terms", "/support"]) {
    const response = await fetch(`${baseUrl}${path}`);
    const body = await response.text();
    assert.doesNotMatch(body, /chatgpt should use/i);
  }
});

addCase("routes", "GET /health returns stable service status", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.deepEqual(await response.json(), { status: "ok", service: "incident-postmortem-checker", version: "1.0.0" });
});

addCase("mcp", "initialize preserves request id and exposes tool capability", async () => {
  const response = await rpc("initialize", {}, "init-123");
  assert.equal(response.id, "init-123");
  assert.equal(response.result.serverInfo.name, "incident-postmortem-checker");
  assert.equal(response.result.serverInfo.version, "1.0.0");
  assert.ok(response.result.protocolVersion);
  assert.deepEqual(response.result.capabilities.tools, {});
});

addCase("mcp", "tools/list returns exactly the frozen three tool contracts", async () => {
  const response = await rpc("tools/list", {});
  const names = response.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, ["extract_incident_timeline", "extract_postmortem_actions", "check_postmortem_completeness"]);
  for (const tool of response.result.tools) {
    for (const key of ["name", "title", "description", "inputSchema", "outputSchema", "annotations"]) assert.ok(key in tool);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
  }
  const completeness = response.result.tools.find((tool) => tool.name === "check_postmortem_completeness");
  assert.ok(completeness.outputSchema.required.includes("checked_items"));
  assert.equal(completeness.outputSchema.properties.present_items.items.type, "string");
  assert.equal(completeness.outputSchema.properties.missing_items.items.type, "string");
});

addCase("timeline", "sorts mixed timestamp events chronologically", async () => {
  const data = await callTool("extract_incident_timeline", { incident_text: timelineText, source_label: "Northstar" });
  assertTimelineSchema(data);
  assert.equal(data.status, "success");
  assert.deepEqual(data.events.map((event) => event.timestamp), ["2026-07-18 08:45 UTC", "2026-07-18 09:05 UTC", "2026-07-18 09:20 UTC", "2026-07-18 09:40 UTC"]);
});

addCase("timeline", "extracts explicit impact statements", async () => {
  const data = await callTool("extract_incident_timeline", { incident_text: timelineText });
  assertTimelineSchema(data);
  assert.equal(data.impact_statements.length, 1);
  assert.match(data.impact_statements[0], /failed checkout attempts/);
});

addCase("timeline", "keeps no-time explicit events", async () => {
  const data = await callTool("extract_incident_timeline", { incident_text: timelineNoTimeText });
  assertTimelineSchema(data);
  assert.equal(data.events.length, 4);
  assert.deepEqual(data.events.map((event) => event.timestamp), ["", "", "", ""]);
});

addCase("timeline", "keeps no-time explicit events in source order", async () => {
  const data = await callTool("extract_incident_timeline", { incident_text: timelineNoTimeText });
  assert.deepEqual(data.events.map((event) => event.event), [
    "The alerting service detected elevated checkout errors.",
    "The incident commander opened the incident bridge.",
    "The team disabled the faulty cache rule.",
    "Checkout error rates returned to normal."
  ]);
});

for (const [word, text] of [
  ["updated", "09:20 UTC - The team updated the cache rule."],
  ["logs", "09:20 UTC - The logs showed elevated latency."],
  ["monitoring", "09:20 UTC - The monitoring system generated an alert."],
  ["notification", "09:20 UTC - The team sent a customer notification."]
]) {
  addCase("timeline", `does not reject material statement containing ${word}`, async () => {
    const data = await callTool("extract_incident_timeline", { incident_text: text });
    assertTimelineSchema(data);
    assert.equal(data.status, "success");
    assert.equal(data.events.length, 1);
  });
}

for (const [name, args, code, field] of [
  ["missing incident_text", {}, "missing_required_input", "incident_text"],
  ["incident_text wrong type", { incident_text: 42 }, "invalid_input_type", "incident_text"],
  ["incident_text empty string", { incident_text: "" }, "empty_input", "incident_text"],
  ["incident_text whitespace", { incident_text: "   " }, "empty_input", "incident_text"],
  ["infer root cause request", { incident_text: "Infer the root cause from this incident." }, "out_of_scope", ""],
  ["determine responsibility request", { incident_text: "Determine which team is responsible." }, "out_of_scope", ""],
  ["access monitoring request", { incident_text: "Access the monitoring system and retrieve the logs." }, "out_of_scope", ""],
  ["execute remediation request", { incident_text: "Execute the remediation now." }, "out_of_scope", ""],
  ["extra field", { incident_text: "09:20 UTC - Service recovered.", extra: true }, "invalid_input_type", "extra"],
  ["arguments null", null, "invalid_input_type", ""],
  ["arguments array", [], "invalid_input_type", ""],
  ["arguments string", "bad", "invalid_input_type", ""]
]) {
  addCase("timeline errors", name, async () => {
    const data = await callTool("extract_incident_timeline", args);
    assertToolError(data, assertTimelineSchema, code, field);
  });
}

addCase("timeline errors", "arguments missing", async () => {
  const data = await callToolWithoutArguments("extract_incident_timeline");
  assertToolError(data, assertTimelineSchema, "invalid_input_type", "");
});

addCase("actions", "extracts actions with owners and deadlines", async () => {
  const data = await callTool("extract_postmortem_actions", { postmortem_text: actionsText });
  assertActionsSchema(data);
  assert.equal(data.status, "success");
  assert.equal(data.actions.length, 3);
  assert.equal(data.actions[0].owner, "Maya");
  assert.equal(data.actions[0].due_date, "2026-08-01");
});

addCase("actions", "missing owner remains empty", async () => {
  const data = await callTool("extract_postmortem_actions", { postmortem_text: actionsText });
  assert.equal(data.actions[1].owner, "");
});

addCase("actions", "missing due date remains empty", async () => {
  const data = await callTool("extract_postmortem_actions", { postmortem_text: actionsText });
  assert.equal(data.actions[2].due_date, "");
});

addCase("actions", "ordinary incident event is not an action", async () => {
  const data = await callTool("extract_postmortem_actions", { postmortem_text: "09:20 UTC - The team updated the cache rule." });
  assertActionsSchema(data);
  assert.equal(data.status, "success");
  assert.equal(data.actions.length, 0);
});

for (const [name, text] of [
  ["timeline bullet commands", "Timeline:\n- Update the cache rule.\n- Remove the temporary routing rule.\n- Investigate the latency spike."],
  ["mitigation bullet commands", "Mitigation:\n- Disable the faulty cache rule.\n- Redirect traffic to the stable region."],
  ["resolution events", "Resolution:\n- Update the cache rule.\n- Remove the temporary routing rule."]
]) {
  addCase("actions", `${name} are not follow-up actions`, async () => {
    const data = await callTool("extract_postmortem_actions", { postmortem_text: text });
    assertActionsSchema(data);
    assert.equal(data.status, "success");
    assert.deepEqual(data.actions, []);
  });
}

for (const [name, text] of [
  ["timeline will sentence with owner and due", "Timeline:\n- The team will review the alert configuration. Owner: Operations Team. Due: 2026-08-05."],
  ["mitigation will sentence with owner and due", "Mitigation:\n- The platform team will update the cache rule. Owner: Platform Team. Due: 2026-08-05."],
  ["resolution must sentence with due and owner", "Resolution:\n- The platform team must replace the temporary rule. Due: 2026-08-05. Owner: Platform Team."]
]) {
  addCase("actions", `${name} is excluded by incident section priority`, async () => {
    const data = await callTool("extract_postmortem_actions", { postmortem_text: text });
    assertActionsSchema(data);
    assert.equal(data.status, "success");
    assert.deepEqual(data.actions, []);
  });
}

for (const [name, text] of [
  ["explicit follow-up section", "Follow-up actions:\n- Review alert thresholds. Owner: Operations Team. Due: 2026-08-05."],
  ["Action marker", "Action: Review alert thresholds. Owner: Operations Team. Due: 2026-08-05."],
  ["TODO marker", "TODO: Add a cache-rule validation check. Owner: Maya. Due: 2026-08-05."]
]) {
  addCase("actions", `${name} is extracted`, async () => {
    const data = await callTool("extract_postmortem_actions", { postmortem_text: text });
    assertActionsSchema(data);
    assert.equal(data.status, "success");
    assert.equal(data.actions.length, 1);
  });
}

addCase("actions", "due before owner is extracted from the same action", async () => {
  const data = await callTool("extract_postmortem_actions", {
    postmortem_text: "Follow-up actions:\n- Review alert thresholds. Due: 2026-08-05. Owner: Operations Team."
  });
  assertActionsSchema(data);
  assert.equal(data.actions.length, 1);
  assert.equal(data.actions[0].owner, "Operations Team");
  assert.equal(data.actions[0].due_date, "2026-08-05");
});

addCase("actions", "owner and due are not borrowed from neighboring actions", async () => {
  const data = await callTool("extract_postmortem_actions", {
    postmortem_text: "Follow-up actions:\n- Review alert thresholds. Owner: Operations Team.\n- Document rollback steps. Due: 2026-08-05."
  });
  assertActionsSchema(data);
  assert.equal(data.actions.length, 2);
  assert.equal(data.actions[0].owner, "Operations Team");
  assert.equal(data.actions[0].due_date, "");
  assert.equal(data.actions[1].owner, "");
  assert.equal(data.actions[1].due_date, "2026-08-05");
});

for (const [name, text] of [
  ["already created ticket material", "The team created a Jira ticket during the incident."],
  ["already notified owner material", "The incident commander notified the service owner."],
  ["already reviewed logs and updated rule material", "The team reviewed the logs and updated the rule."]
]) {
  addCase("actions", `does not extract ${name}`, async () => {
    const data = await callTool("extract_postmortem_actions", { postmortem_text: text });
    assertActionsSchema(data);
    assert.equal(data.status, "success");
    assert.deepEqual(data.actions, []);
  });
}

for (const [name, args, code, field] of [
  ["missing postmortem_text", {}, "missing_required_input", "postmortem_text"],
  ["postmortem_text wrong type", { postmortem_text: 42 }, "invalid_input_type", "postmortem_text"],
  ["postmortem_text empty string", { postmortem_text: "" }, "empty_input", "postmortem_text"],
  ["postmortem_text whitespace", { postmortem_text: "   " }, "empty_input", "postmortem_text"],
  ["create Jira request", { postmortem_text: "Create Jira tickets for each action." }, "out_of_scope", ""],
  ["notify owners request", { postmortem_text: "Notify every action owner." }, "out_of_scope", ""],
  ["extra field", { postmortem_text: "Review alert thresholds.", extra: true }, "invalid_input_type", "extra"],
  ["arguments null", null, "invalid_input_type", ""],
  ["arguments array", [], "invalid_input_type", ""],
  ["arguments string", "bad", "invalid_input_type", ""]
]) {
  addCase("actions errors", name, async () => {
    const data = await callTool("extract_postmortem_actions", args);
    assertToolError(data, assertActionsSchema, code, field);
  });
}

addCase("actions errors", "arguments missing", async () => {
  const data = await callToolWithoutArguments("extract_postmortem_actions");
  assertToolError(data, assertActionsSchema, "invalid_input_type", "");
});

addCase("completeness", "all requirements present sets is_complete true", async () => {
  const text = `${completenessText}\nRoot Cause: A malformed cache rule bypassed validation.`;
  const data = await callTool("check_postmortem_completeness", {
    postmortem_text: text,
    required_items: ["Impact statement", "Incident timeline", "Root cause", "Follow-up actions with owners and deadlines"]
  });
  assertCompletenessSchema(data);
  assert.equal(data.is_complete, true);
  assert.deepEqual(data.missing_items, []);
});

addCase("completeness", "partial requirements missing sets is_complete false", async () => {
  const data = await callTool("check_postmortem_completeness", {
    postmortem_text: completenessText,
    required_items: ["Impact statement", "Incident timeline", "Root cause", "Follow-up actions with owners and deadlines"]
  });
  assertCompletenessSchema(data);
  assert.equal(data.is_complete, false);
  assert.deepEqual(data.missing_items, ["Root cause"]);
});

addCase("completeness", "all requirements missing", async () => {
  const data = await callTool("check_postmortem_completeness", {
    postmortem_text: "Summary: The review is pending.",
    required_items: ["Impact statement", "Incident timeline", "Root cause"]
  });
  assert.deepEqual(data.present_items, []);
  assert.deepEqual(data.missing_items, ["Impact statement", "Incident timeline", "Root cause"]);
});

addCase("completeness", "near semantic match without explicit evidence is missing", async () => {
  const data = await callTool("check_postmortem_completeness", {
    postmortem_text: "Customers had a rough morning and the team talked through follow ups.",
    required_items: ["Impact statement", "Follow-up actions with owners and deadlines"]
  });
  assert.deepEqual(data.missing_items, ["Impact statement", "Follow-up actions with owners and deadlines"]);
});

addCase("completeness", "faulty cache phrase does not imply root cause", async () => {
  const data = await callTool("check_postmortem_completeness", {
    postmortem_text: "09:20 UTC - The faulty cache rule was disabled.",
    required_items: ["Root cause"]
  });
  assert.deepEqual(data.missing_items, ["Root cause"]);
});

addCase("completeness", "explicit root cause is present", async () => {
  const data = await callTool("check_postmortem_completeness", {
    postmortem_text: "Root Cause: A malformed cache rule bypassed validation.",
    required_items: ["Root cause"]
  });
  assert.deepEqual(data.present_items, ["Root cause"]);
});

for (const [name, text] of [
  ["timeline owner due row", "Timeline:\n- Review the alert configuration. Owner: Operations Team. Due: 2026-08-05."],
  ["mitigation owner due row", "Mitigation:\n- Update the cache rule. Owner: Platform Team. Due: 2026-08-05."],
  ["resolution due owner row", "Resolution:\n- Replace the temporary routing rule. Due: 2026-08-05. Owner: Platform Team."]
]) {
  addCase("completeness", `${name} is not follow-up action evidence`, async () => {
    const data = await callTool("check_postmortem_completeness", {
      postmortem_text: text,
      required_items: ["Follow-up actions with owners and deadlines"]
    });
    assertCompletenessSchema(data);
    assert.deepEqual(data.missing_items, ["Follow-up actions with owners and deadlines"]);
    assert.equal(data.checked_items[0].coverage_status, "missing");
    assert.equal(data.checked_items[0].evidence, "");
  });
}

for (const [name, text] of [
  ["timeline will sentence with owner and due", "Timeline:\n- The team will review the alert configuration. Owner: Operations Team. Due: 2026-08-05."],
  ["mitigation will sentence with owner and due", "Mitigation:\n- The platform team will update the cache rule. Owner: Platform Team. Due: 2026-08-05."],
  ["resolution must sentence with due and owner", "Resolution:\n- The platform team must replace the temporary rule. Due: 2026-08-05. Owner: Platform Team."]
]) {
  addCase("completeness", `${name} is not follow-up action evidence`, async () => {
    const data = await callTool("check_postmortem_completeness", {
      postmortem_text: text,
      required_items: ["Follow-up actions with owners and deadlines"]
    });
    assertCompletenessSchema(data);
    assert.equal(data.checked_items.length, 1);
    assert.equal(data.checked_items[0].requirement, "Follow-up actions with owners and deadlines");
    assert.equal(data.checked_items[0].coverage_status, "missing");
    assert.equal(data.checked_items[0].evidence, "");
    assert.deepEqual(data.missing_items, ["Follow-up actions with owners and deadlines"]);
  });
}

for (const [name, text] of [
  ["owner and due present on same action", "- Review alert thresholds. Owner: Operations Team. Due: 2026-08-05."],
  ["only owner missing due", "- Review alert thresholds. Owner: Operations Team."],
  ["only due missing owner", "- Review alert thresholds. Due: 2026-08-05."],
  ["owner and due on different actions", "- Review alert thresholds. Owner: Operations Team.\n- Document rollback. Due: 2026-08-05."]
]) {
  addCase("completeness", `follow-up coverage: ${name}`, async () => {
    const data = await callTool("check_postmortem_completeness", {
      postmortem_text: `Follow-up actions:\n${text}`,
      required_items: ["Follow-up actions with owners and deadlines"]
    });
    if (name === "owner and due present on same action") {
      assert.deepEqual(data.present_items, ["Follow-up actions with owners and deadlines"]);
    } else {
      assert.deepEqual(data.missing_items, ["Follow-up actions with owners and deadlines"]);
      assert.equal(data.checked_items[0].evidence, "");
    }
  });
}

addCase("completeness", "checked_items is complete and input ordered", async () => {
  const required_items = ["Incident timeline", "Impact statement", "Root cause"];
  const data = await callTool("check_postmortem_completeness", {
    postmortem_text: `${completenessText}\nRoot Cause: A malformed cache rule bypassed validation.`,
    required_items
  });
  assert.deepEqual(data.checked_items.map((item) => item.requirement), required_items);
});

addCase("completeness", "present_items and missing_items are original strings", async () => {
  const data = await callTool("check_postmortem_completeness", {
    postmortem_text: completenessText,
    required_items: ["Impact statement", "Root cause"]
  });
  assert.deepEqual(data.present_items, ["Impact statement"]);
  assert.deepEqual(data.missing_items, ["Root cause"]);
});

for (const [name, text, requirement] of [
  ["empty Impact heading", "Impact:", "Impact statement"],
  ["empty Timeline heading", "Timeline:", "Incident timeline"],
  ["empty Impact followed by Timeline does not borrow evidence", "Impact:\n\nTimeline:\n09:10 UTC - An alert fired.", "Impact statement"],
  ["empty Timeline followed by Root Cause does not borrow evidence", "Timeline:\n\nRoot Cause: A cache rule was misconfigured.", "Incident timeline"],
  ["Root Cause not yet determined", "Root Cause: Not yet determined.", "Root cause"],
  ["Root Cause under investigation", "Root Cause: Under investigation.", "Root cause"],
  ["Root Cause unknown", "Root Cause: Unknown.", "Root cause"]
]) {
  addCase("completeness", `${name} is missing`, async () => {
    const data = await callTool("check_postmortem_completeness", { postmortem_text: text, required_items: [requirement] });
    assertCompletenessSchema(data);
    assert.deepEqual(data.missing_items, [requirement]);
    assert.equal(data.checked_items[0].evidence, "");
  });
}

for (const [name, text, requirement] of [
  ["Impact same-line content", "Impact: Checkout failed for approximately 20% of requests.", "Impact statement"],
  ["Impact body content", "Impact:\nCheckout failed for approximately 20% of requests.", "Impact statement"],
  ["Timeline same-line content", "Timeline: 09:10 UTC - An alert fired.", "Incident timeline"],
  ["Timeline body event", "Timeline:\n09:10 UTC - An alert fired.", "Incident timeline"]
]) {
  addCase("completeness", `${name} is present with real evidence`, async () => {
    const data = await callTool("check_postmortem_completeness", { postmortem_text: text, required_items: [requirement] });
    assertCompletenessSchema(data);
    assert.deepEqual(data.present_items, [requirement]);
    assert.notEqual(data.checked_items[0].evidence, "");
    assert.notEqual(data.checked_items[0].evidence, "Impact:");
    assert.notEqual(data.checked_items[0].evidence, "Timeline:");
  });
}

addCase("completeness", "follow-up coverage accepts due before owner on same action", async () => {
  const data = await callTool("check_postmortem_completeness", {
    postmortem_text: "Follow-up actions:\n- Review alert thresholds. Due: 2026-08-05. Owner: Operations Team.",
    required_items: ["Follow-up actions with owners and deadlines"]
  });
  assert.deepEqual(data.present_items, ["Follow-up actions with owners and deadlines"]);
});

for (const [name, text] of [
  ["Action marker", "Action: Review alert thresholds. Owner: Operations Team. Due: 2026-08-05."],
  ["TODO marker due before owner", "TODO: Add cache validation. Due: 2026-08-05. Owner: Platform Team."],
  ["Follow-up marker", "Follow-up: Document rollback steps. Owner: Operations Team. Due: 2026-08-05."]
]) {
  addCase("completeness", `${name} is follow-up action evidence`, async () => {
    const data = await callTool("check_postmortem_completeness", {
      postmortem_text: text,
      required_items: ["Follow-up actions with owners and deadlines"]
    });
    assertCompletenessSchema(data);
    assert.deepEqual(data.present_items, ["Follow-up actions with owners and deadlines"]);
    assert.notEqual(data.checked_items[0].evidence, "");
  });
}

for (const [name, args, code, field] of [
  ["missing postmortem_text", { required_items: ["Impact statement"] }, "missing_required_input", "postmortem_text"],
  ["missing required_items", { postmortem_text: "Impact: Users were affected." }, "missing_required_input", "required_items"],
  ["postmortem_text wrong type", { postmortem_text: 42, required_items: ["Impact statement"] }, "invalid_input_type", "postmortem_text"],
  ["required_items not array", { postmortem_text: "ok", required_items: "Impact statement" }, "invalid_input_type", "required_items"],
  ["required_items item wrong type", { postmortem_text: "ok", required_items: [42] }, "invalid_input_type", "required_items"],
  ["postmortem_text empty", { postmortem_text: "", required_items: ["Impact statement"] }, "empty_input", "postmortem_text"],
  ["required_items empty", { postmortem_text: "ok", required_items: [] }, "empty_input", "required_items"],
  ["required_items contains blank", { postmortem_text: "ok", required_items: [""] }, "empty_input", "required_items"],
  ["create criteria request", { postmortem_text: "Create a checklist for this review.", required_items: ["Impact statement"] }, "out_of_scope", ""],
  ["approve postmortem request", { postmortem_text: "Approve this postmortem.", required_items: ["Impact statement"] }, "out_of_scope", ""],
  ["execute fix request", { postmortem_text: "Execute the remediation now.", required_items: ["Impact statement"] }, "out_of_scope", ""],
  ["extra field", { postmortem_text: "ok", required_items: ["Impact statement"], extra: true }, "invalid_input_type", "extra"],
  ["arguments null", null, "invalid_input_type", ""],
  ["arguments array", [], "invalid_input_type", ""],
  ["arguments string", "bad", "invalid_input_type", ""]
]) {
  addCase("completeness errors", name, async () => {
    const data = await callTool("check_postmortem_completeness", args);
    assertToolError(data, assertCompletenessSchema, code, field);
  });
}

addCase("completeness errors", "arguments missing", async () => {
  const data = await callToolWithoutArguments("check_postmortem_completeness");
  assertToolError(data, assertCompletenessSchema, "invalid_input_type", "");
});

addCase("protocol", "unknown tool uses separate stable protocol wrapper", async () => {
  const data = await callTool("unknown_tool", {});
  assertNoExtraKeys(data, ["status", "errors"]);
  assert.equal(data.status, "error");
  assertErrorShape(data.errors[0], "unknown_tool", "name");
});

addCase("protocol", "unknown JSON-RPC method is JSON-RPC layer error", async () => {
  const response = await rpc("unknown/method", {});
  assert.equal(response.error.code, -32601);
  assert.equal(response.error.data.structuredContent.errors[0].code, "unknown_method");
});

addCase("protocol", "invalid JSON-RPC request object is rejected", async () => {
  const response = await rawMcp({ id: "bad", method: "initialize" });
  assert.equal(response.error.code, -32600);
});

addCase("protocol", "formal HTTP params cannot trigger internal_error with hidden flag", async () => {
  const response = await rpc("tools/call", { name: "extract_incident_timeline", arguments: { incident_text: "09:20 UTC - Service recovered." }, _simulate_internal_error: true });
  const data = response.result.structuredContent;
  assertTimelineSchema(data);
  assert.equal(data.status, "success");
  assert.equal(data.errors.length, 0);
  assert.doesNotMatch(JSON.stringify(data), /internal_error/);
});

addCase("protocol", "hidden flag inside tool arguments is rejected as additional input", async () => {
  const data = await callTool("extract_incident_timeline", { incident_text: "09:20 UTC - Service recovered.", _simulate_internal_error: true });
  assertToolError(data, assertTimelineSchema, "invalid_input_type", "_simulate_internal_error");
});

addCase("protocol", "material with operational words remains valid for all tools", async () => {
  const timeline = await callTool("extract_incident_timeline", { incident_text: timelineMaterialWithOperationalWords });
  assert.equal(timeline.status, "success");
  const actions = await callTool("extract_postmortem_actions", { postmortem_text: "The team created a ticket and notified the owner during the incident." });
  assert.equal(actions.status, "success");
  const completeness = await callTool("check_postmortem_completeness", {
    postmortem_text: "Root Cause: The monitoring system generated duplicate alerts after logs rotated.",
    required_items: ["Root cause"]
  });
  assert.equal(completeness.status, "success");
  assert.deepEqual(completeness.present_items, ["Root cause"]);
});

const worker = startWorker();
const results = [];

try {
  await waitForHealth();
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
  console.error(worker.getOutput());
  console.error(error);
  process.exitCode = 1;
} finally {
  const passed = results.filter((result) => result.ok).length;
  console.log(`Test Groups: ${groups.size}`);
  console.log(`Total Cases: ${cases.length}`);
  console.log(`Passed Cases: ${passed}`);
  console.log(`Failed Cases: ${cases.length - passed}`);
  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} [${result.group}] ${result.name}`);
  if (process.platform === "win32" && worker.child.pid) {
    spawn("taskkill", ["/pid", String(worker.child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    worker.child.kill();
  }
}
