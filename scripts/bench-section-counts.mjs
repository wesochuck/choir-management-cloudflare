import { performance } from "node:perf_hooks";

function makeData(profileCount = 500, voicePartCount = 20) {
  const voiceParts = Array.from({ length: voicePartCount }, (_, index) => ({
    label: `Voice ${String(index)}`,
    sectionCode: `S${String(index % 5)}`,
  }));
  const rows = Array.from({ length: profileCount }, (_, index) => ({
    voicePart: voiceParts[index % voiceParts.length].label,
  }));
  return { rows, voiceParts };
}

function baselineSectionCounts(rows, voiceParts) {
  const values = new Map();
  for (const { label } of voiceParts) values.set(label, 0);
  // Simulate reportableSections with 5 sections
  const reportable = new Set(["S0", "S1", "S2", "S3", "S4"]);
  for (const row of rows) {
    const voicePart = voiceParts.find(({ label }) => label === row.voicePart);
    if (voicePart && reportable.has(voicePart.sectionCode)) {
      values.set(voicePart.sectionCode, (values.get(voicePart.sectionCode) ?? 0) + 1);
    }
  }
  return values;
}

function optimizedSectionCounts(rows, voiceParts) {
  const sectionByVoicePart = new Map(
    voiceParts.map(({ label, sectionCode }) => [label, sectionCode]),
  );
  const values = new Map();
  for (const { label } of voiceParts) values.set(label, 0);
  const reportable = new Set(["S0", "S1", "S2", "S3", "S4"]);
  for (const row of rows) {
    const sectionCode = sectionByVoicePart.get(row.voicePart);
    if (sectionCode && reportable.has(sectionCode)) {
      values.set(sectionCode, (values.get(sectionCode) ?? 0) + 1);
    }
  }
  return values;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure(fn, rows, voiceParts, iterations = 30) {
  for (let i = 0; i < 3; i++) fn(rows, voiceParts);
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn(rows, voiceParts);
    samples.push(performance.now() - start);
  }
  return median(samples);
}

for (const size of [100, 500, 1000]) {
  const { rows, voiceParts } = makeData(size, 20);
  const baseline = measure(baselineSectionCounts, rows, voiceParts);
  const optimized = measure(optimizedSectionCounts, rows, voiceParts);
  console.log(
    JSON.stringify({
      size,
      baselineMs: Number(baseline.toFixed(3)),
      optimizedMs: Number(optimized.toFixed(3)),
      speedup: Number((baseline / optimized).toFixed(2)),
    }),
  );
}
