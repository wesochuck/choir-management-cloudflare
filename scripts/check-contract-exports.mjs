import { readFile } from "node:fs/promises";

const contractsDirectory = new URL("../packages/contracts/src/", import.meta.url);
const barrel = await readFile(new URL("index.ts", contractsDirectory), "utf8");
const snapshot = JSON.parse(
  await readFile(new URL("export-names.snapshot.json", contractsDirectory), "utf8"),
);
const exportPattern = /export\s+(?:const|function|class|type)\s+([A-Za-z0-9_]+)/g;
const actual = [];

for (const match of barrel.matchAll(/export \* from "(\.\/[^"\\]+)"/g)) {
  const moduleSource = await readFile(new URL(`${match[1]}.ts`, contractsDirectory), "utf8");
  for (const exportMatch of moduleSource.matchAll(exportPattern)) actual.push(exportMatch[1]);
}

const actualSorted = actual.toSorted();
const expectedSorted = [...snapshot].toSorted();
if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
  const missing = expectedSorted.filter((name) => !actualSorted.includes(name));
  const extra = actualSorted.filter((name) => !expectedSorted.includes(name));
  throw new Error(
    `Contract export surface changed: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`,
  );
}

console.log(`Contract export surface unchanged: ${actualSorted.length} names.`);
