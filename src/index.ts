import { renderHomePage, renderPrivacyPage, renderSupportPage, renderTermsPage } from "./pages/review";

const SERVICE_NAME = "incident-postmortem-checker";
const VERSION = "1.0.0";
const PROTOCOL_VERSION = "2024-11-05";
const CHALLENGE_TOKEN = "test";

type JsonRpcId = string | number | null;
type JsonObject = Record<string, unknown>;
type ToolName =
  | "extract_incident_timeline"
  | "extract_postmortem_actions"
  | "check_postmortem_completeness";

type ContractErrorCode =
  | "missing_required_input"
  | "invalid_input_type"
  | "empty_input"
  | "out_of_scope"
  | "internal_error";
type ContractError = { code: ContractErrorCode; message: string; field: string };

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true
};

const errorItemSchema = {
  type: "object",
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    field: { type: "string" }
  },
  required: ["code", "message", "field"],
  additionalProperties: false
};

const timelineOutputSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["success", "error"] },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp: { type: "string" },
          event: { type: "string" },
          evidence: { type: "string" }
        },
        required: ["timestamp", "event", "evidence"],
        additionalProperties: false
      }
    },
    impact_statements: { type: "array", items: { type: "string" } },
    source_label: { type: "string" },
    errors: { type: "array", items: errorItemSchema }
  },
  required: ["status", "events", "impact_statements", "source_label", "errors"],
  additionalProperties: false
};

const actionsOutputSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["success", "error"] },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string" },
          owner: { type: "string" },
          due_date: { type: "string" },
          evidence: { type: "string" }
        },
        required: ["action", "owner", "due_date", "evidence"],
        additionalProperties: false
      }
    },
    source_label: { type: "string" },
    errors: { type: "array", items: errorItemSchema }
  },
  required: ["status", "actions", "source_label", "errors"],
  additionalProperties: false
};

const completenessOutputSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["success", "error"] },
    is_complete: { type: "boolean" },
    checked_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          requirement: { type: "string" },
          coverage_status: { type: "string", enum: ["present", "missing"] },
          evidence: { type: "string" }
        },
        required: ["requirement", "coverage_status", "evidence"],
        additionalProperties: false
      }
    },
    present_items: { type: "array", items: { type: "string" } },
    missing_items: { type: "array", items: { type: "string" } },
    source_label: { type: "string" },
    errors: { type: "array", items: errorItemSchema }
  },
  required: ["status", "is_complete", "checked_items", "present_items", "missing_items", "source_label", "errors"],
  additionalProperties: false
};

const tools = [
  {
    name: "extract_incident_timeline",
    title: "Extract Incident Timeline",
    description:
      "Extracts explicitly stated incident events and impact statements from user-provided incident records, and returns the events in chronological order. It does not infer missing events, determine root cause, assign blame, or access external systems.",
    inputSchema: {
      type: "object",
      properties: {
        incident_text: {
          type: "string",
          description: "User-provided incident record or postmortem text."
        },
        source_label: {
          type: "string",
          description: "Optional label identifying the supplied source."
        }
      },
      required: [],
      additionalProperties: false
    },
    outputSchema: timelineOutputSchema,
    annotations
  },
  {
    name: "extract_postmortem_actions",
    title: "Extract Postmortem Actions",
    description:
      "Extracts explicitly stated follow-up actions, owners, deadlines, and supporting evidence from user-provided postmortem text. It does not invent missing owners or deadlines, assign tasks, contact people, or update tracking systems.",
    inputSchema: {
      type: "object",
      properties: {
        postmortem_text: {
          type: "string",
          description: "User-provided incident postmortem text."
        },
        source_label: {
          type: "string",
          description: "Optional label identifying the supplied source."
        }
      },
      required: [],
      additionalProperties: false
    },
    outputSchema: actionsOutputSchema,
    annotations
  },
  {
    name: "check_postmortem_completeness",
    title: "Check Postmortem Completeness",
    description:
      "Checks user-provided postmortem material against the user-provided required items and returns present items, missing items, and source evidence. It only checks explicitly stated content and does not judge incident quality, infer root cause, or approve the postmortem.",
    inputSchema: {
      type: "object",
      properties: {
        postmortem_text: {
          type: "string",
          description: "User-provided incident postmortem text."
        },
        required_items: {
          type: "array",
          items: { type: "string" },
          description: "Explicit checklist items supplied by the user."
        },
        source_label: {
          type: "string",
          description: "Optional label identifying the supplied source."
        }
      },
      required: [],
      additionalProperties: false
    },
    outputSchema: completenessOutputSchema,
    annotations
  }
] as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message, data } });
}

function textContent(message: string) {
  return [{ type: "text", text: message }];
}

function successToolResult<T extends JsonObject>(structuredContent: T) {
  return {
    content: textContent("Structured result returned in structuredContent."),
    structuredContent
  };
}

function errorToolResult<T extends JsonObject>(structuredContent: T) {
  return {
    isError: true,
    content: textContent("Validation or scope error returned in structuredContent."),
    structuredContent
  };
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateBaseArguments(
  args: unknown,
  allowedFields: string[],
  requiredStringFields: string[],
  requiredArrayFields: string[] = []
): ContractError[] {
  const errors: ContractError[] = [];
  if (!isPlainObject(args)) {
    errors.push({ code: "invalid_input_type", message: "arguments must be an object.", field: "" });
    return errors;
  }
  for (const key of Object.keys(args)) {
    if (!allowedFields.includes(key)) {
      errors.push({ code: "invalid_input_type", message: `Unexpected field: ${key}.`, field: key });
    }
  }
  for (const field of requiredStringFields) {
    if (!(field in args)) {
      errors.push({ code: "missing_required_input", message: `${field} is required.`, field });
    } else if (typeof args[field] !== "string") {
      errors.push({ code: "invalid_input_type", message: `${field} must be a string.`, field });
    } else if ((args[field] as string).trim() === "") {
      errors.push({ code: "empty_input", message: `${field} must not be empty.`, field });
    }
  }
  for (const field of requiredArrayFields) {
    if (!(field in args)) {
      errors.push({ code: "missing_required_input", message: `${field} is required.`, field });
    } else if (!Array.isArray(args[field])) {
      errors.push({ code: "invalid_input_type", message: `${field} must be an array of strings.`, field });
    } else if ((args[field] as unknown[]).length === 0) {
      errors.push({ code: "empty_input", message: `${field} must not be empty.`, field });
    } else {
      (args[field] as unknown[]).forEach((item, index) => {
        if (typeof item !== "string") {
          errors.push({ code: "invalid_input_type", message: `${field}[${index}] must be a string.`, field });
        } else if (item.trim() === "") {
          errors.push({ code: "empty_input", message: `${field}[${index}] must not be empty.`, field });
        }
      });
    }
  }
  if ("source_label" in args && typeof args.source_label !== "string") {
    errors.push({ code: "invalid_input_type", message: "source_label must be a string.", field: "source_label" });
  }
  return errors;
}

function containsOutOfScope(text: string, tool: ToolName): boolean {
  const commandIntent =
    /\b(please\s+)?(access|retrieve|fetch|query|connect to|open)\b.*\b(logs?|monitoring|jira|linear|github|ticket|system)\b/i;
  const executeIntent = /\b(please\s+)?(execute|run|perform|apply)\b.*\b(remediation|fix|repair|rollback|mitigation)\b/i;
  const notifyIntent = /(^|\n)\s*(please\s+)?(create|open)\b.*\b(jira|linear|github)?\s*(tickets?|issues?)\b|(^|\n)\s*(please\s+)?notify\b.*\b(owner|team|person|people|everyone)\b/i;
  const inferenceIntent = /\b(infer|determine|judge|decide|identify)\b.*\b(root cause|blame|responsib\w*|fault)\b/i;
  const approvalIntent = /\b(approve|certify|sign off)\b.*\b(postmortem|review|incident)\b/i;
  const criteriaIntent = /(^|\n)\s*(please\s+)?(invent|create|generate|define)\b.*\b(checklist|criteria|required items|requirements)\b/i;
  if (tool === "extract_incident_timeline") return commandIntent.test(text) || executeIntent.test(text) || inferenceIntent.test(text);
  if (tool === "extract_postmortem_actions") return notifyIntent.test(text);
  return commandIntent.test(text) || executeIntent.test(text) || approvalIntent.test(text) || criteriaIntent.test(text) || inferenceIntent.test(text);
}

function makeTimelineError(errors: ContractError[], sourceLabel = "") {
  return {
    status: "error",
    events: [],
    impact_statements: [],
    source_label: sourceLabel,
    errors
  };
}

function makeActionsError(errors: ContractError[], sourceLabel = "") {
  return {
    status: "error",
    actions: [],
    source_label: sourceLabel,
    errors
  };
}

function makeCompletenessError(errors: ContractError[], sourceLabel = "") {
  return {
    status: "error",
    is_complete: false,
    checked_items: [],
    present_items: [],
    missing_items: [],
    source_label: sourceLabel,
    errors
  };
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isSectionHeader(line: string): boolean {
  return /^(source|postmortem|timeline|incident timeline|impact|follow-up actions|action items|corrective actions|next actions|actions|root cause|mitigation|resolution|detection)\s*:?.*$/i.test(line);
}

function sectionName(line: string): string {
  const match = line.match(/^(source|postmortem|timeline|incident timeline|impact|follow-up actions|action items|corrective actions|next actions|actions|root cause|mitigation|resolution|detection)\s*(?::|$)/i);
  return match ? normalizeText(match[1]) : "";
}

function sectionInlineContent(line: string): string {
  const name = sectionName(line);
  if (name === "") return "";
  if (!/^[^:]+:/i.test(line)) return "";
  return line.replace(/^[^:]+:\s*/i, "").trim();
}

function sectionBody(lines: string[], targetNames: string[]): string[] {
  const body: string[] = [];
  let inTarget = false;
  for (const line of lines) {
    const current = sectionName(line);
    if (current !== "") {
      const inline = sectionInlineContent(line);
      inTarget = targetNames.includes(current);
      if (inTarget && inline !== "") body.push(inline);
      continue;
    }
    if (inTarget) body.push(line);
  }
  return body;
}

function hasImpactContent(line: string): boolean {
  return /\b(customers?|users?|requests?|service|region|availability|latency|errors?|outage|checkout|failed|affected|degraded|unavailable|minutes?|percent|%)\b/i.test(line);
}

function parseTimestamp(line: string): string {
  const dateTime = line.match(/\b\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(?::\d{2})?\s*(?:UTC|Z|[A-Z]{2,4})?\b/);
  if (dateTime) return dateTime[0].trim();
  const timeOnly = line.match(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:UTC|[A-Z]{2,4})?\b/);
  return timeOnly ? timeOnly[0].trim() : "";
}

function sortKey(timestamp: string, index: number): number {
  const normalized = timestamp.replace(" UTC", "Z").replace(" ", "T");
  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) return parsed;
  const time = timestamp.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (time) return Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3] ?? "0");
  return Number.MAX_SAFE_INTEGER - 100000 + index;
}

function cleanEvent(line: string, timestamp: string): string {
  return line
    .replace(timestamp, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^[\s\-–—:]+/, "")
    .replace(/^(event|timeline)\s*[:\-]\s*/i, "")
    .trim();
}

function isExplicitTimelineEvent(line: string): boolean {
  if (isSectionHeader(line) || /^impact\s*:/i.test(line)) return false;
  return /\b(alerting|detected|declared|opened|disabled|returned|updated|created|sent|generated|showed|failed|recovered|resolved|mitigated|degraded|experienced|started|ended)\b/i.test(line);
}

function isActionSectionName(name: string): boolean {
  return ["follow up actions", "action items", "corrective actions", "next actions", "actions"].includes(name);
}

function isExcludedIncidentSection(name: string): boolean {
  return ["timeline", "incident timeline", "mitigation", "resolution", "impact", "root cause", "detection"].includes(name);
}

function normalizeActionBody(line: string): string {
  return line.replace(/^[-*]\s+/, "").replace(/^(Action|TODO|Follow-up):\s*/i, "").trim();
}

function isActionMarkerLine(line: string): boolean {
  return /^(Action|TODO|Follow-up):\s*\S/i.test(line.replace(/^[-*]\s+/, ""));
}

function isFutureActionSentence(line: string): boolean {
  return /\b(will|must|needs to|need to|should)\b\s+(add|document|review|update|create|write|schedule|verify|define|implement|remove|prepare|publish|test|audit|improve|investigate)\b/i.test(line);
}

function isActionLike(body: string): boolean {
  return /^(add|document|review|update|create|write|schedule|verify|define|implement|remove|prepare|publish|test|audit|improve|investigate)\b/i.test(body) || isFutureActionSentence(body);
}

function actionRecordFromLine(line: string) {
  const evidence = line;
  const body = normalizeActionBody(line);
  const owner = body.match(/\bOwner:\s*([^.;\n]+)/i)?.[1]?.trim() ?? "";
  const due = body.match(/\bDue:\s*([^.;\n]+)/i)?.[1]?.trim() ?? "";
  const action = body.replace(/\bOwner:\s*[^.;\n]+[.;]?/gi, "").replace(/\bDue:\s*[^.;\n]+[.;]?/gi, "").trim().replace(/[.;]$/, "");
  return { action, owner, due_date: due, evidence };
}

function actionCandidatesFromText(text: string) {
  let currentSection = "";
  return splitLines(text)
    .flatMap((line) => {
      const detectedSection = sectionName(line);
      if (detectedSection !== "") {
        currentSection = detectedSection;
        const inline = sectionInlineContent(line);
        if (inline === "") return [];
        return [{ line: inline, explicitActionContext: !isExcludedIncidentSection(currentSection) && isActionSectionName(currentSection) }];
      }
      const excludedIncidentSection = isExcludedIncidentSection(currentSection);
      return [{
        line,
        explicitActionContext:
          !excludedIncidentSection &&
          (isActionSectionName(currentSection) || isActionMarkerLine(line) || isFutureActionSentence(line))
      }];
    })
    .filter(({ line, explicitActionContext }) => explicitActionContext && !isSectionHeader(line.replace(/^[-*]\s+/, "")))
    .map(({ line }) => actionRecordFromLine(line))
    .filter((item) => item.action.length > 0 && isActionLike(item.action));
}

function extractTimeline(args: unknown) {
  const errors = validateBaseArguments(args, ["incident_text", "source_label"], ["incident_text"]);
  const sourceLabel = isPlainObject(args) && typeof args.source_label === "string" ? args.source_label : "";
  if (errors.length > 0) return errorToolResult(makeTimelineError(errors, sourceLabel));
  const incidentText = (args as JsonObject).incident_text as string;
  if (containsOutOfScope(incidentText, "extract_incident_timeline")) {
    return errorToolResult(makeTimelineError([{ code: "out_of_scope", message: "The request asks for behavior outside this read-only extraction tool.", field: "" }], sourceLabel));
  }
  const events = splitLines(incidentText)
    .filter((line) => !/^impact\s*:/i.test(line))
    .map((line, index) => ({ line, index, timestamp: parseTimestamp(line) }))
    .filter(({ line, timestamp }) => Boolean(timestamp) || isExplicitTimelineEvent(line))
    .map(({ line, index, timestamp }) => ({
      timestamp,
      event: cleanEvent(line, timestamp),
      evidence: line,
      index,
      sort: sortKey(timestamp, index)
    }))
    .filter((item) => item.event.length > 0)
    .sort((a, b) => a.sort - b.sort || a.index - b.index)
    .map(({ timestamp, event, evidence }) => ({ timestamp, event, evidence }));
  const impact_statements = splitLines(incidentText)
    .filter((line) => /^impact\s*:/i.test(line) || /\b(customers|users|service|availability|latency|errors?|outage|failed)\b.*\b(experienced|affected|impact|unavailable|degraded|failed)\b/i.test(line))
    .map((line) => line.replace(/^impact\s*:\s*/i, "").trim());
  return successToolResult({ status: "success", events, impact_statements, source_label: sourceLabel, errors: [] });
}

function extractActions(args: unknown) {
  const errors = validateBaseArguments(args, ["postmortem_text", "source_label"], ["postmortem_text"]);
  const sourceLabel = isPlainObject(args) && typeof args.source_label === "string" ? args.source_label : "";
  if (errors.length > 0) return errorToolResult(makeActionsError(errors, sourceLabel));
  const postmortemText = (args as JsonObject).postmortem_text as string;
  if (containsOutOfScope(postmortemText, "extract_postmortem_actions")) {
    return errorToolResult(makeActionsError([{ code: "out_of_scope", message: "The request asks for external action or task assignment.", field: "" }], sourceLabel));
  }
  const actions = actionCandidatesFromText(postmortemText);
  return successToolResult({ status: "success", actions, source_label: sourceLabel, errors: [] });
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isUncertainRootCause(text: string): boolean {
  return /\b(not yet determined|under investigation|unknown|to be determined|tbd|pending)\b/i.test(text);
}

function requirementEvidence(item: string, text: string): string {
  const normalizedItem = normalizeText(item);
  const lines = splitLines(text);
  if (normalizedItem === "impact statement") {
    const candidates = sectionBody(lines, ["impact"]);
    return candidates.find((line) => hasImpactContent(line)) ?? "";
  }
  if (normalizedItem === "incident timeline") {
    const candidates = sectionBody(lines, ["timeline", "incident timeline"]);
    return candidates.find((line) => parseTimestamp(line) !== "" || isExplicitTimelineEvent(line)) ?? "";
  }
  if (normalizedItem === "root cause") {
    return sectionBody(lines, ["root cause"]).find((line) => line.trim() !== "" && !isUncertainRootCause(line)) ?? "";
  }
  if (normalizedItem === "follow up actions with owners and deadlines" || normalizedItem === "actions with owners and deadlines") {
    return actionCandidatesFromText(text).find((action) => action.owner !== "" && action.due_date !== "")?.evidence ?? "";
  }
  return lines.find((line) => normalizeText(line).includes(normalizedItem)) ?? "";
}

function checkCompleteness(args: unknown) {
  const errors = validateBaseArguments(args, ["postmortem_text", "required_items", "source_label"], ["postmortem_text"], ["required_items"]);
  const sourceLabel = isPlainObject(args) && typeof args.source_label === "string" ? args.source_label : "";
  if (errors.length > 0) return errorToolResult(makeCompletenessError(errors, sourceLabel));
  const postmortemText = (args as JsonObject).postmortem_text as string;
  const requiredItems = (args as JsonObject).required_items as string[];
  if (containsOutOfScope(`${postmortemText}\n${requiredItems.join("\n")}`, "check_postmortem_completeness")) {
    return errorToolResult(makeCompletenessError([{ code: "out_of_scope", message: "The request asks this tool to create criteria, approve, infer root cause, or execute remediation.", field: "" }], sourceLabel));
  }
  const checked_items = requiredItems.map((requirement) => {
    const evidence = requirementEvidence(requirement, postmortemText);
    return {
      requirement,
      coverage_status: evidence === "" ? "missing" : "present",
      evidence
    };
  });
  const present_items = checked_items.filter((entry) => entry.coverage_status === "present").map((entry) => entry.requirement);
  const missing_items = checked_items.filter((entry) => entry.coverage_status === "missing").map((entry) => entry.requirement);
  return successToolResult({
    status: "success",
    is_complete: missing_items.length === 0,
    checked_items,
    present_items,
    missing_items,
    source_label: sourceLabel,
    errors: []
  });
}

export function internalErrorForTool(name: string) {
  const error: ContractError[] = [{ code: "internal_error", message: "An unexpected internal error occurred.", field: "" }];
  if (name === "extract_incident_timeline") return errorToolResult(makeTimelineError(error));
  if (name === "extract_postmortem_actions") return errorToolResult(makeActionsError(error));
  return errorToolResult(makeCompletenessError(error));
}

export function executeWithInternalErrorBoundary(toolName: string, operation: () => unknown) {
  try {
    return operation();
  } catch {
    return internalErrorForTool(toolName);
  }
}

function validationErrorForTool(name: string, error: ContractError) {
  if (name === "extract_incident_timeline") return errorToolResult(makeTimelineError([error]));
  if (name === "extract_postmortem_actions") return errorToolResult(makeActionsError([error]));
  return errorToolResult(makeCompletenessError([error]));
}

function callTool(params: unknown) {
  if (!isPlainObject(params) || typeof params.name !== "string") {
    return errorToolResult(makeCompletenessError([{ code: "invalid_input_type", message: "tools/call params.name is required.", field: "" }]));
  }
  if (!["extract_incident_timeline", "extract_postmortem_actions", "check_postmortem_completeness"].includes(params.name)) {
    return {
      isError: true,
      content: textContent(`Unknown tool: ${params.name}.`),
      structuredContent: { status: "error", errors: [{ code: "unknown_tool", message: `Unknown tool: ${params.name}.`, field: "name" }] }
    };
  }
  const toolName = params.name;
  if (!("arguments" in params)) {
    return validationErrorForTool(toolName, { code: "invalid_input_type", message: "arguments must be provided as an object.", field: "" });
  }
  const args = "arguments" in params ? params.arguments : {};
  return executeWithInternalErrorBoundary(toolName, () => {
    if (toolName === "extract_incident_timeline") return extractTimeline(args);
    if (toolName === "extract_postmortem_actions") return extractActions(args);
    if (toolName === "check_postmortem_completeness") return checkCompleteness(args);
    return internalErrorForTool(toolName);
  });
}

async function handleMcp(request: Request): Promise<Response> {
  let payload: JsonObject;
  try {
    const body = await request.json();
    if (!isPlainObject(body)) return rpcError(null, -32600, "Invalid Request");
    payload = body;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  const id = "id" in payload && (typeof payload.id === "string" || typeof payload.id === "number" || payload.id === null) ? payload.id : null;
  if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string") return rpcError(id, -32600, "Invalid Request");
  if (payload.method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: SERVICE_NAME, version: VERSION },
      capabilities: { tools: {} }
    });
  }
  if (payload.method === "tools/list") return rpcResult(id, { tools });
  if (payload.method === "tools/call") return rpcResult(id, callTool(payload.params));
  return rpcError(id, -32601, "Method not found", { structuredContent: { status: "error", errors: [{ code: "unknown_method", message: `Unknown method: ${payload.method}.`, field: "method" }] } });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(renderHomePage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (request.method === "GET" && url.pathname === "/privacy") {
      return new Response(renderPrivacyPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (request.method === "GET" && url.pathname === "/terms") {
      return new Response(renderTermsPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (request.method === "GET" && url.pathname === "/support") {
      return new Response(renderSupportPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (request.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") {
      return new Response(CHALLENGE_TOKEN, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ status: "ok", service: SERVICE_NAME, version: VERSION });
    }
    if (request.method === "POST" && url.pathname === "/mcp") return handleMcp(request);
    if (url.pathname === "/mcp") return jsonResponse({ error: "method_not_allowed", message: "POST /mcp is required." }, 405);
    return jsonResponse({ error: "not_found", message: "Route not found." }, 404);
  }
};
