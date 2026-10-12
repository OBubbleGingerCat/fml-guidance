# Running a simulation

## From plan to simulation

```rust
let plan = fml::SimPlan::<Top>::new(Some("params.toml".into()), None)?;
print!("{}", plan.to_program()?);       // the program the model became, as text
let mut sim = plan.into_sim(fml::SimConfig::default())?;
```

- `SimPlan::new(params, snapshot)` elaborates and checks the model. Both
  arguments are optional paths: without a parameter file every parameter
  keeps its default; with a snapshot the simulation starts from it
  ([Snapshots](./snapshots)).
- `plan.to_program()` gives the program the model became, useful to see
  what the `init`s connected.
- `into_sim(config)` builds the simulation. A model with
  [external ports](./external-ports) uses `into_sim_with(config, |top, ports| ..)`
  to bind them.

## Configuration

`fml::SimConfig`:

| Field | Default | Meaning |
|---|---|---|
| `workers` | every hardware thread, up to 64 | the most worker threads; the placement policy may use fewer. Set it to use more than 64 |
| `overlap` | `true` | let later timepoints start while earlier ones finish, where the model allows; `false` runs one timepoint at a time |
| `checks` | `false` | check the parallel program when it is built, and record the execution order for `sim.check_trace()`; slow, for tests |
| `delta_limit` | 1000 | the most delta cycles at one physical time |
| `stop_delay` | `None` | how long after a stop the simulation runs; `None` is the model's free delay ([Stopping](#stopping)) |
| `event_capacity` | 2²⁰ | the most events in flight from one source location |
| `snapshots` | `None` | when and where to take snapshots |
| `placement`, `wait`, `steal`, `pin`, `topology` | built in | runtime policies ([Performance](./performance)) |

None of these changes results, except `stop_delay`, `delta_limit` and
`event_capacity`, which change them deterministically: a given value gives
the same results on any machine and any number of workers.

```rust
let config = fml::SimConfig {
    workers: 8,
    checks: true,
    ..fml::SimConfig::default()
};
```

## Running

`sim.run_until(time)` runs every timepoint up to and including `time`, all
of its delta cycles included, and returns how it ended:

```rust
match sim.run_until(fml::Time::us(10))? {
    fml::RunEnd::Reached(time) => println!("reached {time}"),
    fml::RunEnd::Finished(finished) => println!("stopped at {}", finished.at),
}
```

Runs can be repeated: `run_until(1 µs)`, then `run_until(2 µs)` continues
from where the first stopped, and gives the same result as running to
2 µs at once.

`sim.step()` runs exactly the next timepoint and returns
`StepEnd::Executed(timepoint)`, `StepEnd::Finished(..)` or
`StepEnd::Idle` when nothing is left to run. `sim.next_timepoint()` says
which timepoint that would be, and `sim.now()` which ran last.

## Reading and writing state

Between runs, the host reads state through the handles in `sim.top()`,
the instance tree:

```rust
let total = sim.top().workers[0].sink.total;
println!("{}", sim.state(total)?);
*sim.state_mut(total)? = 0;
```

`state` reads a value; `state_mut` writes one, and is also how the host
reaches stores and external sources.

## Stopping

A task that may end the simulation returns `Result<(), fml::Stop>`:

```rust
#[fml::module]
pub struct Countdown {
    #[fml::param("ticks before stopping", default = 5u64)]
    limit: u64,

    #[fml::trigger]
    clock: fml::Clock,

    ticks: u64,
}

#[fml::module_impl]
impl Countdown {
    #[fml::init]
    fn init(ctx: &mut fml::InitCtx) -> Result<(), fml::SimError> {
        let module = ctx.module();
        ctx.init_clock(module.clock, fml::Time::ns(1), fml::Time::ps(0))
    }

    #[fml::task(triggers = (clock,))]
    fn count(ctx: &mut fml::TaskCtx, ticks: &mut u64) -> Result<(), fml::Stop> {
        *ticks += 1;
        if *ticks == *ctx.module().limit {
            return Err(fml::Stop::finish(format!("counted to {ticks}")));
        }
        Ok(())
    }
}
```

```rust
match sim.run_until(fml::Time::ns(100))? {
    fml::RunEnd::Finished(finished) => {
        for finish in &finished.by {
            println!("{} at {}: {}", finish.path, finished.at, finish.message);
        }
        println!("ended at {}", finished.end);
    }
    fml::RunEnd::Reached(time) => println!("reached {time}"),
}
```

```text
top at 4ns: counted to 5
ended at 4ns
```

A stop returned at *T* ends the simulation at *T* + *L*, where *L* is the
stop delay: everything up to that time runs, nothing after. `finished`
records where the stop came from (`at`, `by`), where the simulation ended
(`end`), and any stops returned in between (`later`). The default *L* is
the model's **free delay**, the longest any work can run ahead of the
stopping task without waiting for it, so that stopping costs nothing; it
depends on the model, never on the configuration, and `sim.stop_delay()`
reports it. Here nothing depends on the counter, so it is 0. A shorter
delay than the free one, such as `Some(fml::Time::ps(0))`, is still exact
but makes other work wait for the stopping tasks, which costs speed.

`Stop::Error(e)` and `Err(e)` from a `SimError` end the run with an error
instead; `?` converts.

## After the run

- `sim.finished()` returns the stop, once any task has stopped.
- `sim.check_trace()`, with `checks` on, verifies that every pair of
  conflicting accesses ran in the serial order, and returns the
  violations otherwise.
- `sim.program()` is the program the simulation runs.
