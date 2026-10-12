# 模块与参数

模块是标记了 `#[fml::module]` 的 Rust 结构体，并且有且只有一个
`#[fml::module_impl]` 块，放它的 `init` 和 task，即使这个块是空的：

```rust
#[fml::module]
pub struct Leaf {
    value: u64,
}

#[fml::module_impl]
impl Leaf {}
```

宏会把结构体的字段换成生成的类型，所以模块的值从来不用手工构造：
[展开](#elaboration)从参数建出每个实例。

## 字段

| 字段 | 是什么 |
|---|---|
| `#[fml::param("doc", default = expr)] name: T` | 一个参数，在仿真开始前就固定下来 |
| `#[fml::trigger] clock: fml::Clock` | 一个独立的时钟源，在 `init` 里配置 |
| `#[fml::trigger] clock: fml::ClockRelay` | 来自别处的时钟 |
| `#[fml::trigger] out: fml::EventSource<T>` | 载荷为 `T` 的事件源 |
| `#[fml::trigger] input: fml::EventRelay<T>` | 来自别处的事件 |
| `#[fml::submodule] child: Child` | 一个子实例 |
| `#[fml::interface] out: fml::FifoTx<T>` | 通往一个组件的接口（[组件](./components)） |
| `name: T`（不带属性） | 状态，`T` 是 [plain 类型](./components#plain-types)、容器、`Store` 或 `External` 端口 |
| `name: fml::StateRef<T>` | 对另一个模块拥有的状态的引用 |

不带 FML 属性的字段是状态；带其他任何属性都是错误。

**可见性。** 参数和子模块必须是私有的。父模块恰好能看到直接子模块里声明为 `pub`
的那些字段（状态、触发源、接口），更深的一层都看不到：要访问孙模块，子模块得通过自己的一个 `pub` 中继、引用或接口把它转发出来。

## 数组

子模块、触发源、状态、引用和接口都可以是数组：

```rust
#[fml::param("number of workers", default = 2)]
worker_count: usize,

#[fml::submodule]
workers: [Worker; fml::DynShape(worker_count)],
```

- `[X; 4]`：固定长度，一个非零的字面量；
- `[X; N]`：模块的一个 const 泛型参数；
- `[X; fml::DynShape(p)]`：同一个模块的参数 `p` 的值，每个实例各自取值。参数要直接写名字，不允许写表达式。值为零是错误。

状态数组的每个元素都是一个独立的位置，与其他元素分开定序。应当作为一个位置的值（总是整体取用的缓冲区）要改用 `fml::Array<T, N>`。

## 复位值

状态的初值是 `Default::default()`，或者 `#[fml::reset(..)]` 给出的值：

```rust
#[fml::param("credits at reset", default = 4u32)]
credits_init: u32,

#[fml::reset(credits_init)]     // 本模块的一个参数
pub credits: u32,

#[fml::reset(u64::MAX)]         // 一个常量，每个元素都用它
tags: [u64; fml::DynShape(depth)],
```

`#[fml::reset(with = f)]` 对默认值调用 `fn f(value: &mut T)`，
`#[fml::reset(with = f, args = [p, q])]` 还会把参数也传给它。复位值在模型展开时计算。

## 参数

参数有一个 `default`（必需），还可以有 `validate = f`，即一个函数
`fn(&T) -> Result<(), fml::ParamError>`：

```rust
fn positive(value: &u32) -> Result<(), fml::ParamError> {
    match *value {
        0 => Err(fml::ParamError::new("must be positive")),
        _ => Ok(()),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, fml::ParamValue)]
pub enum Policy {
    RoundRobin,
    Fixed { first: u8 },
}

#[fml::module]
pub struct Port {
    #[fml::param("credits at reset", default = 4u32, validate = positive)]
    credits_init: u32,

    #[fml::param("arbitration", default = Policy::RoundRobin)]
    policy: Policy,

    #[fml::param("link delay", default = fml::Time::ns(2))]
    link: fml::Time,

    #[fml::trigger(min_delay = link)]
    pub out: fml::EventSource<u64>,

    #[fml::reset(credits_init)]
    pub credits: u32,
}
```

参数的类型：整数、浮点数、`bool`、`char`、`String`、`fml::Time`（写作
`"10ns"`、`"250 ps"` 或 `"delta"`）、由这些类型组成的数组和元组，以及任何带
`#[derive(fml::ParamValue)]` 的结构体或枚举。值的转换是严格的：浮点参数在文件里写成整数是错误。

init 和 task 通过 `ctx.module()` 读取参数：`*ctx.module().credits_init`。参数永远不变。

## 参数文件

表按实例路径组织，从 `top` 开始：

```toml
[top]
ports = 3

[[top.port]]            # 子模块数组：用数组表
credits_init = 8        # 没有选择器：所有元素

[[top.port]]
__select_index__ = 2    # 只有元素 2（也可以是列表、"a..b"、"a..=b"）
policy = { Fixed = { first = 1 } }
link = "500ps"
```

- 单个子模块是一个表，`[top.child]`；数组的元素是数组表，`[[top.children]]`，可以带一个 `__select_index__`。数组表后面的表作用于它选中的那些元素。
- 有几条规则设置同一个参数时，更具体的那条优先，其次是后写的那条。
- `__include__ = "other.toml"` 加载一个文件，把它的 `[top]` 表放到写这一行的那个表的位置上。
- 表必须对应一个存在的实例，键必须是这个实例的一个参数；其他情况都是错误。没有设置的参数保持默认值。

派生类型写成 TOML 值：结构体写成内联表，枚举写成 `"Variant"` 或
`{ Variant = ... }`。

## `init`

模块可以有一个 `#[fml::init]`，每个实例运行一次，在子模块的 init 之前运行，负责把东西连起来。它不能读写状态的值，也不能发送事件。

```rust
#[fml::init]
fn init_top(ctx: &mut fml::InitCtx) -> Result<(), fml::SimError> {
    let module = ctx.module();
    ctx.init_clock(module.clock, fml::Time::ns(10), fml::Time::ps(0))?;
    for worker in module.workers.iter() {
        ctx.connect(module.clock, worker.clock)?;
    }
    Ok(())
}
```

| 方法 | 作用 |
|---|---|
| `ctx.module()` | 模块自己的视图：参数是值，其他都是句柄，子模块是它们的 `pub` 视图（数组是 `Vec`） |
| `ctx.path()` | 实例路径，比如 `top.workers[1]` |
| `ctx.init_clock(clock, period, phase)` | 配置一个独立的时钟，恰好一次 |
| `ctx.connect(source, target)` | 时钟 → 时钟中继，中继 → 中继，事件源 → 事件中继，中继 → 中继 |
| `ctx.share_state(state, reference)` | 让一个 `StateRef` 指向一个状态，或者指向另一个引用；store 和外部端口也用它 |
| `ctx.connect_interface(&child_component, interface)` | 把一个接口绑定到一个直接子组件上 |
| `ctx.share_interface(interface, child_interface)` | 把一个接口转发给子模块 |

连接在所有 `init` 都运行完之后才解析，所以连接的先后无关紧要。每个中继、引用和接口都必须恰好连接一次：没有连接、有两个驱动、连到一个源上，以及引用成环，都是错误。

## 展开 {#elaboration}

`fml::SimPlan::<Top>::new(params, snapshot)` 读取参数文件，建出每个实例，运行各个 `init`，解析连接，检查每个 task 的绑定，并分析模型。它的报错写的是实例路径，所以直接指向模型里出问题的地方。展开之后，实例树可以通过 `plan.top` 访问，所有字段都是公开的：参数是 `Param<T>`（`.get()`），状态和触发源是句柄。

泛型模块和在 Rust 里一样：`Fifo<T>` 和 `Cache<const WAYS: usize>` 的每种实例化都是不同的模块类型。
