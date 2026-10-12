# GPGPU-Sim, reproduced cycle by cycle

The largest FML model so far is a reproduction of GPGPU-Sim, the
standard academic GPU simulator, as Accel-Sim drives it from SASS traces:
the SM7_QV100 configuration, a Volta V100. The goal is not a model
"like" GPGPU-Sim but the same simulation: every statistic, and every
event in a per-cycle log, identical to the reference's.

## What it models

Everything the rodinia_2.0-ft benchmarks exercise:

- **80 SMs**: fetch and decode, four schedulers, the scoreboard, the
  operand collector, the SP, DP, INT, SFU, branch, texture and tensor
  pipelines, writeback;
- **the load/store unit**: shared-memory bank conflicts, global
  coalescing into 32-byte sectors, the L1 data cache and its banks;
- **the memory system**: address mapping, sector caches with MSHRs, the
  iSLIP crossbar between 80 SMs and 64 L2 slices, 32 memory partitions
  with their queues, and DRAM channels with FR-FCFS scheduling and bank
  timing;
- **the command processor**: kernel launches, CTA dispatch, the copies
  before each kernel, and the reference's own deadlock detection.

Atomics, local memory and fences are not modeled; traces that use them
are refused when they load.

## The reference

Accel-Sim v2.0.0 in trace-driven mode, with GPGPU-Sim at a fixed commit
and three small patches:

1. **Exact clock domains.** GPGPU-Sim advances each clock domain by
   adding its period, as a double. Rounding makes edges that should
   coincide drift apart within a few hundred cycles. The patch adds an
   option that fires edges at exact times; the reference is run with it.
   On 10 of the 11 benchmarks this changes nothing; streamcluster runs 28
   cycles shorter (of 1.17 million).
2. **A per-cycle event log**, written by the SMs and the command
   processor, and
3. **memory-system events** in the same log (crossbar, L2, DRAM).

The log patches leave GPGPU-Sim's own output unchanged.

## The model

```text
Gpu                       core clock (1132 MHz) and DRAM clock (850 MHz)
├── sms: [Sm; 80]         tasks: icnt (receive replies), cycle (the pipeline)
├── cp: Cp                kernel launch, CTA dispatch, statistics
├── xbar: Xbar            tasks: req, reply (one per subnetwork)
├── mems: [MemPartition; 32]
│   ├── l2s: [L2; 2]      L2 slices
│   └── dram: Dram        on the DRAM clock
└── Fifos between them    launch, requests and replies, to and from DRAM
```

The two clocks run at 1132 and 850 MHz; their periods are modeled as 425
and 566 picoseconds, which keeps the ratio between them exact, so the
edges coincide exactly where the reference's exact clocks do.

**The order within a cycle comes from the FIFOs alone.** In GPGPU-Sim,
one function calls the parts of a cycle in a fixed order: DRAM, then L2,
then the crossbar, then the SMs. In the model, each FIFO's two sides say
who acts first ([Components](../guide/components#who-acts-first)), and
FML derives the same order:

```text
[Dram] → L2 ‖ Sm.icnt → Xbar.req ‖ Xbar.reply → Sm.cycle → Cp
```

Nothing in the model or in FML refers to these names: change an access
mode, and the order changes accordingly. The command processor reads
every SM's status as it is at the end of the cycle (`&'latest`), so it
runs after them.

The same SM, memory and command-processor code also runs in a plain loop,
outside FML, in the reference's call order. It is a second check of the
model itself.

## How exactness is checked

- **86 small cases**, 30 written by hand to exercise one mechanism each
  (bank conflicts, barriers, scheduling corner cases, …) and 56
  generated at random, each with the reference's full per-cycle log and
  statistics as goldens.
- **The 11 rodinia_2.0-ft benchmarks**, from 8,389 cycles (heartwall) to
  1,172,557 (streamcluster), 2.4 million cycles and 16.5 million log
  lines in all, compared on the statistics and on hashes of the log in
  windows of 10,000 cycles.

Every case must match exactly in the plain loop and in FML on one and four
workers one timepoint at a time, and on one, two, three and eight workers
with timepoints overlapping; every benchmark in the plain loop and in FML
on one worker one timepoint at a time, and on one, two and eight workers.
They all do.

## Speed

**A busy GPU: 45 times as fast.** On a kernel that keeps all 80 SMs busy
(1280 CTAs of 8 warps, 16,399 cycles), on an AMD EPYC 9654:

| | Accel-Sim | FML, 1 worker | FML, 8 workers |
|---|---|---|---|
| simulating | 26.0 s | 3.2 s (8.1×) | **0.57 s (45×)** |
| reading the 107 MB of traces | (while simulating) | 1.1 s | 1.1 s |
| whole run | 26.0 s | 4.3 s (6.0×) | 1.66 s (15.7×) |

Accel-Sim reads its traces as it simulates, so its 26.0 s include them;
FML reads them first, on one thread, so its whole run adds 1.1 s to the
simulation.

**The rodinia benchmarks**, whole runs including reading the traces,
FML's workers pinned to one cache domain:

| Benchmark | Cycles | Accel-Sim | FML, 1 worker | FML, 8 workers | 8 workers vs Accel-Sim |
|---|---|---|---|---|---|
| heartwall | 8,389 | 4.00 s | 1.24 s | 0.37 s | 10.8× |
| backprop | 14,731 | 7.66 s | 1.51 s | 0.51 s | 15.0× |
| nn | 29,962 | 16.0 s | 3.61 s | 0.89 s | 18.0× |
| lud | 127,309 | 8.35 s | 1.15 s | 0.72 s | 11.6× |

All 11 benchmarks take 218 s in Accel-Sim and 22.4 s in FML on eight
workers, about 9.7 times as fast; per benchmark, from 8.2× (streamcluster)
to 18× (nn).

The benchmarks differ in how much parallelism they have. Heavy ones (many
SMs busy each cycle) use all eight workers. Light ones, where most cycles
have little to do, would lose time handing work between cores; FML's
placement policy measures this as it runs and picks the faster layout for
each phase ([Performance](../guide/performance#placement)).
