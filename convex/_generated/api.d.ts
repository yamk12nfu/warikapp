/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_claude from "../ai/claude.js";
import type * as ai_config from "../ai/config.js";
import type * as ai_gemini from "../ai/gemini.js";
import type * as ai_index from "../ai/index.js";
import type * as ai_types from "../ai/types.js";
import type * as couples from "../couples.js";
import type * as expenses from "../expenses.js";
import type * as lib_auth from "../lib/auth.js";
import type * as rateLimits from "../rateLimits.js";
import type * as receipts from "../receipts.js";
import type * as settlements from "../settlements.js";
import type * as uploads from "../uploads.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "ai/claude": typeof ai_claude;
  "ai/config": typeof ai_config;
  "ai/gemini": typeof ai_gemini;
  "ai/index": typeof ai_index;
  "ai/types": typeof ai_types;
  couples: typeof couples;
  expenses: typeof expenses;
  "lib/auth": typeof lib_auth;
  rateLimits: typeof rateLimits;
  receipts: typeof receipts;
  settlements: typeof settlements;
  uploads: typeof uploads;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
