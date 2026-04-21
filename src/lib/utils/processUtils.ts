import { type spawn } from "child_process";

const CLAUDE_BIN = "claude";

// Strip ANTHROPIC_API_KEY so claude binary uses keychain auth
const { ANTHROPIC_API_KEY: _key, ...env } = process.env;
const claudeEnv = env;

const attachAbort = (proc: ReturnType<typeof spawn>, signal: AbortSignal): void => {
    const onAbort = () => proc.kill();
    signal.addEventListener("abort", onAbort);
    proc.on("close", () => signal.removeEventListener("abort", onAbort));
};

export { attachAbort, CLAUDE_BIN, claudeEnv };
