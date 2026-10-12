# Event benchmark

A synthetic model for measuring how FML runs event-driven work, which the
GPGPU-Sim model (clocks only) never exercises. It comes in two shapes:
lanes that stress the parallel runtime, and a mesh network on chip that
is closer to a real model.

## Lanes

```text
Top (clocks)
└── lanes: [Lane; lane_count]
    ├── source: Source        every `every` clock edges: emit a token
    ├── stages: [Stage; stage_count]
    │     on a token from its own lane or the next one:
    │     state = mix(state, token, `work` rounds); pass its own lane's token on
    └── sink: Sink            total += token
```

Stage *k* of lane *i* takes the tokens at position *k* of its own lane and
of lane *i* + 1, so the lanes depend on each other. Each hop between
stages is either one delta cycle or a declared minimum delay of 1 ns,
which lets work run ahead across timepoints. Lanes can run on clocks out
of phase, so that each timepoint has only a few lanes active; and a
variant ends each lane in stages that the clock triggers too.

## Mesh

A `width` × `height` mesh of routers. Each router's clock injects
packets, a share of them to a hotspot so the load is uneven; packets go X
then Y, one per output per cycle from per-output queues, over links that
are events with a physical delay (2 ns by default). A variant adds a
monitor that sums every router's counters on the clock and stops the
simulation once a goal number of packets has been delivered, which
exercises [stopping](../guide/running#stopping) in an event-driven model.

## What it shows

Every configuration prints a checksum, which every number of workers and
every layout must agree on. On eight workers (µs per simulated cycle,
lower is better):

| Configuration | 1 worker | 8 workers |
|---|---|---|
| mesh, 8 × 8 | 27.5 | 8.2 |
| mesh, 16 × 16, heavy routers | 2,185 | 279 |
| mesh, 32 × 32 | 1,284 | 178 |
| heavy lanes, delta hops | 16,690 | 2,197 |
| lanes out of phase, 1 ns hops | 135 | 45 |
| lanes out of phase, delta hops | 131 | 149 |

The last two rows are the same lanes, with the same work. With 1 ns hops,
work at different times overlaps and eight workers are three times as
fast; with delta hops, every hop is a handoff between cores that nothing
overlaps, and one worker is fastest. The default placement policy measures
which is the case and chooses accordingly; the small loss on the last row
is what that measurement costs in a run of a quarter of a second.
