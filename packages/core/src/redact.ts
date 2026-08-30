const SECRET_KEY =
  /(?:api[_-]?key|access[_-]?token|auth(?:orization)?|cookie|credential|password|private[_-]?key|secret|token)/i;

const SECRET_VALUE_PATTERNS = [
  /\bsk-(?:live|proj)-[A-Za-z0-9_-]{8,}\b/gi,
  /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{8,}\b/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/gi,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
];

function redactString(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, "[REDACTED]"),
    value,
  );
}

/**
 * Remove credential-shaped values before data is logged or serialized.
 * Object keys are checked as well as string values because provider payloads
 * use several different names for the same secret.
 */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === "object") {
    if (value instanceof Date) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SECRET_KEY.test(key) ? "[REDACTED]" : redactSecrets(child),
      ]),
    );
  }
  return value;
}

export function redactErrorMessage(message: string): string {
  return redactString(message).replace(
    /(?:\/(?:home|tmp|Users|var|workspace)\/|[A-Za-z]:\\)[^\s"'`]+/g,
    "[path redacted]",
  );
}
