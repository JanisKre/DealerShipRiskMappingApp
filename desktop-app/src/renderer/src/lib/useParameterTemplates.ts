import { useCallback, useEffect, useState } from "react";
import type { RiskParameters, Settings } from "@shared/types";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";

export type ParameterTemplate = NonNullable<
  Settings["parameterTemplates"]
>[number];

/** Id of the built-in template: the app's default values. */
export const DEFAULT_TEMPLATE_ID = "__defaults__";

/**
 * Parameter sets to start a portfolio from: the defaults plus the sets the
 * user saved (app settings). Saving under an existing name replaces it.
 */
export function useParameterTemplates(): {
  templates: ParameterTemplate[];
  parametersOf: (id: string) => RiskParameters | null;
  save: (name: string, parameters: RiskParameters) => Promise<void>;
  remove: (name: string) => Promise<void>;
} {
  const [templates, setTemplates] = useState<ParameterTemplate[]>([]);
  useEffect(() => {
    let cancelled = false;
    void window.api
      .getSettings()
      .then((s) => {
        if (!cancelled) setTemplates(s.parameterTemplates ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const store = useCallback(async (next: ParameterTemplate[]) => {
    const saved = await window.api.setSettings({ parameterTemplates: next });
    setTemplates(saved.parameterTemplates ?? next);
  }, []);

  return {
    templates,
    parametersOf: (id) =>
      id === DEFAULT_TEMPLATE_ID
        ? DEFAULT_RISK_PARAMETERS
        : (templates.find((tpl) => tpl.name === id)?.parameters ?? null),
    save: (name, parameters) =>
      store([
        ...templates.filter((tpl) => tpl.name !== name.trim()),
        {
          name: name.trim(),
          savedAt: new Date().toISOString(),
          parameters,
        },
      ]),
    remove: (name) => store(templates.filter((tpl) => tpl.name !== name)),
  };
}

/** Parameters that differ from `base`, for "n values changed" notes. */
export function changedKeys(
  parameters: RiskParameters,
  base: RiskParameters = DEFAULT_RISK_PARAMETERS,
): (keyof RiskParameters)[] {
  return (Object.keys(base) as (keyof RiskParameters)[]).filter(
    (key) => parameters[key] !== base[key],
  );
}
