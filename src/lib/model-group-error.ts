export interface TriedModel {
  model: string;
  exceeded: boolean;
  message?: string;
}

export class ModelGroupExhaustedError extends Error {
  triedModels: TriedModel[];

  constructor(triedModels: TriedModel[]) {
    super(`All models in group exceeded their limits`);
    this.name = 'ModelGroupExhaustedError';
    this.triedModels = triedModels;
  }
}
