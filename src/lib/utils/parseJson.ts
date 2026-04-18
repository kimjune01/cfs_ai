const parseJsonObject = <T>(raw: string): T | null => {
  try {
    const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
};

export { parseJsonObject };
