# Use On Break in Product Language While Retaining Idle Internally

The product will call the temporary roster Profile Status **On Break** in user-facing copy, while
retaining `Idle` as the internal storage, API, and CSV value. This preserves the existing contract
and avoids a broad status migration while making the domain language clearer to administrators.

**Considered option:** Rename the internal value to `On Break` as well. We rejected that for now
because it would require coordinated forward-only changes across Organization schemas, contracts,
queries, imports, exports, projections, and tests without improving the user-facing experience.
