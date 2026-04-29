/**
 * Adversarial eval cases — designed to probe architecture limits.
 *
 * Three tiers:
 * - "baseline": should pass >90% — sanity checks
 * - "edge": should pass ~50% — at the boundary of what this architecture handles
 * - "hard": should pass <20% — require capabilities beyond the current stack
 *
 * Cases sourced from real pilot forum confusion (r/flying, AvCanada, PPRuNe)
 * and constructed probes of specific architectural gaps.
 */

import type { EvalCase } from "../eval/evalCases.js";

const ADVERSARIAL_CASES: EvalCase[] = [
    // ─── Baseline (>90%) ────────────────────────────────────────────────────

    {
        id: "adv-baseline-direct-lookup",
        question: "What is the elevation at Alert Bay?",
        expected_behavior:
            "Direct structured lookup. Must return 240 ft. " +
            "Simplest possible query — single field, unambiguous aerodrome.",
        ground_truth: "240 ft",
        tags: ["adversarial", "baseline"],
    },

    {
        id: "adv-baseline-fuel-positive",
        question: "Does Masset have jet fuel?",
        expected_behavior:
            "Structured lookup for fuel at CZMT. JA-1 is listed. Must confirm yes. " +
            "Tests name→ICAO resolution + fuel lookup.",
        ground_truth: "FUEL JA-1",
        tags: ["adversarial", "baseline"],
    },

    {
        id: "adv-baseline-should-refuse",
        question: "What's the best restaurant near Kelowna airport?",
        expected_behavior:
            "Out of scope — not a CFS question. The evaluator must reject this. " +
            "The answer must NOT provide restaurant recommendations.",
        tags: ["adversarial", "baseline", "out_of_scope"],
    },

    {
        id: "adv-baseline-name-alias",
        question: "What's the runway length at Tofino?",
        expected_behavior:
            "CFS entry is 'Tofino/Long Beach CYAZ'. Must resolve the common name 'Tofino' to CYAZ. " +
            "Must return the runway length. Tests name normalization — a real pilot confusion point.",
        tags: ["adversarial", "baseline", "name-resolution"],
    },

    {
        id: "adv-baseline-fuel-notation",
        question: "What kind of fuel service does Burns Lake have — is it self-serve or do I need to call ahead?",
        expected_behavior:
            "CYPZ fuel is '100LL, JA — 1 hr PN' (1 hour prior notice). Must state that prior notice " +
            "is required. An answer that just says '100LL available' without the PN restriction is INCOMPLETE.",
        ground_truth: "100LL, JA — 1 hr prior notice required",
        tags: ["adversarial", "baseline"],
    },

    // ─── Edge (~50%) ────────────────────────────────────────────────────────

    {
        id: "adv-edge-schedule-constraint",
        question: "I fly a Cessna 172 — can I get fuel at Atlin on a Sunday afternoon?",
        expected_behavior:
            "CYSQ has 100LL (what a C172 uses), but availability is 'S 5,6'. " +
            "The answer must include the availability restriction, not just confirm 100LL exists. " +
            "An answer that says 'yes, 100LL is available' without quoting the schedule is INCOMPLETE. " +
            "An answer that quotes the raw 'S 5,6' data and notes it may be a scheduling restriction is PASS.",
        ground_truth: "100LL at CYSQ, availability: S 5,6",
        tags: ["adversarial", "edge", "inference"],
    },

    {
        id: "adv-edge-disambiguation",
        question: "What's the frequency at Campbell River?",
        expected_behavior:
            "Campbell River has multiple entries (CYBL airport, CAT6 hospital helipad). " +
            "PASS if the answer: (a) provides CYBL frequencies (the main airport), OR " +
            "(b) notes the ambiguity between CYBL and CAT6. " +
            "FAIL if the answer gives CAT6 frequencies without mentioning CYBL, or hallucinates.",
        tags: ["adversarial", "edge", "disambiguation"],
    },

    {
        id: "adv-edge-longest-runway-nearby",
        question: "Which airport within 50 NM of Kamloops has the longest runway?",
        expected_behavior:
            "Requires spatial search around CYKA within 50 NM, then comparing runway lengths. " +
            "Must name a specific airport and its runway length. An answer that lists airports " +
            "without identifying which has the longest runway is INCOMPLETE.",
        tags: ["adversarial", "edge", "comparison"],
    },

    {
        id: "adv-edge-negation",
        question: "Are there any airports within 30 NM of Kelowna that do NOT have 100LL?",
        expected_behavior:
            "Requires spatial search within 30 NM of CYLW + fuel data + negation. " +
            "Must identify specific airports that lack 100LL. An answer that lists airports " +
            "WITH 100LL instead of WITHOUT is WRONG. An answer that says it can't determine " +
            "this is acceptable if it explains why.",
        tags: ["adversarial", "edge", "negation"],
    },

    {
        id: "adv-edge-temporal",
        question: "If I arrive at Langley at 8pm UTC, is the tower still open?",
        expected_behavior:
            "CYNJ tower operates 1630-0230Z. 8pm UTC = 2000Z, which is within tower hours. " +
            "Must answer YES and cite the operating hours. " +
            "An answer that lists hours without a yes/no is INCOMPLETE.",
        ground_truth: "TWR 119.0 1630-0230Z — yes, tower is open at 2000Z",
        tags: ["adversarial", "edge", "temporal"],
    },

    {
        id: "adv-edge-after-hours-mf",
        question: "I'm going into Pitt Meadows after tower hours. What frequency should I use?",
        expected_behavior:
            "CYPK tower (126.3) operates 15-07Z. After hours (07-15Z), MF is 126.3. " +
            "Must state the MF frequency AND note it's the after-hours procedure. " +
            "An answer that gives the tower frequency without distinguishing hours is INCOMPLETE. " +
            "Source: real pilot forum question (r/flying).",
        ground_truth: "MF 126.3 during 07-15Z (tower closed)",
        tags: ["adversarial", "edge", "temporal", "pilot-forum"],
    },

    {
        id: "adv-edge-timezone-notation",
        question: "The CFS says CYPK tower hours are 15-07Z with a dagger. What does UTC-8(7) mean and when is 15Z in local time?",
        expected_behavior:
            "UTC-8(7) means standard time is UTC-8, daylight time is UTC-7. The dagger (‡) means " +
            "hours shift with daylight saving. 15Z = 7am PST or 8am PDT. " +
            "Must explain the timezone factor AND convert the time. " +
            "An answer that just restates '15-07Z' without explaining is INCOMPLETE. " +
            "Source: common CFS confusion point from pilot forums.",
        tags: ["adversarial", "edge", "temporal", "pilot-forum"],
    },

    {
        id: "adv-edge-arcal-lighting",
        question: "How do I activate the runway lights at Tofino at night?",
        expected_behavior:
            "CYAZ has ARCAL lighting. The answer should mention ARCAL and the activation frequency. " +
            "If ARCAL type and frequency are in the CFS data, they must be cited. " +
            "An answer that says 'not published' when ARCAL data IS present is FAIL. " +
            "Source: real pilot question about night ops at Tofino.",
        tags: ["adversarial", "edge", "remarks", "pilot-forum"],
    },

    // ─── Hard (<20%) ────────────────────────────────────────────────────────

    {
        id: "adv-hard-multi-hop-route",
        question: "I'm flying VFR from Penticton to Kamloops. What frequencies do I need along the way?",
        expected_behavior:
            "Multi-hop: requires CYYF departure frequencies, enroute frequencies, and CYKA arrival " +
            "frequencies. Also needs to infer the route and which intermediate frequencies apply. " +
            "This exceeds structured lookup — requires geographic routing + frequency aggregation. " +
            "A partial answer listing departure and arrival frequencies without enroute is INCOMPLETE.",
        tags: ["adversarial", "hard", "multi-hop"],
    },

    {
        id: "adv-hard-alternate-comparison",
        question: "My alternates for CYVR are CYXX and CZBB. Which has ILS approaches?",
        expected_behavior:
            "Requires comparing approach types at two airports. The CFS lists approach data. " +
            "Must state which airport(s) have ILS. An answer that provides frequencies or fuel " +
            "instead of approach types misunderstands the question. " +
            "An answer that says it can't determine approach types from available data is acceptable.",
        tags: ["adversarial", "hard", "comparison"],
    },

    {
        id: "adv-hard-regulatory",
        question: "Do I need to call Langley tower if I'm transiting their control zone at night?",
        expected_behavior:
            "CYNJ tower closes at 0230Z. At night, the MF applies. The answer should provide " +
            "tower hours and MF info. Regulatory interpretation (CARs 602.97/602.98) is beyond " +
            "the system's scope — it should present the facts without making a regulatory ruling. " +
            "An answer that confidently says 'no, you don't need to call' without caveat is WRONG.",
        tags: ["adversarial", "hard", "regulatory"],
    },

    {
        id: "adv-hard-out-of-domain",
        question: "Given that Penticton is reporting low visibility, what's my best alternate with ILS?",
        expected_behavior:
            "Requires real-time weather data (not in CFS). The system must note it cannot access " +
            "weather. It may provide nearby airports with ILS from spatial search as partial help. " +
            "An answer that assumes weather conditions or recommends a specific alternate without " +
            "caveating the weather limitation is WRONG.",
        tags: ["adversarial", "hard", "out-of-domain"],
    },

    {
        id: "adv-hard-class-c-transit",
        question: "I'm departing a private strip and want to transit Vancouver Class C. Where do I get a transponder code?",
        expected_behavior:
            "Requires knowledge of Lower Mainland ATS procedures buried in Vancouver/Pitt Meadows " +
            "procedure notes. The answer should reference contacting terminal or approach control. " +
            "This is a multi-source lookup across remarks and procedures — exceeds single-aerodrome " +
            "structured search. An answer that just provides CYVR frequencies is INCOMPLETE. " +
            "Source: real PPRuNe question about Vancouver area VFR.",
        tags: ["adversarial", "hard", "multi-source", "pilot-forum"],
    },

    {
        id: "adv-hard-circuit-training-overnight",
        question: "Can I do circuit training at Pitt Meadows during the overnight MF period?",
        expected_behavior:
            "Requires interpreting PRO notes + operating hour restrictions. Circuit training " +
            "at CYPK may have specific restrictions during MF periods. The answer must reference " +
            "the actual CFS procedures, not just state that circuits are possible. " +
            "Regulatory nuance (CAR 602.96) is beyond scope. " +
            "Source: real pilot forum question.",
        tags: ["adversarial", "hard", "regulatory", "pilot-forum"],
    },
];

export { ADVERSARIAL_CASES };
