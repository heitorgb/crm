export class AppException extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number = 400,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'AppException';
  }
}
