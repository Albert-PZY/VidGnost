import pino from "pino"

export const logger = pino({
  level: process.env.VIDGNOST_LOG_LEVEL?.trim() || "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino/file",
          options: { destination: 1 },
        },
})

export function childLogger(name: string) {
  return logger.child({ scope: name })
}
