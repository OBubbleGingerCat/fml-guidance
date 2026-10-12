# 运行仿真

## 从 plan 到仿真

```rust
let plan = fml::SimPlan::<Top>::new(Some("params.toml".into()), None)?;
print!("{}", plan.to_program()?);       // 模型变成的程序，文本形式
let mut sim = plan.into_sim(fml::SimConfig::default())?;
```

- `SimPlan::new(params, snapshot)` 展开并检查模型。两个参数都是可选的路径：没有参数文件时，每个参数保持默认值；给了快照时，仿真从快照开始（[快照](./snapshots)）。
- `plan.to_program()` 给出模型变成的程序，可以用来查看各个 `init` 连了什么。
- `into_sim(config)` 构建仿真。带[外部端口](./external-ports)的模型用
  `into_sim_with(config, |top, ports| ..)` 绑定端口。

## 配置

`fml::SimConfig`：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `workers` | 全部硬件线程，最多 64 个 | worker 线程数的上限；放置策略可能用得更少。要用 64 个以上就显式设置 |
| `overlap` | `true` | 在模型允许的地方，让较晚的时刻点在较早的时刻点结束之前就开始；`false` 一次只运行一个时刻点 |
| `checks` | `false` | 构建并行程序时检查它，并记录执行顺序供 `sim.check_trace()` 使用；慢，用于测试 |
| `delta_limit` | 1000 | 同一个物理时间上 delta 周期数的上限 |
| `stop_delay` | `None` | stop 之后仿真还运行多久；`None` 表示模型的免费延迟（[停止](#stopping)） |
| `event_capacity` | 2²⁰ | 来自同一个源位置的在途事件数的上限 |
| `snapshots` | `None` | 何时、在哪里拍快照 |
| `placement`、`wait`、`steal`、`pin`、`topology` | 内置 | 运行时策略（[性能](./performance)） |

这些字段都不改变结果，只有 `stop_delay`、`delta_limit` 和 `event_capacity` 例外，它们以确定的方式改变结果：给定的值在任何机器、任何 worker 数下都得到同样的结果。

```rust
let config = fml::SimConfig {
    workers: 8,
    checks: true,
    ..fml::SimConfig::default()
};
```

## 运行

`sim.run_until(time)` 运行到 `time` 为止（含 `time`）的每个时刻点，包括它们的全部 delta 周期，并返回运行是怎样结束的：

```rust
match sim.run_until(fml::Time::us(10))? {
    fml::RunEnd::Reached(time) => println!("reached {time}"),
    fml::RunEnd::Finished(finished) => println!("stopped at {}", finished.at),
}
```

运行可以分多次：先 `run_until(1 µs)`，再 `run_until(2 µs)`，第二次从第一次停下的地方继续，结果与一次跑到 2 µs 相同。

`sim.step()` 恰好运行下一个时刻点，返回 `StepEnd::Executed(timepoint)`、
`StepEnd::Finished(..)`，或者在没有东西可运行时返回 `StepEnd::Idle`。
`sim.next_timepoint()` 给出下一个会是哪个时刻点，`sim.now()` 给出最后运行的是哪个。

## 读写状态

两次运行之间，宿主通过 `sim.top()`（即实例树）里的句柄读取状态：

```rust
let total = sim.top().workers[0].sink.total;
println!("{}", sim.state(total)?);
*sim.state_mut(total)? = 0;
```

`state` 读一个值；`state_mut` 写一个值，宿主也用它访问 store 和外部端口的源对象。

## 停止 {#stopping}

可能结束仿真的 task 返回 `Result<(), fml::Stop>`：

```rust
#[fml::module]
pub struct Countdown {
    #[fml::param("ticks before stopping", default = 5u64)]
    limit: u64,

    #[fml::trigger]
    clock: fml::Clock,

    ticks: u64,
}

#[fml::module_impl]
impl Countdown {
    #[fml::init]
    fn init(ctx: &mut fml::InitCtx) -> Result<(), fml::SimError> {
        let module = ctx.module();
        ctx.init_clock(module.clock, fml::Time::ns(1), fml::Time::ps(0))
    }

    #[fml::task(triggers = (clock,))]
    fn count(ctx: &mut fml::TaskCtx, ticks: &mut u64) -> Result<(), fml::Stop> {
        *ticks += 1;
        if *ticks == *ctx.module().limit {
            return Err(fml::Stop::finish(format!("counted to {ticks}")));
        }
        Ok(())
    }
}
```

```rust
match sim.run_until(fml::Time::ns(100))? {
    fml::RunEnd::Finished(finished) => {
        for finish in &finished.by {
            println!("{} at {}: {}", finish.path, finished.at, finish.message);
        }
        println!("ended at {}", finished.end);
    }
    fml::RunEnd::Reached(time) => println!("reached {time}"),
}
```

```text
top at 4ns: counted to 5
ended at 4ns
```

在 *T* 返回的 stop 让仿真在 *T* + *L* 结束，*L* 是 stop 延迟：到这个时间为止的一切都会运行，之后的都不运行。`finished` 记录 stop 从哪里来（`at`、`by`）、仿真在哪里结束（`end`），以及其间返回的其他 stop（`later`）。默认的 *L* 是模型的
**免费延迟**，即任何工作不必等待发出 stop 的 task 就能领先它运行的最长时间，这样停止不需要任何代价；它取决于模型，从不取决于配置，`sim.stop_delay()` 会报告它。这里没有任何东西依赖计数器，所以它是 0。比免费延迟更短的值，例如 `Some(fml::Time::ps(0))`，结果仍然精确，但会让其他工作等待可能结束仿真的 task，代价是速度。

`Stop::Error(e)` 和来自 `SimError` 的 `Err(e)` 则让这次运行以错误结束；`?` 会做转换。

## 运行之后

- 一旦有 task 停止，`sim.finished()` 就返回这个 stop。
- 开启 `checks` 时，`sim.check_trace()` 验证每一对冲突访问都按串行顺序运行，否则返回违反之处。
- `sim.program()` 是仿真运行的程序。
