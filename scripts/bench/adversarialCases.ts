/**
 * Adversarial eval cases — designed to probe architecture limits.
 *
 * Three tiers:
 * - "edge" cases: should pass ~50% — at the boundary of what this architecture handles
 * - "hard" cases: should pass <20% — require capabilities beyond the current stack
 * - "baseline" cases: should pass >90% — sanity checks that the pipeline works
 */

import type { EvalCase } from "../eval/evalCases.js";

const ADVERSARIAL_CASES: EvalCase[] = [
    // ─── Baseline (>90%) ────────────────────────────────────────────────────

    {
        id: "adv-baseline-direct-lookup",
        question: "What is the elevation at Alert Bay?",
        expected_behavior:
            "Direct structured lookup. Must return 240 ft. " +
            "This is the simplest possible query — single field, unambiguous aerodrome.",
        ground_truth: "240 ft",
        tags: ["adversarial", "baseline"],
    },

    {
        id: "adv-baseline-fuel-negative",
        question: "Does Masset have jet fuel?",
        expected_behavior:
            "Structured lookup for fuel at CZMT. JA-1 is listed. Must confirm yes. " +
            "Tests name→ICAO resolution + fuel lookup.",
        ground_truth: "FUEL JA-1",
        tags: ["adversarial", "baseline"],
    },

    // ─── Edge (~50%) ────────────────────────────────────────────────────────

    {
        id: "adv-edge-implicit-constraint",
        question: "I fly a Cessna 172 — can I get fuel at Atlin on a Sunday afternoon?",
        expected_behavior:
            "Requires cross-referencing: CYSQ has 100LL (what a C172 uses), but availability " +
            "is 'S 5,6' (likely seasonal months 5-6, i.e. May-June). A Sunday afternoon " +
            "in other months may not have service. The answer must address the time constraint, " +
            "not just confirm 100LL exists. An answer that says 'yes, 100LL is available' " +
            "without addressing the scheduling restriction is incomplete.",
        ground_truth: "100LL available at CYSQ, restricted schedule S 5,6",
        tags: ["adversarial", "edge", "inference"],
    },

    {
        id: "adv-edge-disambiguation",
        question: "What's the frequency at Campbell River?",
        expected_behavior:
            "Ambiguous: Campbell River has multiple entries (CYBL airport, CAT6 hospital helipad). " +
            "The answer should either ask for clarification, default to CYBL (the airport), or " +
            "note the ambiguity. An answer that confidently gives a frequency without noting " +
            "there are multiple Campbell River aerodromes is incomplete.",
        tags: ["adversarial", "edge", "disambiguation"],
    },

    {
        id: "adv-edge-implicit-comparison",
        question: "Which airport near Kamloops has the longest runway?",
        expected_behavior:
            "Requires spatial search around CYKA, then comparing runway lengths across results. " +
            "The structured layer can get individual runway data, but the comparison requires " +
            "cross-result reasoning. Must name the specific airport and runway length.",
        tags: ["adversarial", "edge", "comparison"],
    },

    {
        id: "adv-edge-negation",
        question: "Which airports near Kelowna do NOT have 100LL?",
        expected_behavior:
            "Requires spatial search + fuel data + negation logic. Must find airports near CYLW " +
            "and filter for those WITHOUT 100LL. This is an inverted query — the system needs to " +
            "reason about absence, not presence.",
        tags: ["adversarial", "edge", "negation"],
    },

    {
        id: "adv-edge-temporal",
        question: "If I arrive at Langley at 8pm UTC, is the tower still open?",
        expected_behavior:
            "CYNJ tower operates 1630-0230Z. 8pm UTC = 2000Z, which is within tower hours. " +
            "The answer must say yes and cite the hours. Tests temporal reasoning over structured data. " +
            "An answer that just lists the hours without answering the yes/no question is incomplete.",
        ground_truth: "TWR 119.0 1630-0230Z — yes, tower is open at 2000Z",
        tags: ["adversarial", "edge", "temporal"],
    },

    // ─── Hard (<20%) ────────────────────────────────────────────────────────

    {
        id: "adv-hard-multi-hop-route",
        question: "I'm flying VFR from Penticton to Kamloops. What frequencies do I need along the way?",
        expected_behavior:
            "Multi-hop: requires knowing CYYF departure frequencies, enroute frequencies " +
            "(possibly FSS/RCO along the route), and CYKA arrival frequencies. Also needs " +
            "to infer the route and which intermediate frequencies apply. This exceeds " +
            "the structured lookup capability — it requires geographic routing + frequency aggregation.",
        tags: ["adversarial", "hard", "multi-hop"],
    },

    {
        id: "adv-hard-operational-decision",
        question: "My alternates for CYVR are CYXX and CZBB. Which one should I file if I need ILS and cheap fuel?",
        expected_behavior:
            "Requires comparing two airports across multiple dimensions: ILS approach availability, " +
            "fuel types, fuel cost (not in CFS), and distance. The CFS has approach types and fuel " +
            "but not fuel prices. A correct answer should provide what the CFS says and note what " +
            "it can't answer (prices). Choosing between them requires judgment the system shouldn't fake.",
        tags: ["adversarial", "hard", "decision"],
    },

    {
        id: "adv-hard-regulatory-interpretation",
        question: "Do I need to call Langley tower if I'm transiting their control zone at night?",
        expected_behavior:
            "CYNJ tower closes at 0230Z. At night (after 0230Z), the CZ may revert to uncontrolled " +
            "and the MF applies. But the answer depends on the specific CZ classification and hours, " +
            "which requires interpreting CFS remarks and regulatory context (CARs 602.97/602.98). " +
            "The system should provide the tower hours and MF info, but regulatory interpretation " +
            "is beyond its scope.",
        tags: ["adversarial", "hard", "regulatory"],
    },

    {
        id: "adv-hard-weather-integration",
        question: "Given that Penticton is reporting low visibility, what's my best alternate with ILS?",
        expected_behavior:
            "This requires integrating real-time weather data (not in CFS) with aerodrome capabilities. " +
            "The system should note it cannot access weather data and provide what it can: " +
            "nearby airports with ILS approaches from a spatial search. Full integration is beyond scope.",
        tags: ["adversarial", "hard", "out-of-domain"],
    },
];

export { ADVERSARIAL_CASES };
