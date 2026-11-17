/**
 * Structured JSON logging for every Lambda. One JSON object per line on
 * stdout (stderr for errors), which CloudWatch Logs indexes as fields.
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const LEVEL_RANK: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

export interface LoggerOptions {
  level?: LogLevel;
  base?: LogFields;
  write?: (level: LogLevel, line: string) => void;
  now?: () => Date;
}

function defaultWrite(level: LogLevel, line: string): void {
  const stream = level === "ERROR" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

/** Serializes Error instances into plain fields so they survive JSON.stringify. */
function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function serializeFields(fields: LogFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, serializeValue(value)]),
  );
}

/** Parses a LOG_LEVEL value, falling back to INFO for anything unrecognized. */
export function parseLogLevel(value: string | undefined): LogLevel {
  const upper = value?.toUpperCase();
  return upper === "DEBUG" || upper === "INFO" || upper === "WARN" || upper === "ERROR"
    ? upper
    : "INFO";
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "INFO";
  const base = options.base ?? {};
  const write = options.write ?? defaultWrite;
  const now = options.now ?? (() => new Date());

  const log = (entryLevel: LogLevel, message: string, fields: LogFields = {}): void => {
    if (LEVEL_RANK[entryLevel] < LEVEL_RANK[level]) return;
    const entry = {
      timestamp: now().toISOString(),
      level: entryLevel,
      message,
      ...serializeFields(base),
      ...serializeFields(fields),
    };
    write(entryLevel, JSON.stringify(entry));
  };

  return {
    debug: (message, fields) => {
      log("DEBUG", message, fields);
    },
    info: (message, fields) => {
      log("INFO", message, fields);
    },
    warn: (message, fields) => {
      log("WARN", message, fields);
    },
    error: (message, fields) => {
      log("ERROR", message, fields);
    },
    child: (fields) => createLogger({ level, base: { ...base, ...fields }, write, now }),
  };
}

/** The process-wide logger, configured from LOG_LEVEL. */
export const logger: Logger = createLogger({ level: parseLogLevel(process.env["LOG_LEVEL"]) });
