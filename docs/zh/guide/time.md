# 时间：时钟与事件

## 时间与时刻点

`fml::Time` 是以整数皮秒计的物理时间，或者是 `Time::DELTA`，即一个 delta 周期：

```rust
fml::Time::ns(10)        // 也有 ps、us、ms、s
fml::Time::from_ps(425)
fml::Time::DELTA
```

它本身没有算术运算，也不能比较大小；比较和相加要通过 `as_ps()`，对 `DELTA`
它返回 `None`。在参数文件里，时间写成字符串：`"10ns"`、`"250 ps"`、`"delta"`。

**时刻点**是一个物理时间加上一个 delta 周期，先按时间、再按 delta 排序，显示为
`10ns` 或 `10ns+1`。时钟在 delta 0 触发；用 `DELTA` 发出的事件在同一时间的下一个
delta 到达；用物理延迟发出的事件在之后那个时间的 delta 0 到达。时刻点严格按顺序运行：先是 `10ns` 的全部，然后是 `10ns+1` 的全部，依此类推。

## 时钟

独立的时钟是一个 `fml::Clock` 字段，在 `init` 里配置一次，给出周期和相位（第一个时钟沿的时间，小于周期）：

```rust
ctx.init_clock(module.clock, fml::Time::ns(10), fml::Time::ps(0))?;
```

接收时钟的模块声明一个 `fml::ClockRelay`，并被连到时钟上：
`ctx.connect(module.clock, module.child.clock)?`。由时钟触发的 task 以时钟的
`ClockInfo`（周期和相位）作为触发载荷。

**多个时钟域**就是多个时钟。它们的周期和相位都是精确的整数，所以应该重合的时钟沿永远重合。GPGPU-Sim 模型的核心跑在 1132 MHz，DRAM 跑在 850 MHz，分别表示为
425 和 566 皮秒的周期，两者之间的比例因此保持精确。

FML 最多支持 64 种不同的时钟配置，一个超周期（各周期的最小公倍数，从最大的相位之后算起）里最多 65,536 个时刻点；超出的模型在加载时被拒绝。

## 事件 {#events}

事件源有一个载荷类型，必须是 plain 类型：

```rust
#[fml::trigger]
pub done: fml::EventSource<u64>,
```

可能往它上面发送的 task 在 `emits` 里列出它，并带一个延迟发送：

```rust
ctx.emit_triggers().0.emit(*value, fml::Time::DELTA)?;   // 下一个 delta 周期
ctx.emit_triggers().0.emit(*value, fml::Time::ns(2))?;   // 2 ns 之后
```

延迟是 `DELTA` 或一个正的物理时间；物理延迟为零是错误。接收方声明一个
`fml::EventRelay<T>`，连到源上，或者连到另一个中继上；中继链不增加延迟，一个中继恰好有一个源。由中继触发的 task 在自己的触发槽位里拿到载荷。

一个源在每个时刻点最多接收一个事件：同一位置、同一时刻点的两个事件，不论来自两个 task 还是一个，都是**多驱动**错误。要同时发送几个值，就把它们放进一个载荷，或者用一个源数组。

## 声明的延迟

事件源可以声明它的事件可能用的延迟：

```rust
#[fml::param("link delay", default = fml::Time::ns(2))]
link: fml::Time,

#[fml::trigger(min_delay = link)]
pub out: [fml::EventSource<Packet>; 4],

#[fml::trigger(max_delay = fml::Time::DELTA)]
pub hint: fml::EventSource<()>,
```

界限是一个常量 `fml::Time`，或者本模块一个 `Time` 参数的名字。每次发出都会对照它检查。

**`min_delay` 是事件驱动部分能并行运行的关键。** 当 FML 知道一个源发出的任何东西都不会早于 2 ns 之后到达，它下游的一切就可以比发送者最多提前 2 ns 运行。没有声明最小值时，一跳只算一个
delta 周期，接收者不能跑到发送者的物理时间前面。请为每条链路和每个端口声明真实的最小延迟。

`max_delay = Time::DELTA` 表示这个事件总是只晚一个 delta 周期到达，所以永远不会碰上时钟沿；分析由此知道它触发的 task 永远不会和时钟触发的 task 在同一个时刻点运行，从而免去了本来要在运行时检查的冲突。

如果一个可能结束仿真的 task 用到的源声明了最小延迟，这个延迟也决定了 Stop 之后仿真还要继续运行多久（[停止](./running#stopping)）。

## delta 周期 {#delta-cycles}

delta 周期给同一个物理时间之内的事情定序：一串事件，每个都用 `DELTA` 发出，就作为同一时间的一系列时刻点运行。同一时间超过 `delta_limit` 个 delta 周期（默认 30）是错误，这能抓住永远稳定不下来的模型。需要更长链条的模型，可以设置 `SimConfig::delta_limit`，最大 65,534。

这个上限也决定一次运行在仿真时间上能走多远：默认值下约 160 小时，1000 时约 5 小时，65,534 时约 281 秒。超出这个范围的运行会报错，错误信息里写明上限。
