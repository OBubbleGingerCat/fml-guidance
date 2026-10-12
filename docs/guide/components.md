# Components and interfaces

## Plain types

Everything stored as state or sent as an event payload is a **plain**
type: a fixed size, copied by bytes, nothing to drop, no pointers. That is
what lets FML store state in place, copy it into snapshots and hand it
between cores without allocating.

- Built in: integers, floats, `bool`, `()`, `fml::Time`,
  `fml::ClockInfo`, `Option<T>`, arrays and tuples of plain types.
- Your own: `#[derive(fml::Plain)]` on a struct or enum whose fields are
  plain.

```rust
#[derive(Debug, Default, Clone, Copy, PartialEq, fml::Plain)]
pub enum Op {
    #[default]
    Idle,
    Read(u64),
    Write { addr: u64, data: [u8; 4] },
}
```

`Vec`, `String`, `Box` and references are not plain; use a container.
Parameters are not state and need only `fml::ParamValue`.

## Containers

Containers hold a bounded number of plain elements, with the capacity
fixed at compile time (`Queue<T, 8>`) or per instance when the model loads
(`Queue<T, fml::DynShape(depth)>`, sized by a parameter):

| Container | What it is |
|---|---|
| `fml::Array<T, N>` | N elements stored as **one** location, always taken whole |
| `fml::ArrayVec<T, N>` | a bounded vector: `push` returns the value back when full |
| `fml::Queue<T, N>` | a ring FIFO: `push`, `pop`, `front`, `iter`, … |
| `fml::Map<K, V, N>` | a small map with linear lookup |
| `fml::BitSet![N]` | a bit set with the usual set operations |
| `fml::Store<S>` | a sparse memory FML manages, such as `fml::SparseMem<fml::CacheLine<64>>`, cells allocated as they are written |

Inside a task, a load-time container appears in its `Dyn` form
(`fml::DynQueue<T>`), which is also what helper functions take.

## Components

A **component** is a reusable module that others use through an
**interface**. FML's standard component is `fml::Fifo<T>`, a bounded
queue between two modules: a producer side, `fml::FifoTx<T>`, and a
consumer side, `fml::FifoRx<T>`.

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

The module that owns the `Fifo` connects both sides to it:

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

The queue's depth is a parameter of the `Fifo` instance:

```toml
[top.fifo]
depth = 2
```

`FifoTx` has `push`, `is_full`, `free`, `len`, `capacity`; `FifoRx` has
`pop`, `front`, `get(i)`, `is_empty`, `len`, `capacity`.

## Who acts first

When both sides of a FIFO run in the same cycle, one of them must act
first, and the result depends on which: can a value pushed this cycle be
popped this cycle, and can a slot freed this cycle be reused? The
interface parameter's form says which, on each side, and **exactly one
side must be `&'latest mut`**:

| Producer | Consumer | Meaning |
|---|---|---|
| `&'latest mut FifoTx` | `&mut FifoRx` | the consumer acts first: a value pushed in cycle *k* can be popped from *k* + 1; a slot freed by a pop can be refilled in the same cycle |
| `&mut FifoTx` | `&'latest mut FifoRx` | the producer acts first: a value pushed can be popped in the same cycle; a freed slot is reusable from the next cycle |

Both `&mut`, or both `&'latest mut`, is an ordering cycle and an error when
the plan is built, naming both tasks and the FIFO. The order belongs to
the tasks, not to the component, and only matters in timepoints where
both run (where two clocks meet, say).

Interfaces are never read-only: `&FifoTx` does not compile. One task may
not hold both sides of one FIFO, and two tasks may not hold the same side.

## Arrays and forwarding

Interfaces can be arrays, connected element by element:

```rust
#[fml::interface]
pub outs: [fml::FifoTx<u64>; fml::DynShape(lanes)],
// in the owner's init:
ctx.connect_interface(&module.fifos[lane], module.splitter.outs[lane])?;
```

A module that is not the component's direct parent declares the same
interface and has its parent forward it:
`ctx.share_interface(module.inbox, module.consumer.inbox)?`.

## Your own interfaces

An interface is a struct of parts, each a `pub` field of the component,
marked as owned (written by the holder) or as the other side's (read
only):

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

Each part's name must be a `pub` field of the component with a compatible
type; this is checked at compile time. Under `&mut I`, a task writes the
owned parts and reads the others as they were (`curr`); under
`&'latest mut I`, it reads them after the other side (`latest`). Any
module can be a component, including modules with tasks of their own:
interfaces are a general way to give a module a typed, ordered port, much
like a SystemVerilog interface and its modports.
