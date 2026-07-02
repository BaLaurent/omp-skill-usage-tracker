import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

// Auto-loaded extension that records every time the agent reads a skill
// (`read` with a `skill://…` path) into a CSV, so skill usage can be ranked
// and dead skills identified. One row per read; dedupe per session at
// analysis time via the `session` column.

const HEADER = "timestamp,skill,path,session,cwd\n";

function quote(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function skillUsageTracker(pi: HookAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    // Fail-closed safety: a throwing tool_call handler BLOCKS the tool, so
    // any logging failure must be swallowed — never break the user's read.
    try {
      if (event.toolName !== "read") return;
      const rawPath = typeof event.input?.path === "string" ? event.input.path : "";
      if (!rawPath.startsWith("skill://")) return;

      // First path segment after `skill://`, ignoring any sub-path or `:selector`.
      // `skill://brainstorming/visual-companion.md:10-20` -> `brainstorming`
      const match = /^skill:\/\/([^/:]+)/.exec(rawPath);
      if (!match) return;
      const skill = decodeURIComponent(match[1]);

      let session = "";
      try {
        const file = ctx?.sessionManager?.getSessionFile?.();
        if (file) session = basename(String(file));
      } catch {
        // session id is best-effort
      }
      const cwd = typeof ctx?.cwd === "string" && ctx.cwd ? ctx.cwd : process.cwd();

      const row =
        [quote(new Date().toISOString()), quote(skill), quote(rawPath), quote(session), quote(cwd)].join(",") + "\n";

      // Test seam: SKILL_USAGE_CSV overrides the destination so verification
      // never touches the real file.
      const dest = process.env.SKILL_USAGE_CSV || join(homedir(), ".omp", "skill-usage.csv");
      // Create the file with its header exactly once, even with concurrent
      // sessions: `wx` is an exclusive create that throws EEXIST if it's there.
      try {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, HEADER, { flag: "wx" });
      } catch {
        // already exists — fine
      }
      // O_APPEND keeps concurrent writers from clobbering each other.
      appendFileSync(dest, row);
    } catch {
      // never throw out of a tool_call handler
    }
    // implicit `return undefined` -> never block the read
  });
}
