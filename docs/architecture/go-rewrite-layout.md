# Go rewrite package layout

## Package boundaries

- `internal/domain`: protocol-independent contracts and typed errors.
- `internal/service`: business orchestration; canonical action mapping.
- `internal/pluginipc`: file transport implementation for plugin bridge.
- `internal/mcpadapter`: stdio adapter and tool argument mapping.
- `internal/config`: env/path/timeout config.
- `internal/logging`: logger construction.
- `internal/version`: build metadata.

## Key interfaces

```go
type Bridge interface {
    Call(ctx context.Context, req Request) (Response, error)
    Health(ctx context.Context) (HealthStatus, error)
    Capabilities(ctx context.Context) (Capabilities, error)
}
```

```go
type TaskService interface {
    CreateTask(ctx context.Context, in CreateTaskInput) (any, error)
    ListTasks(ctx context.Context, in ListTasksInput) (any, error)
    UpdateTask(ctx context.Context, in UpdateTaskInput) (any, error)
    CompleteTask(ctx context.Context, in CompleteTaskInput) (any, error)
}
```

## Design constraints

- MCP adapter must not know file transport details.
- Service layer must remain reusable for future local API adapter.
- Syntax parsing remains in plugin/SP path for now.
