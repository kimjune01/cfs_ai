/**
 * CFS/AI Integration Evals
 *
 * Runs a set of golden Q&A cases through the full agent pipeline and uses
 * Claude as a judge to verify answer quality.
 *
 * Usage:
 *   npm run eval                         # run all cases
 *   npm run eval -- --filter=regression  # run tagged subset
 *   npm run eval -- --id=cyvr-tower-freq # run a single case by id
 *   npm run eval -- --timeout=90000      # override per-case timeout (ms)
 *
 * Exit code: 0 = all pass, 1 = any failures
 */

import { spawn } from "child_process";

import { runAgentLoop } from "../../src/lib/agentLoop.js";
import type { AgentResult, Turn } from "../../src/lib/types.js";
import { EVAL_CASES, type EvalCase } from "./evalCases.js";

// Strip ANTHROPIC_API_KEY so the claude binary uses keychain auth instead
const { ANTHROPIC_API_KEY: _key, ...claudeEnv } = process.env;

const args = process.argv.slice(2);
const TIMEOUT_MS = parseInt(args.find((a) => a.startsWith("--timeout="))?.split("=")[1] ?? "90000");
const FILTER_TAG = args.find((a) => a.startsWith("--filter="))?.split("=")[1];
const FILTER_ID = args.find((a) => a.startsWith("--id="))?.split("=")[1];

// ─── Judge ───────────────────────────────────────────────────────────────────

interface JudgeResult {
    verdict: "PASS" | "FAIL" | "ERROR";
    reason: string;
    fatal_error: string | null;
}

const JUDGE_SCHEMA = {
    type: "object",
    properties: {
        verdict: { type: "string", enum: ["PASS", "FAIL"] },
        reason: { type: "string" },
        fatal_error: { type: "string" },
    },
    required: ["verdict", "reason"],
};

const buildJudgePrompt = (evalCase: EvalCase, actualAnswer: string): string => {
    return `You are an aviation accuracy judge evaluating an AI assistant's answer about the Canadian Flight Supplement (CFS).

## Test Case
Question asked: "${evalCase.question}"
Ground truth anchor: "${evalCase.ground_truth ?? "Not provided"}"

## Expected Behavior
${evalCase.expected_behavior}

## Actual Answer to Evaluate
${actualAnswer}

## Your Task
Decide whether the actual answer satisfies the expected behavior.

Rules:
- Minor phrasing differences are acceptable ("118.5 MHz" vs "118.5" — both fine)
- Label errors are ALWAYS failures: calling an MF/RADIO frequency a "tower" frequency is wrong even if the number is correct
- Hallucinated data not supported by the expected behavior is a failure
- A "not found" response when data IS expected is a failure
- A "not found" response when data IS NOT expected (e.g. aerodrome not in DB) is correct

Set verdict to PASS or FAIL. For FAIL, set fatal_error to the specific wrong statement from the actual answer.`;
};

const callJudge = (evalCase: EvalCase, actualAnswer: string): Promise<JudgeResult> => {
    return new Promise((resolve) => {
        const proc = spawn(
            "claude",
            [
                "--enable-auto-mode",
                "--print",
                "--output-format",
                "json",
                "--model",
                "sonnet",
                "--json-schema",
                JSON.stringify(JUDGE_SCHEMA),
            ],
            { stdio: ["pipe", "pipe", "pipe"], env: claudeEnv },
        );

        let stdout = "";
        proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        proc.on("close", () => {
            try {
                const parsed = JSON.parse(stdout) as {
                    is_error: boolean;
                    structured_output?: JudgeResult;
                };
                if (parsed.is_error || !parsed.structured_output) throw new Error("judge error");
                resolve({
                    ...parsed.structured_output,
                    fatal_error: parsed.structured_output.fatal_error ?? null,
                });
            } catch {
                resolve({
                    verdict: "ERROR",
                    reason: "Judge response could not be parsed",
                    fatal_error: stdout.slice(0, 200),
                });
            }
        });

        proc.stdin.write(buildJudgePrompt(evalCase, actualAnswer));
        proc.stdin.end();
    });
};

// ─── Runner ──────────────────────────────────────────────────────────────────

interface CaseResult {
    id: string;
    verdict: "PASS" | "FAIL" | "ERROR" | "TIMEOUT";
    reason: string;
    fatal_error?: string | null;
    actual?: string;
}

const runCase = async (evalCase: EvalCase): Promise<CaseResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let actualAnswer = "";
    try {
        const result: AgentResult = await runAgentLoop(
            evalCase.question,
            [] as Turn[],
            () => {},
            controller.signal,
        );
        actualAnswer = result.answer;
    } catch (e) {
        if (controller.signal.aborted) {
            return { id: evalCase.id, verdict: "TIMEOUT", reason: `Exceeded ${TIMEOUT_MS}ms` };
        }
        return {
            id: evalCase.id,
            verdict: "ERROR",
            reason: `Pipeline threw: ${(e as Error).message}`,
        };
    } finally {
        clearTimeout(timer);
    }

    const judgment = await callJudge(evalCase, actualAnswer);
    return {
        id: evalCase.id,
        verdict: judgment.verdict,
        reason: judgment.reason,
        fatal_error: judgment.fatal_error,
        actual: actualAnswer,
    };
};

// ─── Main ────────────────────────────────────────────────────────────────────

const main = async () => {
    let cases = EVAL_CASES;
    if (FILTER_ID) {
        cases = EVAL_CASES.filter((c) => c.id === FILTER_ID);
        if (cases.length === 0) {
            console.error(`No case with id: ${FILTER_ID}`);
            process.exit(1);
        }
    } else if (FILTER_TAG) {
        cases = EVAL_CASES.filter((c) => c.tags?.includes(FILTER_TAG));
        if (cases.length === 0) {
            console.error(`No cases match filter: ${FILTER_TAG}`);
            process.exit(1);
        }
    }

    console.log(
        `\nCFS/AI Eval — ${cases.length} case${cases.length > 1 ? "s" : ""}${FILTER_TAG ? ` [filter: ${FILTER_TAG}]` : ""}\n`,
    );

    const results: CaseResult[] = [];
    for (const evalCase of cases) {
        process.stdout.write(`  ${evalCase.id} ... `);
        const result = await runCase(evalCase);
        results.push(result);

        const symbol = result.verdict === "PASS" ? "✓" : "✗";
        console.log(`${symbol} ${result.verdict}`);

        if (result.verdict !== "PASS") {
            console.log(`    reason:  ${result.reason}`);
            if (result.fatal_error) console.log(`    fatal:   ${result.fatal_error}`);
            if (result.actual)
                console.log(`    actual:  ${result.actual.slice(0, 200).replace(/\n/g, " ")}`);
        }
    }

    const passed = results.filter((r) => r.verdict === "PASS").length;
    const failed = results.length - passed;

    console.log(`\n${passed}/${results.length} passed`);

    if (failed > 0) {
        const failedIds = results.filter((r) => r.verdict !== "PASS").map((r) => r.id);
        console.log(`failed: ${failedIds.join(", ")}`);
        process.exit(1);
    }
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
