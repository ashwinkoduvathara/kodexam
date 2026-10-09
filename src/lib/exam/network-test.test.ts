import { describe, expect, it } from "vitest";
import { evaluateNetwork, isLocalHost, type NetworkMetrics } from "./network-test";

const metrics = (m: Partial<NetworkMetrics>): NetworkMetrics => ({
  latencyMs: 40,
  jitterMs: 2,
  downloadMbps: 50,
  uploadMbps: 20,
  speedTestAvailable: true,
  ...m,
});

describe("evaluateNetwork", () => {
  it("passes a fast, low-latency connection", () => {
    expect(evaluateNetwork(metrics({}))).toMatchObject({ status: "passed" });
  });

  it("passes on latency alone when speeds can't be measured — without inventing speeds", () => {
    const state = evaluateNetwork(
      metrics({ downloadMbps: null, uploadMbps: null, speedTestAvailable: false }),
    );
    expect(state).toMatchObject({ status: "passed", label: "Connected" });
  });

  it("fails when the server can't be reached", () => {
    expect(evaluateNetwork(metrics({ latencyMs: null }))).toMatchObject({
      status: "failed",
      reason: "server_unreachable",
    });
  });

  it("fails a connection that is too slow", () => {
    expect(evaluateNetwork(metrics({ uploadMbps: 0.4 }))).toMatchObject({
      status: "failed",
      reason: "slow_connection",
    });
    expect(evaluateNetwork(metrics({ latencyMs: 900 }))).toMatchObject({ status: "failed" });
  });

  it("warns below the recommended speed", () => {
    expect(evaluateNetwork(metrics({ downloadMbps: 3 }))).toMatchObject({ status: "warning" });
  });
});

describe("isLocalHost", () => {
  it.each(["localhost", "127.0.0.1", "::1", "[::1]", "192.168.1.28", "10.0.0.5", "172.20.1.1"])(
    "%s is local",
    (h) => expect(isLocalHost(h)).toBe(true),
  );
  it.each(["exam.kodeversity.com", "8.8.8.8", "172.32.0.1"])("%s is public", (h) =>
    expect(isLocalHost(h)).toBe(false),
  );
});
