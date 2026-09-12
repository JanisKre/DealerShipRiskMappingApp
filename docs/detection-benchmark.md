# Detection benchmark

The vehicle detector is evaluated separately from the risk model. This keeps
model quality measurable when changing the ONNX weights, imagery provider,
tile size, or confidence threshold.

Use `evaluateDetectionBenchmark` from
`desktop-app/src/main/services/detection-benchmark.ts` with a small labelled
set of real dealership aerial images. Each sample should contain the manually
verified total and, where possible, class counts for car, van, truck, and bus.

Track at least:

- mean absolute error (MAE) of the total vehicle count
- signed count bias (over-/under-counting)
- share of samples within 10% of the labelled count
- class-level MAE

The benchmark output should be stored alongside the model version and imagery
provider. Public datasets such as VisDrone or CARPK are useful for initial
model comparisons, but they are not a substitute for dealership-specific
validation.
