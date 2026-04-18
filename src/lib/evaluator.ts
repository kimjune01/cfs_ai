import { runClaude, formatHistoryForPrompt } from "./agentTools";
import type { AgentResult, EmitFn, Turn } from "./types";

type EvaluatorResult =
  | { status: "ready"; icao: string; question: string }
  | { status: "clarify"; questions: string[] }
  | { status: "out_of_scope"; reason: string };

const EVALUATOR_SYSTEM_PROMPT = `You are a question evaluator for the Canadian Flight Supplement (CFS) assistant.
The CFS contains aerodrome data for British Columbia aerodromes: frequencies, circuit altitudes, fuel types, runway dimensions, lighting, and related services.

Return ONLY a JSON object — no explanation, no markdown.`;

const EVALUATOR_RULES = `Rules:
- Extract or infer the ICAO code. Canadian airport ICAO codes start with C.
  Common ones: CYVR=Vancouver, CYYJ=Victoria Intl, CYWH=Victoria Harbour, CYLW=Kelowna, CYXX=Abbotsford, CYCD=Nanaimo, CZBB=Boundary Bay, CYCW=Chilliwack, CYHE=Hope, CZML=Port McNeil.
- If inference is ambiguous (multiple plausible matches), ask the pilot to pick.
- If the aerodrome is outside British Columbia, return out_of_scope.
- This tool only covers CFS aerodrome data. If the question is about weather, NOTAMs, or regulations, return out_of_scope.

Return one of:
{"status":"ready","icao":"CYYJ","question":"<synthesized self-contained question with ICAO code>"}
{"status":"clarify","questions":["<specific question 1>","<specific question 2>"]}
{"status":"out_of_scope","reason":"<one line reason>"}`;

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
    const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
    const parsed = JSON.parse(jsonStr) as EvaluatorResult;
    if (
      parsed.status === "ready" ||
      parsed.status === "clarify" ||
      parsed.status === "out_of_scope"
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
  emit: EmitFn,
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

export type { EvaluatorResult, EvaluationGateResult };
export { evaluate, runEvaluationGate };
