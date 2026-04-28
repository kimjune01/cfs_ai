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

const DECOMPOSER_V2_SCHEMA = {
    type: "object",
    properties: {
        steps: {
            type: "array",
            items: {
                type: "object",
                oneOf: [
                    {
                        properties: {
                            route: { type: "string", const: "structured" },
                            intent: { type: "string" },
                            icao: { type: "string" },
                            filter: { type: "string" },
                        },
                        required: ["route", "intent", "icao"],
                    },
                    {
                        properties: {
                            route: { type: "string", const: "spatial" },
                            origin: { type: "string" },
                            radiusNm: { type: "number", minimum: 1, maximum: 500 },
                            filter: { type: "string" },
                        },
                        required: ["route", "origin", "radiusNm"],
                    },
                    {
                        properties: {
                            route: { type: "string", const: "unstructured" },
                            target: { type: "string" },
                            topic: { type: "string" },
                        },
                        required: ["route", "target", "topic"],
                    },
                    {
                        properties: {
                            route: { type: "string", const: "complex" },
                            subQueries: { type: "array", items: { type: "string" } },
                        },
                        required: ["route", "subQueries"],
                    },
                ],
            },
        },
        aerodromeRefs: { type: "array", items: { type: "string" } },
    },
    required: ["steps", "aerodromeRefs"],
};

const VISION_SCHEMA = {
    type: "object",
    properties: {
        answer: { type: "string" },
        sourcePages: { type: "array", items: { type: "integer" } },
    },
    required: ["answer", "sourcePages"],
};

export { DECOMPOSER_V2_SCHEMA, EVALUATOR_SCHEMA, SYNTHESIZER_SCHEMA, VISION_SCHEMA };
