# 逐周期复现 GPGPU-Sim

迄今最大的 FML 模型是对 GPGPU-Sim 的复现。GPGPU-Sim 是学术界标准的 GPU 仿真器，这里复现的是 Accel-Sim 用 SASS trace 驱动它的方式：SM7_QV100 配置，即一块 Volta
V100。目标不是一个“像” GPGPU-Sim 的模型，而是同一个仿真：每一项统计数据、逐周期日志里的每一个事件，都与参照完全相同。

## 建模范围

rodinia_2.0-ft 基准用到的一切：

- **80 个 SM**：取指和译码、四个调度器、记分板、操作数收集器，SP、DP、INT、SFU、分支、纹理和张量流水线，写回；
- **load/store 单元**：共享内存的 bank 冲突、全局访存合并成 32 字节的 sector、L1
  数据缓存及其 bank；
- **存储系统**：地址映射、带 MSHR 的 sector 缓存、连接 80 个 SM 和 64 个 L2 分片的
  iSLIP 交叉开关、32 个存储分区及其队列，以及带 FR-FCFS 调度和 bank 时序的 DRAM
  通道；
- **命令处理器**：kernel 启动、CTA 分派、每个 kernel 之前的拷贝，以及参照自带的死锁检测。

原子操作、本地内存和 fence 没有建模；用到它们的 trace 在加载时就被拒绝。

## 参照

trace 驱动模式下的 Accel-Sim v2.0.0，GPGPU-Sim 固定在一个提交上，并打了三个小补丁：

1. **精确的时钟域。** GPGPU-Sim 推进每个时钟域时，用 double 加上它的周期。舍入误差让本应重合的沿在几百个周期内就错开。补丁加了一个选项，让沿在精确的时间触发；参照就是带着这个选项运行的。在 11 个基准中的 10 个上，这没有改变任何东西；streamcluster 少跑 28 个周期（共 117 万个）。
2. **逐周期事件日志**，由 SM 和命令处理器写出；以及
3. 同一个日志里的**存储系统事件**（交叉开关、L2、DRAM）。

日志补丁不改变 GPGPU-Sim 自己的输出。

## 模型

```text
Gpu                       core clock (1132 MHz) and DRAM clock (850 MHz)
├── sms: [Sm; 80]         tasks: icnt (receive replies), cycle (the pipeline)
├── cp: Cp                kernel launch, CTA dispatch, statistics
├── xbar: Xbar            tasks: req, reply (one per subnetwork)
├── mems: [MemPartition; 32]
│   ├── l2s: [L2; 2]      L2 slices
│   └── dram: Dram        on the DRAM clock
└── Fifos between them    launch, requests and replies, to and from DRAM
```

两个时钟分别是 1132 和 850 MHz；它们的周期建模为 425 和 566 皮秒，这样两者的比值是精确的，两个时钟的沿正好在参照的精确时钟重合的地方重合。

**一个周期之内的顺序只来自 FIFO。** 在 GPGPU-Sim 里，一个函数按固定的顺序调用一个周期的各个部分：先 DRAM，再 L2，再交叉开关，最后 SM。在模型里，每个 FIFO
的两端说明谁先动（[组件](../guide/components#who-acts-first)），FML 由此推出同样的顺序：

```text
[Dram] → L2 ‖ Sm.icnt → Xbar.req ‖ Xbar.reply → Sm.cycle → Cp
```

模型和 FML 里都没有任何地方提到这些名字：改一个访问模式，顺序就随之改变。命令处理器读的是每个 SM 在周期结束时的状态（`&'latest`），所以它在 SM 之后运行。

同一套 SM、存储和命令处理器代码也在 FML 之外的普通循环（plain loop）里运行，按参照的调用顺序。它也是对模型本身的第二重检查。

## 如何检查完全一致

- **86 个小用例**：30 个手写，每个针对一种机制（bank 冲突、屏障、调度的边角情况……），56 个随机生成；每个都以参照完整的逐周期日志和统计数据作为 golden。
- **11 个 rodinia_2.0-ft 基准**：从 8,389 个周期（heartwall）到 1,172,557 个（streamcluster），共 240 万个周期、1650 万行日志；比较统计数据，以及每 10,000
  个周期一个窗口的日志哈希。

每个用例都必须完全一致：在普通循环里；在 FML 上用 1 个和 4 个 worker 一次跑一个时刻点；以及用 1、2、3、8 个 worker 让时刻点重叠。每个基准也都必须完全一致：在普通循环里；在 FML 上用 1 个 worker 一次跑一个时刻点；以及用 1、2、8 个 worker。全部都一致。

## 速度

**忙碌的 GPU：快 45 倍。** 在一个让 80 个 SM 全部忙碌的 kernel 上（1280 个 CTA，每个 8 个 warp，16,399 个周期），AMD EPYC 9654：

| | Accel-Sim | FML，1 worker | FML，8 worker |
|---|---|---|---|
| 模拟 | 26.0 s | 3.2 s（8.1×） | **0.57 s（45×）** |
| 读入 107 MB 的 trace | （边模拟边读） | 1.1 s | 1.1 s |
| 整次运行 | 26.0 s | 4.3 s（6.0×） | 1.66 s（15.7×） |

Accel-Sim 边模拟边读 trace，所以它的 26.0 s 已经包含了读 trace；FML 先用一个线程把 trace 读完，所以整次运行要在模拟之外再加 1.1 s。

**rodinia 基准**，整次运行，包括读 trace，FML 的 worker 绑核到同一个缓存域：

| 基准 | 周期数 | Accel-Sim | FML，1 worker | FML，8 worker | 8 worker 快几倍 |
|---|---|---|---|---|---|
| heartwall | 8,389 | 4.00 s | 1.24 s | 0.37 s | 10.8× |
| backprop | 14,731 | 7.66 s | 1.51 s | 0.51 s | 15.0× |
| nn | 29,962 | 16.0 s | 3.61 s | 0.89 s | 18.0× |
| lud | 127,309 | 8.35 s | 1.15 s | 0.72 s | 11.6× |

全部 11 个基准在 Accel-Sim 里共需 218 s，FML 用 8 个 worker 需 22.4 s，快约 9.7 倍；按单个基准算，从 8.2×（streamcluster）到 18×（nn）。

各个基准的并行度不同。重的基准（每个周期都有许多 SM 在忙）用满 8 个 worker。轻的基准大多数周期没什么事可做，在核之间交接工作反而浪费时间；FML 的放置策略在运行中测量这一点，为每个阶段挑选更快的布局（[性能](../guide/performance#placement)）。
