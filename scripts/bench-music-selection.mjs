import { performance } from "node:perf_hooks";

function makeData(pieceCount = 5000, selectedCount = 100) {
  const pieces = Array.from({ length: pieceCount }, (_, i) => ({ id: `piece-${i}` }));
  const selectedPieceIds = pieces.slice(0, selectedCount).map((p) => p.id);
  return { pieces, selectedPieceIds };
}

function baseline(pieces, selectedPieceIds) {
  return pieces.filter(({ id }) => selectedPieceIds.includes(id));
}

function optimized(pieces, selectedPieceIds) {
  const selectedSet = new Set(selectedPieceIds);
  return pieces.filter(({ id }) => selectedSet.has(id));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure(fn, pieces, selectedPieceIds, iterations = 30) {
  for (let i = 0; i < 3; i++) fn(pieces, selectedPieceIds);
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn(pieces, selectedPieceIds);
    samples.push(performance.now() - start);
  }
  return median(samples);
}

for (const pieceCount of [500, 1000, 5000]) {
  const { pieces, selectedPieceIds } = makeData(pieceCount, 100);
  const baselineMs = measure(baseline, pieces, selectedPieceIds);
  const optimizedMs = measure(optimized, pieces, selectedPieceIds);
  console.log(
    JSON.stringify({
      pieceCount,
      baselineMs: Number(baselineMs.toFixed(3)),
      optimizedMs: Number(optimizedMs.toFixed(3)),
      speedup: Number((baselineMs / optimizedMs).toFixed(2)),
    }),
  );
}
for (const selectedCount of [10, 100, 500]) {
  const { pieces, selectedPieceIds } = makeData(5000, selectedCount);
  const baselineMs = measure(baseline, pieces, selectedPieceIds);
  const optimizedMs = measure(optimized, pieces, selectedPieceIds);
  console.log(
    JSON.stringify({
      pieceCount: 5000,
      selectedCount,
      baselineMs: Number(baselineMs.toFixed(3)),
      optimizedMs: Number(optimizedMs.toFixed(3)),
      speedup: Number((baselineMs / optimizedMs).toFixed(2)),
    }),
  );
}
