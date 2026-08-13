import { SERVICE_ALIASES, SERVICE_NAMES, type ServiceName } from "../types.ts";
import { FatalError } from "../core/errors.ts";

const NAME_LOOKUP: ReadonlyMap<string, ServiceName> = new Map(
  SERVICE_NAMES.map((name) => [name.toLowerCase(), name])
);
const ALIAS_LOOKUP: ReadonlyMap<string, ServiceName> = new Map(
  Object.entries(SERVICE_ALIASES).map(([alias, name]) => [alias.toLowerCase(), name])
);

export function parseServices(servicesOpt: string): Set<ServiceName> {
  if (servicesOpt === "all") {
    return new Set(SERVICE_NAMES);
  }

  const requested = servicesOpt.split(",").map((s) => s.trim().toLowerCase());
  const enabled = new Set<ServiceName>();

  for (const svc of requested) {
    if (svc === "") continue;

    const normalized = NAME_LOOKUP.get(svc) ?? ALIAS_LOOKUP.get(svc) ?? null;

    if (normalized === null) {
      throw new FatalError(
        `Err: Unknown service: ${svc}. Available: ${SERVICE_NAMES.join(", ")}`
      );
    }
    enabled.add(normalized);
  }

  return enabled;
}
