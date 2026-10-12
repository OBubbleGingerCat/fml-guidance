# 事件流水线

最小的多模块模型，也就是[快速开始](../guide/getting-started)一步步搭起来的那个。

```text
Top                        a 10 ns clock
└── workers: [Worker; worker_count]
    ├── producer: Producer on every clock edge: value += step, send value
    └── sink: Sink         on every value received: total += value
```

它用大约 80 行代码展示了：

- 模块参数，以及一个大小由参数决定的子模块数组（`[Worker; fml::DynShape(worker_count)]`）；
- 嵌套的子模块，在各个模块的 `init` 里连接；
- 经中继穿过一层层级的时钟（`Clock` → `ClockRelay` →
  `ClockRelay`）；
- 连到中继上的事件源（`EventSource<u64>` →
  `EventRelay<u64>`）；
- 状态，以及最小的一对有用的 task：一个由时钟触发，发出事件；一个由事件触发。

## 展开之后

展开之后，中继都不见了：每个 producer 直接订阅顶层的时钟，sink *r* 订阅
producer *r* 的事件。`plan.to_program()` 会打印出结果。

## 运行

用默认参数（两个 worker，步长 1）时，时钟沿落在 0、10、…、100 ns，所以
`run_until(100 ns)` 之后每个 sink 的值都是 1 + 2 + … + 11 = 66。用一个参数文件把
worker 1 的步长设为 10，它的 sink 的值就是 660：

```toml
[top]
worker_count = 3

[[top.workers]]
__select_index__ = 1
[top.workers.producer]
step = 10
```

```text
workers[0].sink.total = 66
workers[1].sink.total = 660
workers[2].sink.total = 66
```

不论用几个 worker，得到的数都一样。
