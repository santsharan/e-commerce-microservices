import { AppError, ErrorCode } from "@commerce-flow/errors";

/** Cancel requires the caller's view of the order. The version is the strong ETag. */
export function versionFromIfMatch(header: string | undefined): number {
  if (header === undefined || header.trim().length === 0) {
    throw new AppError(ErrorCode.PRECONDITION_REQUIRED, "If-Match is required", 428, {
      fields: ["If-Match"],
    });
  }
  const value = header.trim().replace(/^W\//, "").replaceAll('"', "");
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new AppError(ErrorCode.PRECONDITION_REQUIRED, "If-Match is invalid", 428, {
      fields: ["If-Match"],
    });
  }
  return Number.parseInt(value, 10);
}
