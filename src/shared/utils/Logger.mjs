import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * SRP: Centralized structured logging configuration.
 * Uses pino for high-performance JSON logging.
 */
export const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    transport: isDev ? {
        target: "pino-pretty",
        options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "HH:MM:ss Z",
        },
    } : undefined,
});

/**
 * Utility to create a child logger with a request ID for correlation.
 */
export function createRequestLogger(requestId, metadata = {}) {
    return logger.child({ requestId, ...metadata });
}
