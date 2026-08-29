import { performance } from "node:perf_hooks";

function makeRows(size) {
  const rows = Array.from({ length: size }, (_, index) => ({
    profileId: `profile-${String(index)}`,
    voicePart: "Soprano",
  }));
  const selectedProfileIds = rows.slice(0, Math.floor(size / 2)).map((row) => row.profileId);
  return { rows, selectedProfileIds };
}

function baselineFilter(rows, selectedProfileIds) {
  return rows.filter((row) => selectedProfileIds.includes(row.profileId)).length;
}

function optimizedFilter(rows, selectedProfileIds) {
  const selectedSet = new Set(selectedProfileIds);
  return rows.filter((row) => selectedSet.has(row.profileId)).length;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure(fn, rows, selectedProfileIds, iterations = 30) {
  for (let i = 0; i < 3; i++) fn(rows, selectedProfileIds);
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn(rows, selectedProfileIds);
    samples.push(performance.now() - start);
  }
  return median(samples);
}

for (const size of [100, 500, 1000]) {
  const { rows, selectedProfileIds } = makeRows(size);
  const baseline = measure(baselineFilter, rows, selectedProfileIds);
  const optimized = measure(optimizedFilter, rows, selectedProfileIds);
  console.log(
    JSON.stringify({
      size,
      baselineMs: Number(baseline.toFixed(3)),
      optimizedMs: Number(optimized.toFixed(3)),
      speedup: Number((baseline / optimized).toFixed(2)),
    }),
  );
}
