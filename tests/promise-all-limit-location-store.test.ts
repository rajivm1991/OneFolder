import { promiseAllLimit } from '../common/promise';

// Mirrors the concurrency contract watchLocations must apply to its pathToIFile calls:
// no more than N in flight at once, all resolved by the time the batch completes.
describe('LocationStore watchLocations concurrency', () => {
  it('promiseAllLimit never runs more than N jobs concurrently', async () => {
    const N = 5;
    let inFlight = 0;
    let maxInFlight = 0;
    const jobs = Array.from({ length: 37 }, (_, i) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return i;
    });

    const results = await promiseAllLimit(jobs, N);

    expect(maxInFlight).toBeLessThanOrEqual(N);
    expect(results).toHaveLength(37);
    expect(results.sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
  });
});
