import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSourceRoot = join(repositoryRoot, "apps/worker/src");
const entryRelative = "organization/OrganizationStore.ts";
const schedulerRelative = "organization/scheduler.ts";

const exceptions = [
  {
    debtId: "DO-IO-001",
    expectedCount: 1,
    path: "organization/organizationEmailSettingsStore.ts",
    reason: "Legacy DoH email-domain verification; move Worker-side separately.",
    rule: "external-fetch",
  },
  {
    debtId: "DO-CONCURRENCY-INIT",
    expectedCount: 1,
    path: "organization/OrganizationStore.ts",
    reason: "Constructor migration/initialization barrier only.",
    rule: "block-concurrency",
  },
  {
    debtId: "DO-QUEUE-HANDOFF",
    expectedCount: 1,
    path: "organization/scheduler.ts",
    reason: "Approved bounded DO-to-JOBS_QUEUE handoff in runOrganizationAlarm.",
    rule: "queue-send",
  },
];

const providerPathPrefixes = [
  "payments/",
  "communications/provider",
  "auth/platformEmail",
  "jobs/deliveries",
];

const providerSdkSpecifiers = [
  "stripe",
  "@stripe/",
  "brevo",
  "@getbrevo/",
  "resend",
  "twilio",
  "sendgrid",
  "@sendgrid/",
];

const credentialPattern =
  /\b(PLATFORM_EMAIL|BREVO_API_KEY|STRIPE_SECRET_KEY|CLOUDFLARE_API_TOKEN)\b/g;

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function stripComments(source) {
  let result = "";
  let i = 0;
  const length = source.length;
  let state = "code";
  let stringQuote = "";
  while (i < length) {
    const char = source[i];
    const next = source[i + 1] ?? "";
    if (state === "code") {
      if (char === '"' || char === "'" || char === "`") {
        state = "string";
        stringQuote = char;
        result += char;
        i += 1;
      } else if (char === "/" && next === "/") {
        while (i < length && source[i] !== "\n") {
          result += " ";
          i += 1;
        }
      } else if (char === "/" && next === "*") {
        result += "  ";
        i += 2;
        while (i < length) {
          if (source[i] === "*" && source[i + 1] === "/") {
            result += "  ";
            i += 2;
            break;
          }
          result += source[i] === "\n" ? "\n" : " ";
          i += 1;
        }
      } else {
        result += char;
        i += 1;
      }
    } else {
      result += char;
      if (char === "\\") {
        const escaped = source[i + 1] ?? "";
        result += escaped;
        i += 2;
        continue;
      }
      if (char === stringQuote) {
        state = "code";
        stringQuote = "";
      }
      i += 1;
    }
  }
  return result;
}

function lineNumber(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function lineText(source, index) {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  let end = source.indexOf("\n", index);
  if (end === -1) end = source.length;
  return source.slice(start, end);
}

function extractRuntimeImports(stripped) {
  const imports = [];
  const patterns = [
    /import\s*['"]([^'"]+)['"]/g,
    /import\s+(?!type(?:\s|$|;))[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /export\s+(?!type\b)[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(stripped)) !== null) {
      const specifier = match[1];
      if (!specifier) continue;
      const full = match[0];
      if (full.startsWith("import type") || full.startsWith("export type")) continue;
      const offset = match.index + full.indexOf(specifier);
      imports.push({
        line: lineNumber(stripped, match.index),
        offset,
        specifier,
      });
    }
  }
  return imports;
}

function resolveRelativeImport(fromFileAbs, specifier) {
  const fromDir = dirname(fromFileAbs);
  const base = resolve(fromDir, specifier);
  const candidates = [];
  if (specifier.endsWith(".js")) {
    candidates.push(resolve(fromDir, specifier.slice(0, -3) + ".ts"));
    candidates.push(`${base.slice(0, -3)}/index.ts`);
  } else if (specifier.endsWith(".ts")) {
    candidates.push(base);
  } else {
    candidates.push(`${base}.ts`);
    candidates.push(join(base, "index.ts"));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
}

function buildGraph(sourceRoot, entryRel) {
  const entryAbs = join(sourceRoot, entryRel);
  const files = new Map();
  const errors = [];
  const queue = [entryAbs];
  const seen = new Set();
  if (!existsSync(entryAbs)) {
    errors.push(`graph: entry ${entryRel} does not exist`);
    return { errors, files };
  }
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    let raw;
    try {
      raw = readFileSync(current, "utf8");
    } catch {
      errors.push(`graph: cannot read ${toPosix(relative(sourceRoot, current))}`);
      continue;
    }
    const stripped = stripComments(raw);
    const imports = extractRuntimeImports(stripped);
    files.set(current, {
      imports,
      raw,
      relative: toPosix(relative(sourceRoot, current)),
      stripped,
    });
    for (const imp of imports) {
      if (!imp.specifier.startsWith(".")) continue;
      const resolved = resolveRelativeImport(current, imp.specifier);
      if (!resolved) {
        errors.push(
          `${toPosix(relative(sourceRoot, current))}:${imp.line}: unresolved relative runtime import "${imp.specifier}"`,
        );
        continue;
      }
      const resolvedRelative = toPosix(relative(sourceRoot, resolved));
      if (resolvedRelative.startsWith("..") || resolvedRelative.startsWith("/")) continue;
      if (!resolved.endsWith(".ts")) continue;
      if (!seen.has(resolved) && !queue.includes(resolved)) queue.push(resolved);
    }
  }
  return { errors, files };
}

function findAll(stripped, pattern) {
  const results = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(stripped)) !== null) {
    results.push({ index: match.index, match: match[0] });
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return results;
}

function findExternalFetch(stripped) {
  const candidates = findAll(stripped, /\bfetch\s*\(/g);
  const results = [];
  for (const candidate of candidates) {
    let before = candidate.index - 1;
    while (before >= 0 && (stripped[before] === " " || stripped[before] === "\t")) before -= 1;
    if (before >= 0 && stripped[before] === ".") continue;
    const text = lineText(stripped, candidate.index);
    if (/^\s*(?:(?:public|override|async)\s+)+fetch\s*\(/.test(text)) continue;
    results.push({ line: lineNumber(stripped, candidate.index) });
  }
  return results;
}

function findSimple(stripped, pattern) {
  return findAll(stripped, pattern).map((entry) => ({
    line: lineNumber(stripped, entry.index),
  }));
}

function isProviderLocalPath(relativePosix) {
  return providerPathPrefixes.some((prefix) => relativePosix.startsWith(prefix));
}

function isProviderSdkSpecifier(specifier) {
  return providerSdkSpecifiers.some((sdk) =>
    sdk.endsWith("/") ? specifier.startsWith(sdk) : specifier === sdk,
  );
}

function checkGraph(sourceRoot, files, ruleExceptions = exceptions) {
  const failures = [];
  const countsByRuleAndPath = new Map();

  function recordCount(rule, relativePath, count) {
    countsByRuleAndPath.set(`${rule}::${relativePath}`, count);
  }

  for (const [, file] of files) {
    const { relative: relativePath, stripped } = file;
    const fetchHits = findExternalFetch(stripped);
    recordCount("external-fetch", relativePath, fetchHits.length);
    const timerHits = findSimple(stripped, /\b(setTimeout|setInterval)\s*\(/g);
    recordCount("timer", relativePath, timerHits.length);
    const newSocketHits = findSimple(stripped, /\bnew\s+WebSocket\s*\(/g);
    const socketImportHits = file.imports.filter(
      (imp) =>
        imp.specifier === "cloudflare:sockets" || imp.specifier.startsWith("cloudflare:sockets"),
    );
    recordCount("socket", relativePath, newSocketHits.length + socketImportHits.length);
    const doSocketHits = findSimple(stripped, /\b(acceptWebSocket|setWebSocketAutoResponse)\s*\(/g);
    recordCount("do-websocket", relativePath, doSocketHits.length);
    const waitHits = findSimple(stripped, /\bwaitUntil\s*\(/g);
    recordCount("waitUntil", relativePath, waitHits.length);
    const blockHits = findSimple(stripped, /\bblockConcurrencyWhile\s*\(/g);
    recordCount("block-concurrency", relativePath, blockHits.length);
    const alarmHits = findSimple(stripped, /\b(setAlarm|deleteAlarm)\s*\(/g);
    recordCount("alarm", relativePath, alarmHits.length);
    const queueHits = findSimple(stripped, /\.\s*send(Batch)?\s*\(/g);
    recordCount("queue-send", relativePath, queueHits.length);
    credentialPattern.lastIndex = 0;
    const credentialHits = findSimple(stripped, credentialPattern);
    recordCount("credential", relativePath, credentialHits.length);

    for (const hit of timerHits) {
      failures.push(
        `${relativePath}:${hit.line}: long-lived timer in DO runtime graph; keep the Organization DO hibernation-friendly`,
      );
    }
    for (const hit of newSocketHits) {
      failures.push(
        `${relativePath}:${hit.line}: outbound WebSocket in DO runtime graph; outbound connections keep the DO active`,
      );
    }
    for (const imp of socketImportHits) {
      failures.push(
        `${relativePath}:${imp.line}: cloudflare:sockets import in DO runtime graph; outbound sockets keep the DO active`,
      );
    }
    for (const hit of doSocketHits) {
      failures.push(
        `${relativePath}:${hit.line}: OrganizationStore WebSocket API is outside the current architecture`,
      );
    }
    for (const hit of waitHits) {
      failures.push(
        `${relativePath}:${hit.line}: waitUntil in a Durable Object is misleading and provides no lifetime benefit`,
      );
    }
    for (const hit of credentialHits) {
      failures.push(
        `${relativePath}:${hit.line}: provider credential/binding must stay Worker/queue-side`,
      );
    }
    for (const imp of file.imports) {
      if (imp.specifier.startsWith(".")) {
        const resolved = resolveRelativeImport(join(sourceRoot, relativePath), imp.specifier);
        if (resolved) {
          const resolvedRelative = toPosix(relative(sourceRoot, resolved));
          if (isProviderLocalPath(resolvedRelative)) {
            failures.push(
              `${relativePath}:${imp.line}: provider runtime dependency "${imp.specifier}" must stay Worker/queue-side`,
            );
          }
        }
      } else if (isProviderSdkSpecifier(imp.specifier)) {
        failures.push(
          `${relativePath}:${imp.line}: provider SDK import "${imp.specifier}" must stay Worker/queue-side`,
        );
      }
    }
  }

  const exceptionFor = (rule, path) =>
    ruleExceptions.find((e) => e.rule === rule && e.path === path);

  for (const [, file] of files) {
    const { relative: relativePath, stripped } = file;
    const fetchHits = findExternalFetch(stripped);
    for (const hit of fetchHits) {
      const allowed = exceptionFor("external-fetch", relativePath);
      if (!allowed) {
        failures.push(
          `${relativePath}:${hit.line}: external fetch in DO runtime graph; awaited external I/O keeps the DO activation busy`,
        );
      }
    }
    const blockHits = findSimple(stripped, /\bblockConcurrencyWhile\s*\(/g);
    for (const hit of blockHits) {
      const allowed = exceptionFor("block-concurrency", relativePath);
      if (!allowed) {
        failures.push(
          `${relativePath}:${hit.line}: blockConcurrencyWhile is limited to constructor initialization/migration`,
        );
      }
    }
    const queueHits = findSimple(stripped, /\.\s*send(Batch)?\s*\(/g);
    for (const hit of queueHits) {
      const allowed = exceptionFor("queue-send", relativePath);
      if (!allowed) {
        failures.push(
          `${relativePath}:${hit.line}: queue send from DO runtime graph; only the scheduler handoff may enqueue JOBS_QUEUE`,
        );
      }
    }
    const alarmHits = findSimple(stripped, /\b(setAlarm|deleteAlarm)\s*\(/g);
    for (const hit of alarmHits) {
      if (relativePath !== schedulerRelative) {
        failures.push(
          `${relativePath}:${hit.line}: direct alarm call outside scheduler.ts; request scheduler work through the shared alarm helpers`,
        );
      }
    }
  }

  for (const exception of ruleExceptions) {
    const key = `${exception.rule}::${exception.path}`;
    const actual = countsByRuleAndPath.get(key);
    if (actual === undefined) {
      failures.push(
        `allowlist: ${exception.rule} exception for ${exception.path} is stale (file not in DO runtime graph; ${exception.debtId})`,
      );
      continue;
    }
    if (actual !== exception.expectedCount) {
      failures.push(
        `allowlist: ${exception.rule} exception for ${exception.path} expected ${exception.expectedCount} but found ${actual} (${exception.debtId})`,
      );
    }
  }

  return { countsByRuleAndPath, failures };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runSelfTests() {
  const cleanFetch =
    "override async fetch(request: Request): Promise<Response> {\n  return new Response();\n}";
  assert(
    findExternalFetch(stripComments(cleanFetch)).length === 0,
    "OrganizationStore.fetch declaration must not count as external fetch",
  );
  const publicFetch =
    "public override async fetch(request: Request): Promise<Response> {\n  return new Response();\n}";
  assert(
    findExternalFetch(stripComments(publicFetch)).length === 0,
    "public override async fetch declaration must not count as external fetch",
  );
  const external = 'const r = await fetch("https://example.com");';
  assert(findExternalFetch(stripComments(external)).length === 1, "global fetch must be detected");
  const dotted = "await stub.fetch(request);";
  assert(
    findExternalFetch(stripComments(dotted)).length === 0,
    ".fetch transport must not count as external fetch",
  );
  const commented = '// await fetch("https://example.com")\nconst x = 1;';
  assert(
    findExternalFetch(stripComments(commented)).length === 0,
    "commented fetch must not count",
  );
  const timers = "setTimeout(() => {}, 100); setInterval(() => {}, 100);";
  assert(
    findSimple(stripComments(timers), /\b(setTimeout|setInterval)\s*\(/g).length === 2,
    "timers must be detected",
  );
  const waits = "ctx.waitUntil(promise);";
  assert(
    findSimple(stripComments(waits), /\bwaitUntil\s*\(/g).length === 1,
    "waitUntil must be detected",
  );
  const alarms = "await storage.setAlarm(Date.now() + 1);";
  assert(
    findSimple(stripComments(alarms), /\b(setAlarm|deleteAlarm)\s*\(/g).length === 1,
    "setAlarm must be detected",
  );
  const queues = "await queue.sendBatch(messages);";
  assert(
    findSimple(stripComments(queues), /\.\s*send(Batch)?\s*\(/g).length === 1,
    "queue sendBatch must be detected",
  );
  const sockets = "const ws = new WebSocket(url);";
  assert(
    findSimple(stripComments(sockets), /\bnew\s+WebSocket\s*\(/g).length === 1,
    "new WebSocket must be detected",
  );
  const doSockets = "ctx.acceptWebSocket(ws);";
  assert(
    findSimple(stripComments(doSockets), /\b(acceptWebSocket|setWebSocketAutoResponse)\s*\(/g)
      .length === 1,
    "acceptWebSocket must be detected",
  );

  const typeOnly = 'import type { Foo } from "./workerOnly";\nimport { value } from "./included";';
  const typeImports = extractRuntimeImports(stripComments(typeOnly));
  assert(
    typeImports.some((imp) => imp.specifier === "./included"),
    "value import must be followed",
  );
  assert(
    !typeImports.some((imp) => imp.specifier === "./workerOnly"),
    "import type must not be followed",
  );

  const dynamic = 'await import("./helper");';
  const dynamicImports = extractRuntimeImports(stripComments(dynamic));
  assert(
    dynamicImports.some((imp) => imp.specifier === "./helper"),
    "dynamic import must be followed",
  );

  const staleTestExceptions = [
    {
      debtId: "TEST-STALE",
      expectedCount: 1,
      path: "some/stale/file.ts",
      reason: "Test stale allowlist",
      rule: "external-fetch",
    },
  ];
  const staleCheck = checkGraph("/fake", new Map(), staleTestExceptions);
  assert(
    staleCheck.failures.some((failure) => failure.includes("is stale")),
    "stale allowlist fixture must fail",
  );

  const tempDirs = [];
  const ensureDir = (dir) => {
    mkdirSync(dir, { recursive: true });
  };
  try {
    const graphRoot = mkdtempSync(join(tmpdir(), "do-runtime-graph-"));
    tempDirs.push(graphRoot);
    ensureDir(join(graphRoot, "payments"));
    writeFileSync(
      join(graphRoot, "entry.ts"),
      'import { helper } from "./helper";\nimport type { Only } from "./workerOnly";\nconst dynamic = () => import("./dynamicHelper");\nconsole.log(helper, dynamic);\n',
    );
    writeFileSync(
      join(graphRoot, "helper.ts"),
      'export const helper = 1;\nawait fetch("https://example.com");\n',
    );
    writeFileSync(
      join(graphRoot, "workerOnly.ts"),
      'await fetch("https://worker.example.com");\nexport type Only = string;\n',
    );
    writeFileSync(
      join(graphRoot, "dynamicHelper.ts"),
      "export const dynamicHelper = 2;\nsetTimeout(() => {}, 10);\n",
    );
    const nested = buildGraph(graphRoot, "entry.ts");
    assert(
      nested.errors.length === 0,
      `nested fixture graph must resolve, got: ${nested.errors.join("; ")}`,
    );
    const relatives = [...nested.files.values()].map((file) => file.relative).sort();
    assert(relatives.includes("entry.ts"), "entry must be in graph");
    assert(relatives.includes("helper.ts"), "nested helper must be in graph");
    assert(relatives.includes("dynamicHelper.ts"), "dynamic helper must be in graph");
    assert(!relatives.includes("workerOnly.ts"), "import type must not pull worker-only code");
    const helperFile = [...nested.files.values()].find((file) => file.relative === "helper.ts");
    assert(
      helperFile && findExternalFetch(helperFile.stripped).length === 1,
      "nested fetch must be caught",
    );

    const providerRoot = mkdtempSync(join(tmpdir(), "do-runtime-provider-"));
    tempDirs.push(providerRoot);
    ensureDir(join(providerRoot, "payments"));
    writeFileSync(
      join(providerRoot, "entry.ts"),
      'import { charge } from "./payments/stripe";\nconsole.log(charge);\n',
    );
    writeFileSync(join(providerRoot, "payments/stripe.ts"), "export const charge = 1;\n");
    writeFileSync(join(providerRoot, "payments/index.ts"), "export const index = 1;\n");
    const providerGraph = buildGraph(providerRoot, "entry.ts");
    const providerFiles = [...providerGraph.files.values()];
    const entryFile = providerFiles.find((file) => file.relative === "entry.ts");
    assert(entryFile, "provider entry must exist");
    const resolved = resolveRelativeImport(join(providerRoot, "entry.ts"), "./payments/stripe");
    assert(resolved !== null, "provider import must resolve");
    assert(isProviderLocalPath("payments/stripe.ts"), "provider path must be flagged");
    const dynamicProvider = 'await import("./payments/stripe");';
    const dynamicProviderImports = extractRuntimeImports(stripComments(dynamicProvider));
    assert(
      dynamicProviderImports.some((imp) => imp.specifier === "./payments/stripe"),
      "dynamic provider import must be extracted",
    );

    const alarmRoot = mkdtempSync(join(tmpdir(), "do-runtime-alarm-"));
    tempDirs.push(alarmRoot);
    writeFileSync(join(alarmRoot, "entry.ts"), 'import "./store";\n');
    writeFileSync(join(alarmRoot, "store.ts"), "await storage.setAlarm(Date.now() + 1);\n");
    const alarmGraph = buildGraph(alarmRoot, "entry.ts");
    const storeFile = [...alarmGraph.files.values()].find((file) => file.relative === "store.ts");
    assert(
      storeFile && findSimple(storeFile.stripped, /\b(setAlarm|deleteAlarm)\s*\(/g).length === 1,
      "direct setAlarm outside scheduler must be caught",
    );

    const mockSchedulerFiles = new Map([
      [
        "/fake/organization/scheduler.ts",
        {
          imports: [],
          raw: "",
          relative: "organization/scheduler.ts",
          stripped: "await queue.sendBatch(a);\nawait queue.sendBatch(b);\n",
        },
      ],
    ]);
    const queueTestExceptions = [
      {
        debtId: "TEST-QUEUE",
        expectedCount: 1,
        path: "organization/scheduler.ts",
        reason: "Test approved queue handoff",
        rule: "queue-send",
      },
    ];
    const queueCheck = checkGraph("/fake", mockSchedulerFiles, queueTestExceptions);
    assert(
      queueCheck.failures.some(
        (failure) => failure.includes("expected 1 but found 2") || failure.includes("queue send"),
      ),
      "second queue send beyond approved count must fail",
    );

    const cleanRoot = mkdtempSync(join(tmpdir(), "do-runtime-clean-"));
    tempDirs.push(cleanRoot);
    writeFileSync(join(cleanRoot, "entry.ts"), "export const value = 1;\n");
    const cleanGraph = buildGraph(cleanRoot, "entry.ts");
    assert(cleanGraph.errors.length === 0, "clean fixture graph must resolve");
    const cleanFile = [...cleanGraph.files.values()].find((file) => file.relative === "entry.ts");
    assert(cleanFile, "clean entry must exist");
    assert(findExternalFetch(cleanFile.stripped).length === 0, "clean fixture must have no fetch");
    assert(
      findSimple(cleanFile.stripped, /\b(setTimeout|setInterval)\s*\(/g).length === 0,
      "clean fixture must have no timers",
    );
    const cleanCheck = checkGraph(cleanRoot, cleanGraph.files, []);
    assert(cleanCheck.failures.length === 0, "clean fixture graph must have zero failures");
  } finally {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { force: true, recursive: true });
      } catch {
        void 0;
      }
    }
  }
}

function main() {
  try {
    runSelfTests();
  } catch (error) {
    console.error("DO runtime boundary self-tests failed:");
    console.error(`- ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log("DO runtime boundary self-tests passed.");

  const sourceRoot = defaultSourceRoot;
  const { errors, files } = buildGraph(sourceRoot, entryRelative);
  const { failures } = checkGraph(sourceRoot, files);
  const allFailures = [...errors, ...failures];
  if (allFailures.length > 0) {
    console.error("DO runtime boundary check failed:");
    for (const failure of allFailures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(
    `DO runtime boundary check passed: ${files.size} DO runtime modules scanned, scheduler owns alarms and the queue handoff.`,
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

export { buildGraph, checkGraph, extractRuntimeImports, findExternalFetch, stripComments };
