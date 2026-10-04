export const MSG_UNAUTHENTICATED = "Sign in required.";
export const MSG_FORBIDDEN = "Not permitted.";
export const MSG_FORBIDDEN_ADMIN_OPS = "Admin or Operations only.";
export const MSG_INTERNAL_ERROR = "Unexpected server error.";
export const MSG_INVALID_REQUEST = "Invalid request.";
export const MSG_SHAPE_F9 =
  "This file contains jobs only — stock history and audit log are missing. Export a full localStorage dump (see data-quality instructions).";
export const MSG_FILE_TOO_LARGE =
  "File exceeds the 25 MB limit. Export a smaller file or split the backup and import each part separately.";
export const MSG_ROW_CAP =
  "This file contains more than 50,000 rows. Split it into smaller batches of 50,000 rows or fewer and import them one at a time.";
export const MSG_STORAGE_QUOTA =
  "Storage quota reached. Clear old import files or wait for the nightly sweep, then try again.";
export const MSG_TYPED_COUNT =
  "Confirm count does not match the preview. Reload, re-check the counts shown, and try again.";
export const MSG_BATCH_STATE =
  "This batch is not in a state that allows that action. Reload to see its current status.";
export const MSG_RATE_LIMITED = "Too many requests. Try again later.";
export const MSG_CSRF_ORIGIN_MISMATCH = "Cross-origin request blocked.";
export const MSG_EXPORT_UNKNOWN_VIEW = "Unknown export view.";
export const MSG_EXPORT_ROW_CAP =
  "Export row cap reached (100,000 rows). Narrow the view with filters and try again.";

export const CODE_INTERNAL_ERROR = "internal_error";
export const CODE_UNAUTHENTICATED = "unauthenticated";
export const CODE_FORBIDDEN = "forbidden";
export const CODE_FORBIDDEN_ADMIN_OPS = "forbidden_admin_ops";
export const CODE_NOT_FOUND = "not_found";
export const CODE_JOB_NOT_FOUND = "job_not_found";
export const CODE_CUSTOMER_NOT_FOUND = "customer_not_found";
export const CODE_DISPATCH_PLAN_NOT_FOUND = "dispatch_plan_not_found";
export const CODE_FILE_NOT_FOUND = "file_not_found";
export const CODE_INVALID_REQUEST = "invalid_request";
export const CODE_VALIDATION_ERROR = "validation_error";
export const CODE_CONFIRM_REQUIRED = "confirm_required";
export const CODE_NOTHING_TO_UPDATE = "nothing_to_update";
export const CODE_INVALID_RECEIPT_QTY = "invalid_receipt_quantity";
export const CODE_RATE_LIMITED = "rate_limited";
export const CODE_CSRF_ORIGIN_MISMATCH = "csrf_origin_mismatch";
export const CODE_INVALID_CREDENTIALS = "invalid_credentials";
export const CODE_MFA_STEP_EXPIRED = "mfa_step_expired";
export const CODE_MFA_INVALID_CODE = "mfa_invalid_code";
export const CODE_MFA_INVALID_RECOVERY_CODE = "mfa_invalid_recovery_code";
export const CODE_MFA_ENROLL_INVALID = "mfa_enroll_invalid";
export const CODE_STALE_JOB = "stale_job";
export const CODE_STALE_BATCH = "stale_batch";
export const CODE_IMPORT_SHAPE_INVALID = "import_shape_invalid";
export const CODE_IMPORT_FILE_TOO_LARGE = "import_file_too_large";
export const CODE_IMPORT_ROW_CAP = "import_row_cap";
export const CODE_IMPORT_STORAGE_QUOTA = "import_storage_quota";
export const CODE_IMPORT_TYPED_COUNT = "import_typed_count_mismatch";
export const CODE_IMPORT_BATCH_STATE = "import_batch_invalid_state";
export const CODE_IMPORT_STORAGE_FAILED = "import_storage_failed";
export const CODE_EXPORT_VIEW_UNKNOWN = "export_view_unknown";
export const CODE_EXPORT_ROW_CAP = "export_row_cap";

export const ERROR_CODES = [
  CODE_INTERNAL_ERROR,
  CODE_UNAUTHENTICATED,
  CODE_FORBIDDEN,
  CODE_FORBIDDEN_ADMIN_OPS,
  CODE_NOT_FOUND,
  CODE_JOB_NOT_FOUND,
  CODE_CUSTOMER_NOT_FOUND,
  CODE_DISPATCH_PLAN_NOT_FOUND,
  CODE_FILE_NOT_FOUND,
  CODE_INVALID_REQUEST,
  CODE_VALIDATION_ERROR,
  CODE_CONFIRM_REQUIRED,
  CODE_NOTHING_TO_UPDATE,
  CODE_INVALID_RECEIPT_QTY,
  CODE_RATE_LIMITED,
  CODE_INVALID_CREDENTIALS,
  CODE_MFA_STEP_EXPIRED,
  CODE_MFA_INVALID_CODE,
  CODE_MFA_INVALID_RECOVERY_CODE,
  CODE_MFA_ENROLL_INVALID,
  CODE_STALE_JOB,
  CODE_STALE_BATCH,
  CODE_IMPORT_SHAPE_INVALID,
  CODE_IMPORT_FILE_TOO_LARGE,
  CODE_IMPORT_ROW_CAP,
  CODE_IMPORT_STORAGE_QUOTA,
  CODE_IMPORT_TYPED_COUNT,
  CODE_IMPORT_BATCH_STATE,
  CODE_IMPORT_STORAGE_FAILED,
  CODE_EXPORT_VIEW_UNKNOWN,
  CODE_EXPORT_ROW_CAP,
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
