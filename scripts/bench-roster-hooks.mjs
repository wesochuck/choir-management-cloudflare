import { performance } from "node:perf_hooks";

function makeData(size = 500) {
  const profiles = Array.from({ length: size }, (_, i) => ({
    displayName: `Singer ${i}`,
    id: `profile-${i}`,
    phone: `555-${i}`,
    voicePart: "Soprano",
    globalStatus: "Active",
  }));
  const memberships = profiles.map((p) => ({ email: `${p.id}@example.test`, profileId: p.id }));
  const roster = {
    memberships,
    profiles,
    status: "ready",
    configuration: { voiceParts: [], sections: [] },
  };
  return { roster, query: "singer" };
}

function baselineFilter(roster, query) {
  const normalized = query.trim().toLocaleLowerCase();
  return roster.profiles.filter((candidate) => {
    const email =
      roster.memberships.find(({ profileId }) => profileId === candidate.id)?.email ?? "";
    const matchesQuery =
      !normalized ||
      [candidate.displayName, candidate.phone, candidate.voicePart, email]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized);
    return matchesQuery;
  });
}

function optimizedFilter(roster, query) {
  const emailByProfileId = new Map(roster.memberships.map((m) => [m.profileId, m.email]));
  const normalized = query.trim().toLocaleLowerCase();
  return roster.profiles.filter((candidate) => {
    const email = emailByProfileId.get(candidate.id) ?? "";
    const matchesQuery =
      !normalized ||
      [candidate.displayName, candidate.phone, candidate.voicePart, email]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized);
    return matchesQuery;
  });
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}
function measure(fn, roster, query, iter = 30) {
  for (let i = 0; i < 3; i++) fn(roster, query);
  const samples = [];
  for (let i = 0; i < iter; i++) {
    const start = performance.now();
    fn(roster, query);
    samples.push(performance.now() - start);
  }
  return median(samples);
}
for (const size of [100, 500, 1000]) {
  const { roster, query } = makeData(size);
  const b = measure(baselineFilter, roster, query);
  const o = measure(optimizedFilter, roster, query);
  console.log(
    JSON.stringify({
      size,
      baselineMs: Number(b.toFixed(3)),
      optimizedMs: Number(o.toFixed(3)),
      speedup: Number((b / o).toFixed(2)),
    }),
  );
}
