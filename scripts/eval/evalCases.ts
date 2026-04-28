interface EvalCase {
    id: string;
    question: string;
    expected_behavior: string;
    ground_truth?: string;
    tags?: string[];
}

const EVAL_CASES: EvalCase[] = [
    {
        id: "cyvr-tower-freq",
        question: "What is the tower frequency at CYVR?",
        expected_behavior:
            "The answer must identify the ATC tower (TWR) frequencies at CYVR (Vancouver International). " +
            "The correct values are 118.7 for the South tower and 119.55 for the North tower. " +
            "The answer must use the word 'tower' or 'TWR', not 'MF', 'RADIO', or 'Ground'. " +
            "Quoting both frequencies is ideal; quoting only one is acceptable if labeled as tower. " +
            "The answer must not confuse this with any other comm service.",
        ground_truth: "TWR 118.7 (South) 119.55 (North)",
        tags: ["frequency", "tower"],
    },

    {
        id: "cyyf-mf-not-tower",
        question: "What is the tower frequency at CYYF?",
        expected_behavior:
            "CYYF (Penticton) does NOT have a tower. It uses a Mandatory Frequency (MF) and FSS radio, both on 118.5. " +
            "A correct answer must: (a) state that CYYF has no ATC tower, OR clearly label the frequency as MF/Mandatory Frequency — not 'tower'. " +
            "(b) mention 118.5 MHz as the relevant frequency. " +
            "An answer that calls 118.5 the 'tower frequency' is WRONG — that is a label substitution error. " +
            "The answer may mention the RADIO 118.5 PTC service and GND ADV 121.9.",
        ground_truth: "RADIO 118.5 PTC avbl (V); MF rdo 118.5 5NM 4100 ASL — no TWR label present",
        tags: ["regression", "mf-vs-tower", "frequency"],
    },

    {
        id: "cypk-tower-and-mf",
        question: "What frequency do I call at Pitt Meadows?",
        expected_behavior:
            "CYPK (Pitt Meadows) uses 126.3 MHz as the tower frequency when the tower is operating (15-07Z), " +
            "and the same 126.3 MHz as the MF (Mandatory Frequency) when the tower is closed (07-15Z). " +
            "A correct answer should explain this time-based distinction. " +
            "An answer that says simply 'tower frequency is 126.3' without mentioning the tower hours or MF period is incomplete. " +
            "An answer that calls 126.3 only the MF (ignoring the tower) is also incomplete. " +
            "Mentioning ATIS 125.0 or GND 123.8 is a bonus but not required.",
        ground_truth: "TWR Pitt 126.3 (V) 15-07Z; MF tfc 126.3 07-15Z 3NM 2500 ASL",
        tags: ["frequency", "tower", "mf-vs-tower", "hours"],
    },

    {
        id: "cynj-tower-frequency",
        question: "What is the tower frequency at Langley?",
        expected_behavior:
            "CYNJ (Langley Regional) has a tower on 119.0 MHz operating 1630-0230Z. " +
            "Outside those hours (0230-1630Z), 119.0 becomes the MF. " +
            "A correct answer must state 119.0 as the tower frequency. " +
            "Noting the operating hours and/or the MF conversion is ideal. " +
            "An answer stating only 'MF 119.0' without mentioning tower is wrong for this question.",
        ground_truth: "TWR 119.0 (V) 1630-0230Z; MF tfc 119.0 0230-1630Z 3NM 1900 ASL",
        tags: ["frequency", "tower", "hours"],
    },

    {
        id: "cypk-fuel-100ll",
        question: "Is 100LL avgas available at CYPK?",
        expected_behavior:
            "Yes, 100LL is available at CYPK (Pitt Meadows). " +
            "A correct answer must confirm this affirmatively. " +
            "It may note it is Cardlock (self-serve card system). " +
            "An answer saying fuel is unavailable or 'not published' is WRONG.",
        ground_truth: "FUEL 100LL (Cardlock)",
        tags: ["fuel"],
    },

    {
        id: "czmt-no-avgas",
        question: "Can I get 100LL avgas at Masset?",
        expected_behavior:
            "100LL avgas is NOT available at CZMT (Masset). Only JA-1 jet fuel is listed. " +
            "A correct answer must state that 100LL is not available or not published at CZMT. " +
            "It may mention JA-1 is available with time restrictions. " +
            "An answer saying 100LL IS available at CZMT is WRONG.",
        ground_truth: "FUEL JA-1 only — no 100LL listed at CZMT",
        tags: ["fuel", "not-published"],
    },

    {
        id: "cyeg-not-in-cfs",
        question: "What is the tower frequency at Edmonton International?",
        expected_behavior:
            "CYEG (Edmonton International) is in Alberta, not British Columbia. " +
            "The evaluator must reject this as out of scope and explain that this tool covers BC aerodromes only. " +
            "The answer must NOT invent or hallucinate a frequency for CYEG. " +
            "The response must NOT say the data is 'not published' — the correct reason is geographic scope.",
        ground_truth: "CYEG is not covered — Alberta airport, outside BC scope",
        tags: ["evaluator", "out_of_scope", "hallucination-guard"],
    },

    {
        id: "cyyf-circuit-altitude",
        question: "What is the circuit altitude at CYYF?",
        expected_behavior:
            "The circuit altitude at CYYF (Penticton) is 2300 ASL. " +
            "A correct answer must state '2300' and 'ASL' (above sea level). " +
            "It may add that right-hand circuits apply to Runway 34. " +
            "An answer with a different altitude, or no altitude at all, is WRONG.",
        ground_truth: "Circuit hgt 2300 ASL; Rgt hand circuits Rwy 34",
        tags: ["circuit", "altitude"],
    },

    // ─── Evaluator / decomposer cases ───────────────────────────────────────────

    {
        id: "evaluator-out-of-scope-non-bc",
        question: "What is the tower frequency at CYYC?",
        expected_behavior:
            "CYYC (Calgary International) is in Alberta, not British Columbia. " +
            "The evaluator must state that this assistant only covers British Columbia aerodromes. " +
            "The response must NOT provide any frequency information for CYYC. " +
            "The response must NOT say the data is 'not published' — the correct reason is geographic scope.",
        tags: ["evaluator", "out_of_scope"],
    },

    {
        id: "evaluator-out-of-scope-weather",
        question: "What is the weather at CYVR right now?",
        expected_behavior:
            "Weather is not covered by the Canadian Flight Supplement. " +
            "The evaluator must state that this tool only covers CFS aerodrome data and cannot answer weather questions. " +
            "The response must NOT provide any weather information. " +
            "The response must NOT attempt to look up METAR, TAF, or current conditions.",
        tags: ["evaluator", "out_of_scope"],
    },

    {
        id: "multi-icao-avgas-near-vancouver",
        question: "Where can I find avgas near Vancouver?",
        expected_behavior:
            "The decomposer must infer several Vancouver-area aerodromes and generate fuel sub-queries for each — this is a multi-aerodrome question. " +
            "The answer must confirm that CYVR (Vancouver International) has 100LL avgas. " +
            "The answer must confirm that CYXX (Abbotsford) has 100LL avgas. " +
            "The answer must confirm that CZBB (Boundary Bay) has 100LL avgas, available by truck or H24 cardlock. " +
            "The answer must confirm that CYPK (Pitt Meadows) has 100LL avgas via Cardlock. " +
            "An answer that only covers one aerodrome is incomplete. " +
            "An answer that invents fuel availability for aerodromes not in the CFS is WRONG.",
        ground_truth:
            "CYVR: FUEL MG-1, 100LL, JA, JA-1. CYXX: FUEL MG-1, 100LL, JA, JA-1. CZBB: FUEL 100LL (truck or H24 cardlock), JA-1. CYPK: FUEL 100LL (Cardlock).",
        tags: ["fuel", "multi-icao", "decomposer", "inference"],
    },

    {
        id: "multi-section-aerodrome-and-general",
        question: "What is the tower frequency at CYNJ and what does MF stand for?",
        expected_behavior:
            "This question spans two CFS sections: aerodrome data (CYNJ tower frequency) and General (MF abbreviation). " +
            "The decomposer must generate two sub-queries — one targeting CYNJ and one targeting the General section. " +
            "The answer must state 119.0 MHz as the CYNJ tower frequency. " +
            "The answer must explain that MF stands for Mandatory Frequency, used at uncontrolled aerodromes. " +
            "An answer that only addresses one of the two questions is incomplete.",
        ground_truth: "CYNJ TWR 119.0 (V) 1630-0230Z; MF = Mandatory Frequency",
        tags: ["multi-section", "decomposer", "frequency", "tower"],
    },

    {
        id: "decomposer-infer-vancouver",
        question: "What is the tower frequency at Vancouver airport?",
        expected_behavior:
            "The decomposer must infer CYVR from 'Vancouver airport' without asking for clarification — this is unambiguous. " +
            "The pipeline must then answer with the CYVR tower frequencies: 118.7 (South) and 119.55 (North). " +
            "An answer that asks for the ICAO code is WRONG — the inference should be automatic. " +
            "An answer with incorrect frequencies or labeling the frequency as MF is also WRONG.",
        ground_truth: "TWR 118.7 (South) 119.55 (North)",
        tags: ["decomposer", "inference", "frequency", "tower"],
    },

    // ─── Composite pipe cases (cross-result reasoning) ─────────────────────────

    {
        id: "composite-fuel-and-frequency",
        question: "I need to refuel at Pitt Meadows — is 100LL available and what frequency should I call on arrival?",
        expected_behavior:
            "This decomposes into two steps: fuel lookup at CYPK and frequency lookup at CYPK. " +
            "The composite pipe must confirm 100LL is available (Cardlock) AND provide the correct arrival frequency. " +
            "CYPK has TWR 126.3 (15-07Z) and MF 126.3 (07-15Z). " +
            "A correct composite answer explains the time-based distinction and confirms fuel. " +
            "An answer that only addresses one of the two parts is incomplete.",
        ground_truth: "FUEL 100LL (Cardlock); TWR Pitt 126.3 (V) 15-07Z; MF tfc 126.3 07-15Z",
        tags: ["composite", "fuel", "frequency"],
    },

    {
        id: "composite-runway-suitability",
        question: "Can a King Air land at Alert Bay? What's the runway like?",
        expected_behavior:
            "This requires cross-result reasoning: runway data lookup at CYAL, then inference about aircraft suitability. " +
            "CYAL has Rwy 09/27, 2985 ft, ASPH. A King Air (BE200) typically needs ~2500 ft for landing. " +
            "A correct answer states the runway data AND reasons about whether 2985 ft is sufficient — it is marginal but possible under good conditions. " +
            "An answer that only lists the runway data without addressing the aircraft suitability question is incomplete. " +
            "An answer that confidently says 'yes' without noting the margins or conditions is oversimplified.",
        ground_truth: "Rwy 09/27 2985x75 ASPH — marginal for King Air, depends on conditions",
        tags: ["composite", "inference", "runway"],
    },

    {
        id: "composite-compare-two-aerodromes",
        question: "Compare the fuel options at Anahim Lake and Burns Lake",
        expected_behavior:
            "This decomposes into two fuel lookups: CAJ4 (Anahim Lake) and CYPZ (Burns Lake). " +
            "CAJ4 has 100LL and JA, self-serve VISA & Mastercard. " +
            "CYPZ has 100LL and JA, 1 hr prior notice required. " +
            "A correct composite answer presents both side by side and notes the operational difference: " +
            "CAJ4 is self-serve (available anytime), CYPZ requires 1 hour prior notice. " +
            "An answer that lists them separately without comparison misses the point of the question.",
        ground_truth: "CAJ4: 100LL/JA self-serve; CYPZ: 100LL/JA 1hr PN",
        tags: ["composite", "comparison", "fuel"],
    },

    {
        id: "composite-flight-planning",
        question: "I'm flying from Atlin to Bella Bella — what are the runway lengths at both ends?",
        expected_behavior:
            "Two structured lookups: CYSQ (Atlin) runway and CBBC (Bella Bella) runway. " +
            "CYSQ: Rwy 01/19, 3949 ft, gravel. CBBC: Rwy 13/31, 3702 ft, ASPH. " +
            "A correct composite answer presents both and may note that Atlin is gravel while Bella Bella is paved. " +
            "The answer should present this as flight planning context, not just two disconnected facts.",
        ground_truth: "CYSQ: 01/19 3949ft gravel; CBBC: 13/31 3702ft ASPH",
        tags: ["composite", "flight-planning", "runway"],
    },
];

export type { EvalCase };
export { EVAL_CASES };
