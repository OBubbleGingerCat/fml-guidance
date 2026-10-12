---
layout: home

hero:
  name: FML
  text: Full-System Modeling Language
  tagline: Clocked timing and discrete events in one Rust model, simulated in parallel, with results that never depend on how it runs.
  image:
    light: /logo.svg
    dark: /logo-dark.svg
    alt: FML
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: GPGPU-Sim, cycle-exact
      link: /examples/gpgpu-sim

features:
  - title: Deterministic in parallel
    icon:
      light: /icons/deterministic.svg
      dark: /icons/deterministic-dark.svg
      width: 44
      height: 44
    details: The same state, events and end on any number of workers, with timepoints overlapping or one at a time. FML works out the model's ordering when it loads it, rejects what is ambiguous, and can check a run against it.
  - title: Models in plain Rust
    icon:
      light: /icons/rust.svg
      dark: /icons/rust-dark.svg
      width: 44
      height: 44
    details: Modules are Rust structs, their state Rust values, their behaviour Rust functions; macros do the rest. Parameters come from a TOML file.
  - title: Clocks and events together
    icon:
      light: /icons/clocks.svg
      dark: /icons/clocks-dark.svg
      width: 44
      height: 44
    details: Any number of clock domains in integer picoseconds, and events with physical delays or delta cycles, in the same model, from a pipeline stage to the network between GPUs.
  - title: Built for speed
    icon:
      light: /icons/speed.svg
      dark: /icons/speed-dark.svg
      width: 44
      height: 44
    details: Models run on many cores, independent work runs ahead of the rest, and FML measures as it runs to use as many cores as a model is worth.
  - title: Snapshots without stopping
    icon:
      light: /icons/snapshots.svg
      dark: /icons/snapshots-dark.svg
      width: 44
      height: 44
    details: Snapshots are taken while the simulation runs, incrementally, and restore it to reproduce a problem without running everything again.
  - title: Open at the edges
    icon:
      light: /icons/open.svg
      dark: /icons/open-dark.svg
      width: 44
      height: 44
    details: External ports bring in traces, functional models or RTL co-simulation; components, interfaces and runtime policies can all be user-defined.
---

<div class="fml-results">

## 45× faster than Accel-Sim

<div class="fml-stats">
  <div class="fml-stat"><div class="value">45×</div><div class="label">faster simulation than Accel-Sim on a busy GPU (all 80 SMs), eight workers</div></div>
  <div class="fml-stat"><div class="value">16×</div><div class="label">faster on the whole run, reading the 107 MB of traces included</div></div>
  <div class="fml-stat"><div class="value">11 / 11</div><div class="label">rodinia_2.0-ft benchmarks identical to GPGPU-Sim, cycle by cycle</div></div>
</div>

The GPGPU-Sim example models a Volta GPU (Accel-Sim's trace-driven QV100
configuration) in FML, and reproduces it cycle by cycle: on all 11
rodinia_2.0-ft benchmarks it matches the reference's statistics and
per-cycle event log exactly.

On a kernel that keeps all 80 SMs busy, **Accel-Sim takes 26.0 s; FML
simulates it in 0.57 s on eight workers, 45 times as fast.** FML reads the
107 MB of traces first, in 1.1 s more (Accel-Sim reads them as it
simulates), so the whole run is 16 times as fast.

On the rodinia benchmarks, whole runs including reading the traces:

| Benchmark | Accel-Sim | FML, 1 worker | FML, 8 workers | Faster, 8 workers |
|---|---|---|---|---|
| heartwall | 4.00 s | 1.24 s | 0.37 s | 10.8× |
| backprop | 7.66 s | 1.51 s | 0.51 s | 15.0× |
| nn | 16.0 s | 3.61 s | 0.89 s | 18.0× |
| lud | 8.35 s | 1.15 s | 0.72 s | 11.6× |

All on the same AMD EPYC 9654, FML's eight workers in one cache domain.
[More about the example](/examples/gpgpu-sim).

</div>
