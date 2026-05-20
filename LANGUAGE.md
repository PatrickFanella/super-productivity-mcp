# Architecture Language

Use this vocabulary for architecture reviews and refactors in this repository.

- **Module** — anything with an interface and an implementation: a function,
  package, script, test harness, installer profile, action group, or documented
  workflow.
- **Interface** — everything a caller must know to use the module: names, types,
  invariants, ordering, error modes, configuration, files, and side effects.
- **Implementation** — the code and data behind the interface.
- **Depth** — leverage at the interface. A deep module hides substantial useful
  behavior behind a small interface. A shallow module exposes almost as much
  complexity as it contains.
- **Deep** — high leverage and high locality: callers know little while the
  implementation owns meaningful behavior.
- **Shallow** — low leverage: the interface is nearly as complex as the
  implementation, often just passing maps, flags, or calls through.
- **Seam** — where an interface lives; a place behavior can be altered without
  editing callers in place.
- **Adapter** — a concrete implementation satisfying an interface at a seam.
- **Leverage** — what callers gain from a module's depth.
- **Locality** — what maintainers gain from depth: changes, bugs, and knowledge
  concentrated in one place.

## Tests and Seams

- **Deletion test** — imagine deleting the module. If complexity vanishes, the
  module was probably pass-through. If complexity reappears across many callers,
  the module was earning its keep.
- **The interface is the test surface.** Test the contract callers rely on, not
  incidental implementation details.
- **One adapter = hypothetical seam. Two adapters = real seam.** Do not add a
  broad abstraction until there is more than one adapter or the single adapter
  owns enough behavior to justify the seam.
