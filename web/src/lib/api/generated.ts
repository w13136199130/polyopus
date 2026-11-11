/**
 * Re-export the generated contract types (docs/49 §7.1), namespaced to avoid
 * collisions between the api and events dictionaries.
 *
 * `generated/ts` is the v1.0 *type* promise; the backend implements a subset
 * (schemas/api/implemented.json) and some live payloads still differ from the
 * v1.0 shapes. Endpoint wrappers use these types where they match, and
 * explicit wire types (./wire.ts) where the live backend differs today.
 */
export type * as Api from "../../../../generated/ts/src/api.gen";
export type * as Events from "../../../../generated/ts/src/events.gen";
