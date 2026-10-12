# Snapshots

Snapshots save a running simulation's complete state at regular
boundaries, without stopping it, so that a long run can be resumed from
shortly before a problem instead of from the start.

## Taking snapshots

```rust
let config = fml::SimConfig {
    snapshots: Some(fml::SnapshotConfig::new(
        fml::SnapshotEvery::Time(fml::Time::us(100)),
        "snapshots".into(),
    )),
    ..fml::SimConfig::default()
};
let mut sim = plan.into_sim(config)?;
sim.run_until(fml::Time::ms(5))?;
```

Boundaries are at every 100 µs (100, 200, …; never at 0). They can also
follow a clock, every *N* of its cycles:

```rust
let clock = plan.top.core_clock;            // a clock's handle, taken before into_sim
fml::SnapshotEvery::Cycles { clock, cycles: 100_000 }
```

A snapshot at a boundary *B* is the state after every timepoint before
*B* and before any at or after it.

`SnapshotConfig::new(every, dir)` keeps the newest 3 snapshots (`keep`)
and makes every 8th one full (`full_every`); the others are
**incremental**, holding only the memory cells written since the one
before. Each snapshot is a file in `dir` named by its boundary in
picoseconds, `00000000000100000000.fmls`; files are written by a
background thread, through a temporary file and a rename, so a file that
exists is complete.

## Best effort

Snapshots never block the simulation: they are captured while it runs,
alongside the jobs. In exchange, a boundary may be **skipped** if the
previous snapshot is still being written. Every snapshot that is written
is exact, and the same on any number of workers.

```rust
if let Some(status) = sim.wait_snapshots() {
    println!("{} written, {} skipped, latest {:?}", status.written, status.skipped, status.latest);
}
```

`snapshot_status()` reports without waiting; `wait_snapshots()` waits for
the writer first. A write failure is reported there and does not fail the
run.

A model that runs faster than snapshots are written skips boundaries: run
to 100 ns at once with a snapshot every 30 ns, and the one at 30 ns may
still be writing when 60 and 90 pass. Where every boundary matters, in a
test say, run in steps and wait in between:

```rust
for until in [30, 60, 90, 100] {
    sim.run_until(fml::Time::ns(until))?;
    sim.wait_snapshots();
}
```

## Restoring

Give the latest snapshot file to `SimPlan::new`:

```rust
let latest = status.latest.expect("a snapshot");   // from wait_snapshots() above
let plan = fml::SimPlan::<Top>::new(params, Some(latest))?;
let mut sim = plan.into_sim(fml::SimConfig { workers: 3, ..config })?;
println!("restored from {:?}", sim.restored_from());
sim.run_until(fml::Time::ms(5))?;   // continues exactly as the original run
```

`fml::snapshot_path(dir, time)` gives the file name for a boundary.

An incremental snapshot finds the files it builds on by name, in the same
directory. The restored simulation may use a different number of workers
or a different configuration; it continues exactly as the original run
would have.

A snapshot only restores into the same model: the file records a
fingerprint of the program (its structure, types, clocks, connections and
reset values), and a mismatch is an error. Task bodies and parameters that
only tasks read are not part of the fingerprint, so a snapshot can be
restored with a fixed bug in a task, which is often the point.

## External ports

Sources taken exclusively (`&mut External<S>`) must implement `save` and
`restore` ([External ports](./external-ports#snapshots)); with snapshots
configured, building a simulation whose sources cannot be saved fails and
names the port. Read-only sources are not saved: on restore, the host
binds them again.
