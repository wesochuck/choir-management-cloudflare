# Rebuild the Frontend with Repository-Owned Radix Components

The Cloudflare frontend will retain React, TypeScript, Vite, Tailwind, TanStack Query, and TanStack
Table while replacing Shoelace/Web Awesome wrappers with repository-owned shadcn-style components
built on Radix primitives. The replacement must preserve semantic theme tokens, responsive table and
card behavior, mobile dialog patterns, accessible controls, safe destructive confirmations, and the
Parity Baseline's visual character.

**Why:** Frontend source compatibility is not required, and repository-owned components use patterns
that AI coding tools understand more reliably while remaining directly inspectable and testable.
This trades the current wrapper investment and exact underlying web-component behavior for stronger
generation support, simpler customization, and an explicit Visual and Interaction Parity test suite.
