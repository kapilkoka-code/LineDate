import { readFile, writeFile } from "node:fs/promises";

const indexPath = new URL("../api-zod/src/index.ts", import.meta.url);
const source = await readFile(indexPath, "utf8");
const fixed = source
  .split("\n")
  .filter((line) => !line.includes("./generated/types"))
  .join("\n");
await writeFile(indexPath, fixed);