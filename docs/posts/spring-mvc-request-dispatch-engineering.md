---
title: Spring MVC 请求链路工程实践：DispatcherServlet、映射、适配与异常回写
date: 2026-08-24
category: 后端开发
cover: /images/posts/spring-mvc-request-dispatch-engineering-knowledge-map.webp
tags: [spring, spring-mvc, servlet]
excerpt: Spring MVC 的请求处理不是 Controller 前后两次拦截，而是一条由 DispatcherServlet 统筹、HandlerMapping 定位、HandlerAdapter 调用、参数与返回值处理器完成协议转换、异常解析器统一收口的分派链。本文讲清 REST 与视图渲染的分叉、拦截器时序和工程扩展边界。
---

# Spring MVC 请求链路工程实践：DispatcherServlet、映射、适配与异常回写

<img src="/images/posts/spring-mvc-request-dispatch-engineering-knowledge-map.webp" alt="Spring MVC 请求链路工程实践：DispatcherServlet、映射、适配与异常回写知识串联图" style="border-radius: 10px;" />

Spring MVC 的请求处理不是 Controller 前后两次拦截，而是一条由 DispatcherServlet 统筹、HandlerMapping 定位、HandlerAdapter 调用、参数与返回值处理器完成协议转换、异常解析器统一收口的分派链。本文讲清 REST 与视图渲染的分叉、拦截器时序和工程扩展边界。

## 先说结论：DispatcherServlet 只负责调度

Spring MVC 采用前端控制器模式。Servlet 容器先把匹配的 HTTP 请求交给 `DispatcherServlet`，它不直接执行业务方法，而是依次寻找并调用一组策略组件：

```text
Servlet Filter
  → DispatcherServlet
  → HandlerMapping：找到处理器和拦截器链
  → HandlerAdapter：以处理器支持的方式执行
  → 参数解析、类型转换、校验
  → Controller 方法
  → 返回值处理
      ├─ REST：HttpMessageConverter 写响应体
      └─ MVC：ViewResolver 找视图并渲染
  → HandlerExceptionResolver：异常时尝试生成错误响应
  → afterCompletion：请求完成回调
```

这种分层让调度器不必知道处理器是注解方法、传统 `Controller` 还是其他类型，也不必把 JSON、视图、异步响应和异常处理写成一段巨型条件分支。

本文以 Spring Framework 7.0.8 的 Servlet 栈文档与 API 为事实基线，核对日期为 2026-08-24。Spring WebFlux 使用 `DispatcherHandler` 和响应式链路，不属于本文范围。

## 一、请求到达 DispatcherServlet 之前

请求先经过 Servlet 容器的 Filter 链，再进入 `DispatcherServlet`。两者的边界不能混淆：

| 组件 | 所属体系 | 能看到的范围 | 典型职责 |
|---|---|---|---|
| `Filter` | Jakarta Servlet | 进入某个 Servlet 前后的原始请求与响应 | 安全链、CORS、请求包装、字符集、链路入口 |
| `HandlerInterceptor` | Spring MVC | 已匹配到 Spring MVC Handler 的执行链 | Handler 级鉴权补充、审计、耗时与上下文 |
| `ControllerAdvice` | Spring MVC | Controller 参数绑定、返回值和异常处理 | 统一异常、绑定配置、响应增强 |

认证和授权优先交给 Spring Security Filter Chain。拦截器可能因静态资源、错误分派、异步分派或路径配置而不执行，不适合作为唯一安全边界。

进入 `DispatcherServlet` 后，它还会准备请求级基础设施，例如本地化上下文，并在配置了 `MultipartResolver` 时解析 multipart 请求。上传大小限制或 multipart 解析失败可能发生在 Controller 被定位之前，此时异常处理链拿到的 handler 可以是 `null`。

## 二、HandlerMapping：找到的不只是 Controller

`DispatcherServlet` 按顺序查询已注册的 `HandlerMapping`，直到得到一个 `HandlerExecutionChain`。它包含两部分：

- 真正的 handler，例如 `HandlerMethod`，其中记录 Controller Bean、Java 方法和方法元数据；
- 当前请求需要执行的 `HandlerInterceptor` 列表。

注解控制器通常由 `RequestMappingHandlerMapping` 匹配。它综合路径、HTTP 方法、请求参数、请求头、`consumes` 和 `produces` 等条件，而不是只按 URL 查一个 Map。

因此，下面三种失败含义不同：

| 现象 | 发生位置 | 排查重点 |
|---|---|---|
| 没有匹配 Handler | HandlerMapping | 路径、上下文路径、静态资源、控制器是否注册 |
| 路径存在但方法不支持 | 映射条件匹配 | HTTP Method 与 `@RequestMapping` 条件 |
| 方法执行前返回 400/415/406 | 参数或消息转换阶段 | 请求体格式、Content-Type、Accept、校验与转换器 |

不要把所有“没进 Controller”都归因于拦截器。先根据状态码和异常类型定位失败阶段。

## 三、HandlerAdapter：屏蔽处理器调用差异

映射得到 handler 后，`DispatcherServlet` 会寻找第一个 `supports(handler)` 的 `HandlerAdapter`。注解方法通常由 `RequestMappingHandlerAdapter` 执行。

对下面这个接口，真正发生的事情远多于一次 Java 反射：

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderQueryService orderQueryService;

    public OrderController(OrderQueryService orderQueryService) {
        this.orderQueryService = orderQueryService;
    }

    @GetMapping("/{orderId}")
    public ResponseEntity<OrderView> detail(
            @PathVariable Long orderId,
            @RequestHeader("X-Tenant-Id") Long tenantId) {
        // Controller 只做协议适配，业务查询和权限条件由应用服务负责
        OrderView order = orderQueryService.get(tenantId, orderId);
        return ResponseEntity.ok(order);
    }
}
```

`RequestMappingHandlerAdapter` 会为每个参数寻找合适的 `HandlerMethodArgumentResolver`：路径变量来自 URI 模板，请求头来自 Header，请求体可由 `HttpMessageConverter` 反序列化，复杂对象还可能经过数据绑定、类型转换和 Bean Validation。

参数解析是有序责任链。自定义解析器应只支持明确的注解或参数类型，避免用宽泛的 `supportsParameter` 抢走框架内置参数：

```java
public final class CurrentTenantArgumentResolver
        implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        // 同时限制注解和类型，避免误处理普通 Long 参数
        return parameter.hasParameterAnnotation(CurrentTenant.class)
                && parameter.getParameterType() == TenantId.class;
    }

    @Override
    public Object resolveArgument(MethodParameter parameter,
                                  ModelAndViewContainer container,
                                  NativeWebRequest request,
                                  WebDataBinderFactory binderFactory) {
        String rawTenantId = request.getHeader("X-Tenant-Id");
        if (rawTenantId == null) {
            throw new MissingRequestHeaderException(
                    "X-Tenant-Id", parameter);
        }
        // 这里只把已认证上下文转换为值对象，不在解析器中执行远程业务查询
        return new TenantId(Long.parseLong(rawTenantId));
    }
}
```

解析器不是认证器。租户 Header 必须与已经验证的身份绑定，不能因客户端传了一个 ID 就获得对应数据权限。

## 四、拦截器的真实时序

Handler 选定后，拦截器按注册顺序执行 `preHandle`。任意一个返回 `false`，后续拦截器和 Controller 都不会执行；已经成功执行过 `preHandle` 的拦截器仍会按逆序进入完成回调。

正常同步请求的顺序是：

```text
interceptor A.preHandle
interceptor B.preHandle
Controller
interceptor B.postHandle
interceptor A.postHandle
渲染或写回
interceptor B.afterCompletion
interceptor A.afterCompletion
```

有三个常被忽略的边界：

1. `postHandle` 只在 Handler 正常返回后执行；Controller 抛异常时不会进入这一步；
2. 对 `@ResponseBody` 接口，响应体可能已在 `HandlerAdapter` 内由返回值处理器写出，`postHandle` 不适合统一改 JSON；
3. `afterCompletion` 适合清理线程上下文和记录最终耗时，但响应可能已经提交，不能指望在这里改状态码。

异步请求启动后，原 Servlet 线程会退出，常规完成回调延后到异步再次分派完成。需要观察“并发处理开始”时点，应实现 `AsyncHandlerInterceptor`，并确保 MDC、租户上下文等在线程切换时显式传递和清理。

## 五、返回值在 REST 与页面渲染处分叉

Controller 返回后，`HandlerMethodReturnValueHandler` 决定如何解释结果。常见路径如下：

| 返回形态 | 主要处理方式 | 是否经过 ViewResolver |
|---|---|---|
| `@ResponseBody`、`@RestController` 返回对象 | `HttpMessageConverter` 按协商媒体类型序列化 | 否 |
| `ResponseEntity<T>` | 先应用状态码和 Header，再转换 Body | 否 |
| `String` 视图名、`ModelAndView` | 解析逻辑视图并渲染 Model | 是 |
| `ProblemDetail`、`ErrorResponse` | 生成标准错误响应体 | 否 |
| `Callable`、`DeferredResult` 等 | 启动异步处理，完成后再次分派 | 取决于最终值 |

`@RestController` 本质上组合了 `@Controller` 和 `@ResponseBody`。返回一个 `String` 时，它是响应正文，不是 JSP 或 Thymeleaf 视图名。

REST 写回还包含内容协商。客户端的 `Accept`、服务端声明的 `produces`、返回类型与已注册转换器共同决定最终媒体类型。出现 406 时应检查响应协商，出现 415 时应检查请求 `Content-Type` 与读取转换器。

## 六、异常不是绕过主链，而是进入解析链

请求映射、参数解析、Controller 执行或返回值处理抛出异常后，`DispatcherServlet` 会依次询问 `HandlerExceptionResolver`。Spring MVC 默认组合包括：

1. `ExceptionHandlerExceptionResolver`：处理 Controller 或 `@ControllerAdvice` 中的 `@ExceptionHandler`；
2. `ResponseStatusExceptionResolver`：处理 `@ResponseStatus` 和 `ResponseStatusException`；
3. `DefaultHandlerExceptionResolver`：把 Spring MVC 内置异常映射为相应 HTTP 状态。

解析器返回非空 `ModelAndView`，表示异常已被处理；若全部不能解析，异常继续抛给 Servlet 容器，后续可能进入容器错误页或 Spring Boot 的错误分派。

统一业务异常时，保持错误码、HTTP 状态和可观测字段稳定：

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(OrderNotFoundException.class)
    public ResponseEntity<ProblemDetail> handleOrderNotFound(
            OrderNotFoundException exception) {
        ProblemDetail detail = ProblemDetail.forStatus(404);
        detail.setTitle("订单不存在");
        detail.setDetail(exception.getMessage());
        // 对外只返回安全字段，内部堆栈由日志和 traceId 关联
        detail.setProperty("code", "ORDER_NOT_FOUND");
        return ResponseEntity.status(404).body(detail);
    }
}
```

不要用 `@ControllerAdvice` 捕获所有 `Exception` 后统一返回 HTTP 200。这样会破坏网关重试、客户端降级、监控告警和缓存语义。未知异常应记录完整堆栈并返回 5xx，业务可预期异常再映射为明确的 4xx。

## 七、一次 REST 请求的源码级主线

把关键方法压缩后，可以用下面的调用关系定位日志与断点：

```text
FrameworkServlet.service / doGet / doPost
  → processRequest
    → DispatcherServlet.doService
      → doDispatch
        → getHandler
        → getHandlerAdapter
        → HandlerExecutionChain.applyPreHandle
        → HandlerAdapter.handle
          → RequestMappingHandlerAdapter.invokeHandlerMethod
            → 参数解析、Controller 调用、返回值处理
        → HandlerExecutionChain.applyPostHandle
        → processDispatchResult
          → processHandlerException（异常时）
          → render（存在 ModelAndView 时）
        → HandlerExecutionChain.triggerAfterCompletion
```

`@ResponseBody` 请求通常在 `HandlerAdapter.handle` 内已经完成消息转换和响应写出，因此 `ModelAndView` 为空，后续不会再走视图渲染。这正是“前后端分离版本”与传统 JSP 版本最关键的分叉，而不是两套完全独立的 DispatcherServlet 流程。

## 八、工程排查清单

遇到请求异常时，按阶段收集证据：

1. Filter 入口记录 method、path、traceId，不记录 Token 和完整敏感正文；
2. HandlerMapping 后记录匹配到的 Handler 与模板路径，避免只记录原始 URI；
3. 参数绑定失败区分缺字段、类型转换、校验、消息不可读与媒体类型错误；
4. Controller 只记录业务关键 ID，不重复打印大对象；
5. 返回值阶段关注选中的媒体类型、转换器和响应是否已经提交；
6. 异常处理记录异常分类、最终 HTTP 状态、业务错误码与解析器；
7. `afterCompletion` 清理 MDC、租户和 ThreadLocal，异步路径也要覆盖；
8. 404 时先区分 MVC 无 Handler、静态资源失败和容器错误分派；
9. 需要改响应体时使用 `ResponseBodyAdvice`，不要依赖拦截器 `postHandle`；
10. 自定义映射、参数或返回值扩展后，确认顺序没有遮蔽框架默认策略。

## 总结

Spring MVC 的稳定性来自职责分离：`DispatcherServlet` 固定调度骨架，`HandlerMapping` 决定谁处理，`HandlerAdapter` 决定怎样调用，参数与返回值处理器完成 Java 对象和 HTTP 协议之间的转换，`HandlerExceptionResolver` 把失败重新收束为响应。

工程上最重要的是识别失败发生在哪一段：请求还在 Filter、没有匹配 Handler、参数转换失败、Controller 抛错、消息转换失败，还是视图渲染异常。只有把链路和时序分清，鉴权、日志、统一返回、异常治理与性能观测才能放在正确的扩展点上。

## 参考资料

- [Spring Framework 7.0.8：DispatcherServlet](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet.html)
- [Spring Framework 7.0.8：DispatcherServlet 处理顺序](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/sequence.html)
- [Spring Framework 7.0.8：DispatcherServlet 特殊 Bean 类型](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/special-bean-types.html)
- [Spring Framework 7.0.8：注解式 Controller 方法](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods.html)
- [Spring Framework 7.0.8：ResponseBody](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/responsebody.html)
- [Spring Framework 7.0.8 API：DispatcherServlet](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/servlet/DispatcherServlet.html)
