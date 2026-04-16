import type { ProviderConfig, ModelGroup } from '../config.js';
import { RateLimiter } from './rate-limiter.js';
import { ModelGroupExhaustedError, type TriedModel } from './model-group-error.js';

export interface AvailableModelResult {
  model: string;
  provider: ProviderConfig;
  triedModels: TriedModel[];
}

export class ModelGroupResolver {
  resolveModelGroup(
    modelGroups: ModelGroup[] | undefined,
    groupName: string,
    providerConfigs: ProviderConfig[] = []
  ): string[] {
    if (!modelGroups) {
      throw new Error(`Model group "${groupName}" not found`);
    }

    const group = modelGroups.find(g => g.name === groupName);
    if (!group) {
      throw new Error(`Model group "${groupName}" not found`);
    }

    // Resolve model name aliases: if a name in group models doesn't match any
    // customModel, check if it's a renamed model (its alias exists in providerConfigs).
    return group.models.map(modelName => {
      // Direct match
      if (providerConfigs.some(p => p.customModel === modelName)) {
        return modelName;
      }

      // Alias lookup: find a provider config whose customModel is this name
      const aliasEntry = providerConfigs.find(p => p.customModel === modelName);
      if (aliasEntry) {
        return aliasEntry.customModel;
      }

      // No match — provide a useful error message with available models
      const available = providerConfigs.map(p => p.customModel).join(', ');
      throw new Error(
        `Model "${modelName}" in group "${groupName}" not found in provider configs. Available models: [${available}]`
      );
    });
  }

  async findAvailableModel(
    modelNames: string[],
    config: ProviderConfig[],
    logDir: string
  ): Promise<AvailableModelResult> {
    const triedModels: TriedModel[] = [];
    const rateLimiter = new RateLimiter(logDir);

    for (const modelName of modelNames) {
      const provider = config.find(p => p.customModel === modelName);

      if (!provider) {
        triedModels.push({
          model: modelName,
          exceeded: false,
          message: 'Model config not found'
        });
        continue;
      }

      try {
        const result = await rateLimiter.checkLimits(provider, logDir);

        if (result.exceeded) {
          triedModels.push({
            model: modelName,
            exceeded: true,
            message: result.message
          });
          continue;
        }

        return { model: modelName, provider, triedModels };
      } catch (error: any) {
        triedModels.push({
          model: modelName,
          exceeded: false,
          message: error.message
        });
        continue;
      }
    }

    throw new ModelGroupExhaustedError(triedModels);
  }
}