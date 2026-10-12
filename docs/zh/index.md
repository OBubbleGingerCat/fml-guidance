---
layout: home

hero:
  name: FML
  text: 全系统建模语言
  tagline: 在一个 Rust 模型里结合时钟驱动的时序与离散事件，并行仿真，结果与怎么运行无关。
  image:
    light: /logo.svg
    dark: /logo-dark.svg
    alt: FML
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/guide/getting-started
    - theme: alt
      text: 周期精确的 GPGPU-Sim
      link: /zh/examples/gpgpu-sim

features:
  - title: 并行而确定
    icon:
      light: /icons/deterministic.svg
      dark: /icons/deterministic-dark.svg
      width: 44
      height: 44
    details: 不论用几个 worker、时刻点是否重叠，状态、事件和结束方式都完全相同。FML 在加载时推出模型的顺序，拒绝有歧义的写法，运行之后还可以对照检查。
  - title: 用普通的 Rust 写模型
    icon:
      light: /icons/rust.svg
      dark: /icons/rust-dark.svg
      width: 44
      height: 44
    details: 模块是 Rust 结构体，状态是 Rust 值，行为是 Rust 函数。其余的交给宏，参数来自 TOML 文件。
  - title: 时钟与事件同在
    icon:
      light: /icons/clocks.svg
      dark: /icons/clocks-dark.svg
      width: 44
      height: 44
    details: 任意多个以整数皮秒计的时钟域，加上带物理延迟或 delta 周期的事件，放在同一个模型里，从流水线的一级到 GPU 之间的网络。
  - title: 为速度而设计
    icon:
      light: /icons/speed.svg
      dark: /icons/speed-dark.svg
      width: 44
      height: 44
    details: 模型在多个核上运行，互不依赖的工作跑在前面，FML 边运行边测量，一个模型值得用几个核就用几个。
  - title: 快照不停机
    icon:
      light: /icons/snapshots.svg
      dark: /icons/snapshots-dark.svg
      width: 44
      height: 44
    details: 快照在仿真运行的同时增量地拍下，可以从快照恢复，不必从头再跑就能复现问题。
  - title: 边界开放
    icon:
      light: /icons/open.svg
      dark: /icons/open-dark.svg
      width: 44
      height: 44
    details: 外部端口接入 trace、功能模型或 RTL 联合仿真；组件、接口和运行时策略都可以由用户自己定义。
---

<div class="fml-results">

## 比 Accel-Sim 快 45 倍

<div class="fml-stats">
  <div class="fml-stat"><div class="value">45×</div><div class="label">忙碌的 GPU（80 个 SM 全部在忙）上，8 个 worker 的模拟比 Accel-Sim 快的倍数</div></div>
  <div class="fml-stat"><div class="value">16×</div><div class="label">整次运行快的倍数，包括读入 107 MB 的 trace</div></div>
  <div class="fml-stat"><div class="value">11 / 11</div><div class="label">rodinia_2.0-ft 基准与 GPGPU-Sim 逐周期完全一致</div></div>
</div>

GPGPU-Sim 示例用 FML 建模一块 Volta GPU（Accel-Sim trace 驱动模式的 QV100 配置），并且逐周期复现：在 rodinia_2.0-ft 的全部 11 个基准上，它与参照的统计数据和逐周期事件日志完全一致。

在一个让 80 个 SM 全部忙碌的 kernel 上，**Accel-Sim 用 26.0 s；FML 用 8 个 worker 0.57 s 就模拟完，快 45 倍。** FML 还要先花 1.1 s 读入 107 MB 的 trace（Accel-Sim 是边模拟边读），所以整次运行快 16 倍。

rodinia 基准的整次运行时间，包括读 trace：

| 基准 | Accel-Sim | FML，1 worker | FML，8 worker | 8 worker 快几倍 |
|---|---|---|---|---|
| heartwall | 4.00 s | 1.24 s | 0.37 s | 10.8× |
| backprop | 7.66 s | 1.51 s | 0.51 s | 15.0× |
| nn | 16.0 s | 3.61 s | 0.89 s | 18.0× |
| lud | 8.35 s | 1.15 s | 0.72 s | 11.6× |

都在同一台 AMD EPYC 9654 上，FML 的 8 个 worker 放在同一个缓存域里。[示例详情](/zh/examples/gpgpu-sim)。

</div>
