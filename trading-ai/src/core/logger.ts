import winston from "winston";

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

export const logger = winston.createLogger({
  level: (process.env.LOG_LEVEL as string) || "info",
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

export function logAudit(
  level: "info" | "warn" | "error" | "critical",
  category: string,
  message: string,
  data?: Record<string, unknown>
): void {
  const winstonLevel = level === "critical" ? "error" : level;
  logger.log(winstonLevel, message, { category, ...data });
}
