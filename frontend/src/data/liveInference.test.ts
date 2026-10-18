import { afterEach, describe, expect, it, vi } from 'vitest';
import { livePlatform, parseLiveResult, rescore } from './liveInference';

const result = { probability: .88, engine: 'snapml-nnpa', machine: 's390x', byteorder: 'big',
  model: 'test-model', model_inference_ms: .12, total_ms_incl_features: 31, tree_format: 'zdnn_tensors' };
afterEach(() => vi.unstubAllGlobals());

describe('live inference evidence', () => {
  it('requires fresh probability, timing, engine and platform fields', () => {
    expect(parseLiveResult(result)).toMatchObject(result);
    expect(() => parseLiveResult({ probability: .88 })).toThrow();
    for (const probability of [-1, 2, NaN, '0.8', null]) expect(() => parseLiveResult({ ...result, probability })).toThrow();
    expect(() => parseLiveResult({ ...result, model_inference_ms: -1 })).toThrow();
    expect(() => parseLiveResult({ ...result, machine: null })).toThrow();
  });
  it('does not call a laptop or unknown platform IBM Z', () => {
    expect(livePlatform(result)).toContain('IBM Z · s390x');
    expect(livePlatform({ machine: 'arm64' })).toBe('arm64 · not IBM Z');
    expect(parseLiveResult({ ...result, engine: 'xgboost' }).engine).toBe('xgboost');
  });
  it('posts only the selected BIN through the configured endpoint and uses a cancellation signal', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await rescore('1078054', 'auto', signal)).toMatchObject(result);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/score/1078054?engine=auto'), { method: 'POST', signal });
    await expect(rescore('../rescore', 'auto', signal)).rejects.toThrow('valid NYC BIN');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fails honestly on unreachable networks and HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(rescore('1078054', 'auto', new AbortController().signal)).rejects.toThrow('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(rescore('1078054', 'auto', new AbortController().signal)).rejects.toThrow('HTTP 503');
  });
  it('aborts in-flight work without manufacturing a result', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    })));
    const controller = new AbortController();
    const pending = rescore('1078054', 'auto', controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
  });
});
