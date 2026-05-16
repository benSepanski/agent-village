# Data model

DynamoDB single-table design. One table per env: `agent-village-{env}`.

| Question                            | File                                      |
| ----------------------------------- | ----------------------------------------- |
| What are the partition / sort keys? | [table-keys](table-keys.md)               |
| What's a User item?                 | [user](user.md)                           |
| What's an Agent item?               | [agent](agent.md)                         |
| What's a Run item?                  | [run](run.md)                             |
| How is the spend limit enforced?    | [spend-reservation](spend-reservation.md) |
| How long are runs kept?             | [run-retention](run-retention.md)         |
