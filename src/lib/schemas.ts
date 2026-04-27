const EVALUATOR_SCHEMA = {
    type: "object",
    properties: {
        status: { type: "string", enum: ["ready", "clarify", "out_of_scope"] },
        question: { type: "string" },
        questions: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
    },
    required: ["status"],
};

const DECISION_SCHEMA = {
    type: "object",
    properties: {
        action: { type: "string", enum: ["answer", "vision"] },
        text: { type: "string" },
        pages: { type: "array", items: { type: "integer" } },
    },
    required: ["action"],
};

const QUERIES_SCHEMA = {
    type: "object",
    properties: {
        queries: { type: "array", items: { type: "string" } },
    },
    required: ["queries"],
};

export { DECISION_SCHEMA, EVALUATOR_SCHEMA, QUERIES_SCHEMA };
