# What is FML?

FML, the **Full-System Modeling Language**, is a way to write cycle-level
models of whole systems in Rust, and to run them in parallel. A model can be a pipeline stage, a GPU, or many GPUs and the
network between them: parts driven by clocks, parts driven by events, in
one program.

## The idea

Hardware is many things happening at once, but a simulator that runs them
in parallel usually pays for it twice: in correctness, when two parts race
for the same state, and in effort, when the modeler has to say what may
run in parallel and synchronize it by hand.

FML asks for neither. You write each task as an ordinary function over the
state it touches, and say, through the type of each parameter, how it is
ordered against the other tasks that touch the same state within a cycle:

```rust
fn issue(ctx: &mut fml::TaskCtx,
         scoreboard: &Scoreboard,          // as it was at the start of the cycle
         ready: &'latest Ready,            // after this cycle's writer
         queue: &mut fml::FifoTx<Inst>)    // this task writes it
```

From these declarations alone, FML derives every ordering in the
model. It rejects a model whose order would be ambiguous, schedules the
rest across all cores, and guarantees that the result is the one a serial
run would give, whatever the number of workers.

## What a model is made of

- **Modules**: Rust structs with parameters, state, triggers and
  submodules. Arrays of submodules can be sized by a parameter.
- **State**: plain Rust values, fixed-capacity containers, sparse memories
  and external objects.
- **Triggers**: clocks, with exact integer periods and phases in
  picoseconds, any number of domains; and events, with a payload and a
  delay, physical or one delta cycle.
- **Tasks**: Rust functions that a module's triggers run, reading and
  writing its state and emitting events.
- **Components and interfaces**: reusable modules such as a `Fifo`, which
  others reach through typed interfaces that also fix who acts first.
- **External ports**: host objects, such as a trace reader, a functional
  model or an RTL simulation, that tasks call into.

## What you get

- **The same results in every configuration.** One worker or a hundred,
  timepoints overlapping or one at a time: the same final state, events
  and end.
- **Speed.** Models run on many cores without a global lock, with work
  that is independent running ahead of the rest. The GPGPU-Sim
  reproduction runs Accel-Sim's benchmarks 11 to 18 times as fast as
  Accel-Sim on eight workers.
- **Snapshots** taken while the simulation runs, to restore and reproduce
  a problem.
- **Errors at load time** for most modeling mistakes (two writers of one
  register, an unconnected reference, an ordering cycle), named by the
  instance paths in your model.

## When FML fits

FML is built for cycle-level models of systems whose parts interact
through state and events at known times: processors, accelerators,
memory hierarchies, interconnects, networks. It is not a hardware
description language: a model describes behaviour per cycle in Rust, not
gates and wires, and it can call into an RTL simulator through an external
port where that detail is needed.

Next: [Getting started](./getting-started).
