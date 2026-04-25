# Current Python behavior (baseline)

## Transport

- Writes command JSON into `plugin_commands/`.
- Polls `plugin_responses/` for `<id>_response.json`.
- Correlation depends on generated command id and polling; plugin discovery is mtime-based.

## Request shape (legacy, implicit v1)

```json
{
  "action": "addTask",
  "id": "addTask_1234.56",
  "timestamp": 1234.56,
  "data": {}
}
```

## Response shape (legacy)

```json
{
  "success": true,
  "result": {}
}
```

## Known behavior quirks

- Optional args accepted by MCP schemas are sometimes not forwarded.
- Action aliases are implemented in plugin switch statement.
- Error format is non-uniform across actions.
