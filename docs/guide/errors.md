# Errors and debugging

Most modeling mistakes are caught before anything runs, when the plan is
built, and named by the instance paths in your model. The rest are caught
when they happen, with the timepoint.

## When the plan is built

`SimPlan::new` fails with a message for:

**Parameters**
- a table that names no instance, or a key that is not a parameter:
  `top.x is not a parameter`;
- a value of the wrong type, or a failed `validate`:
  `top.limits: validation failed: ...`;
- a `DynShape` length of zero, or negative.

**Connections**
- a relay, reference or interface never connected:
  `x: unbound handle (referenced by y)`;
- one connected twice: `x: duplicate driver (from y)`;
- a connection into a source, or between kinds that do not connect
  (a clock to an event): `invalid trigger connection ...`;
- a cycle of references: `connection cycle: a -> b -> a`;
- a clock never configured: `top.clock: Clock was not initialized`, or
  configured twice.

**Tasks**
- a parameter whose type is not the field's:
  `... state value has type u32, but the bound state has type u64`;
- two parameters of one task on one location with different modes:
  `state parameters current and latest conflict on ...`.

**Ordering**, which FML works out from the access modes
([State and tasks](./state-and-tasks#access-modes)):

- two tasks that certainly write one location in the same timepoint:

  ```text
  write conflict: %WriteConflict.bump at top and %WriteConflict.clear at top
  both write top.value (both triggered by clock top.clock (1ns phase 0ps))
  ```

- a cycle among tasks that always run together:

  ```text
  dependency cycle (triggered by clock top.clock ...): %Cycle.cycle_a at top
  reads top.x (curr) before %Cycle.cycle_b at top writes it; ...
  ```

  For a FIFO, this is both sides claiming to act first, or both after
  ([Components](./components#who-acts-first)).

Conflicts and cycles that only *may* happen, because events are involved,
are warnings instead, checked when the simulation runs:

```rust
for warning in plan.analysis().warnings() {
    eprintln!("{warning}");
}
```

## When the simulation is built

`into_sim` fails for a model FML cannot run: more than 64 distinct clock
configurations, or more than 65,536 timepoints per hyperperiod (the
message says which); for a `delta_limit` above 65,534; for an unbound or
twice-bound external port; and, with snapshots configured, for an
exclusive external port whose source cannot be saved.

## While it runs

`run_until` and `step` return `Err` and the run ends for:

| Error | Cause |
|---|---|
| `%Sm.cycle at top.sms[3] failed at 1200ns: ...` | a task returned an error |
| `... panicked: ...` | a task panicked |
| `multi-drive at 10ns+1: A and B both emit to L` | two events for one location and timepoint |
| `write conflict at 37ns: A and B both write L` | a possible write conflict happened |
| `dependency cycle among ...` | a block's active members formed a cycle |
| `more than 30 delta cycles at 5ns` | a chain of delta cycles that never settles (`delta_limit`) |
| `600000s is after the latest time a run with a delta limit of 30 reaches, ...` | the run went further in time than its `delta_limit` allows ([Delta cycles](./time#delta-cycles)) |
| `more than N events in flight from one location` | `event_capacity` exceeded |
| `event delay ... is below min_delay ...` | an emit outside the source's declared delays |

When several tasks fail at the same time, which error is reported may
differ between runs and configurations: they are all errors. The state
after an error is not specified.

## Debugging

- **Read the program.** `print!("{}", plan.to_program()?)` shows what the
  model became: every instance, connection and binding, with instance
  paths.
- **Step.** `sim.step()` runs one timepoint; `sim.next_timepoint()` says
  which. Inspect state with `sim.state(handle)` between steps.
- **Check the run.** With `SimConfig { checks: true, .. }`, FML checks
  its own schedule when it builds the simulation, and `sim.check_trace()`
  checks after a run that every conflicting pair of accesses ran in serial
  order.
- **Compare with the reference.** `SimConfig { workers: 1, overlap: false, .. }`
  runs one timepoint at a time on one worker. A model that gives other
  results on more workers is a bug in FML; please report it.
- **Snapshot and restore.** Take snapshots in a long run and restore the
  one before the problem, with a `step` loop or more logging
  ([Snapshots](./snapshots)).
