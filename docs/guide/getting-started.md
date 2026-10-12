# Getting started

This page builds the smallest useful model, the event pipeline: a clock,
and a number of workers, each a producer that counts on the clock and a
sink that sums what the producer sends it.

```text
Top
└── workers: [Worker; worker_count]
    ├── producer: Producer   on every clock edge: value += step; send value
    └── sink: Sink           on every value received: total += value
```

## Setting up

FML is not published on crates.io yet. Depend on it from a checkout of its
repository:

```toml
[dependencies]
fml = { path = "../fml/crates/fml" }

# Recommended: task bodies, the code the macros generate and FML itself
# are in different crates, and inlining across them makes models faster.
[profile.release]
lto = "fat"
codegen-units = 1
```

FML needs a recent stable Rust.

## The producer

A module is a struct marked `#[fml::module]`. Its fields are parameters
(`#[fml::param]`), triggers (`#[fml::trigger]`), submodules
(`#[fml::submodule]`) and, without an attribute, state.

```rust
#[fml::module]
pub struct Producer {
    #[fml::param("increment per tick", default = 1)]
    step: u64,

    #[fml::trigger]
    pub clock: fml::ClockRelay,

    #[fml::trigger]
    pub done: fml::EventSource<u64>,

    value: u64,
}

#[fml::module_impl]
impl Producer {
    #[fml::task(triggers = (clock,), emits = (done,))]
    fn produce(ctx: &mut fml::TaskCtx, value: &mut u64) -> Result<(), fml::SimError> {
        *value += *ctx.module().step;
        ctx.emit_triggers().0.emit(*value, fml::Time::DELTA)?;
        Ok(())
    }
}
```

- `clock` is a **relay**: the clock comes from the module above.
- `done` is an **event source** with a `u64` payload.
- The task runs on every clock edge. `value: &mut u64` binds the state
  field of the same name for writing. `emit(.., fml::Time::DELTA)` sends
  the value one delta cycle later, at the same time.

## The sink

```rust
#[fml::module]
pub struct Sink {
    #[fml::trigger]
    pub done: fml::EventRelay<u64>,

    pub total: u64,
}

#[fml::module_impl]
impl Sink {
    #[fml::task(triggers = (done,))]
    fn consume(ctx: &mut fml::TaskCtx, total: &mut u64) -> Result<(), fml::SimError> {
        if let Some(value) = ctx.triggered_triggers().0 {
            *total += *value;
        }
        Ok(())
    }
}
```

`triggered_triggers()` gives one slot per trigger, `Some(payload)` for
those that fired.

## Connecting them

Connections are made in a module's `#[fml::init]`, with explicit calls;
nothing is connected by name.

```rust
#[fml::module]
pub struct Worker {
    #[fml::trigger]
    pub clock: fml::ClockRelay,

    #[fml::submodule]
    producer: Producer,

    #[fml::submodule]
    sink: Sink,
}

#[fml::module_impl]
impl Worker {
    #[fml::init]
    fn init_worker(ctx: &mut fml::InitCtx) -> Result<(), fml::SimError> {
        let module = ctx.module();
        ctx.connect(module.clock, module.producer.clock)?;
        ctx.connect(module.producer.done, module.sink.done)?;
        Ok(())
    }
}

#[fml::module]
pub struct Top {
    #[fml::param("number of workers", default = 2)]
    worker_count: usize,

    #[fml::trigger]
    pub clock: fml::Clock,

    #[fml::submodule]
    workers: [Worker; fml::DynShape(worker_count)],
}

#[fml::module_impl]
impl Top {
    #[fml::init]
    fn init_top(ctx: &mut fml::InitCtx) -> Result<(), fml::SimError> {
        let module = ctx.module();
        ctx.init_clock(module.clock, fml::Time::ns(10), fml::Time::ps(0))?;
        for worker in module.workers.iter() {
            ctx.connect(module.clock, worker.clock)?;
        }
        Ok(())
    }
}
```

- `fml::Clock` is an independent clock; `init_clock` gives it a period of
  10 ns and phase 0.
- `[Worker; fml::DynShape(worker_count)]` is an array whose length is the
  `worker_count` parameter.

## Running it

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let params = std::env::args_os().nth(1).map(std::path::PathBuf::from);
    let plan = fml::SimPlan::<Top>::new(params, None)?;
    let mut sim = plan.into_sim(fml::SimConfig::default())?;
    match sim.run_until(fml::Time::ns(100))? {
        fml::RunEnd::Reached(time) => println!("ran until {time}"),
        fml::RunEnd::Finished(finished) => println!("finished at {}", finished.at),
    }
    let totals: Vec<_> = (sim.top().workers.iter())
        .map(|worker| worker.sink.total)
        .collect();
    for (index, total) in totals.into_iter().enumerate() {
        println!("workers[{index}].sink.total = {}", sim.state(total)?);
    }
    Ok(())
}
```

- `SimPlan::new` reads the parameters (or uses the defaults when given
  `None`), builds the instances, runs the `init`s and checks the model.
- `into_sim` makes the simulation; `SimConfig::default()` uses every
  hardware thread the machine has, up to 64.
- `run_until` runs every timepoint up to 100 ns. The clock ticks at 0, 10,
  …, 100 ns, so each sink ends at 1 + 2 + … + 11 = 66.
- `sim.top()` gives handles to the model's state, read with `sim.state`.

## Parameters

Parameters come from a TOML file whose tables follow the instance tree.
Three workers, the second counting in tens:

```toml
[top]
worker_count = 3

[[top.workers]]
__select_index__ = 1
[top.workers.producer]
step = 10
```

```text
ran until 100ns
workers[0].sink.total = 66
workers[1].sink.total = 660
workers[2].sink.total = 66
```

## Next

- [Modules and parameters](./modules) and [State and tasks](./state-and-tasks)
  explain what you just wrote in full.
- [Time](./time) covers clocks, events and delays.
- [Running a simulation](./running) covers the configuration, stopping and
  reading results.
