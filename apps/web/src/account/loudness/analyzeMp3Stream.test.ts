import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeMp3Stream } from "./analyzeMp3Stream";
import reference from "./fixtures/reference.json";
function stream(bytes: Uint8Array, chunkSize: number) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset = Math.min(bytes.length, offset + chunkSize);
    },
  });
}
describe("complete MP3 reference parity", () => {
  for (const fixture of reference.fixtures)
    it(fixture.name, async () => {
      const bytes = readFileSync(new URL(`./fixtures/${fixture.name}`, import.meta.url));
      if (fixture.integratedLufs === null) {
        await expect(
          analyzeMp3Stream(stream(bytes, 137), new AbortController().signal, () => undefined),
        ).rejects.toThrow("invalid_audio");
        return;
      }
      let baseline: Awaited<ReturnType<typeof analyzeMp3Stream>> | undefined;
      for (const chunkSize of [137, 32768, 65536]) {
        const result = await analyzeMp3Stream(
          stream(bytes, chunkSize),
          new AbortController().signal,
          () => undefined,
        );
        expect(result.samples).toBe(fixture.samples);
        // Issue #277 specifies ±0.2 LU; loudnorm resamples internally to 192 kHz.
        expect(Math.abs(result.integratedLufs - fixture.integratedLufs)).toBeLessThanOrEqual(0.2);
        if (baseline) {
          expect(result.integratedLufs).toBeCloseTo(baseline.integratedLufs, 10);
          expect(result.truePeakDbtp).toBeCloseTo(baseline.truePeakDbtp, 10);
        }
        baseline = result;
        expect(Math.abs(result.truePeakDbtp - fixture.truePeakDbtp)).toBeLessThanOrEqual(0.3);
      }
    });
  it("rejects truncated input and cancellation", async () => {
    const bytes = readFileSync(
      new URL(`./fixtures/${reference.fixtures[0]?.name ?? ""}`, import.meta.url),
    );
    await expect(
      analyzeMp3Stream(
        stream(bytes.subarray(0, bytes.length - 3), 137),
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toThrow("invalid_audio");
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyzeMp3Stream(stream(bytes, 65536), controller.signal, () => undefined),
    ).rejects.toThrow();
  });
});
