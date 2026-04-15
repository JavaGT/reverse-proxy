import pino from "pino";

/** Logging style is fixed (configuration is via SQLite / management Settings, not process environment). */
const isDev = true;

/**
 * SRP: Centralized structured logging configuration.
 * Uses pino for high-performance JSON logging.
 */
export const logger = pino({
    level: "info",
    transport: isDev ? {
        target: "pino-pretty",
        options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "HH:MM:ss Z",
            singleLine: true,
        },
    } : undefined,
});

/**
 * Utility to create a child logger with a request ID for correlation.
 */
export function createRequestLogger(requestId, metadata = {}) {
    return logger.child({ requestId, ...metadata });
}
