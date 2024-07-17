import { stringifyYaml } from "obsidian";
import { z } from "zod";
import { AnyParams, RoutePath } from "src/routes";
import { incomingBaseParams, noteTargetingParams } from "src/schemata";
import {
  HandlerFailure,
  HandlerFileSuccess,
  HandlerPropertiesSuccess,
} from "src/types";
import { propertiesForFile, updateNote } from "src/utils/file-handling";
import { hardValidateNoteTargetingAndResolvePath } from "src/utils/parameters";
import { helloRoute } from "src/utils/routing";
import { success } from "src/utils/results-handling";
import {
  zodJsonPropertiesObject,
  zodJsonStringArray,
  zodOptionalBoolean,
} from "src/utils/zod";

// SCHEMATA ----------------------------------------

const getParams = incomingBaseParams
  .merge(noteTargetingParams)
  .extend({
    silent: zodOptionalBoolean,
    "x-error": z.string().url(),
    "x-success": z.string().url(),
  })
  .transform(hardValidateNoteTargetingAndResolvePath);
type GetParams = z.infer<typeof getParams>;

const setParams = incomingBaseParams
  .merge(noteTargetingParams)
  .extend({
    properties: zodJsonPropertiesObject,
    mode: z.enum(["overwrite", "update"]).optional(),
  })
  .transform(hardValidateNoteTargetingAndResolvePath);
type SetParams = z.infer<typeof setParams>;

const removeKeysParams = incomingBaseParams
  .merge(noteTargetingParams)
  .extend({
    keys: zodJsonStringArray,
  })
  .transform(hardValidateNoteTargetingAndResolvePath);
type RemoveKeysParams = z.infer<typeof removeKeysParams>;

export type AnyLocalParams =
  | GetParams
  | SetParams
  | RemoveKeysParams;

// ROUTES --------------------

export const routePath: RoutePath = {
  "/note-properties": [
    helloRoute(),
    { path: "/get", schema: getParams, handler: handleGet },
    { path: "/set", schema: setParams, handler: handleSet },
    { path: "/clear", schema: getParams, handler: handleClear },
    {
      path: "/remove-keys",
      schema: removeKeysParams,
      handler: handleRemoveKeys,
    },
  ],
};

// HANDLERS --------------------

async function handleGet(
  incomingParams: AnyParams,
): Promise<HandlerPropertiesSuccess | HandlerFailure> {
  const { _computed: { tFile } } = incomingParams as GetParams;
  return success({ properties: propertiesForFile(tFile!) }, tFile?.path);
}

async function handleSet(
  incomingParams: AnyParams,
): Promise<HandlerFileSuccess | HandlerFailure> {
  const { _computed: { tFile }, mode, properties } =
    incomingParams as SetParams;
  const props = mode === "update"
    ? { ...propertiesForFile(tFile!), ...properties }
    : properties;

  return updateNote(tFile!.path, sanitizedStringifyYaml(props));
}

async function handleClear(
  incomingParams: AnyParams,
): Promise<HandlerFileSuccess | HandlerFailure> {
  const { _computed: { path } } = incomingParams as GetParams;
  return updateNote(path, "");
}

async function handleRemoveKeys(
  incomingParams: AnyParams,
): Promise<HandlerFileSuccess | HandlerFailure> {
  const { _computed: { path, tFile }, keys } =
    incomingParams as RemoveKeysParams;

  const props = propertiesForFile(tFile!)!;
  (<string[]> keys).forEach((key) => delete props[key]);

  return updateNote(path, sanitizedStringifyYaml(props));
}

function sanitizedStringifyYaml(props: any): string {
  return Object.keys(props).length > 0 ? stringifyYaml(props).trim() : "";
}
