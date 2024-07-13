import { TFile } from "obsidian";
import { z } from "zod";
import { STRINGS } from "../constants";
import {
  AnyParams,
  CreateApplyParameterValue,
  CreateContentParams,
  CreatePeriodicNoteParams,
  CreateTemplateParams,
  RoutePath,
} from "../routes";
import {
  incomingBaseParams,
  NoteTargetingParamKey,
  noteTargetingParams,
} from "../schemata";
import {
  HandlerFailure,
  HandlerFileSuccess,
  HandlerPathsSuccess,
  HandlerTextSuccess,
} from "../types";
import {
  appendNote,
  appendNoteBelowHeadline,
  applyCorePluginTemplate,
  createNote,
  createOrOverwriteNote,
  getNote,
  getNoteDetails,
  prependNote,
  prependNoteBelowHeadline,
  renameFilepath,
  sanitizeFilePath,
  searchAndReplaceInNote,
  touchNote,
  trashFilepath,
} from "../utils/file-handling";
import { self } from "../utils/self";
import {
  hardValidateNoteTargetingAndResolvePath,
  softValidateNoteTargetingAndResolvePath,
} from "../utils/parameters";
import {
  getEnabledCommunityPlugin,
  getEnabledCorePlugin,
} from "../utils/plugins";
import { ErrorCode, failure, success } from "../utils/results-handling";
import { helloRoute } from "../utils/routing";
import { parseStringIntoRegex } from "../utils/string-handling";
import {
  createPeriodNote,
  PeriodicNoteType,
} from "../utils/periodic-notes-handling";
import { focusOrOpenFile } from "../utils/ui";
import {
  zodAlwaysFalse,
  zodExistingTemplaterPath,
  zodExistingTemplatesPath,
  zodOptionalBoolean,
  zodSanitizedNotePath,
} from "../utils/zod";

// SCHEMATA ----------------------------------------

const justReturnCallParams = incomingBaseParams
  .extend({
    "x-error": z.string().url(),
    "x-success": z.string().url(),
  });
type JustReturnCallParams = z.infer<typeof justReturnCallParams>;

const getParams = incomingBaseParams
  .merge(noteTargetingParams)
  .extend({
    silent: zodOptionalBoolean,
    "x-error": z.string().url(),
    "x-success": z.string().url(),
  })
  .transform(hardValidateNoteTargetingAndResolvePath);
type GetParams = z.infer<typeof getParams>;

const readNamedParams = incomingBaseParams
  .extend({
    file: zodSanitizedNotePath,
    "sort-by": z.enum([
      "best-guess",
      "path-asc",
      "path-desc",
      "ctime-asc",
      "ctime-desc",
      "mtime-asc",
      "mtime-desc",
      "",
    ]).optional(),
    "x-error": z.string().url(),
    "x-success": z.string().url(),
  });
type ReadFirstNamedParams = z.infer<typeof readNamedParams>;

const openParams = incomingBaseParams
  .merge(noteTargetingParams)
  .extend({
    silent: zodAlwaysFalse,
  })
  .transform(hardValidateNoteTargetingAndResolvePath);
type OpenParams = z.infer<typeof openParams>;

const createStandardNoteParams = incomingBaseParams
  .extend({
    file: zodSanitizedNotePath,
    "if-exists": z.enum(["overwrite", "skip", ""]).optional(),
    silent: zodOptionalBoolean,
  });
const createParams = z.union([
  createStandardNoteParams
    .extend({
      // This sets the default value for `apply` to `content`. The default fallback
      // only works when the `apply` is missing from the input; if it's there but
      // empty, the default won't be applied, and the route will return an error.
      apply: z.literal(CreateApplyParameterValue.Content)
        .optional()
        .default(CreateApplyParameterValue.Content),
      content: z.string().optional(),
    }),
  createStandardNoteParams
    .extend({
      apply: z.literal(CreateApplyParameterValue.Templater),
      "template-file": zodExistingTemplaterPath,
    }),
  createStandardNoteParams
    .extend({
      apply: z.literal(CreateApplyParameterValue.Templates),
      "template-file": zodExistingTemplatesPath,
    }),
  incomingBaseParams
    .extend({
      "periodic-note": z.nativeEnum(PeriodicNoteType),
      "if-exists": z.enum(["overwrite", "skip", ""]).optional(),
      silent: zodOptionalBoolean,
    }),
])
  .transform(softValidateNoteTargetingAndResolvePath);
type CreateParams = z.infer<typeof createParams>;

const appendParams = incomingBaseParams
  .merge(noteTargetingParams)
  .extend({
    content: z.string(),
    silent: zodOptionalBoolean,
    "below-headline": z.string().optional(),
    "create-if-not-found": zodOptionalBoolean,
    "ensure-newline": zodOptionalBoolean,
  })
  .transform(softValidateNoteTargetingAndResolvePath);
type AppendParams = z.infer<typeof appendParams>;

const prependParams = incomingBaseParams
  .merge(noteTargetingParams)
  .extend({
    content: z.string(),
    silent: zodOptionalBoolean,
    "below-headline": z.string().optional(),
    "create-if-not-found": zodOptionalBoolean,
    "ensure-newline": zodOptionalBoolean,
    "ignore-front-matter": zodOptionalBoolean,
  })
  .transform(softValidateNoteTargetingAndResolvePath);
type PrependParams = z.infer<typeof prependParams>;

const touchParams = incomingBaseParams
  .merge(noteTargetingParams)
  .extend({
    silent: zodOptionalBoolean,
  })
  .transform(hardValidateNoteTargetingAndResolvePath);
type TouchParams = z.infer<typeof touchParams>;

const searchAndReplaceParams = incomingBaseParams
  .merge(noteTargetingParams)
  .extend({
    silent: zodOptionalBoolean,
    search: z.string().min(1, { message: "can't be empty" }),
    replace: z.string(),
  })
  .transform(hardValidateNoteTargetingAndResolvePath);
type SearchAndReplaceParams = z.infer<typeof searchAndReplaceParams>;

const deleteParams = incomingBaseParams
  .merge(noteTargetingParams)
  .transform(hardValidateNoteTargetingAndResolvePath);
type DeleteParams = z.infer<typeof deleteParams>;

const renameParams = incomingBaseParams
  .merge(noteTargetingParams)
  .extend({
    "new-filename": zodSanitizedNotePath,
    silent: zodOptionalBoolean,
  })
  .transform(hardValidateNoteTargetingAndResolvePath);
type RenameParams = z.infer<typeof renameParams>;

export type AnyLocalParams =
  | JustReturnCallParams
  | GetParams
  | ReadFirstNamedParams
  | OpenParams
  | CreateParams
  | AppendParams
  | PrependParams
  | TouchParams
  | SearchAndReplaceParams
  | DeleteParams
  | RenameParams;

// ROUTES ----------------------------------------

export const routePath: RoutePath = {
  "/note": [
    helloRoute(),
    { path: "/list", schema: justReturnCallParams, handler: handleList },
    { path: "/get", schema: getParams, handler: handleGet },
    {
      path: "/get-first-named",
      schema: readNamedParams,
      handler: handleGetNamed,
    },
    {
      path: "/get-active",
      schema: justReturnCallParams,
      handler: handleGetActive,
    },
    { path: "/open", schema: openParams, handler: handleOpen },
    { path: "/create", schema: createParams, handler: handleCreate },
    { path: "/append", schema: appendParams, handler: handleAppend },
    { path: "/prepend", schema: prependParams, handler: handlePrepend },
    { path: "/touch", schema: touchParams, handler: handleTouch },
    { path: "/delete", schema: deleteParams, handler: handleDelete },
    { path: "/trash", schema: deleteParams, handler: handleTrash },
    { path: "/rename", schema: renameParams, handler: handleRename },
    {
      path: "/search-string-and-replace",
      schema: searchAndReplaceParams,
      handler: handleSearchStringAndReplace,
    },
    {
      path: "/search-regex-and-replace",
      schema: searchAndReplaceParams,
      handler: handleSearchRegexAndReplace,
    },
  ],
};

// HANDLERS ----------------------------------------

async function handleList(
  incomingParams: AnyParams,
): Promise<HandlerPathsSuccess | HandlerFailure> {
  return success({
    paths: self().app.vault.getMarkdownFiles().map((t) => t.path).sort(),
  });
}

/**
 * Handler for `/note/get`. Existence of note is checked by the schema, i.e. the
 * handler won't be called if the file doesn't exist.
 */
async function handleGet(
  incomingParams: AnyParams,
): Promise<HandlerFileSuccess | HandlerFailure> {
  const { _computed: { path }, silent } = incomingParams as GetParams;
  const res = await getNoteDetails(path);
  if (res.isSuccess && !silent) await focusOrOpenFile(path);
  return res;
}

async function handleGetActive(
  incomingParams: AnyParams,
): Promise<HandlerFileSuccess | HandlerFailure> {
  const res = self().app.workspace.getActiveFile();
  if (res?.extension !== "md") {
    return failure(ErrorCode.NotFound, "No active note");
  }

  const res1 = await getNoteDetails(res.path);
  return (res1.isSuccess)
    ? res1
    : failure(ErrorCode.NotFound, "No active note");
}

async function handleGetNamed(
  incomingParams: AnyParams,
): Promise<HandlerFileSuccess | HandlerFailure> {
  const params = incomingParams as ReadFirstNamedParams;
  const { file } = params;
  const sortBy = params["sort-by"] || "best-guess";

  // "Best guess" means utilizing Obsidian's internal link resolution to find
  // the right note. If it's not found, we return a 404.
  if (sortBy === "best-guess") {
    const res = self().app.metadataCache
      .getFirstLinkpathDest(sanitizeFilePath(file), "/");
    return res
      ? await getNoteDetails(res.path)
      : failure(ErrorCode.NotFound, "No note found with that name");
  }

  // If we're here, we're sorting by something else. We need to find all notes
  // with that name, sort them as requested, and return the first one.
  const sortFns = {
    "path-asc": (a: TFile, b: TFile) => a.path.localeCompare(b.path),
    "path-desc": (a: TFile, b: TFile) => b.path.localeCompare(a.path),
    "ctime-asc": (a: TFile, b: TFile) => a.stat.ctime - b.stat.ctime,
    "ctime-desc": (a: TFile, b: TFile) => b.stat.ctime - a.stat.ctime,
    "mtime-asc": (a: TFile, b: TFile) => a.stat.mtime - b.stat.mtime,
    "mtime-desc": (a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime,
  };

  const res = self().app.vault.getMarkdownFiles()
    .sort(sortFns[sortBy])
    .find((tf) => tf.name === file);
  if (!res) return failure(ErrorCode.NotFound, "No note found with that name");

  return await getNoteDetails(res.path);
}

/**
 * Handler for `/note/open`. Existence of note is checked by the schema, i.e. the
 * handler won't be called if the file doesn't exist.
 */
async function handleOpen(
  incomingParams: AnyParams,
): Promise<HandlerTextSuccess | HandlerFailure> {
  const { _computed: { path } } = incomingParams as OpenParams;
  const res = await getNote(path);
  return res.isSuccess
    ? success({ message: STRINGS.note_opened }, res.result.path)
    : res;
}

async function handleCreate(
  incomingParams: AnyParams,
): Promise<HandlerFileSuccess | HandlerFailure> {
  const {
    _computed: { inputKey, path },
    ["if-exists"]: ifExists,
    silent,
  } = incomingParams as CreateParams;
  const shouldOverwrite = ifExists === "overwrite";
  const shouldFocusNote = !silent;

  // If there already is a note with that name or at that path, deal with it.
  const resNoteExists = await getNote(path);
  const noteExists = resNoteExists.isSuccess;
  if (noteExists && ifExists === "skip") {
    // `skip` == Leave not as-is, we just return the existing note.
    if (!silent) await focusOrOpenFile(path);
    return await getNoteDetails(path);
  }

  return inputKey === NoteTargetingParamKey.PeriodicNote
    ? await createPeriodicNote(
      path,
      (incomingParams as CreatePeriodicNoteParams)["periodic-note"],
      noteExists,
      shouldOverwrite,
      shouldFocusNote,
    )
    : await createGeneralNote(
      path,
      (incomingParams as CreateContentParams).apply,
      (incomingParams as CreateContentParams).content,
      (incomingParams as CreateTemplateParams)["template-file"],
      noteExists,
      shouldOverwrite,
      shouldFocusNote,
    );
}

async function handleAppend(
  incomingParams: AnyParams,
): Promise<HandlerTextSuccess | HandlerFailure> {
  const {
    _computed: { inputKey, tFile, path: computedPath },
    ["below-headline"]: belowHeadline,
    ["create-if-not-found"]: shouldCreateNote,
    ["ensure-newline"]: shouldEnsureNewline,
    content,
    silent,
    uid,
  } = incomingParams as AppendParams;

  // If the note was requested via UID, doesn't exist but should be created,
  // we'll use the UID as path. Otherwise, we'll use the resolved path as it was
  // passed in.
  const path = (!tFile && inputKey === "uid" && shouldCreateNote)
    ? uid!
    : computedPath;

  async function appendAsRequested() {
    if (belowHeadline) {
      return await appendNoteBelowHeadline(path, belowHeadline, content);
    }

    return await appendNote(path, content, shouldEnsureNewline);
  }

  // If the file doesn't exist …
  if (!tFile) {
    // … check if we're supposed to create it. If not, back off.
    if (!shouldCreateNote) {
      return failure(ErrorCode.NotFound, STRINGS.note_not_found);
    }

    // We're supposed to create the note. We try to create it.
    const resCreate = await createNote(path, "");
    if (!resCreate.isSuccess) return resCreate;

    // If the note was requested via UID, we need to set the UID in the front
    // matter of the newly created note.
    if (inputKey === "uid") {
      await self().app.fileManager.processFrontMatter(
        resCreate.result,
        (fm) => fm[self().settings.frontmatterKey] = uid!,
      );
    }
  }

  // Manipulate the file.
  const resAppend = await appendAsRequested();
  if (resAppend.isSuccess) {
    if (!silent) await focusOrOpenFile(path);
    return success({ message: resAppend.result }, path);
  }
  return resAppend;
}

async function handlePrepend(
  incomingParams: AnyParams,
): Promise<HandlerTextSuccess | HandlerFailure> {
  const {
    _computed: { inputKey, tFile, path: computedPath },
    ["below-headline"]: belowHeadline,
    ["create-if-not-found"]: shouldCreateNote,
    ["ensure-newline"]: shouldEnsureNewline,
    ["ignore-front-matter"]: shouldIgnoreFrontMatter,
    content,
    silent,
    uid,
  } = incomingParams as PrependParams;

  // If the note was requested via UID, doesn't exist but should be created,
  // we'll use the UID as path. Otherwise, we'll use the resolved path as it was
  // passed in.
  const path = (!tFile && inputKey === "uid" && shouldCreateNote)
    ? uid!
    : computedPath;

  async function prependAsRequested() {
    if (belowHeadline) {
      return await prependNoteBelowHeadline(
        path,
        belowHeadline,
        content,
        shouldEnsureNewline,
      );
    }

    return await prependNote(
      path,
      content,
      shouldEnsureNewline,
      shouldIgnoreFrontMatter,
    );
  }

  // If the file doesn't exist …
  if (!tFile) {
    // … check if we're supposed to create it. If not, back off.
    if (!shouldCreateNote) {
      return failure(ErrorCode.NotFound, STRINGS.note_not_found);
    }

    // We're supposed to create the note. We try to create it.
    const resCreate = await createNote(path, "");
    if (!resCreate.isSuccess) return resCreate;

    // If the note was requested via UID, we need to set the UID in the front
    // matter of the newly created note.
    if (inputKey === "uid") {
      await self().app.fileManager.processFrontMatter(
        resCreate.result,
        (fm) => fm[self().settings.frontmatterKey] = uid!,
      );
    }
  }

  // Manipulate the file.
  const resPrepend = await prependAsRequested();
  if (resPrepend.isSuccess) {
    if (!silent) await focusOrOpenFile(path);
    return success({ message: resPrepend.result }, path);
  }
  return resPrepend;
}

async function handleTouch(
  incomingParams: AnyParams,
): Promise<HandlerTextSuccess | HandlerFailure> {
  const { _computed: { path }, silent } = incomingParams as TouchParams;

  const res = await touchNote(path);
  if (!res.isSuccess) return res;
  if (!silent) await focusOrOpenFile(path);
  return success({ message: STRINGS.touch_done }, path);
}

async function handleSearchStringAndReplace(
  incomingParams: AnyParams,
): Promise<HandlerTextSuccess | HandlerFailure> {
  const { _computed: { path }, search, replace, silent } =
    incomingParams as SearchAndReplaceParams;

  const res = await searchAndReplaceInNote(path, search, replace);
  if (!res.isSuccess) return res;
  if (!silent) await focusOrOpenFile(path);
  return success({ message: res.result }, path);
}

async function handleSearchRegexAndReplace(
  incomingParams: AnyParams,
): Promise<HandlerTextSuccess | HandlerFailure> {
  const { _computed: { path }, search, replace, silent } =
    incomingParams as SearchAndReplaceParams;

  const resSir = parseStringIntoRegex(search);
  if (!resSir.isSuccess) return resSir;

  const res = await searchAndReplaceInNote(path, resSir.result, replace);
  if (!res.isSuccess) return res;
  if (!silent) await focusOrOpenFile(path);
  return success({ message: res.result }, path);
}

async function handleDelete(
  incomingParams: AnyParams,
): Promise<HandlerTextSuccess | HandlerFailure> {
  const { _computed: { path } } = incomingParams as DeleteParams;

  const res = await trashFilepath(path, true);
  return res.isSuccess ? success({ message: res.result }, path) : res;
}

async function handleTrash(
  incomingParams: AnyParams,
): Promise<HandlerTextSuccess | HandlerFailure> {
  const { _computed: { path } } = incomingParams as DeleteParams;

  const res = await trashFilepath(path);
  return res.isSuccess ? success({ message: res.result }, path) : res;
}

async function handleRename(
  incomingParams: AnyParams,
): Promise<HandlerTextSuccess | HandlerFailure> {
  const { _computed: { path }, ["new-filename"]: newPath } =
    incomingParams as RenameParams;

  const res = await renameFilepath(path, newPath);
  return res.isSuccess ? success({ message: res.result }, path) : res;
}

async function createPeriodicNote(
  path: string,
  periodicNoteType: PeriodicNoteType,
  noteExists: boolean,
  shouldOverwrite: boolean,
  shouldFocusNote: boolean,
): Promise<HandlerFileSuccess | HandlerFailure> {
  if (noteExists) {
    if (shouldOverwrite) {
      await trashFilepath(path);
    } else {
      if (shouldFocusNote) await focusOrOpenFile(path);
      return await getNoteDetails(path);
    }
  }

  const newNote = await createPeriodNote(periodicNoteType);
  if (!newNote) {
    return failure(
      ErrorCode.UnableToCreateNote,
      STRINGS.unable_to_write_note,
    );
  }

  if (shouldFocusNote) await focusOrOpenFile(path);
  return await getNoteDetails(path);
}

async function createGeneralNote(
  path: string,
  apply: CreateApplyParameterValue,
  content: string | undefined,
  templateFile: TFile | undefined,
  noteExists: boolean,
  shouldOverwrite: boolean,
  shouldFocusNote: boolean,
): Promise<HandlerFileSuccess | HandlerFailure> {
  const resCreate = (noteExists && shouldOverwrite)
    ? await createOrOverwriteNote(path, "")
    : await createNote(path, "");
  if (!resCreate.isSuccess) return resCreate;
  const newNote = resCreate.result;

  // If the user wants to apply a template, we need to check if the relevant
  // plugin is available, and if not, we return from here.
  // Testing for existence of template file is done by a zod schema, so we can
  // be sure the file exists.
  switch (apply) {
    case CreateApplyParameterValue.Content:
      await self().app.vault.modify(newNote, content || "");
      break;

    case CreateApplyParameterValue.Templater:
      const resPlugin1 = getEnabledCommunityPlugin("templater-obsidian");
      if (!resPlugin1.isSuccess) return resPlugin1;
      await resPlugin1.result.templater
        .write_template_to_file(templateFile!, newNote);
      break;

    case CreateApplyParameterValue.Templates:
      const resPlugin2 = getEnabledCorePlugin("templates");
      if (!resPlugin2.isSuccess) return resPlugin2;
      await applyCorePluginTemplate(templateFile!, newNote);
      break;
  }

  if (shouldFocusNote) await focusOrOpenFile(newNote.path);
  return await getNoteDetails(newNote.path);
}
