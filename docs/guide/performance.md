# Performance and runtime policies

FML runs a model on as many cores as it is worth, and decides how many by
measuring. This page is about what you can do to help it, and how to
replace its decisions with your own. None of it changes results.

## The basics

- **Build in release, with fat LTO** and one codegen unit
  ([Getting started](./getting-started#setting-up)). Task bodies, the
  code the macros generate and FML itself are in different crates;
  inlining across them is worth 17–28% on the GPGPU-Sim model.
- **Set `workers`** on a large machine. `SimConfig::default()` uses every
  hardware thread, up to 64; set `workers` to use more. A model is often
  fastest on the cores of one cache domain (8 on the machine the GPGPU-Sim
  numbers come from), with those workers pinned there
  ([Pinning](#pinning)).
- **Leave `overlap` on.** Turning it off runs one timepoint at a time,
  which is the reference for testing, not for speed.
- **Turn `checks` off** outside tests.

## Declare minimum delays

Where events drive a model, the most important thing a model can tell
FML is how soon an event can arrive. A link with a 2 ns latency declared as

```rust
#[fml::trigger(min_delay = link)]
pub out: fml::EventSource<Packet>,
```

lets every receiver run up to 2 ns ahead of its senders, and FML run
them in parallel. Without a declared minimum, a hop counts as one delta
cycle and receivers wait for their senders' physical time. Lanes of a
synthetic benchmark whose hops take 1 ns run 2.8 times as fast on eight
workers as on one; the same lanes with delta-cycle hops are fastest on
one.

## Placement

A **placement policy** chooses the layout: how many workers, how finely
the model is spread over them, and how its event-driven part runs. Every
so many timepoints, it sees what was measured and may change the layout
for the rest of the run.

**`Measured`**, the default:

1. starts on every worker, since the first jobs (loading input, say) may
   be heavy;
2. measures the work per timepoint on one worker, and uses as many
   workers as get at least 5 µs of it each, from 20 µs per timepoint
   (`parallel_work`);
3. for lighter work, compares one worker against every worker with one
   group each, by the wall time a timepoint takes, and keeps the faster
   if it is at least 5% faster;
4. measures and compares again when the pace changes by a factor of two,
   and every 65,536 timepoints.

Its parameters are public fields:

```rust
use fml::runtime::Measured;
use std::sync::Arc;

let mut measured = Measured::default();
measured.parallel_work = std::time::Duration::from_micros(10);
let config = fml::SimConfig {
    placement: Arc::new(measured),
    ..fml::SimConfig::default()
};
```

A `Measured` remembers its comparisons, so give each simulation its own
(a clone starts afresh).

**`Fixed`** uses every worker with a fixed number of groups each and never
changes:

```rust
use fml::runtime::Fixed;

let config = fml::SimConfig {
    workers: 8,
    placement: Arc::new(Fixed { groups_per_worker: 1 }),
    ..fml::SimConfig::default()
};
```

Fewer groups per worker means fewer handoffs between cores; more means
better balance. Three is the default; light models often prefer one.

## Your own policy

A policy implements `PlacementPolicy`:

```rust
use fml::runtime::{Decision, Layout, Measured, Measurement, PlacementPolicy};

/// Reports every check, then does what `Measured` does.
#[derive(Debug, Default)]
pub struct Logged(Measured);

impl PlacementPolicy for Logged {
    fn initial(&self, workers: usize) -> Layout {
        self.0.initial(workers)
    }

    fn first_check(&self) -> Option<u64> {
        self.0.first_check()
    }

    fn check(&self, measured: &Measurement<'_>) -> Decision {
        let decision = self.0.check(measured);
        eprintln!(
            "{} timepoints in {:?} on {} workers: {:?}",
            measured.timepoints, measured.elapsed, measured.layout.workers, decision.layout
        );
        decision
    }
}
```

- `initial` gives the layout at load; `first_check` the number of
  timepoints to the first check (`None` for none).
- `check` sees a `Measurement`: the layout, the timepoints and wall time
  since the last check, and per worker the estimated time its jobs took.
  It returns a `Decision`: a new layout or `None`, and the timepoints to
  the next check or `None` to stop checking.
- `homes`, optional, places groups on workers; by default the largest
  groups go first to the least loaded worker.

A `Layout` is `{ workers, groups_per_worker, dynamic_groups_per_worker,
dynamic }`, and `Layout::new(workers, groups)` fills in the rest with the
defaults for that many workers.

## Waiting, stealing, pinning

These are policies too, set in `SimConfig` like placement:

| Policy | Built in | Default |
|---|---|---|
| `wait`: what an idle worker does | `Adaptive` (spin, then yield, then park), `AlwaysSpin`, `AlwaysPark` | `Adaptive` |
| `steal`: whom an idle worker takes work from | `DomainSteal` (workers sharing a cache), `FlatSteal` (anyone), `NoSteal` | `DomainSteal` |
| `pin`: which cores workers run on | `NoPin`, `CacheDomain` | `NoPin` |

```rust
use fml::runtime::{AlwaysPark, CacheDomain, NoSteal};

let config = fml::SimConfig {
    workers: 8,
    pin: Arc::new(CacheDomain),
    wait: Arc::new(AlwaysPark),
    steal: Arc::new(NoSteal),
    ..fml::SimConfig::default()
};
```

### Pinning

`CacheDomain` keeps the workers on the physical cores nearest the calling
thread (its core, its cache domain, its memory node, then the rest), one
hardware thread each. On machines with several cache domains this matters:
the GPGPU-Sim model on eight workers is 20–50% faster pinned to one
domain than spread by the OS. The machine's layout comes from a
`Topology`, read from Linux's sysfs unless `SimConfig::topology` gives one.

`AlwaysPark` suits more workers than free cores; `AlwaysSpin` a machine
dedicated to the simulation.

Each policy is a public trait (`WaitPolicy`, `StealPolicy`, `PinPolicy`),
so any of them can be replaced the same way as placement.
