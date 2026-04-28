import { spawn } from "child_process";

import { attachAbort, CLAUDE_BIN, claudeEnv } from "./processUtils";

const CLAUDE_TIMEOUT_MS = 60_000;
const CLAUDE_MAX_RETRIES = 1;

type ClaudeOptions = {
    prompt: string;
    signal?: AbortSignal;
    systemPrompt?: string;
    schema?: object;
    model?: "sonnet" | "haiku";
};

const runClaudeOnce = <T = string>(opts: ClaudeOptions): Promise<T> =>
    new Promise((resolve, reject) => {
        const model = opts.model ?? "sonnet";
        const args = [
            "--enable-auto-mode",
            "--print",
            "--output-format",
            "json",
            "--model",
            model,
        ];
        if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
        if (opts.schema) args.push("--json-schema", JSON.stringify(opts.schema));
        const proc = spawn(CLAUDE_BIN, args, { stdio: ["pipe", "pipe", "pipe"], env: claudeEnv });

        if (opts.signal) attachAbort(proc, opts.signal);

        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error(`Claude timed out after 60s`));
        }, CLAUDE_TIMEOUT_MS);

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        proc.on("close", (code) => {
            clearTimeout(timer);
            if (opts.signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
            try {
                const parsed = JSON.parse(stdout) as {
                    is_error: boolean;
                    result: string;
                    structured_output?: T;
                };
                if (parsed.is_error) return reject(new Error(`Claude: ${parsed.result}`));
                if (opts.schema && parsed.structured_output == null) {
                    return reject(
                        new Error(`Claude returned no structured output: ${parsed.result.slice(0, 200)}`),
                    );
                }
                resolve(
                    (opts.schema ? parsed.structured_output : parsed.result.trim()) as T,
                );
            } catch {
                const detail = stderr.slice(0, 200) || stdout.slice(0, 200);
                reject(new Error(`claude exited ${code}: ${detail}`));
            }
        });
        proc.stdin.write(opts.prompt);
        proc.stdin.end();
    });

function runClaude(opts: ClaudeOptions): Promise<string>;
function runClaude<T>(opts: ClaudeOptions & { schema: object }): Promise<T>;
async function runClaude<T = string>(opts: ClaudeOptions): Promise<T | string> {
    let lastError: Error = new Error("Unknown error");
    for (let attempt = 0; attempt <= CLAUDE_MAX_RETRIES; attempt++) {
        try {
            return await runClaudeOnce<T>(opts);
        } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") throw e;
            lastError = e as Error;
            console.warn(`Claude attempt ${attempt + 1} failed: ${lastError.message}`);
        }
    }
    throw lastError;
}

export { runClaude };
export type { ClaudeOptions };
