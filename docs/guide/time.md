# Time: clocks and events

## Time and timepoints

`fml::Time` is a physical time in integer picoseconds, or `Time::DELTA`,
one delta cycle:

```rust
fml::Time::ns(10)        // also ps, us, ms, s
fml::Time::from_ps(425)
fml::Time::DELTA
```

It has no arithmetic or ordering of its own; compare and add through
`as_ps()`, which is `None` for `DELTA`. In parameter files a time is a
string: `"10ns"`, `"250 ps"`, `"delta"`.

A **timepoint** is a physical time plus a delta cycle, ordered by time and
then delta, and displayed as `10ns` or `10ns+1`. Clocks fire at delta 0;
an event sent with `DELTA` arrives at the next delta of the same time; an
event sent with a physical delay arrives at delta 0 of that later time.
Timepoints run strictly in order: everything at `10ns`, then everything at
`10ns+1`, and so on.

## Clocks

An independent clock is a `fml::Clock` field, configured once in `init`
with a period and a phase (the time of its first edge, less than the
period):

```rust
ctx.init_clock(module.clock, fml::Time::ns(10), fml::Time::ps(0))?;
```

Modules that receive a clock declare a `fml::ClockRelay` and are
connected to it: `ctx.connect(module.clock, module.child.clock)?`. A task
on a clock sees the clock's `ClockInfo` (period and phase) as its trigger
payload.

**Several clock domains** are just several clocks. Their periods and
phases are exact integers, so edges that should coincide do, forever. The
GPGPU-Sim model runs its core at 1132 MHz and its DRAM at 850 MHz as
periods of 425 and 566 picoseconds, which keeps the ratio between them
exact.

FML supports up to 64 distinct clock configurations, and up to 65,536
timepoints in one hyperperiod (the least common multiple of the periods,
after the largest phase); it refuses a model beyond that when it loads.

## Events

An event source has a payload type, which must be a plain type:

```rust
#[fml::trigger]
pub done: fml::EventSource<u64>,
```

A task that may send on it lists it in `emits`, and sends with a delay:

```rust
ctx.emit_triggers().0.emit(*value, fml::Time::DELTA)?;   // next delta cycle
ctx.emit_triggers().0.emit(*value, fml::Time::ns(2))?;   // 2 ns later
```

A delay is `DELTA` or a positive physical time; a physical delay of zero
is an error. The receiving side declares a `fml::EventRelay<T>` and is
connected to the source, or to another relay; a relay chain adds no delay,
and a relay has exactly one source. A task triggered by the relay finds
the payload in its trigger slot.

A source may receive at most one event per timepoint: two events for the
same location and timepoint, from two tasks or from one, are a
**multi-drive** error. Send several values at once as one payload, or use
an array of sources.

## Declared delays

An event source can declare the delays its events may use:

```rust
#[fml::param("link delay", default = fml::Time::ns(2))]
link: fml::Time,

#[fml::trigger(min_delay = link)]
pub out: [fml::EventSource<Packet>; 4],

#[fml::trigger(max_delay = fml::Time::DELTA)]
pub hint: fml::EventSource<()>,
```

A bound is a constant `fml::Time` or the name of a `Time` parameter of the
module. Every emit is checked against it.

**`min_delay` is what lets event-driven parts run in parallel.** When FML
knows that nothing a source sends can arrive less than 2 ns later,
everything downstream of it may run up to 2 ns ahead of the sender.
Without a declared minimum, a hop counts as a single delta cycle, and
receivers cannot run ahead of the physical time of their senders. Declare
the real minimum latency of every link and port.

`max_delay = Time::DELTA` says the event only ever arrives a delta cycle
later, so it can never meet a clock edge; the analysis then knows that
tasks it triggers never run in the same timepoint as clocked ones, which
removes conflicts it would otherwise have to check at run time.

A minimum delay on a source used by a task that may stop the simulation
also sets how long after a stop the simulation keeps running
([Stopping](./running#stopping)).

## Delta cycles

Delta cycles order things within one physical time: a chain of events,
each sent with `DELTA`, runs as a sequence of timepoints at the same time.
More than `delta_limit` delta cycles at one time (1000 by default) is an
error, which catches models that never settle. Set `SimConfig::delta_limit`
for models that need longer chains.
