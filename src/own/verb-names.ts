/** The names of the verb modules, written into this code when the bundler reads it (#werk-dist-own-list). */
import { verbNames } from "./verb-names.macro.ts" with { type: "macro" };

export const VERB_MODULE_NAMES: readonly string[] = verbNames();
