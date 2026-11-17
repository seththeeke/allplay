import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, logger, parseLogLevel, type LogLevel } from "../src/logger";

const FIXED_TIME = new Date("2026-12-02T14:05:01.009Z");

function capture(level: LogLevel = "DEBUG") {
  const lines: Array<{ level: LogLevel; entry: Record<string, unknown> }> = [];
  const log = createLogger({
    level,
    base: { service: "test" },
    now: () => FIXED_TIME,
    write: (entryLevel, line) => {
      lines.push({ level: entryLevel, entry: JSON.parse(line) as Record<string, unknown> });
    },
  });
  return { log, lines };
}

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one JSON object per entry with timestamp, level, message and fields", () => {
    const { log, lines } = capture();
    log.info("session created", { sessionId: "01JEX" });
    expect(lines).toEqual([
      {
        level: "INFO",
        entry: {
          timestamp: "2026-12-02T14:05:01.009Z",
          level: "INFO",
          message: "session created",
          service: "test",
          sessionId: "01JEX",
        },
      },
    ]);
  });

  it("drops entries below the configured level", () => {
    const { log, lines } = capture("WARN");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines.map((line) => line.level)).toEqual(["WARN", "ERROR"]);
  });

  it("serializes errors into name, message and stack", () => {
    const { log, lines } = capture();
    log.error("failed", { error: new TypeError("bad input") });
    const error = lines[0]?.entry["error"] as Record<string, unknown>;
    expect(error["name"]).toBe("TypeError");
    expect(error["message"]).toBe("bad input");
    expect(typeof error["stack"]).toBe("string");
  });

  it("child loggers add fields to every entry", () => {
    const { log, lines } = capture();
    log.child({ requestId: "r-1" }).debug("hello", { extra: true });
    expect(lines[0]?.entry).toMatchObject({ service: "test", requestId: "r-1", extra: true });
  });

  it("writes errors to stderr and everything else to stdout by default", () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const log = createLogger();
    log.info("to stdout");
    log.error("to stderr");
    expect(out).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]?.[0])).toContain('"level":"ERROR"');
  });

  it("exports a process-wide logger", () => {
    expect(typeof logger.info).toBe("function");
  });
});

describe("parseLogLevel", () => {
  it("accepts known levels in any case", () => {
    expect(parseLogLevel("debug")).toBe("DEBUG");
    expect(parseLogLevel("WARN")).toBe("WARN");
    expect(parseLogLevel("Error")).toBe("ERROR");
    expect(parseLogLevel("info")).toBe("INFO");
  });

  it("falls back to INFO", () => {
    expect(parseLogLevel(undefined)).toBe("INFO");
    expect(parseLogLevel("verbose")).toBe("INFO");
  });
});
