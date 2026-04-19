import { formatHistoryForPrompt } from "./agentTools";
import { emit } from "./emitContext";
import { EVALUATOR_RULES, EVALUATOR_SYSTEM_PROMPT } from "./prompts";
import type { AgentResult, Turn } from "./types";
import { runClaude } from "./utils/claudeUtils";
import { parseJsonObject } from "./utils/parseJson";

type EvaluatorResult =
  | { status: "ready"; icao: string; question: string }
  | { status: "clarify"; questions: string[] }
  | { status: "out_of_scope"; reason: string };

type EvaluationGateResult =
  | { handled: true; result: AgentResult }
  | { handled: false; resolvedQuestion: string };

const evaluate = async (
  question: string,
  history: Turn[],
  signal?: AbortSignal,
): Promise<EvaluatorResult> => {
  const prompt =
    `${formatHistoryForPrompt(history)}` +
    `Question: "${question}"\n\n` +
    `Is the question ready to hand off to the CFS lookup pipeline?\n\n` +
    `${EVALUATOR_RULES}`;

  try {
    const raw = await runClaude(prompt, signal, EVALUATOR_SYSTEM_PROMPT);
    const parsed = parseJsonObject<EvaluatorResult>(raw);
    if (
      parsed?.status === "ready" ||
      parsed?.status === "clarify" ||
      parsed?.status === "out_of_scope"
    ) {
      return parsed;
    }
    throw new Error("Unexpected evaluator status");
  } catch {
    return {
      status: "clarify",
      questions: [
        "Could you clarify your question and include the 4-letter ICAO code for the aerodrome (e.g. CYVR for Vancouver, CYYJ for Victoria)?",
      ],
    };
  }
};

const runEvaluationGate = async (
  question: string,
  history: Turn[],
  signal?: AbortSignal,
): Promise<EvaluationGateResult> => {
  emit({ type: "evaluating" });
  const evaluation = await evaluate(question, history, signal);

  if (evaluation.status === "clarify") {
    const message = evaluation.questions.join("\n\n");
    emit({ type: "clarification", question: message });
    emit({ type: "done", answer: message, sourcePages: [] });
    return {
      handled: true,
      result: { answer: message, sourcePages: [], searchTerms: [], toolsCalled: [] },
    };
  }

  if (evaluation.status === "out_of_scope") {
    emit({ type: "done", answer: evaluation.reason, sourcePages: [] });
    return {
      handled: true,
      result: { answer: evaluation.reason, sourcePages: [], searchTerms: [], toolsCalled: [] },
    };
  }

  return { handled: false, resolvedQuestion: evaluation.question };
};

export { runEvaluationGate };
