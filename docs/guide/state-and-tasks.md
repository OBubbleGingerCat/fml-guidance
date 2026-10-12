# State and tasks

A task is a function in a module's `#[fml::module_impl]` block that the
module's triggers run. It reads and writes the module's state, and the way
it declares each state says how it is ordered against the other tasks
that touch it in the same timepoint.

## A task

```rust
#[fml::task(triggers = (clock,), emits = (done,))]
fn produce(ctx: &mut fml::TaskCtx, value: &mut u64) -> Result<(), fml::SimError> {
    *value += *ctx.module().step;
    ctx.emit_triggers().0.emit(*value, fml::Time::DELTA)?;
    Ok(())
}
```

- `triggers = (..)` lists the triggers that run it (any of them firing
  runs it, at most once per timepoint and instance); `emits = (..)` lists
  the event sources it may send to. An entry is a field, `field[i]` for one
  element, or a whole array.
- The first parameter is `ctx: &mut fml::TaskCtx`; then come the state
  parameters, in any order.
- It returns `Result<(), fml::SimError>`, or `Result<(), fml::Stop>` if it
  may end the simulation ([Running](./running#stopping)).

## Access modes

A state parameter binds the state field of the same name, and its
reference type is its **access mode**:

| Parameter | Mode | Sees |
|---|---|---|
| `x: &T` | `curr` | the value before this timepoint's writer |
| `x: &'latest T` | `latest` | the value after this timepoint's writer |
| `x: &mut T` | `write` | it is the writer: reads and writes the value |

Each location has at most one writer per timepoint. Within a timepoint,
every `curr` reader runs before the writer and every `latest` reader after
it, whatever order the tasks are declared in. If nothing writes in a
timepoint, both readers see the same value.

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

After five clock edges (0 to 4 ns), `reg` is 5, `seen_before` is 4 and
`seen_after` is 5, on any number of workers.

This is how registers and wires are modeled: a pipeline register read with
`&` gives last cycle's value; a combinational signal read with `&'latest`
gives this cycle's.

## Binding other fields

`#[fml::bind(field)]` binds a parameter to a field of another name, and
`#[fml::bind(field[3])]` to one element of an array:

```rust
fn tick(_ctx: &mut fml::TaskCtx,
        #[fml::bind(values[1])] second: &mut u64) -> Result<(), fml::SimError>
```

A whole array is `&[T]`, `&'latest [T]` or `&mut [T]`. Part of one is
`fml::PartialAccess`, with literal indices or ranges:

```rust
#[fml::bind(values)] first_two: &mut [u64; fml::PartialAccess(0, 2)],
```

A container field takes its own type, or its load-time form:
`&mut fml::Queue<Req, fml::DynShape(depth)>` is a `&mut fml::DynQueue<Req>`
inside the task.

The type a parameter names must be the field's type; a mismatch is
reported when the plan is built, with the task and field named.

## Within one task

Two parameters of one task may refer to the same location (through
references or interfaces, say) only if both are `&` or both are
`&'latest`. Anything else is an error when the plan is built, since one
task cannot run both before and after the writer.

## The task context

| Method | Gives |
|---|---|
| `ctx.module()` | the module's view: parameters as values (`*ctx.module().step`) |
| `ctx.now()` | the current `fml::Timepoint` (`.ps()`, `.delta()`, displayed as `10ns` or `10ns+1`) |
| `ctx.triggered_triggers()` | a tuple, one slot per `triggers` entry: `Option<&P>` for a field, `&[Option<&P>]` for an array; a clock's payload is its `ClockInfo` |
| `ctx.emit_triggers()` | a tuple, one emitter per `emits` entry: an `EventEmitter`, or a `Vec` of them for an array |

```rust
let (clock, inputs) = ctx.triggered_triggers();
for packet in inputs.iter().flatten() {
    // every packet that arrived on any input this timepoint
}
let outputs = &mut ctx.emit_triggers().0;
outputs[port].emit(packet, link_delay)?;
```

Emitters and payloads are borrowed for the call only. Sending events is
described in [Time](./time#events).

## Errors

A task that returns `Err(fml::SimError)` (or panics) ends the run with an
error naming the task, the instance and the timepoint: `Err(...)` from
`run_until`. Use `fml::SimError::new("message")`, or `?` on anything that
returns one. Which state the other tasks reached by then is not
specified. See [Errors and debugging](./errors).
