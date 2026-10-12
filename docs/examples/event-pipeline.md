# Event pipeline

The smallest model with more than one module, and the one
[Getting started](../guide/getting-started) builds step by step.

```text
Top                        a 10 ns clock
└── workers: [Worker; worker_count]
    ├── producer: Producer on every clock edge: value += step, send value
    └── sink: Sink         on every value received: total += value
```

It shows, in about 80 lines:

- module parameters, and an array of submodules sized by one
  (`[Worker; fml::DynShape(worker_count)]`);
- nested submodules, connected in each module's `init`;
- a clock relayed through a level of hierarchy (`Clock` → `ClockRelay` →
  `ClockRelay`);
- an event source connected to a relay (`EventSource<u64>` →
  `EventRelay<u64>`);
- state, and the smallest useful pair of tasks: one on a clock that
  emits, one on an event.

## What it becomes

After elaboration, the relays are gone: every producer subscribes to the
top's clock directly, and sink *r* to producer *r*'s event.
`plan.to_program()` prints the result.

## Running it

With the default parameters (two workers, step 1), the clock ticks at 0,
10, …, 100 ns, so after `run_until(100 ns)` every sink holds
1 + 2 + … + 11 = 66. With a parameter file that gives worker 1 a step of
10, its sink holds 660:

```toml
[top]
worker_count = 3

[[top.workers]]
__select_index__ = 1
[top.workers.producer]
step = 10
```

```text
workers[0].sink.total = 66
workers[1].sink.total = 660
workers[2].sink.total = 66
```

The same numbers come out on any number of workers.
