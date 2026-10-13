// JSON Schema validation for .rctrack.json and .rcvenue.json (draft 2020-12, ajv).
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import rctrackSchema from "./schemas/rctrack.schema.json";
import rcvenueSchema from "./schemas/rcvenue.schema.json";
import type { RcTrack, RcVenue } from "./types.js";

export { rctrackSchema, rcvenueSchema };

export interface ValidationError {
  /** JSON pointer to the offending value, "" for the document itself */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// strict: false — the reference schema uses prefixItems without minItems/items, which ajv's strict mode rejects
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const checkTrack = ajv.compile<RcTrack>(rctrackSchema);
const checkVenue = ajv.compile<RcVenue>(rcvenueSchema);

function run(check: typeof checkTrack | typeof checkVenue, doc: unknown): ValidationResult {
  if (check(doc)) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (check.errors ?? []).map((e) => ({ path: e.instancePath, message: e.message ?? e.keyword })),
  };
}

export const validateTrack = (doc: unknown): ValidationResult => run(checkTrack, doc);
export const validateVenue = (doc: unknown): ValidationResult => run(checkVenue, doc);

export function isTrack(doc: unknown): doc is RcTrack {
  return checkTrack(doc);
}
export function isVenue(doc: unknown): doc is RcVenue {
  return checkVenue(doc);
}
