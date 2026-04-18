export interface EvalCase {
  id: string;
  question: string;
  expected_behavior: string;
  ground_truth?: string;
  tags?: string[];
}

export const EVAL_CASES: EvalCase[] = [
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
    question: "What frequency do I call at CYPK?",
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
    question: "What is the tower frequency at CYNJ?",
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
    question: "Can I get 100LL avgas at CZMT?",
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
    question: "What is the tower frequency at CYEG?",
    expected_behavior:
      "CYEG (Edmonton International) is not in this CFS database (which covers British Columbia). " +
      "A correct answer must say that CYEG data is not available or not found in this CFS. " +
      "The answer must NOT invent or hallucinate a frequency for CYEG. " +
      "Responding with 'not published in this CFS entry' or similar is correct.",
    ground_truth: "CYEG is not covered in this BC CFS dataset",
    tags: ["not-published", "hallucination-guard"],
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

  // ─── Evaluator cases ────────────────────────────────────────────────────────

  {
    id: "evaluator-no-icao",
    question: "What is the tower frequency?",
    expected_behavior:
      "The question has no ICAO code and no aerodrome name. " +
      "The evaluator must ask the pilot to provide the aerodrome's 4-letter ICAO code. " +
      "The response must NOT attempt to answer a tower frequency question. " +
      "The response must NOT invent or guess an aerodrome.",
    tags: ["evaluator", "clarify"],
  },

  {
    id: "evaluator-ambiguous-victoria",
    question: "What is the circuit altitude at Victoria?",
    expected_behavior:
      "Victoria is ambiguous — it could refer to CYYJ (Victoria International) or CYWH (Victoria Harbour). " +
      "The evaluator must ask the pilot to clarify which Victoria airport they mean. " +
      "The response must mention both CYYJ and CYWH (or equivalent names). " +
      "The response must NOT answer with a circuit altitude — that would be guessing.",
    tags: ["evaluator", "clarify"],
  },

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
    id: "evaluator-infer-vancouver",
    question: "What is the tower frequency at Vancouver airport?",
    expected_behavior:
      "The evaluator must infer CYVR from 'Vancouver airport' without asking for clarification — this is unambiguous. " +
      "The pipeline must then answer with the CYVR tower frequencies: 118.7 (South) and 119.55 (North). " +
      "An answer that asks for the ICAO code is WRONG — the inference should be automatic. " +
      "An answer with incorrect frequencies or labeling the frequency as MF is also WRONG.",
    ground_truth: "TWR 118.7 (South) 119.55 (North)",
    tags: ["evaluator", "inference", "frequency", "tower"],
  },
];
