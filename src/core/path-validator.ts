import type { OpenAPISpec } from "./types";

export function matchesPathTemplate(actualPath: string, templatePath: string): boolean {
  const actualParts = actualPath.split("/");
  const templateParts = templatePath.split("/");
  if (actualParts.length !== templateParts.length) return false;
  return templateParts.every((tp, i) => tp.startsWith("{") || tp === actualParts[i]);
}

export function pathExistsInSpec(path: string, spec: OpenAPISpec): boolean {
  if (spec.paths[path]) return true;
  return Object.keys(spec.paths).some((tp) => matchesPathTemplate(path, tp));
}

export function findSpecPath(apiPath: string, spec: OpenAPISpec): string | null {
  if (spec.paths[apiPath]) return apiPath;
  return Object.keys(spec.paths).find((tp) => matchesPathTemplate(apiPath, tp)) ?? null;
}

export function findClosestPath(target: string, paths: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const p of paths) {
    const d = levenshtein(target, p);
    if (d < bestDist && d <= Math.max(target.length, p.length) * 0.4) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
