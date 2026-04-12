import type { Template } from "@networkchum/shared";

import { defaultTemplates } from "./defaultTemplates.js";
import {
  listTemplateOverrides,
  saveTemplateOverrides,
  type TemplateDefaultsOverride,
} from "./templateOverrideStore.js";

type TemplateDefaults = {
  ramMb: number;
  vcpu: number;
  interfaceCount: number;
};

function applyTemplateOverride(
  template: Template,
  override?: TemplateDefaultsOverride,
): Template {
  if (!override) {
    return {
      ...template,
      configSchema: {
        ...template.configSchema,
        ramMb: { ...template.configSchema.ramMb },
        vcpu: { ...template.configSchema.vcpu },
        interfaceCount: { ...template.configSchema.interfaceCount },
      },
      interfaceNames: template.interfaceNames
        ? [...template.interfaceNames]
        : undefined,
    };
  }

  return {
    ...template,
    configSchema: {
      ...template.configSchema,
      ramMb: {
        ...template.configSchema.ramMb,
        default: override.ramMb ?? template.configSchema.ramMb.default,
      },
      vcpu: {
        ...template.configSchema.vcpu,
        default: override.vcpu ?? template.configSchema.vcpu.default,
      },
      interfaceCount: {
        ...template.configSchema.interfaceCount,
        default:
          override.interfaceCount ??
          template.configSchema.interfaceCount.default,
      },
    },
    interfaceNames: template.interfaceNames
      ? [...template.interfaceNames]
      : undefined,
  };
}

export class TemplateRegistry {
  list(): Template[] {
    const overrides = listTemplateOverrides();
    return defaultTemplates.map((template) =>
      applyTemplateOverride(template, overrides[template.id]),
    );
  }

  get(templateId: string): Template | undefined {
    const template = defaultTemplates.find((entry) => entry.id === templateId);
    if (!template) {
      return undefined;
    }

    const overrides = listTemplateOverrides();
    return applyTemplateOverride(template, overrides[templateId]);
  }

  updateDefaults(
    templateId: string,
    defaults: TemplateDefaults,
  ): Template | undefined {
    const baseTemplate = defaultTemplates.find(
      (template) => template.id === templateId,
    );
    if (!baseTemplate) {
      return undefined;
    }

    const nextOverride: TemplateDefaultsOverride = {};
    if (defaults.ramMb !== baseTemplate.configSchema.ramMb.default) {
      nextOverride.ramMb = defaults.ramMb;
    }
    if (defaults.vcpu !== baseTemplate.configSchema.vcpu.default) {
      nextOverride.vcpu = defaults.vcpu;
    }
    if (
      defaults.interfaceCount !==
      baseTemplate.configSchema.interfaceCount.default
    ) {
      nextOverride.interfaceCount = defaults.interfaceCount;
    }

    const overrides = listTemplateOverrides();
    if (Object.keys(nextOverride).length === 0) {
      delete overrides[templateId];
    } else {
      overrides[templateId] = nextOverride;
    }
    saveTemplateOverrides(overrides);

    return applyTemplateOverride(baseTemplate, nextOverride);
  }
}
