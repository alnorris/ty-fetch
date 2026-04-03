import type { FetchCallInfo } from "./types";
type TS = typeof import("typescript");
type SourceFile = import("typescript").SourceFile;
/**
 * Find all fetch()/tf.get()/api.post() calls in a source file.
 */
export declare function findFetchCalls(ts: TS, sourceFile: SourceFile): FetchCallInfo[];
export {};
