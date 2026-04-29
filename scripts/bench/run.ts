/**
 * Benchmark runner — n=20 averaged pass rates per eval case.
 *
 * Separates architecture limits from LLM stochasticity by running each case
 * multiple times and bucketing by reliability.
 *
 * Usage:
 *   npx tsx scripts/bench/run.ts                    # all cases, n=20
 *   npx tsx scripts/bench/run.ts --n=5              # quick run
 *   npx tsx scripts/bench/run.ts --filter=composite # tagged subset
 *   npx tsx scripts/bench/run.ts --id=czmt-no-avgas # single case
 *   npx tsx scripts/bench/run.ts --out=results.json # save raw data
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";

import { runAgentLoop } from "../../src/lib/agentLoop.js";
import type { AgentResult, Turn } from "../../src/lib/types.js";
import { EVAL_CASES, type EvalCase } from "../eval/evalCases.js";
import { ADVERSARIAL_CASES } from "./adversarialCases.js";

const ALL_CASES = [...EVAL_CASES, ...ADVERSARIAL_CASES];

const { ANTHROPIC_API_KEY: _key, ...claudeEnv } = process.env;

const args = process.argv.slice(2);
const N = parseInt(args.find((a) => a.startsWith("--n="))?.split("=")[1] ?? "20");
const TIMEOUT_MS = parseInt(args.find((a) => a.startsWith("--timeout="))?.split("=")[1] ?? "90000");
const FILTER_TAG = args.find((a) => a.startsWith("--filter="))?.split("=")[1];
const FILTER_ID = args.find((a) => a.startsWith("--id="))?.split("=")[1];
const OUT_PATH = args.find((a) => a.startsWith("--out="))?.split("=")[1];
const ADV_ONLY = args.includes("--adversarial");

// ─── Types ──────────────────────────────────────────────────────────────────

interface TrialResult {
    run: number;
    verdict: "PASS" | "FAIL" | "ERROR" | "TIMEOUT";
    reason: string;
    answer?: string;
    toolsCalled?: string[];
    durationMs: number;
}

interface CaseBenchmark {
    id: string;
    question: string;
    tags: string[];
    n: number;
    passRate: number;
    bucket: "reliable" | "flaky" | "failing";
    trials: TrialResult[];
    avgDurationMs: number;
    routeDistribution: Record<string, number>;
}

interface BenchmarkReport {
    timestamp: string;
    n: number;
    cases: CaseBenchmark[];
    summary: {
        total: number;
        reliable: number;
        flaky: number;
        failing: number;
        overallPassRate: number;
    };
}

// ─── Judge ──────────────────────────────────────────────────────────────────

const JUDGE_SCHEMA = {
    type: "object",
    properties: {
        verdict: { type: "string", enum: ["PASS", "FAIL"] },
        reason: { type: "string" },
    },
    required: ["verdict", "reason"],
};

const judge = (evalCase: EvalCase, answer: string): Promise<{ verdict: "PASS" | "FAIL"; reason: string }> =>
    new Promise((resolve) => {
        const prompt = `You are an aviation accuracy judge evaluating an AI assistant's answer about the Canadian Flight Supplement (CFS).

Question: "${evalCase.question}"
Ground truth: "${evalCase.ground_truth ?? "Not provided"}"

Expected behavior:
${evalCase.expected_behavior}

Actual answer:
${answer}

Rules:
- Minor phrasing differences are acceptable
- Label errors are ALWAYS failures (calling MF a "tower" frequency is wrong)
- Hallucinated data is a failure
- "Not found" when data IS expected is a failure

Set verdict to PASS or FAIL with a short reason.`;

        const proc = spawn("claude", [
            "--enable-auto-mode", "--print", "--output-format", "json",
            "--model", "sonnet", "--json-schema", JSON.stringify(JUDGE_SCHEMA),
        ], { stdio: ["pipe", "pipe", "pipe"], env: claudeEnv });

        let stdout = "";
        proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        proc.on("close", () => {
            try {
                const parsed = JSON.parse(stdout) as { is_error: boolean; structured_output?: { verdict: "PASS" | "FAIL"; reason: string } };
                if (parsed.is_error || !parsed.structured_output) throw new Error("judge error");
                resolve(parsed.structured_output);
            } catch {
                resolve({ verdict: "FAIL", reason: `Judge parse error: ${stdout.slice(0, 100)}` });
            }
        });
        proc.stdin.write(prompt);
        proc.stdin.end();
    });

// ─── Trial runner ───────────────────────────────────────────────────────────

const runTrial = async (evalCase: EvalCase, run: number): Promise<TrialResult> => {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const result: AgentResult = await runAgentLoop(
            evalCase.question, [] as Turn[], () => {}, controller.signal,
        );
        clearTimeout(timer);

        const judgment = await judge(evalCase, result.answer);
        return {
            run,
            verdict: judgment.verdict,
            reason: judgment.reason,
            answer: result.answer.slice(0, 300),
            toolsCalled: result.toolsCalled,
            durationMs: Date.now() - start,
        };
    } catch (e) {
        clearTimeout(timer);
        if (controller.signal.aborted) {
            return { run, verdict: "TIMEOUT", reason: `Exceeded ${TIMEOUT_MS}ms`, durationMs: Date.now() - start };
        }
        return { run, verdict: "ERROR", reason: (e as Error).message.slice(0, 200), durationMs: Date.now() - start };
    }
};

// ─── Bucketing ──────────────────────────────────────────────────────────────

const bucket = (passRate: number): "reliable" | "flaky" | "failing" => {
    if (passRate >= 0.9) return "reliable";
    if (passRate >= 0.4) return "flaky";
    return "failing";
};

// ─── Main ───────────────────────────────────────────────────────────────────

const main = async () => {
    let cases = ADV_ONLY ? ADVERSARIAL_CASES : ALL_CASES;
    if (FILTER_ID) {
        cases = cases.filter((c) => c.id === FILTER_ID);
    } else if (FILTER_TAG) {
        cases = cases.filter((c) => c.tags?.includes(FILTER_TAG));
    }

    if (cases.length === 0) {
        console.error("No matching cases.");
        process.exit(1);
    }

    console.log(`\nBenchmark — ${cases.length} case${cases.length === 1 ? "" : "s"}, n=${N}\n`);

    const benchmarks: CaseBenchmark[] = [];

    for (const evalCase of cases) {
        console.log(`  ${evalCase.id}:`);
        const trials: TrialResult[] = [];

        for (let i = 0; i < N; i++) {
            const trial = await runTrial(evalCase, i + 1);
            trials.push(trial);

            const symbol = trial.verdict === "PASS" ? "." : trial.verdict === "FAIL" ? "x" : "!";
            process.stdout.write(symbol);
        }

        const passes = trials.filter((t) => t.verdict === "PASS").length;
        const passRate = passes / N;
        const avgDuration = trials.reduce((s, t) => s + t.durationMs, 0) / N;

        const routes: Record<string, number> = {};
        for (const t of trials) {
            for (const tool of t.toolsCalled ?? []) {
                routes[tool] = (routes[tool] ?? 0) + 1;
            }
        }

        const b = bucket(passRate);
        console.log(` ${(passRate * 100).toFixed(0)}% (${b})`);

        benchmarks.push({
            id: evalCase.id,
            question: evalCase.question,
            tags: evalCase.tags ?? [],
            n: N,
            passRate,
            bucket: b,
            trials,
            avgDurationMs: Math.round(avgDuration),
            routeDistribution: routes,
        });
    }

    // ─── Summary ────────────────────────────────────────────────────────────

    const reliable = benchmarks.filter((b) => b.bucket === "reliable").length;
    const flaky = benchmarks.filter((b) => b.bucket === "flaky").length;
    const failing = benchmarks.filter((b) => b.bucket === "failing").length;
    const totalPasses = benchmarks.reduce((s, b) => s + b.trials.filter((t) => t.verdict === "PASS").length, 0);
    const totalTrials = benchmarks.reduce((s, b) => s + b.n, 0);

    console.log(`\n${"─".repeat(50)}`);
    console.log(`Reliable (≥90%): ${reliable}`);
    console.log(`Flaky (40-89%):  ${flaky}`);
    console.log(`Failing (<40%):  ${failing}`);
    console.log(`Overall:         ${totalPasses}/${totalTrials} (${((totalPasses / totalTrials) * 100).toFixed(1)}%)`);

    const report: BenchmarkReport = {
        timestamp: new Date().toISOString(),
        n: N,
        cases: benchmarks,
        summary: {
            total: benchmarks.length,
            reliable,
            flaky,
            failing,
            overallPassRate: totalPasses / totalTrials,
        },
    };

    const outPath = OUT_PATH
        ? join(process.cwd(), OUT_PATH)
        : join(process.cwd(), "scripts", "bench", `results-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`);

    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`\nResults written to ${outPath}`);

    if (failing > 0) process.exit(1);
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
