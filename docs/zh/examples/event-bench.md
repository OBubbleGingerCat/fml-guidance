# 事件基准

一个合成模型，用来测量 FML 运行事件驱动工作的表现，这是 GPGPU-Sim 模型（只有时钟）从来用不到的。它有两种形态：给并行运行时施压的多条 lane，以及一个更接近真实模型的片上 mesh 网络。

## Lane

```text
Top (clocks)
└── lanes: [Lane; lane_count]
    ├── source: Source        every `every` clock edges: emit a token
    ├── stages: [Stage; stage_count]
    │     on a token from its own lane or the next one:
    │     state = mix(state, token, `work` rounds); pass its own lane's token on
    └── sink: Sink            total += token
```

lane *i* 的第 *k* 个 stage 接收自己 lane 和 lane *i* + 1 上第 *k* 个位置的 token，所以各条 lane 互相依赖。stage 之间的每一跳要么是一个 delta 周期，要么是声明的
1 ns 最小延迟，后者让工作可以跨时刻点提前运行。各条 lane 可以跑在相位错开的时钟上，使每个时刻点只有少数几条 lane 活跃；另有一个变体，每条 lane 末尾的几个 stage
也由时钟触发。

## Mesh

一个 `width` × `height` 的路由器 mesh。每个路由器的时钟注入数据包，其中一部分发往一个热点，使负载不均匀；数据包先走 X 再走 Y，每个输出端口有自己的队列，每周期发出一个，经过的链路是带物理延迟（默认 2 ns）的事件。有一个变体加了一个监视器，它在时钟上汇总每个路由器的计数器，一旦送达的数据包达到目标数量就停止仿真，这在事件驱动模型中检验了[停止仿真](../guide/running#stopping)。

## 受门控的单元

挂在受门控时钟上的单元（[时钟门控](../guide/time#clock-gates)）：每次运行时把状态混合一次，运行 `busy` 次之后关闭门控 1 到 `idle` 个沿，具体多少由状态决定。一个配置每次运行都写门控（运行一次，空闲一个沿）；另一个让单元忙 20 次，再空闲最多 80 个沿。程序输出运行次数、被门控的沿和校验和。

## 它说明了什么

每种配置都打印一个校验和，所有 worker 数和所有布局都必须得到同一个校验和。在 8 个
worker 上（每个仿真周期多少 µs，越低越好）：

| 配置 | 1 worker | 8 worker |
|---|---|---|
| mesh，8 × 8 | 27.5 | 8.2 |
| mesh，16 × 16，路由器工作量大 | 2,185 | 279 |
| mesh，32 × 32 | 1,284 | 178 |
| lane 工作量大，delta 跳 | 16,690 | 2,197 |
| lane 相位错开，1 ns 跳 | 135 | 45 |
| lane 相位错开，delta 跳 | 131 | 149 |

最后两行是同样的 lane、同样的工作量。用 1 ns 跳时，不同时刻的工作相互重叠，8 个
worker 的速度是 1 个的三倍；用 delta 跳时，每一跳都是一次核间交接，没有别的工作可以与之重叠，1 个 worker 最快。默认的放置策略测量属于哪种情况，并据此选择；最后一行的小幅损失，就是在一次四分之一秒的运行里这次测量的代价。
