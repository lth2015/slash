

### Slash的项目目标及用法

-----------


#### Slash的项目目标

我想做给SRE使用的UI或者说TLI工具，用来组装和管理我的skills。

sre-unified command set
│
├── /infra：云资源管理
│   ├── /infra <aws|gcp> vm <vm-id> list|get|start|stop|restart
│   │       统一云主机操作接口，屏蔽云厂商差异
│   ├── /infra <aws|gcp> vm <vm-id> resize
│   │       云主机规格变更
│   ├── /infra <aws|gcp> vm <vm-id> snapshot
│   │       创建快照
│   ├── /infra <aws|gcp> vm <vm-id> backup
│   │       主机备份
│   ├── /infra <aws|gcp> oss <bucket-id> <object-id> list|get|upload|download
│   │       对象存储统一接口
│   ├── /infra <aws|gcp> db <db-id> list|get|restart|slow-log
│   │       数据库操作接口
│   ├── /infra <aws|gcp> db <db-id> backup|restore
│   │       数据库备份与恢复
│   ├── /infra <aws|gcp> lb <lb-id> list|get|status
│   │       负载均衡管理
│   ├── /infra <aws|gcp> lb <lb-id> error-log
│   │       LB 错误日志分析
│   ├── /infra <aws|gcp> lb <lb-id> 5xx-analysis
│   │       5xx 错误分析
│   ├── /infra <aws|gcp> dns <domain> resolve
│   │       DNS 解析查询
│   ├── /infra <aws|gcp> cost summary
│   │       成本汇总分析
│   ├── /infra <aws|gcp> cost audit
│   │       成本审计
│   └── /infra <aws|gcp> cost optimize
│           成本优化建议
│
├── /cluster：集群管理（Kubernetes）
│   ├── /cluster <context> get <resource> [name]
│   ├── /cluster <context> list <resource>
│   ├── /cluster <context> describe <resource> <name>
│   ├── /cluster <context> logs <pod>
│   ├── /cluster <context> scale <deploy> --replicas <n>
│   ├── /cluster <context> evict <node>
│   ├── /cluster <context> drain <node>
│   ├── /cluster <context> cordon <node>
│   ├── /cluster <context> uncordon <node>
│   ├── /cluster <context> top <node>
│   ├── /cluster <context> diagnose <pod>
│   ├── /cluster <context> predict <metric>
│   └── /cluster <context> optimize <deploy>
│
├── /app：应用管理
│   ├── /app list
│   ├── /app get <app-name>
│   ├── /app pipeline run <job>
│   ├── /app pipeline list
│   ├── /app pipeline describe <job>
│   ├── /app pipeline stop <job>
│   ├── /app pipeline delete <job>
│   ├── /app pipeline trace <job>
│   ├── /app ship <app-name> --tag <version> --env <env>
│   ├── /app rollback <app-name> --env <env>
│   ├── /app canary <app-name> --env <env> --weight <weight>
│   ├── /app diagnose <app-name> --env <env>
│   ├── /app predict <app-name> --env <env>
│   ├── /app optimize <app-name> --env <env>
│   ├── /app config get <app-name> --env <env>
│   ├── /app config update <app-name> --config <configs> --env <env>
│   └── /app config diff <app-name> --env <env>
│
└── /ops：运维操作
    ├── /ops alert list
    ├── /ops alert ack <id>
    ├── /ops alert mute <id> --duration <duration>
    ├── /ops trace <trace-id>
    ├── /ops top-errors <service>
    ├── /ops scan <service>
    ├── /ops audit logs --user <name>
    └── /ops report daily|weekly

#### Slash的设计

1. 命令式接口：Slash采用类似于命令行的语法结构，用户通过输入特定格式的命令来执行操作。这种设计使得用户能够快速上手，并且可以通过组合不同的命令来实现复杂的功能。注意，对输入有严格的检查，不允许任何形式的扩展、非法输入或者模糊输入，以及禁止任何形式的自然语言输入和Prompt注入。

2. 要求明确的参数：每个命令都需要明确的参数，用户必须按照规定的格式输入参数才能执行命令。这种设计确保了命令的准确性和可预测性，避免了模糊输入带来的歧义。上面的可能不够专业或者详尽、也不够原子级，需要你根据实际情况进行调整、优化和补充。

3. 界面友好：Slash的界面设计简洁明了，用户可以通过输入命令来快速访问所需的功能。界面提供了清晰的提示和反馈，帮助用户理解命令的执行结果。可以支持用户的辅助输入，比如命令补全、参数提示等功能，提升用户体验。这个是很重要的功能

4. 可扩展性：Slash的设计考虑了未来的扩展需求，用户可以通过添加新的命令和参数来扩展系统的功能。这种设计使得Slash能够适应不断变化的需求，并且能够持续提供有价值的功能。我们在Skills目录，按照命令行层次来建立目录结构，最终存储Skills文件，例如：

```
Skills/
├── infra/
│   ├── aws/
│   │   ├── vm/
│   │   │   ├── list.skill
│   │   │   ├── get.skill
│   │   │   ├── start.skill
│   │   │   ├── stop.skill
│   │   │   └── restart.skill
│   │   ├── oss/
│   │   │   ├── list.skill

```
5. 安全性：Slash的设计注重安全性，确保用户输入的命令不会导致系统受到攻击或泄露敏感信息。系统会对输入进行严格的验证和过滤，防止任何形式的恶意输入和攻击。禁止任何形式的自然语言输入和Prompt注入。


#### Slash的要求

1. 由于是一个SRE使用的工具，严格要求输入的准确性和规范性，禁止任何形式的模糊输入、自然语言输入和Prompt注入。
2. 需要提供清晰的错误提示和反馈，帮助用户理解命令执行失败的原因，并指导用户正确输入命令。
3. 需要支持命令补全和参数提示功能，提升用户输入的效率
4. Skills的实现严格要求安全、可验证、可审计并且可以回滚，禁止任何形式的未经验证的代码执行和配置变更。
5. 所有的Skills都必须经过严格的测试和验证，确保其功能的正确性和安全性。必须遵循Human in the Loop的原则，任何自动化操作都必须经过人工审核和批准，禁止任何形式的未经审核的自动化操作。
6. Slash的设计必须考虑到未来的扩展需求，确保系统能够管理skills的生命周期，包括skills的版本化和更新、回滚、审计修订等功能，这里我建议使用GitOps来管理
7. 由于是个demo，暂时不用接入sso，先跑通基本功能，后续可以考虑接入sso来管理用户权限和访问控制。但是每次的执行必须有审计记录
8. 界面清晰明了、有现代感、易于使用，提供清晰的提示和反馈，帮助用户理解命令的执行结果。ui/ux设计需要专业，要达到顶级商业产品的水平。


