# 外部端口

外部端口把模型连到宿主程序的一个对象上：trace 读取器、功能模型、RTL 仿真、输出日志。task 像访问状态一样调用它，FML 也像排定状态访问那样排定这些调用的顺序。

## 端口

端口是一个类型为 `fml::External<S>` 的状态字段，其中 `S` 实现了
`fml::ExternalSource`：

```rust
#[derive(Default, Debug)]
pub struct Log {
    pub lines: Vec<String>,
}

impl fml::ExternalSource for Log {}

#[fml::module]
pub struct Monitor {
    #[fml::trigger]
    clock: fml::Clock,

    pub log: fml::External<Log>,
    cycle: u64,
}

#[fml::module_impl]
impl Monitor {
    #[fml::init]
    fn init(ctx: &mut fml::InitCtx) -> Result<(), fml::SimError> {
        let module = ctx.module();
        ctx.init_clock(module.clock, fml::Time::ns(1), fml::Time::ps(0))
    }

    #[fml::task(triggers = (clock,))]
    fn record(
        ctx: &mut fml::TaskCtx,
        log: &mut fml::External<Log>,
        cycle: &mut u64,
    ) -> Result<(), fml::SimError> {
        log.lines.push(format!("cycle {cycle} at {}", ctx.now()));
        *cycle += 1;
        Ok(())
    }
}
```

`External<S>` 解引用为 `S`。与状态不同，源对象里可以放任何东西：`Vec`、文件、另一个仿真器的句柄。

## 绑定源对象

宿主为每个端口创建一个源对象，在构建仿真时用 `into_sim_with` 绑定它：

```rust
let plan = fml::SimPlan::<Monitor>::new(None, None)?;
let mut sim = plan.into_sim_with(fml::SimConfig::default(), |top, ports| {
    ports.bind(top.log, Log::default())
})?;
sim.run_until(fml::Time::ns(2))?;
let log = sim.top().log;
for line in &sim.state_mut(log)?.lines {
    println!("{line}");
}
```

```text
cycle 0 at 0ps
cycle 1 at 1ns
cycle 2 at 2ns
```

绑定按端口，而不是按类型：同一类型的两个端口得到两个源对象。没有绑定的端口，或者绑定了两次的端口，都是错误。两次运行之间，`sim.state_mut(handle)` 把源对象交还给宿主。

端口可以像状态一样与其他模块共享，办法是用 `ctx.share_state` 连接一个
`fml::StateRef<fml::External<S>>`。端口不能是数组；请用子模块数组，每个子模块一个端口。

## 访问模式

| 参数 | 得到 | 顺序 |
|---|---|---|
| `p: &fml::External<S>` | `&S` | 共享，在本时刻点的独占使用者之前 |
| `p: &'latest fml::External<S>` | `&S` | 共享，在它之后 |
| `p: &mut fml::External<S>` | `&mut S` | 独占：每个端口每个时刻点至多一个 task |

## 约定

只有当源对象表现得像状态时，FML 才能保持仿真的确定性。对每个端口：

- 同样的调用序列必须得到同样的结果，不论由哪个线程发起、在什么时间发起，也不论其他端口上发生了什么；
- 共享（`&`）调用不能改变任何可观察的东西（缓存是可以的）；
- 端口之间共享的数据必须是只读的，或者不影响结果。

**耦合在一起的东西必须是一个端口。** 例如，一个 RTL 实例的输入和输出属于同一个源对象：如果拆到两个端口上，FML 可能以任意顺序调用它们，也可能并行调用，而且不会有任何报告。

游标（比如在 trace 中的位置）放在哪里，是一个选择：

- **放在状态里**，配一个只读端口：task 在自己模块保存的游标处读 trace；许多读者并行运行，快照把游标和其余状态一起保存；
- **放在源对象里**，配一个独占端口：更简单，但每个使用者都需要自己的端口，而且源对象必须自己实现快照。

## 快照 {#snapshots}

`ExternalSource` 有两个方法，默认都报告这个源对象不能保存：

```rust
impl fml::ExternalSource for Trace {
    fn save(&self, out: &mut Vec<u8>) -> Result<(), fml::plain::Error> {
        out.extend_from_slice(&self.position.to_le_bytes());
        Ok(())
    }

    fn restore(&mut self, saved: &[u8]) -> Result<(), fml::plain::Error> {
        // 从 `saved` 读回位置
        Ok(())
    }
}
```

开启快照时，如果一个独占端口的源对象不能保存，仿真就构建失败，错误信息给出这个端口。只读端口不保存。恢复时，宿主照常绑定新的源对象，FML 再对它们调用
`restore`，传入 `save` 写下的内容。
