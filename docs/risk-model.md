# Risk model and evidence

The application now keeps the calculation pipeline explicit:

```text
Hazard provider → exposure → vulnerability/loss → portfolio aggregation
```

The orchestration entry point is
`desktop-app/src/main/services/risk.service.ts`. The model layers are in
`desktop-app/src/main/services/risk/`:

- `hazard-models.ts` maps hazard indicators to comparable 0–100 scores.
- `exposure.ts` estimates vehicle value and site capacity.
- `financial-loss.ts` calculates the per-peril EAL breakdown.
- `evidence.ts` attaches provenance, confidence, fallbacks, and limitations.

Every new risk result includes a model version, overall confidence, source
evidence, and limitations. The current flood component is intentionally a
screening proxy based on precipitation; a hydraulic provider can replace it
behind the provider boundary without changing the renderer contract.

Import reports and scenario impacts follow the same principle: inputs,
assumptions, versions, and quality warnings are kept next to the result.
