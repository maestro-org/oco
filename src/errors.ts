export class OcoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcoError';
  }
}

export class ValidationError extends OcoError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class CommandError extends OcoError {
  readonly command: string;
  readonly code: number;
  readonly stderr: string;

  constructor(command: string, code: number, stderr = '') {
    const detail = stderr
      ? `command failed (${code}): ${command}\n${stderr.trim()}`
      : `command failed (${code}): ${command}`;
    super(detail);
    this.name = 'CommandError';
    this.command = command;
    this.code = code;
    this.stderr = stderr;
  }
}
