/**
 * The entry module of a release executable, and the checksum line beside it (#werk-dist).
 * The entry embeds every file of werk's own list and registers them before the command line starts.
 */

export type OwnList = {
  /** Built client files, as paths under the client output folder, with forward slashes. */
  client: string[];
  /** Verb module file names. */
  verbs: string[];
  /** Subagent definition file names. They are imported as text by the code, so the build only records them. */
  subagents: string[];
};

export type EntryPaths = {
  /** The folder of the client output. */
  clientDir: string;
  /** The folder of the verb modules. */
  verbsDir: string;
  /** The own-file module and the command line module. */
  ownModule: string;
  cliModule: string;
};

/** The address that a client file has in the page. */
export const clientAddress = (file: string): string => `/${file}`;

const quote = (value: string): string => JSON.stringify(value);

/** The source of the entry module. A file import with type file puts the file inside the executable. */
export function entrySource(list: OwnList, paths: EntryPaths): string {
  const imports = list.client.map(
    (file, i) =>
      `import client${i} from ${quote(`${paths.clientDir}/${file}`)} with { type: "file" };`,
  );
  const client = list.client.map(
    (file, i) => `  ${quote(clientAddress(file))}: client${i},`,
  );
  const verbs = list.verbs.map(
    (name) =>
      `  { name: ${quote(name)}, load: () => import(${quote(`${paths.verbsDir}/${name}`)}) },`,
  );
  return [
    `import { registerOwnFiles } from ${quote(paths.ownModule)};`,
    ...imports,
    "",
    "registerOwnFiles({",
    "  client: {",
    ...client,
    "  },",
    "  verbs: [",
    ...verbs,
    "  ],",
    "});",
    "",
    `await import(${quote(paths.cliModule)});`,
    "",
  ].join("\n");
}

/** One line in the format of `shasum -a 256 -c`: the digest, two spaces, the file name. */
export const checksumLine = (digest: string, fileName: string): string =>
  `${digest}  ${fileName}\n`;
