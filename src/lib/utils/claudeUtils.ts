import { spawn } from "child_process";

import { attachAbort, CLAUDE_BIN, claudeEnv } from "./processUtils";

const CLAUDE_TIMEOUT_MS = 60_000;
const CLAUDE_MAX_RETRIES = 1;

const runClaudeOnce = <T = string>(
    prompt: string,
    signal?: AbortSignal,
    systemPrompt?: string,
    schema?: object,
): Promise<T> =>
    new Promise((resolve, reject) => {
        const args = [
            "--enable-auto-mode",
            "--print",
            "--output-format",
            "json",
            "--model",
            "sonnet",
        ];
        if (systemPrompt) args.push("--system-prompt", systemPrompt);
        if (schema) args.push("--json-schema", JSON.stringify(schema));
        const proc = spawn(CLAUDE_BIN, args, { stdio: ["pipe", "pipe", "pipe"], env: claudeEnv });

        if (signal) attachAbort(proc, signal);

        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error("Claude timed out after 60s"));
        }, CLAUDE_TIMEOUT_MS);

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        proc.on("close", (code) => {
            clearTimeout(timer);
            if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
            try {
                const parsed = JSON.parse(stdout) as {
                    is_error: boolean;
                    result: string;
                    structured_output?: T;
                };
                if (parsed.is_error) return reject(new Error(`Claude: ${parsed.result}`));
                resolve((schema ? parsed.structured_output : parsed.result.trim()) as T);
            } catch {
                const detail = stderr.slice(0, 200) || stdout.slice(0, 200);
                reject(new Error(`claude exited ${code}: ${detail}`));
            }
        });
        proc.stdin.write(prompt);
        proc.stdin.end();
    });

function runClaude(prompt: string, signal?: AbortSignal, systemPrompt?: string): Promise<string>;
function runClaude<T>(
    prompt: string,
    signal: AbortSignal | undefined,
    systemPrompt: string | undefined,
    schema: object,
): Promise<T>;
async function runClaude<T = string>(
    prompt: string,
    signal?: AbortSignal,
    systemPrompt?: string,
    schema?: object,
): Promise<T | string> {
    let lastError: Error = new Error("Unknown error");
    for (let attempt = 0; attempt <= CLAUDE_MAX_RETRIES; attempt++) {
        try {
            return await runClaudeOnce<T>(prompt, signal, systemPrompt, schema);
        } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") throw e;
            lastError = e as Error;
            console.warn(`Claude attempt ${attempt + 1} failed: ${lastError.message}`);
        }
    }
    throw lastError;
}

export { runClaude };
