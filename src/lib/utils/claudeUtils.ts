import { spawn } from "child_process";

import { attachAbort, CLAUDE_BIN, claudeEnv } from "./processUtils";

const runClaude = (prompt: string, signal?: AbortSignal, systemPrompt?: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const args = ["--enable-auto-mode", "--print", "--output-format", "json", "--model", "sonnet"];
    if (systemPrompt) args.push("--system-prompt", systemPrompt);
    const proc = spawn(CLAUDE_BIN, args, { stdio: ["pipe", "pipe", "pipe"], env: claudeEnv });

    if (signal) attachAbort(proc, signal);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      try {
        const parsed = JSON.parse(stdout) as { is_error: boolean; result: string };
        if (parsed.is_error) return reject(new Error(`Claude: ${parsed.result}`));
        resolve(parsed.result.trim());
      } catch {
        const detail = stderr.slice(0, 200) || stdout.slice(0, 200);
        reject(new Error(`claude exited ${code}: ${detail}`));
      }
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });

const parseJsonStringArray = (raw: string): string[] => {
  try {
    const jsonStr = raw.match(/\[[\s\S]*\]/)?.[0] ?? raw;
    return (JSON.parse(jsonStr) as string[])
      .map((t) => t.replace(/['"`.]/g, "").trim())
      .filter(Boolean);
  } catch {
    return [raw.replace(/['"`.]/g, "").trim()].filter(Boolean);
  }
};

export { parseJsonStringArray, runClaude };
