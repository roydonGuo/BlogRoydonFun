---
title: AI Agent 沙箱模式工程实践：隔离边界、生命周期与生产治理
date: 2026-08-28 9:19:15
category: AI
cover: /images/posts/ai-agent-sandbox-mode-engineering-knowledge-map.webp
tags:
  - Agent
  - Sandbox
  - 安全
  - Java
excerpt: Agent 沙箱不是一个临时目录，而是一组可验证的执行边界：把不可信代码、文件、进程、网络、凭据和资源消耗限制在短生命周期环境内，再经过验收门把可信产物带回业务系统。
---

# AI Agent 沙箱模式工程实践：隔离边界、生命周期与生产治理

<img src="/images/posts/ai-agent-sandbox-mode-engineering-knowledge-map.webp" alt="AI Agent 沙箱模式工程实践：隔离边界、生命周期与生产治理知识串联图" style="border-radius: 10px;" />

Agent 沙箱不是一个临时目录，而是一组可验证的执行边界：把不可信代码、文件、进程、网络、凭据和资源消耗限制在短生命周期环境内，再经过验收门把可信产物带回业务系统。

模型可以生成代码、调用 Shell、安装依赖、解析外部文件，也可能因为幻觉、提示词注入或工具返回污染而选择错误动作。生产系统不能把安全建立在“模型大多数时候会判断正确”上，而要保证模型判断错误时，损害仍被限制在预设范围内。

> 事实基线：内容按 OWASP LLM Top 10 2025、Docker、Kubernetes、gVisor、Firecracker 与 NIST 官方资料核对，核对日期为 2026-08-28。不同运行时的功能和默认策略会变化，落地时应继续核对所用版本文档。

## 一、为什么 Agent 比普通后端更需要沙箱

传统后端通常执行开发者提前编写、评审和发布的确定性代码。Agent 则把自然语言目标转换成一连串运行时动作，动作序列、参数和中间输入在执行前未必完全已知。

风险主要来自五条链路：

1. **模型不确定性**：模型可能误解目标、拼错路径、构造错误命令，或在重试中扩大影响范围。
2. **提示词注入**：网页、文档、代码注释和工具结果都可能夹带恶意指令，诱导 Agent 读取密钥或向外发送数据。
3. **开放式工具**：`shell(command)`、`writeFile(path, content)` 和 `fetch(url)` 的参数空间过大，一次调用即可越过多个业务边界。
4. **供应链执行**：Agent 可能安装依赖、运行仓库脚本或调用第三方 Skill，其中任何一项都可能包含恶意代码。
5. **循环放大**：Agent Loop 会根据失败继续规划和调用工具，一次小错误可能变成进程风暴、磁盘写满或重复请求。

OWASP 将这类问题归入 **Excessive Agency**（过度代理权）：根因往往是功能过多、权限过大或自主性过强。沙箱不能让模型变得可靠，但可以把开放式执行能力放进硬边界，使一次错误不直接变成宿主机、其他租户或生产系统的事故。

## 二、沙箱到底是什么

**Sandbox**（沙箱）是为一次任务或会话创建的受限执行环境。它至少要回答六个问题：

- 能看到哪些文件，哪些目录只读，哪些目录可写；
- 能启动哪些进程、调用哪些系统能力；
- 能使用多少 CPU、内存、磁盘、进程数和时间；
- 能访问哪些网络目标、端口和协议；
- 能拿到哪些凭据，凭据何时失效；
- 哪些结果允许离开环境，谁负责验收。

因此，“给 Agent 一个临时工作目录”不等于沙箱。路径限制只能减少误写，无法阻止进程读取环境变量、访问宿主服务、扫描内网或耗尽资源。一个可用的沙箱应同时具备**隔离、限制、观测、回收和产物晋升**能力。

:::mermaid
flowchart LR
    A[用户目标与外部内容] --> B[Agent 规划]
    B --> C[工具策略与参数校验]
    C -->|允许执行| D[沙箱边界]
    C -->|高风险| E[审批或拒绝]
    D --> F[文件 / 进程 / 网络]
    F --> G[结果扫描与验收]
    G -->|通过| H[可信产物区]
    G -->|失败| I[隔离销毁]
:::

图中最重要的不是沙箱本身，而是沙箱前后的两道门：执行前由策略决定“能不能做”，执行后由验收决定“什么能带出来”。

## 三、沙箱必须覆盖哪些隔离维度

只限制其中一两项容易产生“看起来隔离，实际上仍可越权”的假安全感。完整设计至少覆盖以下九类边界。

| 隔离维度 | 需要限制的对象 | 常见失误 |
| --- | --- | --- |
| 文件系统 | 根目录、只读挂载、可写层、路径穿越、文件大小 | 把宿主源码、SSH 目录或 Docker Socket 直接挂入 |
| 进程与系统调用 | 进程树、用户身份、Linux capabilities、syscall | 使用特权容器，或关闭默认 seccomp |
| 资源配额 | CPU、内存、磁盘、I/O、进程数、执行时间 | 只设超时，不设内存和进程数上限 |
| 网络出口 | DNS、IP、域名、端口、协议、请求次数与字节数 | 默认允许访问公网、内网和云元数据服务 |
| 凭据 | API Token、云身份、数据库账号、证书 | 把宿主长期密钥写入环境变量或镜像 |
| 租户与身份 | 用户、会话、任务、项目命名空间 | 多个用户复用同一可写目录或同一沙箱 |
| 运行时边界 | 容器内核、用户态内核、虚拟机、宿主节点 | 把容器等同于虚拟机，忽略共享内核风险 |
| 生命周期 | 创建、初始化、快照、恢复、销毁、残留清理 | 任务结束后保留进程、挂载和临时凭据 |
| 产物边界 | 文件类型、大小、恶意内容、来源与摘要 | 沙箱输出未经扫描就覆盖生产文件 |

Docker 官方文档说明，namespace 提供资源视图隔离，cgroup 负责资源记账和限制，seccomp 用系统调用允许列表缩小内核攻击面。它们职责不同，不能互相替代。尤其是容器默认没有资源上限，若不显式配置，进程仍可能耗尽宿主资源。

### 1、文件系统：默认不可见，按需挂载

推荐为每个任务创建独立根文件系统，只挂载必要输入：

- 基础镜像和工具链设为只读；
- 输入资料复制到只读目录；
- 输出写入独立可写卷；
- 禁止挂载宿主根目录、用户主目录、容器运行时 Socket；
- 对路径做规范化后再校验，拒绝 `..`、符号链接逃逸和越界绝对路径；
- 限制单文件大小、文件总数和磁盘总量。

代码仓库可采用“只读基线 + 临时写层”。Agent 可以修改副本并产生补丁，但不能直接改发布目录。验收通过后，再由宿主侧受控服务应用补丁。

### 2、进程与内核：减少可调用面

容器内进程应使用非 root 用户，删除不需要的 Linux capabilities，并保持 seccomp、AppArmor 或 SELinux 等安全机制生效。Docker 的 rootless 模式会让守护进程和容器都运行在用户命名空间内，可降低运行时漏洞带来的宿主 root 风险，但它仍不是所有威胁的终点。

若任务会执行真正不可信的任意代码，仅靠普通容器可能不够。gVisor 通过用户态应用内核拦截工作负载的系统调用，减少其直接接触宿主 Linux 内核的机会；Firecracker 则以 KVM microVM 提供硬件虚拟化边界，并继续叠加 seccomp、cgroup、namespace 和 jailer。隔离越强，通常启动、兼容性和运维成本也越高。

### 3、资源：超时只是其中一项

资源控制至少包括：

- 墙钟超时，限制任务总存活时间；
- CPU 配额，防止死循环长期抢占计算资源；
- 内存硬上限，明确 OOM 后的失败语义；
- 磁盘容量和 I/O 速率，防止日志或生成文件写满节点；
- PID 上限，防止 fork bomb；
- 网络请求数、并发数和流量上限，限制成本与数据外传规模。

资源超限必须返回结构化错误，如 `TIMEOUT`、`MEMORY_LIMIT`、`DISK_QUOTA`，而不是只给模型一段模糊的标准错误输出。编排器据此决定缩小任务、放弃重试或请求人工介入。

### 4、网络：默认拒绝，再声明出口

沙箱网络应遵循 **default deny**（默认拒绝）。按任务声明域名、IP、端口和协议允许列表，并额外阻断：

- 宿主回环地址与内网网段；
- 云厂商元数据服务；
- Kubernetes 控制面和节点管理端口；
- 未经授权的数据库、消息队列和缓存；
- DNS 隧道、任意代理和动态端口转发。

Kubernetes `NetworkPolicy` 可以控制 Pod 的三、四层流量，但前提是网络插件真正支持并执行该策略。域名级控制、HTTP 方法限制、响应大小和内容审计通常还要由出口代理完成。Firecracker 官方设计也明确说明 microVM 本身不负责过滤出口流量，调用方仍须在宿主侧实施过滤。

### 5、凭据：按动作临时换票

长期密钥不应进入镜像、文件系统快照或普通环境变量。更稳妥的方式是由宿主侧 **Credential Broker**（凭据代理）根据任务身份签发短期、窄权限凭据：

1. 编排器提交 `tenantId`、`taskId`、目标服务和所需动作；
2. 策略引擎校验用户权限与任务风险；
3. 凭据代理签发只覆盖本次动作的短期凭据；
4. 沙箱通过受控通道使用，不落盘、不写日志；
5. 任务结束或取消时立即撤销。

这样即使沙箱内代码被提示词注入控制，可利用的身份、时长和数据范围也被压缩。

## 四、沙箱不是哪些东西

### 1、沙箱不是工具授权

沙箱允许一段代码在隔离环境执行，不代表它有权退款、发信、发布版本或删除云资源。真实业务接口仍要按调用者身份做服务端鉴权和数据范围校验。

### 2、沙箱不是人工审批

高金额、不可逆、跨租户或生产变更仍应进入 **HITL**（Human In The Loop，人类参与闭环）。审批解决“业务上是否应该做”，沙箱解决“执行失控时最多能伤到哪里”。

### 3、沙箱不是输入输出校验

模型生成的 Shell、SQL、HTML、文件路径和 URL 都是不可信输入。进入沙箱前仍要做参数校验；离开沙箱的 Markdown、压缩包、可执行文件和补丁仍要扫描。OWASP 将未经校验的模型输出直接传入下游执行器归为 Improper Output Handling。

### 4、沙箱不是备份与回滚

隔离环境可以被销毁，但它无法自动撤销已经调用的外部 API。退款、消息发送、数据库写入等动作仍需要幂等键、审计记录、补偿流程和业务回滚。

## 五、如何选择沙箱实现

没有一种运行时适合所有任务。选择应从威胁模型出发，而不是只比较启动速度。

| 方案 | 隔离强度 | 启动与兼容性 | 适用场景 | 主要边界 |
| --- | --- | --- | --- | --- |
| 独立目录 + 普通进程 | 低 | 最快、兼容最好 | 可信脚本、开发辅助 | 与宿主共享用户、内核和网络，不宜执行不可信代码 |
| 标准容器 | 中 | 快、生态成熟 | 单租户内部 Agent、受审查工具 | 与宿主共享内核，必须正确配置用户、能力、挂载和配额 |
| gVisor 等用户态内核 | 中高 | 有兼容与性能成本 | 多租户代码执行、公共文件处理 | 缩小宿主内核暴露面，仍依赖 cgroup 与外部网络策略 |
| microVM | 高 | 启动和运维成本更高 | 强多租户、公开代码执行、敏感环境 | 仍需宿主加固、出口过滤、补丁和快照保护 |
| 远程托管沙箱 | 取决于服务契约 | 接入快、平台依赖强 | 团队不自建隔离集群 | 需核对数据驻留、镜像、网络、快照、日志和销毁保证 |
| 浏览器或 WebAssembly 沙箱 | 受能力模型约束 | 对特定语言友好 | 前端预览、轻量插件和确定性计算 | 系统能力有限，文件与网络桥接仍需宿主授权 |

一个实用原则是：可信工具用最小权限进程；内部但复杂的代码用强化容器；来自公网、第三方仓库或多租户用户的任意代码，优先考虑 gVisor 或 microVM 级边界。

## 六、一次沙箱任务的完整生命周期

沙箱不应是“启动容器后执行命令”的单步调用，而是一套可恢复、可审计的状态机。

:::mermaid
stateDiagram-v2
    [*] --> Requested
    Requested --> Provisioning: 策略通过
    Requested --> Rejected: 策略拒绝
    Provisioning --> Hydrating: 环境创建成功
    Hydrating --> Running: 输入与工具就绪
    Running --> Inspecting: 执行结束
    Running --> Cancelling: 超时或取消
    Inspecting --> Promoting: 产物通过验收
    Inspecting --> Failed: 验收失败
    Promoting --> Destroying: 产物已复制
    Cancelling --> Destroying
    Failed --> Destroying
    Destroying --> Finished
:::

### 1、申请与策略决策

请求至少携带租户、用户、会话、任务、镜像版本、工具集合、资源预算、网络策略和凭据范围。服务端根据风险策略生成最终配置，不能让模型直接提交 `privileged=true`、任意挂载或开放网络。

### 2、创建与注入输入

从固定摘要的只读镜像创建环境，再把输入文件复制到任务命名空间。初始化过程要校验输入大小、格式、摘要和恶意内容；依赖缓存只能只读共享，避免租户之间通过缓存投毒。

### 3、执行与观测

每条命令都关联 `taskId`、`executionId` 和递增序号。宿主采集退出码、资源用量、网络决策、文件变更清单和截断后的日志摘要。模型只能看到必要结果，密钥和敏感输出要先脱敏。

### 4、验收与产物晋升

执行成功不等于任务成功。产物离开沙箱前应检查：

- 路径是否位于允许输出目录；
- 类型、数量、大小和扩展名是否符合契约；
- 是否包含恶意代码、密钥、个人信息或越权数据；
- 代码补丁是否只触碰授权路径；
- 是否通过格式、构建或策略校验；
- 摘要是否与审计记录一致。

通过后由宿主服务复制到可信区，沙箱本身不应拥有生产目录写权限。这个过程称为**产物晋升**，类似 CI 将构建产物经过检查后发布，而不是把整个工作目录直接暴露给生产系统。

### 5、销毁与残留检查

无论成功、失败、超时还是取消，都必须进入统一清理逻辑：终止完整进程树、卸载卷、撤销凭据、删除网络规则、释放配额和清理临时文件。销毁失败要进入后台补偿队列并报警，不能只依赖进程退出时的 `finally`。

## 七、Java 后端如何定义沙箱契约

业务服务不应把容器命令、Kubernetes Pod 或 microVM API 散落在 Agent Loop 中。先定义稳定的应用层契约，再让不同运行时实现它。

```java
public interface SandboxGateway {

    SandboxHandle provision(SandboxSpec spec);

    ExecutionResult execute(
            SandboxHandle handle,
            CommandRequest command
    );

    PromotionResult promote(
            SandboxHandle handle,
            ArtifactPolicy policy
    );

    void destroy(SandboxHandle handle);
}

public record SandboxSpec(
        String tenantId,
        String taskId,
        String imageDigest,
        ResourceBudget budget,
        NetworkPolicy networkPolicy,
        List<MountSpec> mounts,
        CredentialGrant credentialGrant
) {
    public SandboxSpec {
        // 镜像必须使用不可变摘要，避免同一任务重试时运行不同内容
        if (imageDigest == null || !imageDigest.startsWith("sha256:")) {
            throw new IllegalArgumentException("imageDigest 必须为 sha256 摘要");
        }
    }
}

public record CommandRequest(
        List<String> argv,
        String workingDirectory,
        Duration timeout,
        Map<String, String> safeEnvironment
) {
    public CommandRequest {
        // 使用参数数组，不经 shell 拼接，减少命令注入和转义歧义
        argv = List.copyOf(argv);
        safeEnvironment = Map.copyOf(safeEnvironment);
    }
}
```

这里故意不暴露 `privileged`、宿主路径和任意网络开关。它们属于平台策略，不属于模型或普通业务调用方可以修改的字段。

编排服务还要保证清理动作总会发生：

```java
public PromotionResult runTask(AgentTask task) {
    SandboxHandle handle = sandboxGateway.provision(policy.toSpec(task));
    try {
        ExecutionResult result = sandboxGateway.execute(
                handle,
                commandFactory.from(task)
        );

        if (!result.succeeded()) {
            // 失败类型决定是否允许重试，不能让模型无限循环执行
            throw new SandboxExecutionException(result.failureCode());
        }

        return sandboxGateway.promote(handle, artifactPolicy.forTask(task));
    } finally {
        // 正常、异常和取消都走统一销毁；失败时由网关登记补偿任务
        sandboxGateway.destroy(handle);
    }
}
```

生产实现还应把 `provision`、`execute`、`promote`、`destroy` 设计成幂等操作。网络重试可能导致同一个请求到达两次，平台必须依靠 `tenantId + taskId` 或独立幂等键识别已有实例，而不是创建两个同时写同一输出目录的沙箱。

## 八、失败处理与可观测性

### 1、失败要可分类

建议至少区分：

| 失败码 | 含义 | 默认处理 |
| --- | --- | --- |
| `POLICY_DENIED` | 工具、挂载、网络或凭据不被允许 | 不重试，返回明确边界 |
| `PROVISION_TIMEOUT` | 运行环境创建超时 | 平台级有限重试 |
| `IMAGE_UNAVAILABLE` | 镜像缺失或摘要不匹配 | 不切换浮动标签，报警 |
| `EXECUTION_TIMEOUT` | 命令超过墙钟时间 | 终止进程树，按任务判断是否拆分 |
| `RESOURCE_EXHAUSTED` | CPU、内存、PID 或磁盘超限 | 不原样重试，调整任务或预算 |
| `NETWORK_DENIED` | 访问未授权目标 | 不重试，不让模型绕过策略 |
| `ARTIFACT_REJECTED` | 输出未通过扫描或契约校验 | 保留审计摘要，销毁环境 |
| `DESTROY_PENDING` | 清理暂时失败 | 后台补偿并阻止槽位复用 |

“命令失败后让模型自己想办法”只适合任务逻辑错误。权限拒绝、网络拒绝和资源硬上限属于系统策略，模型不得通过换命令、换域名或重复执行来绕过。

### 2、观测要围绕边界

关键指标包括：

- 创建、恢复、执行、验收和销毁耗时；
- 活跃沙箱数、队列长度和池命中率；
- CPU、内存、磁盘、PID 与出口流量峰值；
- 策略拒绝率、网络拒绝目标和凭据签发次数；
- 超时、OOM、产物拒绝和销毁补偿次数；
- 每租户成本、并发和异常重试率。

审计日志应关联用户、租户、任务、模型回合、工具调用、沙箱实例、策略版本、镜像摘要和产物 SHA-256。命令参数与输出只记录必要摘要，避免把密钥、个人信息或完整业务数据再次泄露到日志系统。

## 九、生产落地检查表

上线前可按以下顺序核对：

1. 明确威胁模型：执行的是受审查脚本、第三方依赖，还是任意用户代码；
2. 确定隔离粒度：每次工具调用、每个任务、每个会话或每个租户；
3. 固定镜像摘要，扫描依赖，禁止运行时随意安装未知包；
4. 使用非 root 身份，删除多余 capability，保持 seccomp 和强制访问控制；
5. 文件默认只读，仅开放独立输出目录，禁止敏感宿主挂载；
6. 显式设置 CPU、内存、磁盘、PID、I/O、超时和并发上限；
7. 网络默认拒绝，通过出口代理开放必要目标并阻断内网与元数据服务；
8. 凭据由代理按任务短期签发，不进入镜像、快照和普通日志；
9. 高风险业务动作继续做服务端鉴权、参数冻结和人工审批；
10. 产物经过类型、恶意内容、敏感信息、路径和摘要校验后再晋升；
11. 所有结束路径都执行销毁，清理失败有补偿任务和报警；
12. 定期做逃逸、跨租户、资源耗尽、数据外传和残留凭据演练。

最常见的错误不是“完全没有沙箱”，而是只有容器名称，没有默认拒绝网络、资源上限、短期凭据、租户隔离和产物验收。安全强度最终取决于最薄弱的一层。

## 十、总结

Agent 沙箱的价值不是让不可信动作变可信，而是把它关进可限制、可观测、可销毁的边界，并且只放行经过验收的结果。

**要点回顾**：Agent 的动态规划、提示词注入、开放式工具和循环重试会放大副作用；沙箱应同时覆盖文件、进程、系统调用、资源、网络、凭据、租户、生命周期和产物；容器、用户态内核与 microVM 的隔离强度和成本不同；沙箱不能替代鉴权、HITL、输入输出校验、幂等和回滚；生产链路必须包含策略决策、隔离执行、产物晋升与可靠销毁。

**关联知识点**：零信任把模型与工具输出都视为不可信输入；最小权限决定工具、网络和凭据只能获得完成任务所需能力；HITL 负责高风险业务动作的人工授权；供应链安全约束镜像、依赖、Skill 与脚本来源；可观测性把一次模型回合关联到工具、沙箱、策略和最终产物。

**面试常问**：有了容器就等于有沙箱吗？→ 不等于，容器还需非 root、能力收缩、seccomp、资源、网络、挂载和凭据策略；为什么沙箱不能替代权限校验？→ 沙箱限制运行环境，权限校验决定业务主体能否操作目标资源；沙箱输出为什么还要验收？→ 环境内的程序仍可能生成恶意文件、泄露数据或修改越界路径，只有通过宿主侧检查的产物才能进入可信区；何时应选 microVM？→ 当执行任意不可信代码、强多租户隔离收益高于启动和运维成本时优先评估。

**参考资料**：[OWASP LLM06:2025 Excessive Agency](https://owasp.org/www-project-top-10-for-large-language-model-applications/2_0_vulns/LLM06_ExcessiveAgency.html)；[OWASP LLM05:2025 Improper Output Handling](https://owasp.org/www-project-top-10-for-large-language-model-applications/2_0_vulns/LLM05_ImproperOutputHandling)；[Docker Engine Security](https://docs.docker.com/engine/security/)；[Docker Seccomp](https://docs.docker.com/engine/security/seccomp/)；[Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/)；[Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)；[Kubernetes NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)；[gVisor Security Model](https://gvisor.dev/docs/architecture_guide/security/)；[Firecracker Design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md)；[NIST SP 800-190](https://csrc.nist.gov/pubs/sp/800/190/final)。
