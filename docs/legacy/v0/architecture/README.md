# Architecture

| Question                                              | File                                    |
| ----------------------------------------------------- | --------------------------------------- |
| What are the AWS components and how do requests flow? | [topology](topology.md)                 |
| What packages exist and what may import from what?    | [layered-packages](layered-packages.md) |
| Where is the code for a given concern?                | [codebase-map](codebase-map.md)         |
| What environments are there (local / dev / prod)?     | [environments](environments.md)         |
| How do sandboxed application runs work?               | [sandbox-runs](sandbox-runs.md)         |
| How does logging / tracing / metrics work?            | [observability](observability.md)       |
| How are costs kept under control?                     | [cost-guards](cost-guards.md)           |

How the load-bearing guarantees (cost caps, auth, isolation, concurrency) are enforced in code: [key-properties](../key-properties/README.md).
