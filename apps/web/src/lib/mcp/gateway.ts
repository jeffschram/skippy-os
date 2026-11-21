import { signEnvelope, type OAuthPrincipal, type OperationName } from "@skippy/shared";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import type { McpConfig } from "./config";

const gatewayCall = makeFunctionReference<"action", { payload: string; signature: string }, unknown>("gateway:call");

/** A refusal from the Convex gateway, with the short code it gave. */
export class GatewayRefusal extends Error {
  constructor(public readonly code: string) {
    super(`Skippy refused the request: ${code}`);
    this.name = "GatewayRefusal";
  }
}

/**
 * Runs one operation in Convex for a verified caller. The operation, its
 * arguments and the caller are signed into a one-use envelope; Convex runs
 * nothing that does not arrive this way.
 */
export async function callGateway(
  config: McpConfig,
  principal: OAuthPrincipal,
  operation: OperationName,
  args: Record<string, unknown>,
): Promise<unknown> {
  const signed = await signEnvelope({ operation, args, principal }, config.gatewaySecret);
  try {
    return await new ConvexHttpClient(config.convexUrl).action(gatewayCall, signed);
  } catch (error) {
    if (error instanceof ConvexError) {
      const code = (error.data as { code?: unknown } | undefined)?.code;
      throw new GatewayRefusal(typeof code === "string" ? code : "refused");
    }
    throw error;
  }
}
