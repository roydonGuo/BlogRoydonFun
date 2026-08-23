---
title: Java 异常处理工程实践：分类、边界转换与资源释放
date: 2026-08-23
category: 后端开发
cover: /images/posts/java-exception-boundary-engineering-knowledge-map.webp
tags: [java, exception, error-handling, spring, observability]
excerpt: Java 异常治理的关键不是多写 try-catch，而是区分可恢复失败与编程错误，在层间完成语义转换，并用 try-with-resources、统一错误契约和一次性日志保住根因与资源边界。
---

# Java 异常处理工程实践：分类、边界转换与资源释放

<img src="/images/posts/java-exception-boundary-engineering-knowledge-map.webp" alt="Java 异常处理工程实践：分类、边界转换与资源释放知识串联图" style="border-radius: 10px;" />

Java 异常治理的关键不是多写 try-catch，而是区分可恢复失败与编程错误，在层间完成语义转换，并用 try-with-resources、统一错误契约和一次性日志保住根因与资源边界。

## 先说结论：只在能恢复或能翻译的地方捕获

异常会中断当前正常控制流，并沿调用栈向上传播，直到遇到类型匹配的 `catch`。工程上最重要的规则可以压缩为四条：

1. 能在当前层补偿、重试或返回替代结果时，捕获并恢复；
2. 跨越业务、基础设施或 HTTP 边界时，捕获并转换语义；
3. 既不能恢复也不能增加语义时，让异常继续传播；
4. 文件、连接、流等资源交给 `try-with-resources` 关闭，不手写脆弱的 `finally`。

本文以 Java SE 25 的 JLS 与 JDK API、Spring Framework 7.0.8 文档为事实基线，核对日期为 2026-08-23。示例只依赖长期稳定的异常语义，不使用预览特性。

## Throwable 体系决定编译期约束

Java 中可抛出的对象都继承 `Throwable`，公认分类如下：

| 类型 | 是否受编译期检查 | 典型含义 | 默认处理策略 |
|---|---:|---|---|
| `Error` 及其子类 | 否 | JVM 或运行环境的严重故障 | 通常不捕获，保留现场并终止或交给容器处理 |
| `RuntimeException` 及其子类 | 否 | 参数、状态、并发约束或程序缺陷 | 在明确边界转换；不要到处兜底吞掉 |
| 其他 `Exception` 子类 | 是 | 调用方有机会预期并恢复的外部失败 | 捕获处理，或通过 `throws` 纳入方法契约 |

JLS 将 `RuntimeException` 与 `Error` 体系合称为 unchecked exceptions，其余异常类属于 checked exceptions。checked 不等于“业务异常”，unchecked 也不等于“无需处理”：两者的核心差异只是编译器是否强制 catch-or-declare。

选择自定义异常基类时，应先问调用方能否在当前抽象层恢复：

```java
// 调用方可以换文件、提示用户重传：保留为 checked exception
public final class ImportFileException extends Exception {
    public ImportFileException(String message, Throwable cause) {
        super(message, cause);
    }
}

// 订单状态不允许重复支付：属于业务约束，跨多层传播更适合 runtime exception
public final class OrderStateException extends RuntimeException {
    private final String orderId;

    public OrderStateException(String orderId, String message) {
        super(message);
        this.orderId = orderId;
    }

    public String orderId() {
        return orderId;
    }
}
```

不要为了逃避 `throws`，把所有 checked exception 机械包装成 `RuntimeException`；也不要让底层 `SQLException`、`IOException` 穿透到领域接口，使业务层被基础设施细节绑死。

## 在层间做异常翻译，而不是改个名字

异常翻译的目标是把下层失败改写成当前层能理解的契约，同时保留原始 cause：

```java
public Order loadOrder(String orderId) {
    try {
        return orderRepository.findRequired(orderId);
    } catch (DataAccessException ex) {
        // 增加当前层语义并保留根因；不要只复制 ex.getMessage()
        throw new OrderLoadException(orderId, ex);
    }
}

public final class OrderLoadException extends RuntimeException {
    public OrderLoadException(String orderId, Throwable cause) {
        super("读取订单失败，orderId=" + orderId, cause);
    }
}
```

一个有效的边界转换至少完成一项工作：

- 隐藏 JDBC、HTTP SDK、文件系统等实现细节；
- 补充稳定业务标识，如 `orderId`、`taskId`，但不记录密码、Token、完整请求体；
- 把可重试、不可重试、冲突、未找到等失败分成不同类型；
- 转换为稳定的 HTTP、消息或任务状态契约。

反例是 `catch (Exception e) { throw new RuntimeException(e.getMessage()); }`：它抹掉静态类型和调用语义，还常常丢失 cause。若当前层没有恢复或翻译职责，最好的处理就是不写 `catch`。

## try-with-resources 保住主异常

实现 `AutoCloseable` 的资源可以放进 `try-with-resources`。资源会在离开语句时自动关闭；多个资源按声明的逆序关闭：

```java
public int importOrders(Path csv, DataSource dataSource) throws IOException, SQLException {
    try (BufferedReader reader = Files.newBufferedReader(csv, StandardCharsets.UTF_8);
         Connection connection = dataSource.getConnection()) {
        connection.setAutoCommit(false);
        try {
            int count = persistRows(reader, connection);
            connection.commit();
            return count;
        } catch (Exception ex) {
            connection.rollback();
            throw ex;
        }
    }
}
```

当业务代码与 `close()` 同时失败时，业务异常仍是主异常，关闭失败会进入 `getSuppressed()`。这比 `finally` 中直接 `close()` 更安全，因为后者可能用关闭异常覆盖真正根因。

诊断时不要只打印 `getMessage()`：成熟日志框架打印完整异常对象时会包含 cause 链，通常也会展示 suppressed exceptions。若要显式检查：

```java
catch (ImportFileException ex) {
    for (Throwable suppressed : ex.getSuppressed()) {
        log.warn("导入失败时资源关闭也失败", suppressed);
    }
    throw ex;
}
```

`finally` 仍适合恢复线程上下文、释放不支持 `AutoCloseable` 的状态，但不要在其中 `return` 或抛出无关新异常，否则原来的返回值或异常会被覆盖。

## HTTP 边界只暴露稳定错误契约

领域层不应知道 HTTP 状态码。Spring MVC 边界可以用 `@RestControllerAdvice` 集中把异常映射为 RFC 9457 `ProblemDetail`：

```java
@RestControllerAdvice
public final class ApiExceptionHandler {

    @ExceptionHandler(OrderStateException.class)
    ResponseEntity<ProblemDetail> handleOrderState(
            OrderStateException ex,
            HttpServletRequest request) {

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setTitle("订单状态冲突");
        problem.setDetail("当前订单状态不允许执行该操作");
        problem.setProperty("code", "ORDER_STATE_CONFLICT");
        problem.setProperty("requestId", request.getHeader("X-Request-Id"));

        // 对外不返回堆栈、类名、SQL 或内部地址
        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> handleUnexpected(Exception ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR);
        problem.setTitle("服务暂时不可用");
        problem.setProperty("code", "INTERNAL_ERROR");
        return ResponseEntity.internalServerError().body(problem);
    }
}
```

客户端应依赖稳定 `code`，不要解析可能国际化的 `detail`。服务端则在最外层未知异常处理器记录完整异常、请求 ID 和必要维度；响应只返回安全信息。

典型映射可以保持简单：

| 失败语义 | HTTP 状态 | 是否建议重试 |
|---|---:|---|
| 参数格式或校验失败 | 400 | 修正请求后再试 |
| 身份未建立 | 401 | 完成认证后再试 |
| 已认证但无权限 | 403 | 否 |
| 资源不存在 | 404 | 视业务而定 |
| 状态、版本或幂等冲突 | 409 | 读取最新状态后决定 |
| 限流 | 429 | 遵守服务端退避提示 |
| 未知服务端错误 | 500 | 仅在操作幂等且有界时重试 |

异常类型、错误码和 HTTP 状态是一份需要版本治理的接口契约。不要把所有业务失败都映射成 200，也不要把所有异常都映射成 500。

## 日志只在责任边界记录一次

“每层 catch 后 log 再 throw”会让同一根因重复打印多份堆栈，既增加日志成本，也干扰告警计数。更稳妥的分工是：

- 中间层转换异常时不重复记完整堆栈，只补充类型和上下文；
- HTTP、消息消费、定时任务等最外层责任边界记录一次最终失败；
- 业务可预期失败按 `INFO` 或 `WARN` 统计，不制造异常告警；
- 未知错误按 `ERROR` 记录完整 cause 链，并关联 traceId、requestId、任务 ID；
- 指标按稳定错误码聚合，不把动态异常消息作为标签，避免基数爆炸。

对中断异常要额外小心。捕获 `InterruptedException` 后若不能直接向上抛出，应恢复中断标记：

```java
catch (InterruptedException ex) {
    Thread.currentThread().interrupt();
    throw new TaskCancelledException("任务等待被中断", ex);
}
```

吞掉中断会让取消、关闭和线程池回收失效。`OutOfMemoryError`、`StackOverflowError` 等 `Error` 也不应被通用 `catch (Throwable)` 当作普通业务失败继续运行。

## 常见误区

### 捕获 Exception 后返回 null

调用方无法区分“确实没有数据”和“系统失败”，后续通常在更远处触发 `NullPointerException`。应返回明确的缺失语义，或传播带上下文的异常。

### 用异常代替正常分支

缓存未命中、集合为空、用户输入校验失败通常是可预期结果。高频正常分支不应依赖抛异常驱动，也不应产生错误堆栈日志。

### 只保留异常消息

异常消息不是稳定协议，也可能包含敏感数据。包装时传入 cause；对外使用稳定错误码和经过控制的说明。

### 无条件重试所有异常

参数错误、权限错误和业务冲突不会因重试自动恢复。只对明确瞬时失败重试，并同时满足幂等、次数上限、退避、抖动和整体 deadline。

### 在 finally 中 return

它会覆盖 `try` 或 `catch` 的返回与异常，使真实失败消失。代码审查和静态分析应直接禁止这一写法。

## 落地检查表

1. 自定义异常是否表达当前层语义，而不是泄漏底层实现；
2. checked/unchecked 的选择是否基于调用方可恢复性；
3. 包装异常是否保留 cause，并去除敏感字段；
4. 所有可关闭资源是否使用 `try-with-resources`；
5. HTTP、消息和任务边界是否有稳定错误码与统一映射；
6. 同一失败是否只在责任边界打印一次完整堆栈；
7. 重试是否只覆盖瞬时错误，并具备幂等与预算；
8. 中断是否向上传播或恢复线程中断标记；
9. 监控是否按错误码、边界和依赖聚合，而非动态消息；
10. 是否有用例验证 cause、suppressed、状态码与错误响应不泄密。

## 总结

Java 异常是一套跨调用栈传递失败的控制流机制，不是一种通用日志工具。先用 `Error`、unchecked 与 checked 的编译期语义理解异常体系，再把捕获点限制在“能够恢复”或“需要翻译”的边界，系统的失败路径才会清晰。

工程实现上，异常翻译要保留 cause，资源释放交给 `try-with-resources`，HTTP 边界输出稳定且安全的错误契约，完整堆栈只在最终责任边界记录一次。这样才能同时获得可恢复性、可诊断性、接口稳定性和安全边界。

## 参考资料

- [Java Language Specification SE 25：Chapter 11 Exceptions](https://docs.oracle.com/javase/specs/jls/se25/html/jls-11.html)
- [Java SE 25 API：AutoCloseable](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AutoCloseable.html)
- [Oracle Java Tutorials：try-with-resources 与 suppressed exceptions](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html)
- [Spring Framework：Error Responses 与 RFC 9457 ProblemDetail](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html)
- [Spring Framework 7.0.8 API：ResponseEntityExceptionHandler](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/servlet/mvc/method/annotation/ResponseEntityExceptionHandler.html)
