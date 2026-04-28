const EVALUATOR_SCHEMA = {
    type: "object",
    properties: {
        status: { type: "string", enum: ["ready", "out_of_scope"] },
        reason: { type: "string" },
    },
    required: ["status", "reason"],
};

const SYNTHESIZER_SCHEMA = {
    type: "object",
    properties: {
        quality: { type: "string", enum: ["good", "weak"] },
        answer: { type: "string" },
        sourcePages: { type: "array", items: { type: "integer" } },
    },
    required: ["quality"],
};

const QUERY_DECOMPOSER_SCHEMA = {
    type: "object",
    properties: {
        subQueries: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    ref: { type: "string" },
                    topic: { type: "string" },
                },
                required: ["ref", "topic"],
            },
        },
        aerodromeRefs: { type: "array", items: { type: "string" } },
    },
    required: ["subQueries", "aerodromeRefs"],
};

const VISION_SCHEMA = {
    type: "object",
    properties: {
        answer: { type: "string" },
        sourcePages: { type: "array", items: { type: "integer" } },
    },
    required: ["answer", "sourcePages"],
};

export { EVALUATOR_SCHEMA, QUERY_DECOMPOSER_SCHEMA, SYNTHESIZER_SCHEMA, VISION_SCHEMA };
