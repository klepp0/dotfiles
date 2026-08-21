/**
 * SAP Jira Extension for pi
 *
 * Calls the SAP Jira MCP server (https://mcp.jira.tools.sap/mcp) directly,
 * reusing the OAuth2 tokens that opencode already obtained via its browser flow.
 *
 * Auth flow:
 *   opencode does the one-time browser OAuth2 login and persists tokens to:
 *     ~/.local/share/opencode/mcp-auth.json
 *   This extension reads that file, uses the refresh_token to silently mint
 *   a fresh access_token (15-min JWT) when needed, and calls the MCP server
 *   over JSON-RPC (SSE transport). No browser, no PAT, no re-login.
 *
 * If the refresh token has also expired (very rare — they're long-lived),
 * open opencode once, trigger any Jira MCP tool call, and it will re-auth
 * via the browser and write fresh tokens back to mcp-auth.json.
 *
 * Tools provided (exact match of the SAP Jira MCP server surface):
 *   jira_get_issue                  - Full issue details
 *   jira_search                     - JQL search
 *   jira_get_transitions            - Available workflow transitions
 *   jira_get_user_profile           - User profile lookup
 *   jira_get_issue_watchers         - Issue watchers
 *   jira_search_fields              - Search/list Jira fields
 *   jira_get_field_options          - Options for custom fields
 *   jira_get_worklog                - Issue worklog entries
 *   jira_get_link_types             - Available link types
 *   jira_get_project_versions       - Project fix versions
 *   jira_get_project_components     - Project components
 *   jira_get_issue_dates            - Date + status transition history
 *   jira_get_issue_development_info - PRs/commits/branches for an issue
 *   jira_get_issues_development_info- Batch dev info for multiple issues
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Constants ────────────────────────────────────────────────────────────────

const MCP_SERVER_URL = "https://mcp.jira.tools.sap/mcp";
const TOKEN_ENDPOINT = "https://mcp.jira.tools.sap/token";
const MCP_AUTH_FILE = join(homedir(), ".local", "share", "opencode", "mcp-auth.json");
const MCP_KEY = "sap.tools.jira.mcp/mcp";

// ─── Token management ─────────────────────────────────────────────────────────

interface McpTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

interface McpClientInfo {
  clientId: string;
  clientIdIssuedAt: number;
}

interface McpAuthEntry {
  tokens?: McpTokens;
  clientInfo?: McpClientInfo;
  serverUrl?: string;
}

interface McpAuthFile {
  [key: string]: McpAuthEntry;
}

// In-memory token cache so we don't hit disk on every call
let cachedTokens: McpTokens | null = null;

function readAuthFile(): McpAuthFile {
  try {
    return JSON.parse(readFileSync(MCP_AUTH_FILE, "utf-8")) as McpAuthFile;
  } catch (e) {
    throw new Error(
      `Cannot read MCP auth file at ${MCP_AUTH_FILE}.\n` +
        `Open opencode and run any Jira MCP tool once to authenticate.\n` +
        `Error: ${e}`
    );
  }
}

function writeAuthFile(data: McpAuthFile): void {
  writeFileSync(MCP_AUTH_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function isExpired(tokens: McpTokens): boolean {
  // Refresh 60s before actual expiry to avoid race conditions
  return Date.now() / 1000 >= tokens.expiresAt - 60;
}

async function refreshAccessToken(
  clientId: string,
  refreshToken: string
): Promise<McpTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Token refresh failed (${res.status}): ${body}\n` +
        `The refresh token may have expired. Open opencode and trigger a Jira tool call to re-authenticate.`
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() / 1000 + data.expires_in,
    scope: data.scope,
  };
}

async function getAccessToken(): Promise<string> {
  // Use in-memory cache first
  if (cachedTokens && !isExpired(cachedTokens)) {
    return cachedTokens.accessToken;
  }

  const authFile = readAuthFile();
  const entry = authFile[MCP_KEY];

  if (!entry?.tokens) {
    throw new Error(
      `No Jira MCP tokens found in ${MCP_AUTH_FILE}.\n` +
        `Open opencode and run any Jira MCP tool once to authenticate via the browser.`
    );
  }

  if (!isExpired(entry.tokens)) {
    cachedTokens = entry.tokens;
    return cachedTokens.accessToken;
  }

  // Access token expired — use refresh token
  const clientId = entry.clientInfo?.clientId;
  if (!clientId) {
    throw new Error(`No clientId found in ${MCP_AUTH_FILE}. Re-authenticate via opencode.`);
  }

  const newTokens = await refreshAccessToken(clientId, entry.tokens.refreshToken);

  // Persist updated tokens so opencode also sees the new refresh token
  authFile[MCP_KEY] = {
    ...entry,
    tokens: newTokens,
  };
  writeAuthFile(authFile);
  cachedTokens = newTokens;

  return cachedTokens.accessToken;
}

// ─── MCP JSON-RPC client ──────────────────────────────────────────────────────

let mcpRequestId = 100;

async function mcpCall<T = unknown>(
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  const token = await getAccessToken();
  const id = ++mcpRequestId;

  const res = await fetch(MCP_SERVER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  if (!res.ok) {
    throw new Error(`MCP server error ${res.status}: ${await res.text()}`);
  }

  // The MCP server responds with SSE: "event: message\ndata: {...}\n\n"
  const text = await res.text();
  let jsonStr = text;

  // Parse SSE — extract the data line
  const dataMatch = text.match(/^data:\s*(.+)$/m);
  if (dataMatch) {
    jsonStr = dataMatch[1];
  }

  let parsed: { result?: { tools?: unknown[] } & Record<string, unknown>; error?: { message: string } };
  try {
    parsed = JSON.parse(jsonStr) as typeof parsed;
  } catch {
    throw new Error(`Failed to parse MCP response: ${text}`);
  }

  if (parsed.error) {
    throw new Error(`Jira MCP error: ${parsed.error.message}`);
  }

  return parsed.result as T;
}

/** Call a Jira tool on the MCP server and return the result text */
async function jiraTool(toolName: string, args: Record<string, unknown>): Promise<string> {
  const result = await mcpCall<{ content?: Array<{ type: string; text: string }>; result?: string }>(
    "tools/call",
    { name: toolName, arguments: args }
  );

  // This MCP server returns { content: [{type:"text", text:"..."}] }
  if (Array.isArray((result as { content?: unknown[] })?.content)) {
    return ((result as { content: Array<{ text: string }> }).content)
      .map((c) => c.text)
      .join("\n");
  }
  if (result?.result) return result.result;
  return JSON.stringify(result, null, 2);
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function jiraExtension(pi: ExtensionAPI) {

  // ── jira_get_issue ─────────────────────────────────────────────────────────
  pi.registerTool({
    name: "jira_get_issue",
    label: "Jira: Get Issue",
    description:
      "Get details of a specific Jira issue including its Epic links and relationship information. " +
      "Returns full issue details: summary, description, status, assignee, comments, custom fields.",
    promptSnippet: "Fetch a Jira issue by key (e.g. PROCESSAICO-528)",
    parameters: Type.Object({
      issue_key: Type.String({
        description: "Jira issue key, e.g. PROCESSAICO-528 or MYPROJ-42",
      }),
      fields: Type.Optional(
        Type.String({
          description:
            "Comma-separated list of fields to return. Use '*all' for all fields. " +
            "Default: priority,labels,summary,reporter,updated,assignee,issuetype,created,status,description",
        })
      ),
      expand: Type.Optional(
        Type.String({
          description:
            "Fields to expand. Examples: 'renderedFields', 'transitions', 'changelog'",
        })
      ),
      comment_limit: Type.Optional(
        Type.Number({
          description: "Max comments to include (0 = no comments, default 10)",
          minimum: 0,
          maximum: 100,
        })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const args: Record<string, unknown> = { issue_key: params.issue_key };
      if (params.fields) args.fields = params.fields;
      if (params.expand) args.expand = params.expand;
      if (params.comment_limit !== undefined) args.comment_limit = params.comment_limit;

      const text = await jiraTool("jira_get_issue", args);
      return {
        content: [{ type: "text", text }],
        details: {},
      };
    },
  });

  // ── jira_search ────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "jira_search",
    label: "Jira: Search Issues (JQL)",
    description:
      "Search Jira issues using JQL (Jira Query Language). " +
      "Examples: 'assignee = currentUser() AND status != Done ORDER BY priority DESC' " +
      "or 'project = PROCESSAICO AND sprint in openSprints()'",
    promptSnippet: "Search Jira issues with JQL",
    parameters: Type.Object({
      jql: Type.String({
        description:
          "JQL query. Examples:\n" +
          "- My open issues: 'assignee = currentUser() AND status != Done'\n" +
          "- Project issues: 'project = PROCESSAICO AND updated >= -7d'\n" +
          "- By Epic: 'parent = PROCESSAICO-100'\n" +
          "- By status: 'status = \"In Progress\" AND project = PROCESSAICO'",
      }),
      fields: Type.Optional(
        Type.String({
          description: "Comma-separated fields to return. Default: priority,labels,summary,reporter,updated,assignee,issuetype,created,status,description",
        })
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Max results (1-50, default 10)",
          minimum: 1,
          maximum: 50,
        })
      ),
      start_at: Type.Optional(
        Type.Number({ description: "Pagination offset (default 0)", minimum: 0 })
      ),
      projects_filter: Type.Optional(
        Type.String({
          description: "Comma-separated project keys to restrict results to, e.g. 'PROCESSAICO,MYPROJ'",
        })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const args: Record<string, unknown> = { jql: params.jql };
      if (params.fields) args.fields = params.fields;
      if (params.limit !== undefined) args.limit = params.limit;
      if (params.start_at !== undefined) args.start_at = params.start_at;
      if (params.projects_filter) args.projects_filter = params.projects_filter;

      const text = await jiraTool("jira_search", args);
      return {
        content: [{ type: "text", text }],
        details: {},
      };
    },
  });

  // ── jira_get_transitions ───────────────────────────────────────────────────
  pi.registerTool({
    name: "jira_get_transitions",
    label: "Jira: Get Transitions",
    description:
      "Get available workflow status transitions for a Jira issue. " +
      "Call this before jira_transition_issue to find valid transition IDs.",
    promptSnippet: "List workflow transitions for a Jira issue",
    parameters: Type.Object({
      issue_key: Type.String({
        description: "Jira issue key, e.g. PROCESSAICO-528",
      }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const text = await jiraTool("jira_get_transitions", { issue_key: params.issue_key });
      return {
        content: [{ type: "text", text }],
        details: {},
      };
    },
  });

  // ── jira_get_user_profile ──────────────────────────────────────────────────
  pi.registerTool({
    name: "jira_get_user_profile",
    label: "Jira: Get User Profile",
    description:
      "Retrieve profile information for a specific Jira user by email, username, or account ID.",
    promptSnippet: "Look up a Jira user profile",
    parameters: Type.Object({
      user_identifier: Type.String({
        description:
          "User identifier: email (e.g. 'jonas.kleppich@sap.com'), username (e.g. 'I753239'), or account ID",
      }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const text = await jiraTool("jira_get_user_profile", {
        user_identifier: params.user_identifier,
      });
      return {
        content: [{ type: "text", text }],
        details: {},
      };
    },
  });

  // ── jira_get_issue_watchers ────────────────────────────────────────────────
  pi.registerTool({
    name: "jira_get_issue_watchers",
    label: "Jira: Get Issue Watchers",
    description: "Get the list of watchers for a Jira issue.",
    promptSnippet: "Get watchers of a Jira issue",
    parameters: Type.Object({
      issue_key: Type.String({ description: "Jira issue key, e.g. PROCESSAICO-528" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const text = await jiraTool("jira_get_issue_watchers", { issue_key: params.issue_key });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── jira_search_fields ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "jira_search_fields",
    label: "Jira: Search Fields",
    description:
      "Search Jira fields by keyword. Useful for discovering custom field IDs (e.g. customfield_10010 for Story Points).",
    promptSnippet: "Search Jira field definitions",
    parameters: Type.Object({
      keyword: Type.Optional(
        Type.String({
          description: "Search keyword. Leave empty to list first N fields.",
        })
      ),
      limit: Type.Optional(
        Type.Number({ description: "Max results (default 10)", minimum: 1 })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const args: Record<string, unknown> = {};
      if (params.keyword) args.keyword = params.keyword;
      if (params.limit !== undefined) args.limit = params.limit;
      const text = await jiraTool("jira_search_fields", args);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── jira_get_field_options ─────────────────────────────────────────────────
  pi.registerTool({
    name: "jira_get_field_options",
    label: "Jira: Get Field Options",
    description:
      "Get allowed option values for a custom field (select, multi-select, radio, etc). " +
      "Use jira_search_fields first to find the field ID.",
    promptSnippet: "Get allowed values for a Jira custom field",
    parameters: Type.Object({
      field_id: Type.String({
        description: "Custom field ID, e.g. 'customfield_10001'. Use jira_search_fields to find IDs.",
      }),
      project_key: Type.Optional(Type.String({ description: "Project key (required for Server/DC)" })),
      issue_type: Type.Optional(Type.String({ description: "Issue type name (required for Server/DC)" })),
      contains: Type.Optional(Type.String({ description: "Filter options by substring" })),
      values_only: Type.Optional(
        Type.Boolean({ description: "Return only value strings in compact format (default false)" })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const args: Record<string, unknown> = { field_id: params.field_id };
      if (params.project_key) args.project_key = params.project_key;
      if (params.issue_type) args.issue_type = params.issue_type;
      if (params.contains) args.contains = params.contains;
      if (params.values_only !== undefined) args.values_only = params.values_only;
      const text = await jiraTool("jira_get_field_options", args);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── jira_get_worklog ───────────────────────────────────────────────────────
  pi.registerTool({
    name: "jira_get_worklog",
    label: "Jira: Get Worklog",
    description: "Get worklog (time tracking) entries for a Jira issue.",
    promptSnippet: "Get worklog entries for a Jira issue",
    parameters: Type.Object({
      issue_key: Type.String({ description: "Jira issue key, e.g. PROCESSAICO-528" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const text = await jiraTool("jira_get_worklog", { issue_key: params.issue_key });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── jira_get_link_types ────────────────────────────────────────────────────
  pi.registerTool({
    name: "jira_get_link_types",
    label: "Jira: Get Link Types",
    description: "Get all available issue link types (blocks, is blocked by, relates to, etc).",
    promptSnippet: "List Jira issue link types",
    parameters: Type.Object({
      name_filter: Type.Optional(
        Type.String({ description: "Filter link types by name substring (case-insensitive)" })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const args: Record<string, unknown> = {};
      if (params.name_filter) args.name_filter = params.name_filter;
      const text = await jiraTool("jira_get_link_types", args);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── jira_get_project_versions ──────────────────────────────────────────────
  pi.registerTool({
    name: "jira_get_project_versions",
    label: "Jira: Get Project Versions",
    description: "Get all fix versions for a Jira project.",
    promptSnippet: "List fix versions for a Jira project",
    parameters: Type.Object({
      project_key: Type.String({ description: "Project key, e.g. PROCESSAICO" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const text = await jiraTool("jira_get_project_versions", { project_key: params.project_key });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── jira_get_project_components ───────────────────────────────────────────
  pi.registerTool({
    name: "jira_get_project_components",
    label: "Jira: Get Project Components",
    description: "Get all components for a Jira project.",
    promptSnippet: "List components for a Jira project",
    parameters: Type.Object({
      project_key: Type.String({ description: "Project key, e.g. PROCESSAICO" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const text = await jiraTool("jira_get_project_components", { project_key: params.project_key });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── jira_get_issue_dates ───────────────────────────────────────────────────
  pi.registerTool({
    name: "jira_get_issue_dates",
    label: "Jira: Get Issue Dates",
    description:
      "Get date information and status transition history for a Jira issue. " +
      "Returns created/updated/due dates plus time spent in each status.",
    promptSnippet: "Get dates and status history for a Jira issue",
    parameters: Type.Object({
      issue_key: Type.String({ description: "Jira issue key, e.g. PROCESSAICO-528" }),
      include_status_changes: Type.Optional(
        Type.Boolean({ description: "Include status change history (default true)" })
      ),
      include_status_summary: Type.Optional(
        Type.Boolean({ description: "Include aggregated time per status (default true)" })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const args: Record<string, unknown> = { issue_key: params.issue_key };
      if (params.include_status_changes !== undefined)
        args.include_status_changes = params.include_status_changes;
      if (params.include_status_summary !== undefined)
        args.include_status_summary = params.include_status_summary;
      const text = await jiraTool("jira_get_issue_dates", args);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── jira_get_issue_development_info ───────────────────────────────────────
  pi.registerTool({
    name: "jira_get_issue_development_info",
    label: "Jira: Get Issue Development Info",
    description:
      "Get development information (PRs, commits, branches) linked to a Jira issue. " +
      "Shows the development panel: linked pull requests, branches, commits from GitHub/GitLab/Bitbucket.",
    promptSnippet: "Get linked PRs and commits for a Jira issue",
    parameters: Type.Object({
      issue_key: Type.String({ description: "Jira issue key, e.g. PROCESSAICO-528" }),
      application_type: Type.Optional(
        Type.String({
          description: "Filter by source control type: 'github', 'gitlab', 'stash' (Bitbucket Server)",
        })
      ),
      data_type: Type.Optional(
        Type.String({
          description: "Filter by data type: 'pullrequest', 'branch', 'repository'",
        })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const args: Record<string, unknown> = { issue_key: params.issue_key };
      if (params.application_type) args.application_type = params.application_type;
      if (params.data_type) args.data_type = params.data_type;
      const text = await jiraTool("jira_get_issue_development_info", args);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── jira_get_issues_development_info ──────────────────────────────────────
  pi.registerTool({
    name: "jira_get_issues_development_info",
    label: "Jira: Get Issues Development Info (Batch)",
    description:
      "Batch-fetch development information (PRs, commits, branches) for multiple Jira issues at once.",
    promptSnippet: "Batch-fetch linked PRs/commits for multiple Jira issues",
    parameters: Type.Object({
      issue_keys: Type.String({
        description: "Comma-separated Jira issue keys, e.g. 'PROCESSAICO-528,PROCESSAICO-529'",
      }),
      application_type: Type.Optional(
        Type.String({ description: "Filter by source control type: 'github', 'gitlab', 'stash'" })
      ),
      data_type: Type.Optional(
        Type.String({ description: "Filter by data type: 'pullrequest', 'branch', 'repository'" })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const args: Record<string, unknown> = { issue_keys: params.issue_keys };
      if (params.application_type) args.application_type = params.application_type;
      if (params.data_type) args.data_type = params.data_type;
      const text = await jiraTool("jira_get_issues_development_info", args);
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
