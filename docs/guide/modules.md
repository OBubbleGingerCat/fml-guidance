# Modules and parameters

A module is a Rust struct marked `#[fml::module]`, with exactly one
`#[fml::module_impl]` block holding its `init` and tasks, even when that
block is empty:

```rust
#[fml::module]
pub struct Leaf {
    value: u64,
}

#[fml::module_impl]
impl Leaf {}
```

The macro replaces the struct's fields with generated types, so a module
value is never built by hand: [elaboration](#elaboration) builds every
instance from the parameters.

## Fields

| Field | What it is |
|---|---|
| `#[fml::param("doc", default = expr)] name: T` | a parameter, fixed before the simulation starts |
| `#[fml::trigger] clock: fml::Clock` | an independent clock source, configured in `init` |
| `#[fml::trigger] clock: fml::ClockRelay` | a clock that comes from elsewhere |
| `#[fml::trigger] out: fml::EventSource<T>` | an event source with payload `T` |
| `#[fml::trigger] input: fml::EventRelay<T>` | events that come from elsewhere |
| `#[fml::submodule] child: Child` | a child instance |
| `#[fml::interface] out: fml::FifoTx<T>` | an interface to a component ([Components](./components)) |
| `name: T` (no attribute) | state, `T` a [plain type](./components#plain-types), a container, a `Store` or an `External` port |
| `name: fml::StateRef<T>` | a reference to state owned by another module |

A field without an FML attribute is state; any other attribute is an
error.

**Visibility.** Parameters and submodules must be private. A parent sees
exactly the fields of its direct children that are declared `pub` (state,
triggers, interfaces), and nothing deeper: to reach a grandchild, the child
forwards it through a `pub` relay, reference or interface of its own.

## Arrays

Submodules, triggers, state, references and interfaces can be arrays:

```rust
#[fml::param("number of workers", default = 2)]
worker_count: usize,

#[fml::submodule]
workers: [Worker; fml::DynShape(worker_count)],
```

- `[X; 4]`: a fixed length, a nonzero literal;
- `[X; N]`: a const generic of the module;
- `[X; fml::DynShape(p)]`: the value of parameter `p` of the same module,
  per instance. The parameter is named directly; expressions are not
  allowed. Zero is an error.

Each element of a state array is its own location, ordered separately
from the others. A value that should be one location (a buffer always
taken whole) is an `fml::Array<T, N>` instead.

## Reset values

State starts at `Default::default()`, or at what `#[fml::reset(..)]` says:

```rust
#[fml::param("credits at reset", default = 4u32)]
credits_init: u32,

#[fml::reset(credits_init)]     // a parameter of this module
pub credits: u32,

#[fml::reset(u64::MAX)]         // a constant, for every element
tags: [u64; fml::DynShape(depth)],
```

`#[fml::reset(with = f)]` calls `fn f(value: &mut T)` on the default
value, and `#[fml::reset(with = f, args = [p, q])]` passes it the
parameters too. Reset values are computed when the model is elaborated.

## Parameters

A parameter has a `default` (required) and optionally `validate = f`, a
function `fn(&T) -> Result<(), fml::ParamError>`:

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

Parameter types: integers, floats, `bool`, `char`, `String`, `fml::Time`
(written as `"10ns"`, `"250 ps"` or `"delta"`), arrays and tuples of
those, and any struct or enum with `#[derive(fml::ParamValue)]`. Values
convert strictly: an integer in the file for a float parameter is an
error.

Init and tasks read parameters through `ctx.module()`:
`*ctx.module().credits_init`. They never change.

## The parameter file

Tables follow instance paths, from `top`:

```toml
[top]
ports = 3

[[top.port]]            # an array of submodules: array tables
credits_init = 8        # no selector: every element

[[top.port]]
__select_index__ = 2    # just element 2 (also lists, "a..b", "a..=b")
policy = { Fixed = { first = 1 } }
link = "500ps"
```

- A scalar submodule is a table, `[top.child]`; elements of an array are
  array tables, `[[top.children]]`, with an optional `__select_index__`.
  Tables after an array table apply to its selected elements.
- When several rules set one parameter, the more specific one wins, then
  the later one.
- `__include__ = "other.toml"` loads a file whose `[top]` table is placed
  at the including table.
- A table must name an existing instance, and a key one of its
  parameters; anything else is an error. Unset parameters keep their
  defaults.

Derived types are written as TOML values: a struct as an inline table, an
enum as `"Variant"` or `{ Variant = ... }`.

## `init`

A module may have one `#[fml::init]`, which runs once per instance, before
its children's, and connects things. It cannot read or write state values
or send events.

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

| Method | What it does |
|---|---|
| `ctx.module()` | the module's own view: parameters as values, everything else as handles, children as their `pub` views (arrays are `Vec`s) |
| `ctx.path()` | the instance path, such as `top.workers[1]` |
| `ctx.init_clock(clock, period, phase)` | configures an independent clock, exactly once |
| `ctx.connect(source, target)` | clock → clock relay, relay → relay, event source → event relay, relay → relay |
| `ctx.share_state(state, reference)` | points a `StateRef` at a state, or at another reference; also for stores and external ports |
| `ctx.connect_interface(&child_component, interface)` | binds an interface to a direct child component |
| `ctx.share_interface(interface, child_interface)` | forwards an interface to a child |

Connections are resolved after every `init` has run, so their order does
not matter. Every relay, reference and interface must be connected
exactly once: an unconnected one, a second driver, a connection to a
source and a cycle of references are errors.

## Elaboration

`fml::SimPlan::<Top>::new(params, snapshot)` reads the parameter file,
builds every instance, runs the `init`s, resolves the connections, checks
every task's bindings and analyzes the model. Its errors name instance
paths, so they point at the place in your model. After it, the instance
tree is available as `plan.top`, with every field public: parameters as
`Param<T>` (`.get()`), state and triggers as handles.

Generic modules work as in Rust: `Fifo<T>` and `Cache<const WAYS: usize>`
are different module types per instantiation.
