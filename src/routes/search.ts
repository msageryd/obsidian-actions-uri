import { z } from "zod";
import { basePayloadSchema } from "../schemata";
import {
  AnyHandlerResult,
  HandlerFailure,
  HandlerTextSuccess,
  Route,
  ZodSafeParseSuccessData,
} from "../types";

// SCHEMATA --------------------

const Payload = z.object({
  ...basePayloadSchema,
  query: z.string().min(1, { message: "can't be empty" }),
});

export type PayloadUnion = z.infer<typeof Payload>;

// ROUTES --------------------

export const routes: Route[] = [
  { path: "search", schema: Payload, handler: handleSearch },
];

// HANDLERS --------------------

// TODO: handleSearch()
async function handleSearch(
  data: ZodSafeParseSuccessData,
): Promise<AnyHandlerResult> {
  const payload = data as z.infer<typeof Payload>;
  console.log("handleSearch", payload);
  return <HandlerTextSuccess> {
    success: true,
    data: { result: "" },
    input: payload,
  };
}
