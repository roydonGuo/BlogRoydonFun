---
title: Docker BuildKit 构建缓存：从层复用到 CI 远程缓存
date: 2026-08-04
category: 后端开发
cover: /images/posts/docker-buildkit-cache-engineering-knowledge-map.webp
tags: [docker, buildkit, cache, ci-cd, java]
excerpt: 从缓存键、失效传播和 Cache Mount 出发，为 Java 镜像建立可复用、可迁移且不泄露凭据的 BuildKit 缓存链路。
---

# Docker BuildKit 构建缓存：从层复用到 CI 远程缓存

<img src="/images/posts/docker-buildkit-cache-engineering-knowledge-map.webp" alt="Docker BuildKit 构建缓存：从层复用到 CI 远程缓存知识串联图" style="border-radius: 10px;" />

从缓存键、失效传播和 Cache Mount 出发，为 Java 镜像建立可复用、可迁移且不泄露凭据的 BuildKit 缓存链路。

同一个 Spring Boot 项目，本地构建镜像可能只需十几秒，换到一次性的 CI Runner 却又要下载 Maven 依赖、重新编译和上传所有层。最常见的处理方式是继续合并 `RUN`、增加代理或直接保留整个工作目录，但这些做法往往把“构建结果复用”“依赖下载复用”和“跨机器传输”混成了同一件事。

BuildKit 的缓存不是一个目录，而是围绕构建依赖图组织的多层机制。只有先弄清缓存键由什么组成、一次失效会传播到哪里，才能让 Dockerfile 在源码频繁变化时仍然复用昂贵步骤，并让短生命周期 CI 从远端取回缓存。

> 本文以 **Dockerfile 稳定语法 `docker/dockerfile:1`、Docker Buildx 与 BuildKit** 为适用范围，能力与后端状态核对时间为 **2026-08-04**。不同 Docker Engine、Buildx、Builder Driver 和容器镜像存储组合支持的远程缓存后端可能不同，上线前应以 `docker buildx inspect` 和当前 Docker 官方文档为准。

## 一、先区分三类缓存

工程中常说的“Docker 构建缓存”至少包含三种不同对象。

| 类型 | 保存什么 | 命中条件 | 失效后会怎样 | 主要用途 |
|---|---|---|---|---|
| 指令/结果缓存 | 某个构建操作及其不可变结果 | 操作定义和输入依赖可匹配 | 当前节点重新执行，下游节点继续失效 | 跳过完整的 `COPY`、`RUN` 等步骤 |
| Cache Mount | Maven、npm、apt、编译器等可变缓存目录 | 通过 `id`、目标路径和 Builder 状态找到 | 步骤仍会执行，但只补齐缺失内容 | 降低依赖下载与增量编译成本 |
| 外部缓存 | 可导入、导出的 BuildKit 缓存记录 | CI 显式配置 `cache-from` | 本地仍能构建，只是命中率下降 | 在 Runner、分支和开发机之间迁移缓存 |

三者不能互相替代。指令缓存命中时，整个 Maven 构建步骤不会运行；指令缓存失效时，Cache Mount 仍可让 Maven 复用 `.m2` 中已有的依赖；外部缓存则负责把前两类可复用结果带到新的 Builder。

一个可靠的设计应同时满足：

```text
输入未变化       → 直接命中构建结果
输入发生变化     → 步骤重跑，但依赖缓存仍可复用
Builder 被销毁   → 从外部缓存恢复可复用记录
缓存全部丢失     → 构建仍然正确，只是变慢
```

最后一条尤其重要：**缓存只能优化性能，不能成为构建正确性的前置条件**。

## 二、BuildKit 按依赖图计算缓存

BuildKit 会把 Dockerfile 前端转换为 LLB（Low-Level Build）构建定义。它不是简单地从第一行向下寻找旧镜像，而是根据操作、输入内容、挂载和前置节点形成内容寻址的依赖图。

可以把一个构建节点的缓存键抽象为：

```text
cacheKey = hash(
  操作类型与参数,
  前置节点结果,
  参与计算的文件元数据与内容,
  构建参数、平台和挂载描述
)
```

这不是 Docker 对外承诺的精确序列化公式，但能帮助理解三个事实：

1. 相同的 `RUN` 文本不代表任何环境下都能共用结果，基础镜像和上游节点也是输入；
2. `COPY` 的文件集合变化会改变当前节点，并让依赖它的后续节点重新执行；
3. 多阶段构建不是把缓存切断，每个 Stage 仍是整张构建图的一部分，未受影响的分支可以继续复用。

BuildKit 还能并行求解互不依赖的节点，并跳过最终产物不需要的阶段。优化 Dockerfile 的重点因此不是机械减少行数，而是让**昂贵、稳定的依赖节点尽量靠前，让高频变化的源码节点尽量靠后**。

## 三、完整理解缓存失效规则

### 1. `COPY`、`ADD` 与构建时 Bind Mount

`COPY`、`ADD` 以及 `RUN --mount=type=bind` 会根据参与文件的元数据计算校验。文件内容、大小或路径等相关输入变化会造成缓存失效；单独改变文件的 `mtime` 不会使缓存失效。

因此下面的写法会让任何源码、README 或本地日志变化都提前打掉 Maven 依赖层：

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

# 反例：在解析依赖之前复制整个上下文，失效范围过大
COPY . .
RUN mvn -B -ntp -DskipTests package
```

### 2. 普通 `RUN` 不会因为外部仓库更新而自动失效

对普通 `RUN`，Builder 不会检查容器内部被命令读取的所有文件，也不会因为软件源出现新版本就自动重新执行。例如一周后再次运行相同的 `RUN apt-get update`，只要缓存键未变化，仍可能直接复用旧结果。

需要定期刷新依赖时，应把更新策略显式放进流程：更新锁文件或基础镜像摘要，按阶段使用 `--no-cache-filter`，或者由受控的构建参数触发失效。不要每次都用全局 `--no-cache`，它会把无关的稳定层一并放弃。

### 3. `ARG`、`ENV` 与基础镜像也是输入

真正参与后续操作的构建参数发生变化时，相应节点会失效。`ENV` 还会写入镜像配置，不应拿来传递密码。基础镜像引用虽然写在 `FROM` 中，但本地已有缓存并不等于远端标签已经刷新；需要检查更新时，可结合镜像摘要管理和受控的 `--pull` 策略。

### 4. Secret 内容不参与缓存键

Build Secret 的内容变化不会自动使缓存失效，Secret 的 ID 或挂载描述变化则可能影响缓存。如果私服 Token 更新后必须重新执行下载步骤，应另外传入不含敏感值的版本号作为 cache-bust 参数。

更关键的是，凭据只能通过 `--secret` 或 `--ssh` 提供，不能先 `COPY settings.xml`，也不能把 Token 放入 `ARG`。否则凭据可能进入镜像层、构建记录或外部缓存。

### 5. 一次失效会沿下游传播

一个节点缓存未命中后，依赖其结果的后续节点都需要重新求解。优化的核心不是追求“永不失效”，而是缩小每种变更影响的子图：只改 Java 源码时，不应重新解析 `pom.xml`；只改运行时配置时，不应重做编译阶段。

## 四、Java 项目的缓存友好 Dockerfile

下面以 Maven Wrapper 和 Java 21 为例，把依赖描述、源码构建与运行时镜像分开。基础镜像标签用于展示结构，生产环境还应按组织策略固定可审计的镜像版本或摘要。

```dockerfile
# syntax=docker/dockerfile:1

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

# 依赖描述变化频率低，先单独复制以扩大命中范围
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw

# Cache Mount 不会进入镜像层；sharing=locked 避免并行写入同一 Maven 仓库
RUN --mount=type=cache,id=maven-repository,target=/root/.m2,sharing=locked \
    ./mvnw -B -ntp -DskipTests dependency:go-offline

# 源码变化只让这里及其下游失效，不会重新创建前面的依赖结果层
COPY src/ src/
RUN --mount=type=cache,id=maven-repository,target=/root/.m2,sharing=locked \
    ./mvnw -B -ntp -DskipTests package

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

# 运行镜像只接收最终产物，不携带 Maven、本地仓库和源码
COPY --from=build /workspace/target/app.jar app.jar

# 使用非 root 用户运行，避免把构建阶段权限带入生产容器
RUN useradd --system --uid 10001 appuser
USER 10001

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

这里存在两级复用：

- `pom.xml` 没变时，`dependency:go-offline` 的结果节点可以直接命中；
- `pom.xml` 变化导致该节点重跑时，`/root/.m2` Cache Mount 仍可能保留已经下载的依赖，只补充新增或更新部分。

`sharing` 有三种模式：

| 模式 | 并行构建行为 | 适用情况 |
|---|---|---|
| `shared` | 多个写入者并发使用同一缓存 | 工具能安全处理并发写入 |
| `private` | 并发写入者获得不同缓存 | 更看重隔离，接受额外空间 |
| `locked` | 后到写入者等待前一个释放 | apt、本地仓库等需要排他写入的目录 |

Maven 本地仓库常用 `locked` 以减少并发构建对同一文件的竞争，但这也可能让同一 Builder 上的多个任务排队。应结合 Runner 并发度和缓存隔离要求选择，而不是把示例参数当作固定答案。

## 五、用 `.dockerignore` 缩小输入边界

构建上下文越大，上传给远端 Builder 的数据越多，也越容易把无关变化纳入 `COPY` 的输入。Java 项目至少应评估以下内容：

```text
.git
.idea
.vscode
target
*.log
.env
docker-compose*.yml
docs
```

这份清单不能直接照搬：如果镜像构建确实需要 `docs` 或 Compose 文件，就不能排除。更稳妥的方法是从 Dockerfile 的实际输入反推上下文，只保留编译和打包需要的文件。

还要注意两个边界：

1. `.dockerignore` 防止文件进入构建上下文，但不等于完整的秘密扫描；
2. 多个 Dockerfile 的输入差异很大时，可以使用 Dockerfile 专属 ignore 文件，避免一份全局规则被迫兼容所有镜像。

## 六、Cache Mount、Bind、Secret 和镜像层各司其职

`RUN --mount` 提供多种挂载类型，容易因语法相似而误用。

| 挂载类型 | 生命周期与持久性 | 典型用途 | 能否进入最终镜像 |
|---|---|---|---|
| `bind` | 只在当前 `RUN` 可见，默认只读 | 临时读取大体积源码或其他 Stage 的文件 | 挂载内容不会自动进入层，只保留命令输出 |
| `cache` | 可跨构建累积，但可能被 GC 清理 | Maven `.m2`、npm、编译器缓存 | 缓存目录本身不进入层 |
| `tmpfs` | 当前步骤内存临时文件系统 | 不希望落盘的中间数据 | 不进入层 |
| `secret` | 当前步骤以文件或环境变量临时暴露 | 仓库 Token、私服配置 | 不应进入层或缓存 |
| `ssh` | 当前步骤访问 SSH Agent | 拉取私有 Git 依赖 | 私钥不进入层 |

如果构建产物写在 Bind Mount 的目标目录中，步骤结束后写入内容会被丢弃。需要保留的 JAR 应写到普通工作目录，再通过多阶段 `COPY --from` 进入运行镜像。

Cache Mount 的内容也不应被当成可信产物。它可能来自其他分支、被并发任务改写，或被 BuildKit 垃圾回收。包管理器必须通过校验和、签名或锁文件验证依赖，构建脚本则应能在空缓存下完成。

## 七、CI 中把缓存导出到 Registry

一次性 Runner 没有长期存在的本地 Builder，必须显式使用 `--cache-from` 导入、用 `--cache-to` 导出。Registry 后端适合已经具备 OCI Registry 的团队：

```bash
# 分支缓存优先命中，同时把 main 作为稳定的回退来源
docker buildx build \
  --platform linux/amd64 \
  --tag registry.example.com/mall/order-service:${GIT_SHA} \
  --cache-from type=registry,ref=registry.example.com/mall/order-cache:${BRANCH_KEY} \
  --cache-from type=registry,ref=registry.example.com/mall/order-cache:main \
  --cache-to type=registry,ref=registry.example.com/mall/order-cache:${BRANCH_KEY},mode=max \
  --push .
```

`cache-from` 可以指定多个来源，适合“当前分支优先、主分支兜底”。`cache-to` 的 `mode` 则决定导出范围：

- `mode=min`：默认只导出最终结果涉及的层，体积和传输成本更低；
- `mode=max`：连中间阶段缓存也导出，更适合依赖和编译阶段较重的多阶段 Java 构建。

远程缓存不是越大越好。`mode=max` 能提高命中率，也会增加上传时间、Registry 空间和网络费用。应同时观察构建时长、缓存上传时长、命中字节数与存储增长，再决定导出粒度。

不同分支不能无条件写入同一个缓存引用。Docker 官方文档提醒，同一缓存位置被再次导出时会覆盖原有状态。建议使用经过转义和长度限制的 `BRANCH_KEY` 分域写入，并让功能分支读取 `main`；合并完成后再按保留策略清理旧分支缓存。

## 八、安全边界：缓存也属于供应链

构建缓存会跨任务、跨机器甚至跨仓库流动，因此要把它视为软件供应链的一部分。

### 1. 不让不可信任务回写共享缓存

来自 Fork 的 Pull Request 可以读取有限的公共缓存，但不应获得生产 Registry 写权限，也不应覆盖 `main` 的缓存引用。可信主分支负责发布共享缓存，不可信任务使用只读或隔离的临时作用域。

### 2. 不把秘密写进层和缓存

下面的写法即使随后删除文件也不安全，因为秘密可能仍存在于历史层或导出的缓存中：

```dockerfile
# 反例：ARG、COPY 和后续 rm 都不能抹掉已进入旧层的秘密
ARG MAVEN_TOKEN
COPY settings.xml /root/.m2/settings.xml
RUN mvn -B package && rm /root/.m2/settings.xml
```

正确做法是用 Secret Mount：

```dockerfile
# settings.xml 只在当前步骤可见，不写入构建结果层
RUN --mount=type=secret,id=maven-settings,target=/root/.m2/settings.xml,required=true \
    --mount=type=cache,id=maven-repository,target=/root/.m2/repository,sharing=locked \
    ./mvnw -B -ntp -DskipTests package
```

```bash
# CI 从受控文件或环境提供 secret，不把实际内容放进 Dockerfile
docker buildx build \
  --secret id=maven-settings,src=/run/ci-secrets/settings.xml \
  --tag registry.example.com/mall/order-service:${GIT_SHA} .
```

### 3. 缓存命中不等于产物可信

镜像仍应进行 SBOM、漏洞扫描、签名或来源证明等组织级校验。缓存优化解决的是重复计算，不负责证明依赖来源、基础镜像新鲜度或产物没有被篡改。

## 九、如何诊断“为什么没有命中”

不要只凭总耗时判断缓存。把构建输出切到明细模式：

```bash
docker buildx build --progress=plain --load .
```

逐个节点观察 `CACHED`、重新传输的构建上下文和实际执行的命令，再按以下顺序排查：

1. **Builder 是否相同**：本地切换 Builder 后，内部缓存不会自动共享；
2. **是否成功导入外部缓存**：检查 Registry 鉴权、引用和 Driver 对后端的支持；
3. **最早失效节点是什么**：真正原因通常在第一个未命中的节点，而不是最后变慢的 `RUN`；
4. **输入边界是否过宽**：检查过早的 `COPY . .`、动态生成文件和未排除的构建产物；
5. **参数与平台是否变化**：目标架构、基础镜像、`ARG` 和 Dockerfile Frontend 都可能改变构建图；
6. **缓存是否被 GC**：本地空间策略可能清理未使用记录，Cache Mount 也不保证永久存在。

如果只需要刷新某个阶段，可使用 `--no-cache-filter <stage>`；只有需要验证完全冷启动或处理明确的缓存污染时，才使用全局 `--no-cache` 或清理 Builder 缓存。

## 十、常见误区与最佳实践

### 误区 1：Dockerfile 行数越少，缓存越好

合并命令可以减少层，但也会扩大单个节点的责任。缓存优化看的是依赖边界和变化频率，不是单纯追求最少行数。

### 误区 2：有 Cache Mount 就不需要拆分 `COPY`

Cache Mount 只能降低步骤重跑的成本，不能让已经失效的 Maven 步骤直接跳过。依赖描述和源码仍应分层复制。

### 误区 3：缓存能保证依赖永远最新

普通 `RUN` 不会因为远端软件仓库更新而自动失效。依赖更新应由锁文件、版本升级、基础镜像摘要或受控刷新任务驱动。

### 误区 4：所有分支共用一个可写缓存最省空间

并发覆盖会降低稳定性，不可信分支还可能污染共享缓存。采用分支写入、主分支回退读取，并设置生命周期策略更稳妥。

### 误区 5：构建成功就说明秘密没有泄露

秘密即使未出现在最终容器文件系统，也可能留在中间层、历史记录或远程缓存。必须使用 `secret`、`ssh` 等专用挂载。

落地时可以遵循这组顺序：

1. 先记录冷构建、热构建和仅修改源码时的基线；
2. 用 `.dockerignore` 缩小上下文；
3. 按变化频率拆分 `COPY`，把依赖描述放在源码之前；
4. 为包管理器增加 Cache Mount，但保证空缓存仍能成功；
5. 用多阶段构建隔离构建工具和运行产物；
6. 在短生命周期 CI 中配置外部缓存，并划分可信写入边界；
7. 用明细日志、存储占用和命中率持续验证收益。

## 十一、总结

Docker BuildKit 缓存的关键不是“把某个目录留下来”，而是管理构建依赖图的稳定边界。指令缓存负责跳过完全相同的操作，Cache Mount 负责降低必要重跑的下载与编译成本，外部缓存负责在 Builder 之间迁移可复用结果。

对 Java 项目而言，最有效的组合通常是：先复制 Maven Wrapper 与 `pom.xml`，用 Cache Mount 保存本地仓库，再复制高频变化的源码；随后通过多阶段构建只交付 JAR，并在 CI 中按分支导入、导出 Registry 缓存。与此同时，缓存必须可丢弃、秘密必须走专用挂载、不可信任务不能回写共享作用域。

当冷缓存仍然正确、热缓存确实更快、失效原因能够被解释时，这套构建链路才算真正可维护。

## 参考资料

- [Docker Docs：BuildKit](https://docs.docker.com/build/buildkit/)
- [Docker Docs：Build cache invalidation](https://docs.docker.com/build/cache/invalidation/)
- [Docker Docs：Optimize cache usage in builds](https://docs.docker.com/build/cache/optimize/)
- [Docker Docs：Cache storage backends](https://docs.docker.com/build/cache/backends/)
- [Dockerfile reference：RUN --mount](https://docs.docker.com/reference/dockerfile/#run---mount)
