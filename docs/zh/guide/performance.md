# 性能与运行时策略

FML 在值得用的那么多个核上运行模型，用几个由测量决定。本页讲你能做些什么来帮助它，以及怎样用你自己的决定替换它的决定。这些都不改变结果。

## 基本要点

- **用 release 构建，开 fat LTO**，并且只用一个 codegen unit
  （[快速开始](./getting-started#setting-up)）。task 的函数体、宏生成的代码和
  FML 本身分在不同的 crate 里；跨 crate 内联让 GPGPU-Sim 模型快 17–28%。
- 在大机器上**设置 `workers`**。`SimConfig::default()` 用上每个硬件线程，最多 64 个；要用更多就设置 `workers`。一个模型往往在一个缓存域的核上最快（GPGPU-Sim 数据所在的机器上是 8 个），同时把这些 worker 绑在那里（[绑核](#pinning)）。
- **保持 `overlap` 开启。** 关掉它就一次只运行一个时刻点，那是测试用的参照，不是为了速度。
- 测试之外**关掉 `checks`**。

## 声明最小延迟

在由事件驱动的模型部分，模型能告诉 FML 的最重要的事情，是一个事件最早多久之后能到达。一条延迟 2 ns 的链路如果声明为

```rust
#[fml::trigger(min_delay = link)]
pub out: fml::EventSource<Packet>,
```

就能让每个接收者领先它的发送者至多 2 ns 运行，FML 也就能并行运行它们。没有声明最小延迟时，一跳算作一个 delta 周期，接收者要等发送者的物理时间。一个合成基准里，跳用 1 ns 的各条 lane 在 8 个 worker 上的速度是 1 个 worker 的 2.8 倍；同样的 lane 用 delta 周期的跳时，1 个 worker 最快。

## 放置 {#placement}

**放置策略**选择布局：用几个 worker，模型在它们之间分得多细，以及事件驱动部分怎样运行。每隔一些时刻点，它看到测量的结果，可能为余下的运行改变布局。

**`Measured`** 是默认策略，它：

1. 先在每个 worker 上开始，因为最初的 job（比如加载输入）可能很重；
2. 在一个 worker 上测量每个时刻点的工作量；从每时刻点 20 µs 起，用尽量多的
   worker，但每个至少分到 5 µs（`parallel_work`）；
3. 对较轻的工作，按一个时刻点花费的墙钟时间，比较一个 worker 与全部 worker
   （每个一个组），如果较快的一方至少快 5%，就保留它；
4. 每时刻点耗时变为原来的两倍或一半时，以及每 65,536 个时刻点，重新测量和比较。

它的参数是公开字段：

```rust
use fml::runtime::Measured;
use std::sync::Arc;

let mut measured = Measured::default();
measured.parallel_work = std::time::Duration::from_micros(10);
let config = fml::SimConfig {
    placement: Arc::new(measured),
    ..fml::SimConfig::default()
};
```

`Measured` 会记住它做过的比较，所以每个仿真要给它单独一个（克隆出的副本会从头开始）。

**`Fixed`** 用上每个 worker，每个 worker 固定数量的组，从不改变：

```rust
use fml::runtime::Fixed;

let config = fml::SimConfig {
    workers: 8,
    placement: Arc::new(Fixed { groups_per_worker: 1 }),
    ..fml::SimConfig::default()
};
```

每个 worker 的组越少，核之间的交接越少；越多，负载越均衡。默认是 3 个；轻的模型往往更适合 1 个。

## 自己的策略

策略实现 `PlacementPolicy`：

```rust
use fml::runtime::{Decision, Layout, Measured, Measurement, PlacementPolicy};

/// 报告每次检查，然后照 `Measured` 的做法决定。
#[derive(Debug, Default)]
pub struct Logged(Measured);

impl PlacementPolicy for Logged {
    fn initial(&self, workers: usize) -> Layout {
        self.0.initial(workers)
    }

    fn first_check(&self) -> Option<u64> {
        self.0.first_check()
    }

    fn check(&self, measured: &Measurement<'_>) -> Decision {
        let decision = self.0.check(measured);
        eprintln!(
            "{} timepoints in {:?} on {} workers: {:?}",
            measured.timepoints, measured.elapsed, measured.layout.workers, decision.layout
        );
        decision
    }
}
```

- `initial` 给出加载时的布局；`first_check` 给出到第一次检查的时刻点数（`None`
  表示不检查）。
- `check` 拿到一个 `Measurement`：布局、自上次检查以来的时刻点数和墙钟时间，以及每个 worker 上的 job 估计花了多少时间。它返回一个 `Decision`：新布局或 `None`，以及到下一次检查的时刻点数，或者用 `None` 表示不再检查。
- `homes` 是可选的，它把组放到 worker 上；默认最大的组先放到负载最轻的 worker 上。

`Layout` 是 `{ workers, groups_per_worker, dynamic_groups_per_worker,
dynamic }`，`Layout::new(workers, groups)` 用这个 worker 数的默认值填好其余部分。

## 等待、窃取、绑核

这些也是策略，像放置策略一样在 `SimConfig` 里设置：

| 策略 | 内置 | 默认 |
|---|---|---|
| `wait`：空闲的 worker 做什么 | `Adaptive`（先自旋，再让出，再挂起）、`AlwaysSpin`、`AlwaysPark` | `Adaptive` |
| `steal`：空闲的 worker 从谁那里拿工作 | `DomainSteal`（共享缓存的 worker）、`FlatSteal`（任何 worker）、`NoSteal` | `DomainSteal` |
| `pin`：worker 在哪些核上运行 | `NoPin`、`CacheDomain` | `NoPin` |

```rust
use fml::runtime::{AlwaysPark, CacheDomain, NoSteal};

let config = fml::SimConfig {
    workers: 8,
    pin: Arc::new(CacheDomain),
    wait: Arc::new(AlwaysPark),
    steal: Arc::new(NoSteal),
    ..fml::SimConfig::default()
};
```

### 绑核 {#pinning}

`CacheDomain` 把 worker 放在离调用线程最近的物理核上（先是它所在的核，然后是它的缓存域、它的内存节点，最后是其余的），每个 worker 一个硬件线程。在有多个缓存域的机器上这很重要：GPGPU-Sim 模型用 8 个 worker 时，绑在一个缓存域上比由操作系统分散调度快 20–50%。机器的结构来自一个 `Topology`，除非 `SimConfig::topology`
给出了一个，否则从 Linux 的 sysfs 读取。

`AlwaysPark` 适合 worker 比空闲核多的情况；`AlwaysSpin` 适合专门跑仿真的机器。

每个策略都是一个公开的 trait（`WaitPolicy`、`StealPolicy`、`PinPolicy`），所以任何一个都可以像放置策略一样替换。
