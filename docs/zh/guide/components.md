# 组件与接口

## plain 类型 {#plain-types}

作为状态存放或作为事件载荷发出的一切，都是 **plain** 类型：大小固定，按字节复制，没有要 drop 的东西，没有指针。正因如此，FML 才能原地存放状态，把它复制进快照，在核之间传递而不必分配内存。

- 内置的：整数、浮点数、`bool`、`()`、`fml::Time`、
  `fml::ClockInfo`、`Option<T>`，以及由 plain 类型组成的数组和元组。
- 自己的：在字段都是 plain 类型的 struct 或 enum 上加
  `#[derive(fml::Plain)]`。

```rust
#[derive(Debug, Default, Clone, Copy, PartialEq, fml::Plain)]
pub enum Op {
    #[default]
    Idle,
    Read(u64),
    Write { addr: u64, data: [u8; 4] },
}
```

`Vec`、`String`、`Box` 和引用都不是 plain 类型；请用容器。参数不是状态，只需要 `fml::ParamValue`。

## 容器

容器存放有限个 plain 元素，容量在编译时固定（`Queue<T, 8>`），或者在模型加载时按实例确定（`Queue<T, fml::DynShape(depth)>`，大小由参数给出）：

| 容器 | 是什么 |
|---|---|
| `fml::Array<T, N>` | N 个元素，作为**一个**位置存放，总是整体访问 |
| `fml::ArrayVec<T, N>` | 有界向量：满了时 `push` 把值原样返回 |
| `fml::Queue<T, N>` | 环形 FIFO：`push`、`pop`、`front`、`iter`、… |
| `fml::Map<K, V, N>` | 线性查找的小 map |
| `fml::BitSet![N]` | 位集合，带常见的集合操作 |
| `fml::Store<S>` | 由 FML 管理的稀疏存储，例如 `fml::SparseMem<fml::CacheLine<64>>`，单元在写入时才分配 |

在 task 里，加载时确定容量的容器以它的 `Dyn` 形式出现（`fml::DynQueue<T>`），辅助函数接收的也是这种形式。

## 组件

**组件**是一个可复用的模块，别的模块通过**接口**使用它。FML 的标准组件是
`fml::Fifo<T>`，即两个模块之间的有界队列：生产者一侧是 `fml::FifoTx<T>`，消费者一侧是 `fml::FifoRx<T>`。

```rust
#[fml::module]
pub struct Producer {
    #[fml::trigger]
    pub clock: fml::ClockRelay,

    #[fml::interface]
    pub out: fml::FifoTx<u64>,

    next: u64,
    pub stalls: u64,
}

#[fml::module_impl]
impl Producer {
    #[fml::task(triggers = (clock,))]
    fn send(
        _ctx: &mut fml::TaskCtx,
        out: &'latest mut fml::FifoTx<u64>,
        next: &mut u64,
        stalls: &mut u64,
    ) -> Result<(), fml::SimError> {
        match out.push(*next) {
            Ok(()) => *next += 1,
            Err(_) => *stalls += 1,
        }
        Ok(())
    }
}

#[fml::module]
pub struct Consumer {
    #[fml::trigger]
    pub clock: fml::ClockRelay,

    #[fml::interface]
    pub inbox: fml::FifoRx<u64>,

    pub sum: u64,
}

#[fml::module_impl]
impl Consumer {
    #[fml::task(triggers = (clock,))]
    fn receive(
        _ctx: &mut fml::TaskCtx,
        inbox: &mut fml::FifoRx<u64>,
        sum: &mut u64,
    ) -> Result<(), fml::SimError> {
        if let Some(value) = inbox.pop() {
            *sum += value;
        }
        Ok(())
    }
}
```

拥有 `Fifo` 的模块把两侧都连到它上面：

```rust
#[fml::module]
pub struct Top {
    #[fml::trigger]
    clock: fml::Clock,

    #[fml::submodule]
    fifo: fml::Fifo<u64>,

    #[fml::submodule]
    producer: Producer,

    #[fml::submodule]
    consumer: Consumer,
}

#[fml::module_impl]
impl Top {
    #[fml::init]
    fn init(ctx: &mut fml::InitCtx) -> Result<(), fml::SimError> {
        let module = ctx.module();
        ctx.init_clock(module.clock, fml::Time::ns(1), fml::Time::ps(0))?;
        ctx.connect(module.clock, module.producer.clock)?;
        ctx.connect(module.clock, module.consumer.clock)?;
        ctx.connect_interface(&module.fifo, module.producer.out)?;
        ctx.connect_interface(&module.fifo, module.consumer.inbox)
    }
}
```

队列的深度是 `Fifo` 实例的一个参数：

```toml
[top.fifo]
depth = 2
```

`FifoTx` 有 `push`、`is_full`、`free`、`len`、`capacity`；`FifoRx` 有
`pop`、`front`、`get(i)`、`is_empty`、`len`、`capacity`。

## 谁先动作 {#who-acts-first}

FIFO 的两侧在同一个周期运行时，必须有一侧先动作，结果取决于是哪一侧：本周期
push 的值能不能在本周期 pop 出来？本周期腾出的槽能不能再用？接口参数的写法说明了每一侧的先后，而且**恰好有一侧必须是 `&'latest mut`**：

| 生产者 | 消费者 | 含义 |
|---|---|---|
| `&'latest mut FifoTx` | `&mut FifoRx` | 消费者先动作：第 *k* 周期 push 的值从 *k* + 1 起才能 pop；pop 腾出的槽可以在同一周期再填 |
| `&mut FifoTx` | `&'latest mut FifoRx` | 生产者先动作：push 的值可以在同一周期 pop；腾出的槽从下一周期起才能再用 |

两侧都是 `&mut`，或者都是 `&'latest mut`，就构成一个顺序环，在构建 plan 时报错，错误信息里给出两个 task 和这个 FIFO。顺序属于 task，不属于组件，而且只在两者都运行的时刻点才有意义（比如两个时钟相遇的地方）。

接口从来不是只读的：`&FifoTx` 无法编译。一个 task 不能同时持有同一个 FIFO 的两侧，两个 task 也不能持有同一侧。

## 数组与转发

接口可以是数组，逐个元素连接：

```rust
#[fml::interface]
pub outs: [fml::FifoTx<u64>; fml::DynShape(lanes)],
// 在拥有者的 init 里：
ctx.connect_interface(&module.fifos[lane], module.splitter.outs[lane])?;
```

如果一个模块不是组件的直接父模块，它声明同样的接口，再由它的父模块转发：
`ctx.share_interface(module.inbox, module.consumer.inbox)?`。

## 自己的接口

接口是一个由若干部分组成的 struct，每个部分都是组件的一个 `pub` 字段，标为自己拥有的（由持有者写），或者另一侧的（只读）：

```rust
#[fml::interface(component = Fifo<T>)]
pub struct FifoTx<T: fml::Plain + Default> {
    slots: fml::Own<fml::DynArray<T>>,
    tail: fml::Own<u64>,
    head: fml::Other<u64>,
}

impl<T: fml::Plain + Default> FifoTx<T> {
    pub fn push(&mut self, value: T) -> Result<(), T> {
        // ...
    }
}
```

每个部分的名字必须是组件里一个类型兼容的 `pub` 字段；这在编译时检查。在
`&mut I` 下，task 写自己拥有的部分，读到的其他部分是原来的值（`curr`）；在
`&'latest mut I` 下，它读的是另一侧动作之后的值（`latest`）。任何模块都可以是组件，包括自己也有 task 的模块：接口是给模块一个有类型、有顺序的端口的通用办法，很像 SystemVerilog 的 interface 和它的 modport。
