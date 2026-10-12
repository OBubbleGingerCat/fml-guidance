# External ports

An external port connects a model to an object of the host program: a
trace reader, a functional model, an RTL simulation, an output log.
Tasks call into it like into state, and FML orders those calls like
state accesses.

## A port

A port is a state field of type `fml::External<S>`, where `S` implements
`fml::ExternalSource`:

```rust
#[derive(Default, Debug)]
pub struct Log {
    pub lines: Vec<String>,
}

impl fml::ExternalSource for Log {}

#[fml::module]
pub struct Monitor {
    #[fml::trigger]
    clock: fml::Clock,

    pub log: fml::External<Log>,
    cycle: u64,
}

#[fml::module_impl]
impl Monitor {
    #[fml::init]
    fn init(ctx: &mut fml::InitCtx) -> Result<(), fml::SimError> {
        let module = ctx.module();
        ctx.init_clock(module.clock, fml::Time::ns(1), fml::Time::ps(0))
    }

    #[fml::task(triggers = (clock,))]
    fn record(
        ctx: &mut fml::TaskCtx,
        log: &mut fml::External<Log>,
        cycle: &mut u64,
    ) -> Result<(), fml::SimError> {
        log.lines.push(format!("cycle {cycle} at {}", ctx.now()));
        *cycle += 1;
        Ok(())
    }
}
```

`External<S>` dereferences to `S`. Unlike state, the source may hold
anything: `Vec`s, files, handles to another simulator.

## Binding sources

The host creates one source object per port and binds it when it builds
the simulation, with `into_sim_with`:

```rust
let plan = fml::SimPlan::<Monitor>::new(None, None)?;
let mut sim = plan.into_sim_with(fml::SimConfig::default(), |top, ports| {
    ports.bind(top.log, Log::default())
})?;
sim.run_until(fml::Time::ns(2))?;
let log = sim.top().log;
for line in &sim.state_mut(log)?.lines {
    println!("{line}");
}
```

```text
cycle 0 at 0ps
cycle 1 at 1ns
cycle 2 at 2ns
```

Binding is by port, not by type: two ports of the same type get two
sources. An unbound port, or one bound twice, is an error. Between runs,
`sim.state_mut(handle)` gives the host the source object back.

A port can be shared with other modules like state, through a
`fml::StateRef<fml::External<S>>` connected with `ctx.share_state`. Ports
cannot be arrays; use an array of submodules, one port each.

## Access modes

| Parameter | Gets | Ordering |
|---|---|---|
| `p: &fml::External<S>` | `&S` | shared, before this timepoint's exclusive user |
| `p: &'latest fml::External<S>` | `&S` | shared, after it |
| `p: &mut fml::External<S>` | `&mut S` | exclusive: at most one task per port per timepoint |

## The contract

FML can only keep a simulation deterministic if the sources behave like
state. For each port:

- the same sequence of calls must give the same results, whatever thread
  makes them, whatever the time, and whatever happens on other ports;
- shared (`&`) calls must not change anything observable (a cache is
  fine);
- data shared between ports must be read-only, or not affect results.

**Things that are coupled must be one port.** An RTL instance's inputs and
outputs, for example, belong to one source: split across two ports, FML
may run calls to them in either order, or in parallel, and nothing reports
it.

Where to keep a cursor, such as the position in a trace, is a choice:

- **in state**, with a read-only port: tasks read the trace at the cursor
  their module keeps; many readers run in parallel, and snapshots save the
  cursor with the rest of the state;
- **in the source**, with an exclusive port: simpler, but every user needs
  its own port, and the source must implement snapshots itself.

## Snapshots

`ExternalSource` has two methods, which by default report that the source
cannot be saved:

```rust
impl fml::ExternalSource for Trace {
    fn save(&self, out: &mut Vec<u8>) -> Result<(), fml::plain::Error> {
        out.extend_from_slice(&self.position.to_le_bytes());
        Ok(())
    }

    fn restore(&mut self, saved: &[u8]) -> Result<(), fml::plain::Error> {
        // read the position back from `saved`
        Ok(())
    }
}
```

With snapshots on, a simulation with an exclusive port whose source cannot
be saved fails to build, naming the port. Read-only ports are not saved.
On restore, the host binds fresh sources as usual, and FML calls `restore`
on them with what `save` wrote.
