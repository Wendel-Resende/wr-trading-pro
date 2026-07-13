/** Base class for dataset-snapshot adapter failures. Instances are thrown, never used as control flow across the domain/adapter boundary. */
export class DatasetSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidDatasetSnapshotInputError extends DatasetSnapshotError {
  constructor(message: string, public readonly issues: readonly string[] = []) {
    super(message);
  }
}

export class RunNotFoundError extends DatasetSnapshotError {}

export class RunNotSucceededError extends DatasetSnapshotError {}
