# 状态与 task

task 是模块的 `#[fml::module_impl]` 块里的一个函数，由模块的触发源运行。它读写模块的状态；它怎样声明每一份状态，就说明了在同一个时刻点里，它与碰这份状态的其他 task 谁先谁后。

## 一个 task

```rust
#[fml::task(triggers = (clock,), emits = (done,))]
fn produce(ctx: &mut fml::TaskCtx, value: &mut u64) -> Result<(), fml::SimError> {
    *value += *ctx.module().step;
    ctx.emit_triggers().0.emit(*value, fml::Time::DELTA)?;
    Ok(())
}
```

- `triggers = (..)` 列出运行它的触发源（其中任何一个触发都会运行它，每个时刻点、每个实例最多一次）；`emits = (..)` 列出它可能发往的事件源。每一项可以是一个字段、表示单个元素的 `field[i]`，或者一整个数组。
- 第一个参数是 `ctx: &mut fml::TaskCtx`；后面是状态参数，顺序随意。
- 它返回 `Result<(), fml::SimError>`；如果它可能结束仿真，则返回
  `Result<(), fml::Stop>`（[运行仿真](./running#stopping)）。

## 访问模式 {#access-modes}

状态参数绑定同名的状态字段，它的引用类型就是它的**访问模式**：

| 参数 | 模式 | 看到的值 |
|---|---|---|
| `x: &T` | `curr` | 本时刻点的写者写之前的值 |
| `x: &'latest T` | `latest` | 本时刻点的写者写之后的值 |
| `x: &mut T` | `write` | 它就是写者：读写这个值 |

每个位置在每个时刻点最多有一个写者。在一个时刻点之内，每个 `curr` 读者都在写者之前运行，每个 `latest` 读者都在写者之后运行，与 task 声明的先后无关。如果一个时刻点里没有谁写它，两种读者看到的值相同。

```rust
#[fml::module]
pub struct Stage {
    #[fml::trigger]
    clock: fml::Clock,

    reg: u64,
    pub seen_before: u64,
    pub seen_after: u64,
}

#[fml::module_impl]
impl Stage {
    #[fml::init]
    fn init(ctx: &mut fml::InitCtx) -> Result<(), fml::SimError> {
        let module = ctx.module();
        ctx.init_clock(module.clock, fml::Time::ns(1), fml::Time::ps(0))
    }

    #[fml::task(triggers = (clock,))]
    fn advance(_ctx: &mut fml::TaskCtx, reg: &mut u64) -> Result<(), fml::SimError> {
        *reg += 1;
        Ok(())
    }

    #[fml::task(triggers = (clock,))]
    fn before(_ctx: &mut fml::TaskCtx, reg: &u64, seen_before: &mut u64) -> Result<(), fml::SimError> {
        *seen_before = *reg;
        Ok(())
    }

    #[fml::task(triggers = (clock,))]
    fn after(_ctx: &mut fml::TaskCtx, reg: &'latest u64, seen_after: &mut u64) -> Result<(), fml::SimError> {
        *seen_after = *reg;
        Ok(())
    }
}
```

经过五个时钟沿（0 到 4 ns）之后，`reg` 是 5，`seen_before` 是 4，`seen_after`
是 5，不论用几个 worker。

寄存器和连线就是这样建模的：用 `&` 读流水线寄存器，得到上一个周期的值；用
`&'latest` 读组合信号，得到这个周期的值。

## 绑定其他字段

`#[fml::bind(field)]` 把参数绑定到另一个名字的字段上，`#[fml::bind(field[3])]`
则绑定到数组的一个元素上：

```rust
fn tick(_ctx: &mut fml::TaskCtx,
        #[fml::bind(values[1])] second: &mut u64) -> Result<(), fml::SimError>
```

整个数组是 `&[T]`、`&'latest [T]` 或 `&mut [T]`。数组的一部分用
`fml::PartialAccess`，下标或范围写成字面量：

```rust
#[fml::bind(values)] first_two: &mut [u64; fml::PartialAccess(0, 2)],
```

容器字段用它自己的类型，或者它加载时的形式：
`&mut fml::Queue<Req, fml::DynShape(depth)>` 在 task 里是
`&mut fml::DynQueue<Req>`。

参数写的类型必须就是字段的类型；不匹配会在构建 plan 时报出，并指明 task 和字段。

## 同一个 task 之内

一个 task 的两个参数可以指向同一个位置（比如经由引用或接口），但只有两者都是
`&`，或者都是 `&'latest` 时才行。其他情况在构建 plan 时报错，因为一个 task
不能既在写者之前、又在写者之后运行。

## task 上下文

| 方法 | 给出 |
|---|---|
| `ctx.module()` | 模块的视图：参数是值（`*ctx.module().step`） |
| `ctx.now()` | 当前的 `fml::Timepoint`（`.ps()`、`.delta()`，显示为 `10ns` 或 `10ns+1`） |
| `ctx.triggered_triggers()` | 一个元组，每个 `triggers` 项一个槽位：字段是 `Option<&P>`，数组是 `&[Option<&P>]`；时钟的载荷是它的 `ClockInfo` |
| `ctx.emit_triggers()` | 一个元组，每个 `emits` 项一个发送器：一个 `EventEmitter`，数组则是由它们组成的 `Vec` |

```rust
let (clock, inputs) = ctx.triggered_triggers();
for packet in inputs.iter().flatten() {
    // 这个时刻点在任一输入上到达的每个包
}
let outputs = &mut ctx.emit_triggers().0;
outputs[port].emit(packet, link_delay)?;
```

发送器和载荷只在这次调用期间借用。发送事件见[时间](./time#events)。

## 错误

返回 `Err(fml::SimError)`（或者 panic）的 task 会以一个错误结束这次运行，错误里写明 task、实例和时刻点：`run_until` 返回 `Err(...)`。用
`fml::SimError::new("message")` 构造，或者对任何返回它的调用用 `?`。此时其他
task 把状态推进到了哪一步，没有规定。见[报错与调试](./errors)。
