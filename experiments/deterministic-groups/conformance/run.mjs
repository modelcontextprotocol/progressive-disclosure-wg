import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runSuite } from "./suite.mjs";

const moduleURL = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]))
  : new URL("./reference-adapter.mjs", import.meta.url);
const report = await runSuite(await import(moduleURL.href));
console.log(JSON.stringify(report, null, 2));
if (report.results.some((r) => r.status !== "passed")) process.exitCode = 1;
