/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as gateway from "../gateway.js";
import type * as knowledge from "../knowledge.js";
import type * as lib_common from "../lib/common.js";
import type * as lib_entities from "../lib/entities.js";
import type * as lib_links from "../lib/links.js";
import type * as lib_searchIndex from "../lib/searchIndex.js";
import type * as lib_sources from "../lib/sources.js";
import type * as links from "../links.js";
import type * as maintenance from "../maintenance.js";
import type * as operations from "../operations.js";
import type * as people from "../people.js";
import type * as projects from "../projects.js";
import type * as read from "../read.js";
import type * as tasks from "../tasks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  gateway: typeof gateway;
  knowledge: typeof knowledge;
  "lib/common": typeof lib_common;
  "lib/entities": typeof lib_entities;
  "lib/links": typeof lib_links;
  "lib/searchIndex": typeof lib_searchIndex;
  "lib/sources": typeof lib_sources;
  links: typeof links;
  maintenance: typeof maintenance;
  operations: typeof operations;
  people: typeof people;
  projects: typeof projects;
  read: typeof read;
  tasks: typeof tasks;
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

export declare const components: {};
