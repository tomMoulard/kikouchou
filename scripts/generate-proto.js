import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const genDir = path.join(__dirname, "..", "src", "gen");
const TS_NOCHECK = "// @ts-nocheck";

for (const file of fs.readdirSync(genDir)) {
  if (!file.endsWith(".ts")) continue;

  const filePath = path.join(genDir, file);
  const content = fs.readFileSync(filePath, "utf8");

  if (!content.startsWith(TS_NOCHECK)) {
    fs.writeFileSync(filePath, `${TS_NOCHECK}\n${content}`);
  }
}
