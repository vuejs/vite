This test aim to check for a particular type of circular dependency that causes tricky deadlocks, **deadlocks with forked imports stack**

```
A -> B means: B is imported by A and B has A in its stack
A ... B means: A is waiting for B to ssrLoadModule()

H -> X ... Y
H -> X -> Y ... B
H -> A ... B
H -> A -> B ... X
```

### Forked deadlock description:
```
[X] is waiting for [Y] to resolve
 ↑                  ↳ is waiting for [A] to resolve
 │                                    ↳ is waiting for [B] to resolve
 │                                                      ↳ is waiting for [X] to resolve
 └────────────────────────────────────────────────────────────────────────┘
```

This may seems a traditional deadlock, but the thing that makes this special is the import stack of each module:
```
[X] stack:
	[H]
```
```
[Y] stack:
	[X]
	[H]
```
```
[A] stack:
	[H]
```
```
[B] stack:
	[A]
	[H]
```
Even if `[X]` is imported by `[B]`, `[B]` is not in `[X]`'s stack because it's imported by `[H]` in first place then it's stack is only composed by `[H]`. `[H]` **forks** the imports **stack** and this make hard to be found.

### Fix description
Vite, when imports `[X]`, should check whether `[X]` is already pending and if it is, it must check that, when it was imported in first place, the stack of `[X]` doesn't have any module in common with the current module; in this case `[B]` has the module `[H]` is common with `[X]` and i can assume that a deadlock is going to happen.

