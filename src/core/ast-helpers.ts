import type { FetchCallInfo, JsonBodyProperty } from "./types";

type TS = typeof import("typescript");
type SourceFile = import("typescript").SourceFile;
type Node = import("typescript").Node;

/**
 * Find all fetch()/tf.get()/api.post() calls in a source file.
 */
export function findFetchCalls(ts: TS, sourceFile: SourceFile): FetchCallInfo[] {
  const results: FetchCallInfo[] = [];

  function nodeStart(node: Node): number {
    return node.getStart(sourceFile);
  }
  function nodeLen(node: Node): number {
    return node.getEnd() - nodeStart(node);
  }

  function visit(node: Node) {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const expr = node.expression;
      let httpMethod: string | null = null;

      if (ts.isIdentifier(expr) && (expr.text === "fetch" || expr.text === "typedFetch")) {
        httpMethod = null;
      } else if (
        ts.isPropertyAccessExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        ["get", "post", "put", "patch", "delete", "head", "request"].includes(expr.name.text)
      ) {
        httpMethod = expr.name.text === "request" || expr.name.text === "head" ? null : expr.name.text;
      } else if (ts.isIdentifier(expr)) {
        httpMethod = null;
      } else {
        ts.forEachChild(node, visit);
        return;
      }

      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        const urlStart = nodeStart(arg) + 1; // skip opening quote
        const urlLength = nodeLen(arg) - 2; // exclude quotes

        let jsonBody: JsonBodyProperty[] | null = null;
        if (node.arguments.length >= 2) {
          const optionsArg = node.arguments[1];
          if (ts.isObjectLiteralExpression(optionsArg)) {
            const jsonProp = optionsArg.properties.find(
              (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "body",
            ) as import("typescript").PropertyAssignment | undefined;
            if (jsonProp && ts.isObjectLiteralExpression(jsonProp.initializer)) {
              jsonBody = extractJsonProperties(ts, sourceFile, jsonProp.initializer);
            }
          }
        }

        results.push({
          url: arg.text,
          httpMethod,
          urlStart,
          urlLength,
          callStart: nodeStart(node),
          callLength: nodeLen(node),
          jsonBody,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

function extractJsonProperties(
  ts: TS,
  sf: SourceFile,
  obj: import("typescript").ObjectLiteralExpression,
): JsonBodyProperty[] {
  function nodeStart(n: Node): number {
    return n.getStart(sf);
  }
  function nodeLen(n: Node): number {
    return n.getEnd() - nodeStart(n);
  }

  const props: JsonBodyProperty[] = [];
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (!name) continue;

    const valueNode = prop.initializer;
    let valueKind: JsonBodyProperty["valueKind"] = "other";
    let valueText = "";

    if (ts.isNumericLiteral(valueNode)) {
      valueKind = "number";
      valueText = valueNode.text;
    } else if (ts.isStringLiteral(valueNode)) {
      valueKind = "string";
      valueText = valueNode.text;
    } else if (valueNode.kind === ts.SyntaxKind.TrueKeyword || valueNode.kind === ts.SyntaxKind.FalseKeyword) {
      valueKind = "boolean";
      valueText = valueNode.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false";
    } else if (valueNode.kind === ts.SyntaxKind.NullKeyword) {
      valueKind = "null";
    } else if (ts.isArrayLiteralExpression(valueNode)) {
      valueKind = "array";
    } else if (ts.isObjectLiteralExpression(valueNode)) {
      valueKind = "object";
    }

    props.push({
      name,
      nameStart: nodeStart(prop.name),
      nameLength: nodeLen(prop.name),
      valueStart: nodeStart(valueNode),
      valueLength: nodeLen(valueNode),
      valueText,
      valueKind,
    });
  }
  return props;
}
