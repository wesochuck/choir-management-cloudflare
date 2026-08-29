import { performance } from "node:perf_hooks";

function makeRows(size) {
  const profiles = Array.from({ length: size }, (_, index) => ({
    displayName: `Singer ${String(size - index).padStart(5, "0")}`,
    id: `profile-${String(index)}`,
  }));
  const memberships = profiles.map(({ id }) => ({
    email: `${id}@example.test`,
    profileId: id,
  }));
  return { memberships, profiles };
}

function baselineSort(profiles, memberships) {
  return [...profiles].sort((left, right) => {
    const leftEmail = memberships.find(({ profileId }) => profileId === left.id)?.email ?? "";
    const rightEmail = memberships.find(({ profileId }) => profileId === right.id)?.email ?? "";
    return leftEmail.localeCompare(rightEmail);
  });
}

function mapSort(profiles, memberships) {
  const emailByProfileId = new Map(memberships.map(({ email, profileId }) => [profileId, email]));
  return [...profiles].sort((left, right) => {
    const leftEmail = emailByProfileId.get(left.id) ?? "";
    const rightEmail = emailByProfileId.get(right.id) ?? "";
    return leftEmail.localeCompare(rightEmail);
  });
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure(fn, rows, iterations = 20) {
  for (let index = 0; index < 3; index += 1) fn(rows.profiles, rows.memberships);
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    fn(rows.profiles, rows.memberships);
    samples.push(performance.now() - start);
  }
  return median(samples);
}

for (const size of [100, 500, 1_000]) {
  const rows = makeRows(size);
  const baseline = measure(baselineSort, rows);
  const optimized = measure(mapSort, rows);
  console.log(
    JSON.stringify({
      size,
      baselineMs: Number(baseline.toFixed(3)),
      optimizedMs: Number(optimized.toFixed(3)),
      speedup: Number((baseline / optimized).toFixed(2)),
    }),
  );
}
