# Audio Analysis v2

This layer extends the existing PabloVoice audio package with reusable analysis primitives. The contract is intentionally provider-agnostic: pitch, tempo, waveform, onset and voice analyzers produce deterministic structured data that can be consumed by sampler, Voice Lab, mix intelligence and Pablo AI without re-analyzing the source per feature.

Safety rule: automatic edits must be confidence-gated. Low-confidence results remain suggestions or manual actions.
