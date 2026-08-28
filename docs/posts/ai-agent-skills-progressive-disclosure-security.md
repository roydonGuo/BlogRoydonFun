---
title: AI Agent Skills 工程实践：渐进式披露、运行契约与安全边界
date: 2026-08-28
category: AI
cover: /images/posts/ai-agent-skills-progressive-disclosure-security-knowledge-map.webp
tags: [agent, skills, context-engineering, security, java]
excerpt: Agent Skill 不是一段更长的系统提示词，而是可发现、按需加载、受控执行的能力包。本文讲清 SKILL.md 契约、三级渐进式披露，以及 Java 宿主如何落实校验、权限、隔离、超时和审计。
---

# AI Agent Skills 工程实践：渐进式披露、运行契约与安全边界

<img src="/images/posts/ai-agent-skills-progressive-disclosure-security-knowledge-map.webp" alt="AI Agent Skills 工程实践：渐进式披露、运行契约与安全边界知识串联图" style="border-radius: 10px;" />

Agent Skill 不是一段更长的系统提示词，而是可发现、按需加载、受控执行的能力包。本文讲清 SKILL.md 契约、三级渐进式披露，以及 Java 宿主如何落实校验、权限、隔离、超时和审计。

## 先给结论：Skill 管知识，宿主管权力

一个可上线的 Skill 应把职责分成两半：

- Skill 负责描述何时启用、该怎么做、需要哪些脚本与参考资料；
- Agent 宿主负责路径校验、权限审批、进程隔离、资源限制、审计与最终执行。

模型读取到“运行删除脚本”并不构成授权，`allowed-tools` 也不能替代操作系统权限。正确链路应是：

```text
任务 → 元数据匹配 → 加载 SKILL.md → 按需读资源 → 生成执行提案
                                                     ↓
                                         策略校验 / 人工批准
                                                     ↓
                                           沙箱执行 / 结果回传
```

本文以 [Agent Skills 官方规范](https://agentskills.io/specification) 为基线，核对日期为 2026-08-28。规范仍在演进，尤其 `allowed-tools` 被标为实验性字段；生产系统不能把某个客户端的扩展行为误写成通用标准。

## Skill 的最小契约

Agent Skills 是一个目录格式，最少只要求 `SKILL.md`；脚本、参考资料和静态资产都是可选项：

```text
order-audit/
├── SKILL.md
├── scripts/
│   └── export-orders.ps1
├── references/
│   ├── fields.md
│   └── failure-policy.md
└── assets/
    └── report-template.md
```

`SKILL.md` 由 YAML frontmatter 和 Markdown 正文组成：

```markdown
---
name: order-audit
description: 审计订单状态并生成报告。用户要求核对订单、导出异常订单或生成审计报告时使用。
compatibility: Requires PowerShell 7 and read-only access to the reporting database.
metadata:
  owner: commerce-platform
  version: "1.3.0"
---

# Order Audit

1. 先读取 `references/fields.md`，确认字段语义。
2. 只查询用户授权的租户和时间范围。
3. 生成执行提案；导出文件前请求批准。
4. 失败时按 `references/failure-policy.md` 分类返回。
```

官方规范要求 `name` 与父目录名一致，只能使用小写字母、数字和连字符，长度不超过 64；`description` 必须说明“做什么”以及“何时使用”，长度不超过 1024。`license`、`compatibility`、`metadata` 和实验性的 `allowed-tools` 可选。完整约束应以[规范源码](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx)为准。

这里有两个容易混淆的边界：

1. `metadata.version` 是作者自定义元数据，不是当前规范强制的顶层版本字段；
2. `compatibility` 只声明环境要求，不会自动安装依赖或授予网络、文件、数据库权限。

## 渐进式披露解决的是上下文预算，不是权限

官方文档把加载过程分为三级：

| 阶段 | 加载内容 | 目的 |
| --- | --- | --- |
| 发现 | 所有 Skill 的 `name`、`description` | 用很小的上下文判断候选能力 |
| 激活 | 命中 Skill 的完整 `SKILL.md` | 获取步骤、约束和资源入口 |
| 执行 | 当前步骤需要的脚本、参考或资产 | 避免一次塞入全部资料 |

因此不要把 200 页运维手册、全部 API 示例和故障字典都复制进 `SKILL.md`。主文件保留稳定流程和路由规则，细节拆到 `references/`，确定要执行时再读取 `scripts/`。官方建议主文件低于 500 行，并让文件引用保持浅层。

渐进式披露只回答“现在需要把什么放进上下文”，不回答“模型能不能执行它”。一个危险脚本即使最后一刻才加载，仍然危险；权限必须由上下文之外的确定性策略控制。

## 先定义 Java 运行契约

下面实现一个宿主侧加载器。先定义数据、权限和失败类型，再进入文件读取与执行逻辑：

```java
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;

public record SkillMetadata(
        String name,
        String description,
        String compatibility,
        Map<String, String> metadata
) {}

public record InstalledSkill(
        Path root,
        SkillMetadata metadata,
        String instructions,
        String sha256
) {}

public record ParsedSkill(
        SkillMetadata metadata,
        String body
) {}

public enum Capability {
    READ_WORKSPACE,
    WRITE_WORKSPACE,
    NETWORK,
    START_PROCESS
}

public record ExecutionPolicy(
        Set<Capability> granted,
        Set<Path> readableRoots,
        Set<Path> writableRoots,
        Set<String> allowedCommands,
        Duration timeout,
        int maxOutputBytes,
        Map<String, String> environment
) {}

public record ExecutionRequest(
        String skillName,
        String command,
        List<String> arguments,
        Path workingDirectory,
        boolean requiresApproval
) {}

public record ExecutionResult(
        int exitCode,
        String output
) {}

public interface ApprovalService {
    boolean approve(ExecutionRequest request);
}

public interface AuditSink {
    void record(
            ExecutionRequest request,
            java.time.Instant startedAt,
            java.time.Instant finishedAt,
            int exitCode
    );
}

public interface FrontmatterParser {
    // 实现应使用 YAML 安全模式，并禁止任意类型反序列化。
    ParsedSkill parse(String markdown);
}

public sealed class SkillException extends RuntimeException
        permits SkillFormatException, SkillPolicyException, SkillExecutionException {
    protected SkillException(String message) {
        super(message);
    }
}

public final class SkillFormatException extends SkillException {
    public SkillFormatException(String message) { super(message); }
}

public final class SkillPolicyException extends SkillException {
    public SkillPolicyException(String message) { super(message); }
}

public final class SkillExecutionException extends SkillException {
    public SkillExecutionException(String message) { super(message); }
}
```

`InstalledSkill` 保存安装时校验过的内容哈希，便于发现目录被替换；`ExecutionPolicy` 来自宿主配置或用户审批，不能从 Skill 正文反向生成。Skill 可以申请能力，但不能批准自己。

## 安全加载：规范校验之外还要约束路径

加载器至少检查名称、目录一致性、文件大小、编码、路径逃逸和内容哈希。YAML 解析应使用安全模式并禁止任意类型反序列化；下面省略具体 YAML 库，只展示不会随框架变化的边界：

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.regex.Pattern;

public final class SkillLoader {
    private static final Pattern NAME =
            Pattern.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$");
    private static final int MAX_SKILL_BYTES = 256 * 1024;

    private final Path trustedSkillRoot;
    private final FrontmatterParser parser;

    public SkillLoader(Path trustedSkillRoot, FrontmatterParser parser) throws IOException {
        this.trustedSkillRoot = trustedSkillRoot.toRealPath();
        this.parser = java.util.Objects.requireNonNull(parser, "parser");
    }

    public InstalledSkill load(Path candidate) {
        try {
            Path root = candidate.toRealPath(LinkOption.NOFOLLOW_LINKS);
            if (!root.startsWith(trustedSkillRoot)) {
                throw new SkillPolicyException("Skill 目录越过可信根目录");
            }

            Path skillFile = root.resolve("SKILL.md").normalize();
            if (!skillFile.startsWith(root) || Files.isSymbolicLink(skillFile)) {
                throw new SkillPolicyException("SKILL.md 路径非法或为符号链接");
            }

            long size = Files.size(skillFile);
            if (size <= 0 || size > MAX_SKILL_BYTES) {
                throw new SkillFormatException("SKILL.md 大小不合法");
            }

            byte[] bytes = Files.readAllBytes(skillFile);
            String markdown = new String(bytes, StandardCharsets.UTF_8);
            ParsedSkill parsed = parser.parse(markdown);
            validate(parsed.metadata(), root.getFileName().toString());

            String sha256 = HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(bytes));
            return new InstalledSkill(root, parsed.metadata(), parsed.body(), sha256);
        } catch (IOException e) {
            throw new SkillFormatException("读取 Skill 失败：" + e.getMessage());
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static void validate(SkillMetadata metadata, String directoryName) {
        String name = metadata.name();
        if (name == null || name.length() > 64 || !NAME.matcher(name).matches()) {
            throw new SkillFormatException("name 不符合规范");
        }
        if (!name.equals(directoryName)) {
            throw new SkillFormatException("name 必须与目录名一致");
        }
        String description = metadata.description();
        if (description == null || description.isBlank() || description.length() > 1024) {
            throw new SkillFormatException("description 不符合规范");
        }
    }
}
```

生产代码还应拒绝 `references/../../secret.txt` 一类相对路径。每次读取资源时都先 `resolve(...).normalize()`，再检查结果仍位于 Skill 根目录；若系统允许符号链接，还要用真实路径再次校验，避免 TOCTOU 和链接逃逸。

## 受控执行：参数数组、最小环境和硬超时

不要把模型生成的字符串交给 `sh -c`、`cmd /c` 或 PowerShell 动态解释。宿主应从白名单选择可执行文件，并把参数作为数组传入：

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.concurrent.TimeUnit;

public final class SkillProcessRunner {
    public ExecutionResult run(
            ExecutionRequest request,
            ExecutionPolicy policy,
            ApprovalService approvals,
            AuditSink auditSink
    ) {
        if (!policy.granted().contains(Capability.START_PROCESS)) {
            throw new SkillPolicyException("未授予进程执行能力");
        }
        if (!policy.allowedCommands().contains(request.command())) {
            throw new SkillPolicyException("命令不在白名单");
        }
        if (request.requiresApproval() && !approvals.approve(request)) {
            throw new SkillPolicyException("用户未批准执行");
        }

        ArrayList<String> command = new ArrayList<>();
        command.add(request.command());
        command.addAll(request.arguments());

        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(request.workingDirectory().toFile());
        builder.environment().clear();
        builder.environment().putAll(policy.environment());
        builder.redirectErrorStream(true);

        Instant startedAt = Instant.now();
        try {
            Process process = builder.start();
            boolean completed = process.waitFor(
                    policy.timeout().toMillis(), TimeUnit.MILLISECONDS);
            if (!completed) {
                process.destroyForcibly();
                throw new SkillExecutionException("执行超时，进程已终止");
            }

            byte[] output = process.getInputStream()
                    .readNBytes(policy.maxOutputBytes() + 1);
            if (output.length > policy.maxOutputBytes()) {
                throw new SkillExecutionException("输出超过限制");
            }

            ExecutionResult result = new ExecutionResult(
                    process.exitValue(),
                    new String(output, StandardCharsets.UTF_8));
            auditSink.record(request, startedAt, Instant.now(), result.exitCode());
            return result;
        } catch (IOException e) {
            throw new SkillExecutionException("启动失败：" + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new SkillExecutionException("执行被中断");
        }
    }
}
```

真实隔离不能只靠 `ProcessBuilder`：高风险脚本应放入低权限系统账号、容器或受限作业环境，分别限制文件挂载、网络出口、CPU、内存和运行时间。密钥通过短期凭证注入，不写入 `SKILL.md`、参数、日志或模型上下文。

## 安全清单：把 Skill 当第三方代码包

Skill 同时包含自然语言指令和可执行资产，应采用软件供应链级治理：

1. **来源固定**：只从批准的仓库或内部注册表安装，记录提交哈希与发布者；
2. **内容校验**：安装时计算整目录清单哈希，运行前检查是否漂移；
3. **静态审查**：扫描脚本、下载行为、混淆命令、秘密读取和危险路径；
4. **能力分离**：只读 Skill 不应获得写权限，需要网络的 Skill 不默认访问全部域名；
5. **副作用审批**：删除、覆盖、提交、推送、付款、发消息等动作在执行前单独批准；
6. **输出不可信**：脚本输出、网页内容和参考文件都可能包含提示注入，回传模型前做长度、类型和敏感信息过滤；
7. **全链路审计**：记录 Skill 名称与哈希、触发原因、读取资源、执行提案、批准人、退出码和产物摘要；
8. **可撤销**：支持禁用、回滚和吊销，不让旧会话继续使用已下架版本。

当前官方格式规范定义的是可移植目录契约，并未替宿主规定完整沙箱或供应链方案。社区中的签名、分发等提案在合入规范前都只能视为提案，不能据此宣称“符合 Agent Skills 就天然安全”。

## 可观测性：不仅看是否执行成功

建议至少记录以下指标：

| 指标 | 发现的问题 |
| --- | --- |
| `skill_activation_total{skill,result}` | 描述过宽导致误触发，或描述过窄导致漏触发 |
| `skill_resource_load_bytes{skill,type}` | 参考资料过大，渐进式披露失效 |
| `skill_approval_total{skill,decision}` | 高风险能力频繁申请或拒绝 |
| `skill_execution_seconds{skill,command}` | 脚本变慢、外部依赖抖动 |
| `skill_execution_total{skill,exit_code}` | 失败类型和版本回归 |
| `skill_output_truncated_total{skill}` | 输出失控，可能污染上下文 |

日志不要保存完整提示词、密钥和未经脱敏的业务数据。排障所需的关联信息用 `traceId`、Skill 哈希、参数摘要和产物哈希表达即可。

## 上线顺序

落地时按以下顺序推进：

1. 先写清单一任务、触发条件、输入输出和失败边界；
2. 把 `SKILL.md` 控制在稳定流程，细节拆入浅层参考文件；
3. 用官方校验器或等价规则检查目录格式；
4. 在无网络、只读文件系统中跑通最小用例；
5. 再逐项开放写入、网络和进程能力，并为副作用增加审批；
6. 建立版本固定、哈希、回归样例、审计和撤销机制；
7. 最后才扩大触发描述和安装范围。

Skill 的价值不是让模型“知道更多”，而是把团队经验变成可发现、可复用、可审计的运行单元。渐进式披露控制上下文，明确契约控制行为，而真正的安全必须由模型之外的宿主策略兜底。
