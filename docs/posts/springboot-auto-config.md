---
title: Spring Boot 自动装配原理
date: 2026-06-10
category: 后端开发
tags: [java, spring, boot]
excerpt: 深入浅出地解析 Spring Boot 自动装配的核心机制，理解 @EnableAutoConfiguration 的工作原理。
---

# Spring Boot 自动装配原理

Spring Boot 的自动装配（Auto-Configuration）是其最核心的特性之一，它让我们无需繁琐的 XML 配置就能快速搭建应用。

## 核心注解

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

`@SpringBootApplication` 是一个组合注解，包含了：

- `@SpringBootConfiguration` — 标识配置类
- `@EnableAutoConfiguration` — 开启自动装配
- `@ComponentScan` — 自动扫描组件

## 自动装配机制

`@EnableAutoConfiguration` 的核心是 `AutoConfigurationImportSelector`，它会：

1. 从 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` 文件中加载所有自动配置类
2. 根据 `@Conditional` 系列注解判断是否生效
3. 将符合条件的配置类注入到 Spring 容器中

## 条件注解

Spring Boot 提供了丰富的条件注解来控制自动配置的生效条件：

| 注解 | 作用 |
|------|------|
| `@ConditionalOnClass` | 类路径存在指定类时生效 |
| `@ConditionalOnMissingBean` | 容器中不存在指定 Bean 时生效 |
| `@ConditionalOnProperty` | 配置文件中存在指定属性时生效 |
| `@ConditionalOnWebApplication` | 当前是 Web 应用时生效 |

## 自定义 Starter

我们也可以编写自己的 Starter：

```java
@Configuration
@ConditionalOnClass(MyService.class)
@EnableConfigurationProperties(MyProperties.class)
public class MyAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public MyService myService(MyProperties properties) {
        return new MyService(properties);
    }
}
```

然后在 `META-INF/spring/` 下注册即可。

## 总结

Spring Boot 自动装配通过 SPI 机制加载配置类，配合条件注解实现按需装配，大大简化了 Spring 应用的搭建流程。
