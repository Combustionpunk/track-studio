// Every error response is {error, message} (+ optional details) with the matching status code.
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new HttpError(400, code, message, details);
export const unauthorized = (message = "Log in first") => new HttpError(401, "unauthorized", message);
export const forbidden = (message: string) => new HttpError(403, "forbidden", message);
export const notFound = (what: string) => new HttpError(404, "not-found", `${what} not found`);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
