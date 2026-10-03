import type { SpatialDiagnosticSample, PhysicalRediscoveryMeasurement } from './diagnostics';

export type SpatialFieldReport = {
  version: 1;
  startedAt: number;
  finishedAt: number;
  samples: SpatialDiagnosticSample[];
  rediscoveryMeasurements: PhysicalRediscoveryMeasurement[];
  summary: {
    sampleCount: number;
    trackingLosses: number;
    averageFps: number | null;
  };
};

export class SpatialFieldRecorder {
  private startedAt = Date.now();
  private samples: SpatialDiagnosticSample[] = [];
  private rediscoveryMeasurements: PhysicalRediscoveryMeasurement[] = [];

  record(sample: SpatialDiagnosticSample) {
    this.samples.push(sample);
  }

  recordRediscovery(measurement: PhysicalRediscoveryMeasurement) {
    this.rediscoveryMeasurements.push(measurement);
  }

  get sampleCount() {
    return this.samples.length;
  }

  finish(): SpatialFieldReport {
    const fps = this.samples
      .map((sample) => sample.framesPerSecond)
      .filter((value): value is number => value !== null && Number.isFinite(value));

    return {
      version: 1,
      startedAt: this.startedAt,
      finishedAt: Date.now(),
      samples: [...this.samples],
      rediscoveryMeasurements: [...this.rediscoveryMeasurements],
      summary: {
        sampleCount: this.samples.length,
        trackingLosses: this.samples.reduce(
          (maximum, sample) => Math.max(maximum, sample.trackingLosses),
          0,
        ),
        averageFps: fps.length
          ? fps.reduce((sum, value) => sum + value, 0) / fps.length
          : null,
      },
    };
  }

  reset() {
    this.startedAt = Date.now();
    this.samples = [];
    this.rediscoveryMeasurements = [];
  }
}
