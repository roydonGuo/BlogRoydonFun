---
title: Spring AI 接入 MCP：从能力协商到安全工具调用
date: 2026-08-04
category: AI
cover: /images/posts/spring-ai-mcp-client-engineering-knowledge-map.webp
tags: [agent, spring-ai, mcp]
excerpt: 基于 MCP 2025-11-25 与 Spring AI 2.0.0，讲清协议生命周期、传输方式、工具发现、白名单接入、错误治理与安全边界。
---

# Spring AI 接入 MCP：从能力协商到安全工具调用
<img src="/images/posts/spring-ai-mcp-client-engineering-knowledge-map.webp" alt="Spring AI 接入 MCP：从能力协商到安全工具调用知识串联图" style="border-radius: 10px;" />

Agent 需要查询库存、创建工单或读取企业知识库时，最直接的做法是为每个能力编写一套 Function Calling 适配代码。随着工具数量和模型供应商增加，应用会逐渐承担重复的工具描述、参数 Schema、连接管理和错误转换工作。

Model Context Protocol（MCP）把这层交互抽象成标准协议：工具提供方实现 MCP Server，Agent 应用通过 MCP Client 发现并调用能力。Spring AI 则可以把远程 MCP Tool 适配为统一的 `ToolCallback`，继续交给 `ChatClient` 驱动模型调用循环。

但“接入 MCP”不等于“把所有工具交给模型”。真正的生产问题是：双方如何协商版本、哪些工具可以暴露、调用失败如何区分、用户凭证如何传递，以及写操作由谁批准。

> 本文以 **MCP 2025-11-25** 稳定协议和 **Spring AI 2.0.0** 为示例版本。Spring AI 2.0.x 对应 Spring Boot 4.0.x/4.1.x；如果项目仍使用 Spring AI 1.0.x 或 1.1.x，应切换到对应版本文档核对依赖、配置项和 API，不能直接复制本文配置。

## 一、MCP 解决什么，不解决什么

MCP 标准化的是 Agent 应用与外部能力之间的上下文交换和调用协议，主要价值包括：

- 统一工具、资源和提示词的发现方式；
- 统一参数 Schema、调用结果与错误结构；
- 支持能力协商、动态变更通知和连接生命周期；
- 让同一个 MCP Server 可以被多个兼容的 Host 复用。

它不负责替代业务系统本身，也不会自动解决这些问题：

- 模型是否选对工具；
- 当前用户是否有权执行该工具；
- 写操作是否需要审批；
- 下游接口的幂等、事务和补偿；
- Prompt Injection、越权和敏感数据泄露；
- 超时、限流、重试和审计。

换句话说，MCP 提供互操作协议，应用仍然是安全与业务责任的最终承担者。

## 二、先分清 Host、Client、Server 与模型

一个典型的调用链包含四个角色：

```text
用户
  ↓
Host：Spring AI Agent 应用，维护会话、权限和工具策略
  ├─ Chat Model：根据问题和工具描述生成工具调用请求
  └─ MCP Client：负责协议协商、工具发现和远程调用
          ↓
     MCP Server：暴露库存、订单、知识库等能力
          ↓
       业务系统 / 数据库 / 第三方 API
```

模型不会直接建立网络连接访问 MCP Server。实际流程是：Host 把允许使用的工具定义发送给模型，模型只返回“希望调用哪个工具及参数”，再由 Host 中的工具执行组件调用 MCP Client。这个边界意味着应用可以在真正执行前做鉴权、审批、参数校验和审计。

### MCP Server 的三类核心原语

MCP 规范把 Server 能提供的核心能力分为三类，它们的控制方不同：

| 原语 | 主要控制方 | 作用 | 典型示例 |
|---|---|---|---|
| Prompts | 用户 | 提供可选择的提示词模板 | “生成故障复盘”模板 |
| Resources | 应用 | 提供上下文数据或内容 | 文件、订单详情、Git 历史 |
| Tools | 模型 | 请求执行查询或动作 | 查询库存、创建工单、发送通知 |

这里的“模型控制 Tool”只表示模型可以建议调用，并不代表应用必须无条件执行。涉及写库、付款、发信或删除数据时，Host 应继续保留拒绝和人工确认能力。

## 三、MCP 连接生命周期：不是连上就直接 `tools/call`

MCP 使用 JSON-RPC 2.0 编码消息。一次正常会话分为初始化、运行和关闭三个阶段。

### 1. 初始化：版本与能力协商

Client 的第一条交互必须是 `initialize`。它会声明支持的协议版本、客户端能力和实现信息：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {
      "name": "mall-agent",
      "version": "1.0.0"
    }
  }
}
```

Server 会返回它选择的协议版本以及支持的 `tools`、`resources`、`prompts`、`logging` 等能力。Client 必须判断返回版本是否兼容，不能假设 Server 一定支持自己声明的最新版本。

协商成功后，Client 发送 `notifications/initialized`，双方才进入正常运行阶段。在这之前，除规范允许的少数消息外，不应提前调用工具。

### 2. 运行：只使用已协商的能力

如果 Server 声明了 `tools` 能力，Client 才能发送 `tools/list` 获取工具。工具定义至少包含名称、描述和输入 JSON Schema；列表还可能分页，不能只取第一页就认定发现完成。

模型决定调用后，Host 通过 Client 发送 `tools/call`。如果 Server 声明 `listChanged`，工具发生变化时还可以发送 `notifications/tools/list_changed`，Client 收到后应重新拉取列表并刷新注册表。

### 3. 关闭、超时与取消

协议没有定义统一的 shutdown 消息，而是由传输层完成关闭。所有请求都应设置超时；超时后调用方应停止等待，并按协议能力发送取消通知。进度事件可以说明任务仍在运行，但生产系统仍要设置不可突破的最大执行时长，避免恶意或异常 Server 无限占用连接。

## 四、传输方式：当前标准只有两类

MCP 2025-11-25 定义了两种标准传输：`stdio` 与 Streamable HTTP。旧版 HTTP+SSE 属于兼容路径，不应再被当成并列的新建方案。

| 传输 | 连接方式 | 适用场景 | 关键边界 |
|---|---|---|---|
| `stdio` | Client 启动 Server 子进程，通过标准输入输出交换消息 | 本地开发工具、桌面 Agent、单机插件 | 一对一、生命周期绑定；stdout 只能输出合法 MCP 消息 |
| Streamable HTTP | 独立 Server 提供统一 MCP HTTP 端点 | 远程服务、多 Client、云原生部署 | 需要认证、会话治理、Origin 校验、网关超时与限流 |
| 旧 HTTP+SSE | 分离的 SSE 与 POST 端点 | 兼容 2024-11-05 旧客户端/服务端 | 已被 Streamable HTTP 替代，不建议新项目采用 |

Streamable HTTP 并不是“完全不用 SSE”。Client 使用 POST 发送 JSON-RPC 消息，Server 可以返回普通 `application/json`，也可以返回 `text/event-stream` 流式发送多条消息；Client 还可以通过 GET 打开服务端消息流。

如果 Server 在初始化响应中返回 `Mcp-Session-Id`，Client 后续请求必须携带它。会话失效并返回 404 时，Client 应重新执行初始化，而不是无限重放原请求。断线也不等于取消，取消需要显式表达。

Spring AI 还提供有状态 Streamable HTTP 和 Stateless Streamable HTTP 等运行模式。这是框架对部署形态的支持，不应与 MCP 规范的两种标准传输分类混为一谈。

## 五、Spring AI 2.0.0 接入远程 MCP Server

下面以远程库存 MCP Server 为例。生产环境使用远程 HTTP 连接时，Spring AI 官方文档建议采用 WebFlux 客户端 Starter。

### 1. Maven 依赖

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-bom</artifactId>
            <version>2.0.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-mcp-client-webflux</artifactId>
        <!-- 版本由 spring-ai-bom 统一管理，避免 MCP 模块版本不一致 -->
    </dependency>

    <!-- 还需要按项目实际模型供应商引入对应的 Chat Model Starter -->
</dependencies>
```

### 2. 配置 Streamable HTTP 连接

```yaml
spring:
  ai:
    mcp:
      client:
        name: mall-agent
        version: 1.0.0
        type: SYNC # 示例使用同步 ChatClient，所有 MCP Client 类型必须保持一致
        initialized: true # 创建 Client 后自动完成 MCP 初始化
        request-timeout: 15s # 防止工具调用无限占用请求线程
        toolcallback:
          enabled: false # 关闭“自动暴露全部工具”，后续由代码显式建立白名单
        streamable-http:
          connections:
            inventory:
              url: https://inventory-mcp.example.com/mcp
```

不要把访问令牌直接写入 `application.yml`。本地 `stdio` Server 通常通过受控环境变量获得凭据；HTTP Server 应使用 OAuth 或企业统一身份体系，并由安全的凭据存储提供 Token。

## 六、不要默认把所有 MCP Tool 交给模型

Spring AI 可以把 MCP Tool 转成 `ToolCallback`。为了避免 Server 新增一个高风险工具后被应用自动暴露，可以先关闭自动转换，再按 Server 与工具名称建立白名单。

```java
@Configuration(proxyBeanMethods = false)
public class McpToolConfiguration {

    private static final Set<String> ALLOWED_SERVERS = Set.of("inventory-mcp");
    private static final Set<String> ALLOWED_TOOLS = Set.of(
            "inventory_get_stock",
            "inventory_get_warehouse"
    );

    @Bean
    public ToolCallbackProvider approvedMcpTools(List<McpSyncClient> clients) {
        List<McpSyncClient> approvedClients = clients.stream()
                .filter(client -> client.getServerInfo() != null)
                .filter(client -> ALLOWED_SERVERS.contains(client.getServerInfo().name()))
                .toList();

        // 将已批准 Server 中发现的 MCP Tool 转换为 Spring AI ToolCallback
        ToolCallbackProvider discovered = new SyncMcpToolCallbackProvider(approvedClients);

        List<ToolCallback> approvedTools = Arrays.stream(discovered.getToolCallbacks())
                .filter(callback -> ALLOWED_TOOLS.contains(
                        callback.getToolDefinition().name()))
                .toList();

        if (approvedTools.isEmpty()) {
            // 启动时失败比静默运行一个“无工具 Agent”更容易发现配置错误
            throw new IllegalStateException("未发现经过批准的 MCP 工具");
        }

        return ToolCallbackProvider.from(approvedTools);
    }
}
```

多 Server 都暴露 `search`、`query` 等同名工具时，还要增加稳定的 Server 前缀或显式重命名策略。不能只依赖模型根据描述猜测工具来源，也不要假设 `serverInfo.name` 在不同连接间天然全局唯一。

### 只在需要的请求中挂载工具

```java
@Service
public class InventoryAgentService {

    private final ChatClient chatClient;
    private final ToolCallbackProvider inventoryTools;

    public InventoryAgentService(
            ChatClient.Builder builder,
            ToolCallbackProvider inventoryTools) {
        this.chatClient = builder
                .defaultSystem("你是库存查询助手，只能查询数据，不能执行库存变更。")
                .build();
        this.inventoryTools = inventoryTools;
    }

    public String answer(String question) {
        return chatClient.prompt()
                .user(question)
                // 工具只对本次库存问答可见，避免成为所有 ChatClient 请求的全局默认能力
                .tools(inventoryTools)
                .call()
                .content();
    }
}
```

对于创建订单、退款、删除文件等有副作用的工具，不应与只读工具放在同一个自动执行集合中。可以在模型提出调用后暂停流程，把工具名称和参数展示给用户，经二次确认后再执行。

## 七、错误必须分层，否则模型和运维都会被误导

MCP Tool 有两类协议内错误，再加上传输和模型决策问题，至少应分四层处理：

| 层次 | 示例 | 正确处理 |
|---|---|---|
| 传输错误 | DNS、TLS、连接超时、HTTP 502 | 熔断、有限重试、降级并告警 |
| 协议错误 | 未知方法、工具不存在、消息格式错误 | 记录协议版本与 Server，通常不盲目重试 |
| 工具执行错误 | 库存服务限流、业务参数越界 | Server 返回 `isError: true`，把可修正信息交给模型或用户 |
| 模型决策错误 | 选错工具、生成错误参数、重复调用 | 收紧 Schema、改进描述、限制循环次数并进行评测 |

业务失败不应伪装成“调用成功，文本里写失败”，也不应一律抛成 JSON-RPC 协议异常。规范允许工具执行错误通过 `isError: true` 返回，这样模型可以根据明确的错误信息修正参数；而找不到工具或消息结构非法才属于协议层错误。

所有自动重试都要同时满足三个条件：操作幂等、错误可恢复、重试次数有界。创建订单等非幂等工具必须使用业务幂等键，不能让模型自行决定重复调用。

## 八、安全边界：MCP Server 不是可信内网接口的同义词

### 1. 工具描述和结果都视为不可信输入

恶意 Server 可以在工具描述或返回文本中注入“忽略系统指令”“调用另一个高权限工具”等内容。Host 应只连接受信 Server，对工具结果限制大小和内容类型，并避免把未经处理的结果拼接到高权限系统提示词中。

### 2. 写操作保留 Human-in-the-Loop

删除、支付、发信、生产变更等工具应展示真实参数、影响范围和目标系统，要求用户确认。工具注解只能作为 UI 提示，不能代替服务端权限校验。

### 3. HTTP 授权必须绑定目标资源

在 MCP 2025-11-25 中，受保护的 HTTP MCP Server 是 OAuth Resource Server，Client 是 OAuth Client。Client 获取 Token 时应携带目标 `resource`，Server 必须验证 Token 确实签发给自己。

MCP Server 调用下游业务 API 时，必须获取面向下游的新 Token，不能把 Client 传来的 Token 原样透传。Token 透传会破坏 audience 边界，形成 confused deputy 风险，也让下游无法正确审计真实调用方。

### 4. Streamable HTTP 防止 DNS Rebinding

Server 必须校验 `Origin`，本地服务应只监听 `127.0.0.1`，远程服务应启用认证和 TLS。否则恶意网页可能通过 DNS Rebinding 访问开发者机器上的本地 MCP Server。

### 5. 身份信息不能只靠 Prompt

“当前用户是管理员”不能作为自然语言混在 Prompt 中交给模型判断。租户、用户、角色和审批状态应来自后端认证上下文，并在真正执行工具前由确定性代码校验。Spring AI 的 `ToolContext` 数据不会发送给模型，适合承载本地执行上下文；远程 Server 需要的身份仍应通过受保护的传输或明确、可校验的协议字段传递。

## 九、可观测性要覆盖完整工具循环

只记录一次模型请求耗时，无法解释 Agent 为什么慢。建议为每次调用生成统一 trace，并至少记录：

- 协商后的 MCP 协议版本与 Server 标识；
- 模型选择的工具名称，不记录完整敏感参数；
- `tools/list` 与 `tools/call` 的耗时、状态和错误层次；
- 工具调用次数、模型循环轮数和总 Token 使用量；
- 人工审批结果、操作者与业务幂等键；
- 超时、取消、限流、重试和熔断次数。

日志中应对手机号、身份证、Token、订单备注等字段脱敏。工具返回可能比用户输入包含更多敏感信息，不应为了排障默认记录完整响应。

发布前还应建立固定评测集，至少覆盖：不该调用工具的问题、应该调用但参数不完整的问题、工具返回业务错误、恶意 Prompt Injection、重复调用和高风险操作未确认等场景。

## 十、常见误区与踩坑

### 1. 把 MCP 等同于 Function Calling

Function Calling 通常描述模型与单个应用之间的工具请求格式；MCP 还定义了 Client-Server 架构、能力发现、版本协商、生命周期和传输。两者可以配合使用，不是简单替换关系。

### 2. 认为 Streamable HTTP 不使用 SSE

Streamable HTTP 统一了 MCP 端点，但 Server 仍可以选择 SSE 流式响应。被替代的是旧版“独立 SSE 端点 + 独立 POST 端点”的 HTTP+SSE 传输模型。

### 3. 自动暴露 Server 新增的所有工具

动态发现提高了扩展性，也可能扩大权限。生产环境应做 Server 与 Tool 双重白名单，工具列表变化后重新执行策略校验，而不是自动信任新工具。

### 4. 把工具超时等同于工具取消

调用方停止等待不代表远端副作用已经停止。涉及写操作时，Server 必须支持幂等、状态查询或补偿，Host 也要区分“结果未知”和“明确失败”。

### 5. 只在 Prompt 中声明“不要越权”

Prompt 是软约束，权限校验、参数边界、限流、审批和审计必须由确定性业务代码实施。

### 6. 忽略协议和框架版本差异

MCP 2025-11-25 新增了仍属实验性的 Tasks 等能力，Spring AI 版本也在持续演进。应用只能使用协商成功且 SDK 实际支持的能力，不应因为规范出现新字段就假设当前依赖已经实现。

## 十一、上线检查清单

1. 固定并记录 Spring AI、MCP SDK 与协议兼容范围。
2. 根据本地或远程场景选择 `stdio` 或 Streamable HTTP，新项目不再首选旧 HTTP+SSE。
3. 为初始化、列表发现和工具调用分别设置超时与错误指标。
4. 使用 Server 与 Tool 双重白名单，写工具默认不自动执行。
5. 对输入 Schema、输出 Schema、结果大小和内容类型进行校验。
6. HTTP 场景启用 TLS、Origin 校验、OAuth audience 校验和最小权限 Scope。
7. 禁止 Token 透传；下游 API 使用独立 Token。
8. 非幂等工具使用业务幂等键，并对结果未知设计查询与补偿。
9. 对工具参数、审批、执行结果和操作者保留脱敏审计记录。
10. 用固定评测集验证误调用、漏调用、注入攻击、业务错误和超时场景。

## 十二、总结

MCP 的价值不只是把一次 HTTP 调用包装成 JSON-RPC，而是为 Agent 与外部能力建立可协商、可发现、可演进的标准边界。Spring AI 2.0.0 可以进一步把 MCP Tool 接入 `ChatClient` 的工具调用循环，降低 Java 应用的适配成本。

生产落地的关键仍在 Host：只向模型提供当前请求真正需要的工具，用确定性代码执行权限和审批，通过规范化错误让模型可以恢复，并把 OAuth、幂等、超时、限流和审计落实到业务链路。协议让工具更容易接入，也意味着权限更容易扩散；工程设计必须让“可插拔”始终服从“可控制”。

## 参考资料

- [MCP 2025-11-25：Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- [MCP 2025-11-25：Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP 2025-11-25：Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP 2025-11-25：Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Spring AI 2.0.0：MCP Client Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-client-boot-starter-docs.html)
- [Spring AI 2.0.0：Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html)
