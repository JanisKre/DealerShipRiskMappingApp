# Dealership detection benchmark data

Place labelled samples for dealership aerial imagery in this directory. Keep
large images outside Git when possible; commit only a small manifest with the
sample id, expected total, and optional class counts.

The manifest is consumed by
`src/main/services/detection-benchmark.ts`. Compare every detector/model
version on the same manifest and record the resulting MAE, bias, tolerance
rate, and class-level errors.

Do not commit imagery whose provider terms or licence do not permit
redistribution.
