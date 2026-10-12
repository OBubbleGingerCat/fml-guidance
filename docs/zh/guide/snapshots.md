# 快照

快照在固定的边界上保存运行中仿真的完整状态，而且不停止仿真。这样一次很长的运行可以从问题出现前不久的地方恢复，而不必从头开始。

## 拍快照

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

边界在每 100 µs 处（100、200、…；从不在 0）。边界也可以跟随一个时钟，每 *N* 个周期一个：

```rust
let clock = plan.top.core_clock;            // 一个时钟的句柄，在 into_sim 之前取得
fml::SnapshotEvery::Cycles { clock, cycles: 100_000 }
```

边界 *B* 处的快照，是 *B* 之前的每个时刻点都已运行、*B* 及之后的时刻点都还没有运行时的状态。

`SnapshotConfig::new(every, dir)` 保留最新的 3 个快照（`keep`），每 8 个中有一个是完整快照（`full_every`）；其余的是**增量**快照，只含自上一个快照以来写过的内存单元。每个快照是 `dir` 里的一个文件，以它的边界（皮秒）命名，如
`00000000000100000000.fmls`；文件由一个后台线程先写成临时文件，再重命名，所以存在的文件都是完整的。

## 尽力而为

快照从不阻塞仿真：它们在仿真运行的同时、与 job 一起被捕获。代价是，如果上一个快照还在写，某个边界可能被**跳过**。写出的每个快照都是精确的，在任何 worker 数下都相同。

```rust
if let Some(status) = sim.wait_snapshots() {
    println!("{} written, {} skipped, latest {:?}", status.written, status.skipped, status.latest);
}
```

`snapshot_status()` 不等待，直接报告；`wait_snapshots()` 先等写入线程。写入失败在这里报告，不会让运行失败。

模型运行得比快照写得快时，就会跳过边界：一次跑到 100 ns、每 30 ns 一个快照，那么经过 60 和 90 时，30 ns 的快照可能还在写。如果每个边界都重要（比如在测试里），就分步运行，中间等待：

```rust
for until in [30, 60, 90, 100] {
    sim.run_until(fml::Time::ns(until))?;
    sim.wait_snapshots();
}
```

## 恢复

把最新的快照文件交给 `SimPlan::new`：

```rust
let latest = status.latest.expect("a snapshot");   // 来自上面的 wait_snapshots()
let plan = fml::SimPlan::<Top>::new(params, Some(latest))?;
let mut sim = plan.into_sim(fml::SimConfig { workers: 3, ..config })?;
println!("restored from {:?}", sim.restored_from());
sim.run_until(fml::Time::ms(5))?;   // 与原来的运行完全一样地继续
```

`fml::snapshot_path(dir, time)` 给出一个边界对应的文件名。

增量快照按文件名在同一个目录里找到它所依赖的文件。恢复后的仿真可以用不同的
worker 数或不同的配置；它会与原来的运行完全一样地继续下去。

快照只能恢复到同一个模型：文件记录了程序的指纹（它的结构、类型、时钟、连接和复位值），不匹配就是错误。task 的函数体和只有 task 读的参数不算在指纹里，所以修好 task 里的一个 bug 之后仍然可以恢复快照，而这往往正是快照的用处。

## 外部端口

被独占使用（`&mut External<S>`）的源对象必须实现 `save` 和 `restore`
（[外部端口](./external-ports#snapshots)）；配置了快照时，如果有源对象不能保存，构建仿真就会失败，并给出这个端口。只读的源对象不保存：恢复时，宿主重新绑定它们。
