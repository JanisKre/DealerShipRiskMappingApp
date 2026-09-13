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

## Licensed natural-catastrophe providers

The shared natural-catastrophe model accepts normalized observations from
licensed providers without persisting raw vendor payloads:

- ZÜRS Geo CSV/XLSX exports are detected by their class columns and imported
  at address/building resolution. Flood classes 1–4 and heavy-rain classes
  1–3 are retained as raw attributes and displayed as normalized scores. The
  class-to-score mapping is a screening visualization, not an insurance
  tariff.
- Swiss Re CatNet is accessed through a customer-configured HTTPS endpoint.
  The adapter accepts normalized hazard scores and optional annual exceedance
  probabilities or return periods. The exact endpoint schema must come from
  the customer's Swiss Re contract/API documentation.

Provider evidence is attached to each assessment and the resulting risk. If a
provider supplies only classes or scores without frequency/loss curves, the
existing EAL remains a screening estimate and is labeled accordingly.

Import reports and scenario impacts follow the same principle: inputs,
assumptions, versions, and quality warnings are kept next to the result.
