---
title: Java 防 SQL 注入工程实践：参数化查询、动态 SQL 白名单与边界治理
date: 2026-09-05
category: 后端开发
cover: /images/posts/java-sql-injection-prevention-engineering-knowledge-map.webp
tags: [java, mysql, sql-injection, jdbc, mybatis, application-security]
excerpt: 防 SQL 注入的核心不是过滤引号，而是让 SQL 结构由代码固定、让外部输入只作为参数值绑定；表名、列名和排序方向等无法参数化的位置必须映射到代码白名单，再用最小权限、审计与测试收紧失守后的影响范围。
---

# Java 防 SQL 注入工程实践：参数化查询、动态 SQL 白名单与边界治理

<img src="/images/posts/java-sql-injection-prevention-engineering-knowledge-map.webp" alt="Java 防 SQL 注入工程实践：参数化查询、动态 SQL 白名单与边界治理知识串联图" style="border-radius: 10px;" />

防 SQL 注入的核心不是过滤引号，而是让 SQL 结构由代码固定、让外部输入只作为参数值绑定；表名、列名和排序方向等无法参数化的位置必须映射到代码白名单，再用最小权限、审计与测试收紧失守后的影响范围。

## 先说结论：把“语句”和“数据”彻底分开

SQL 注入出现的根因不是用户输入中有单引号，而是外部输入被拼进 SQL 文本后，数据库把其中一部分重新解释成关键字、运算符、注释或额外语句。

生产代码可以按下面的顺序治理：

1. 值一律使用 JDBC `PreparedStatement`、Spring `JdbcTemplate` 占位符或 MyBatis `#{}` 绑定；
2. 表名、列名、排序方向等不能绑定的位置，由业务枚举映射为代码常量；
3. 动态条件用查询构造器、MyBatis 动态标签或受控分支生成，不拼接原始请求值；
4. 数据库账号只授予当前服务需要的库、表和操作权限；
5. 对原生 SQL 出口、异常日志和高风险查询建立代码审查、测试与监控。

以下内容以 **Java SE 25 JDBC API、MySQL 8.4、MyBatis 3 当前官方文档**与 OWASP SQL Injection Prevention Cheat Sheet 为事实基线，核对日期为 **2026-09-05**。MySQL 官方明确说明，占位符只能放在数据值位置，不能替代关键字或标识符；因此“所有输入都改成 `?`”并不能覆盖动态表名、列名与排序方向。

## 一、注入发生在 SQL 结构被输入改变时

下面的登录查询即使限制了用户名长度，仍然把输入送进了 SQL 语法层：

```java
String sql = "SELECT id FROM user_account "
        + "WHERE username = '" + username + "' "
        + "AND password_hash = '" + passwordHash + "'";

try (Statement statement = connection.createStatement();
     ResultSet resultSet = statement.executeQuery(sql)) {
    // 危险：输入可能闭合字符串、添加条件或注释后续 SQL。
}
```

黑名单很难补救这段代码：不同数据库的注释、字符集、转义规则、函数和编码方式都可能绕过关键字过滤；把 `'` 替换成 `''` 也会把安全性绑定到数据库模式、驱动和上下文。OWASP 因此把“转义全部输入”列为强烈不推荐的主要防线，而把参数化查询列为首选。

真正的安全边界是：数据库先得到固定语句结构，再通过独立通道接收参数值。参数中即使包含引号或 SQL 片段，也只是一段数据。

## 二、JDBC：固定 SQL，再按真实类型绑定

使用 `PreparedStatement` 时，不要先拼接再 `prepareStatement()`；被准备的 SQL 本身必须固定：

```java
public Optional<UserAccount> findForLogin(
        Connection connection,
        String username,
        String passwordHash
) throws SQLException {
    String sql = """
            SELECT id, username, status
            FROM user_account
            WHERE username = ?
              AND password_hash = ?
              AND status = ?
            """;

    try (PreparedStatement statement = connection.prepareStatement(sql)) {
        // 按列的真实 SQL 类型绑定，避免隐式转换和语义漂移。
        statement.setString(1, username);
        statement.setString(2, passwordHash);
        statement.setString(3, "ACTIVE");

        try (ResultSet resultSet = statement.executeQuery()) {
            if (!resultSet.next()) {
                return Optional.empty();
            }
            return Optional.of(new UserAccount(
                    resultSet.getLong("id"),
                    resultSet.getString("username"),
                    resultSet.getString("status")
            ));
        }
    }
}
```

Java SE 25 的 [`PreparedStatement`](https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/PreparedStatement.html) 文档要求 setter 类型与目标 SQL 类型兼容。金额、时间和数字应分别使用 `setBigDecimal`、`setObject(..., SQLType)`、`setLong` 等合适方法，不要为了省事全部 `setString`。类型正确不仅减少隐式转换，也能避免索引失效和边界值语义不一致。

要注意三个误区：

- `connection.prepareStatement("..." + input)` 仍然是拼接，只是换了执行 API；
- 参数化保证输入不改变语法，不保证查询一定有业务权限；越权查询仍需鉴权；
- Prepared Statement 的首要安全价值是结构与数据分离，不要把“驱动是否启用服务端预编译”误当成防注入开关。

MySQL 8.4 的 [Prepared Statements](https://dev.mysql.com/doc/refman/8.4/en/sql-prepared-statements.html) 文档明确把带占位符的参数化作为防 SQL 注入能力；具体走客户端模拟还是二进制协议、是否缓存语句，会影响性能实现，但不应改变应用层禁止拼接外部值的规则。

## 三、MyBatis：`#{}` 绑定值，`${}` 直接替换文本

MyBatis 中最容易混淆的是两种占位语法：

```xml
<select id="findOrders" resultType="OrderRow">
  SELECT id, user_id, amount_cent, status, created_at
  FROM orders
  <where>
    user_id = #{userId}
    <if test="status != null">
      AND status = #{status}
    </if>
  </where>
  ORDER BY created_at DESC
  LIMIT #{limit}
</select>
```

[`#{}`](https://mybatis.org/mybatis-3/zh_CN/sqlmap-xml.html) 会生成 `PreparedStatement` 参数占位符并绑定值；`${}` 是字符串替换，内容会直接进入最终 SQL。只要 `${}` 接收请求参数，就必须按高风险代码处理。

动态查询应让标签决定“是否包含一段固定 SQL”，让 `#{}` 承载其中的数据：

```xml
<select id="searchOrders" resultType="OrderRow">
  SELECT id, user_id, amount_cent, status, created_at
  FROM orders
  <where>
    tenant_id = #{tenantId}
    <if test="statuses != null and !statuses.isEmpty()">
      AND status IN
      <foreach collection="statuses" item="status" open="(" separator="," close=")">
        #{status}
      </foreach>
    </if>
    <if test="createdAfter != null">
      AND created_at &gt;= #{createdAfter}
    </if>
  </where>
</select>
```

这里每个集合元素都对应一个绑定参数。空集合必须显式定义语义：忽略条件、直接返回空结果或拒绝请求，不能让生成器产出 `IN ()` 后再临时拼接兜底 SQL。

## 四、表名、列名和排序方向必须做白名单映射

占位符表示一个数据值，不能表示 `ORDER BY` 后的列名、`ASC`/`DESC`、表名或 SQL 关键字。MySQL 8.4 的 [`PREPARE`](https://dev.mysql.com/doc/refman/8.4/en/prepare.html) 文档明确限制参数标记只能出现在数据值位置。

这类需求不要把前端传来的 `sort=created_at desc` 直接拼入 SQL，而是先解析为领域枚举，再由代码映射：

```java
public enum OrderSort {
    CREATED_AT_DESC("created_at DESC"),
    CREATED_AT_ASC("created_at ASC"),
    AMOUNT_DESC("amount_cent DESC");

    private final String sqlFragment;

    OrderSort(String sqlFragment) {
        this.sqlFragment = sqlFragment;
    }

    public String sqlFragment() {
        return sqlFragment;
    }

    public static OrderSort fromApiValue(String value) {
        return switch (value) {
            case "newest" -> CREATED_AT_DESC;
            case "oldest" -> CREATED_AT_ASC;
            case "amount_desc" -> AMOUNT_DESC;
            default -> throw new IllegalArgumentException("不支持的排序方式");
        };
    }
}
```

```java
OrderSort sort = OrderSort.fromApiValue(request.sort());
String sql = """
        SELECT id, amount_cent, created_at
        FROM orders
        WHERE tenant_id = ?
        ORDER BY %s
        LIMIT ?
        """.formatted(sort.sqlFragment());
```

这里虽然仍有字符串组装，但进入 SQL 的片段只能来自编译进代码的常量，外部输入永远不会原样进入语句。白名单最好采用“API 值 → 完整安全片段”的映射，不要仅用正则允许字母、数字和下划线后就相信任意列名；合法标识符仍可能访问不该暴露的字段。

如果动态表名来自分表路由，也应由受控的分片编号映射生成，并在数据访问层封装。不要让 Controller 直接传递表名，更不要用 `${tableName}` 暴露通用查询接口。

## 五、参数化之后仍有四类业务风险

### 1. `LIKE` 通配符不是注入，但可能放大查询

`LIKE ?` 能阻止输入改变 SQL 结构，但 `%` 和 `_` 仍有通配语义。用户输入 `%` 可能触发大范围扫描，这属于查询语义和资源治理问题。

若产品要求“按字面包含”，应转义通配符并显式声明转义字符：

```java
static String escapeLikeLiteral(String input) {
    return input
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_");
}

String sql = "SELECT id, name FROM product WHERE name LIKE ? ESCAPE '\\\\' LIMIT ?";
statement.setString(1, "%" + escapeLikeLiteral(keyword) + "%");
statement.setInt(2, 100);
```

同时设置最短关键词、结果上限、超时和合适索引；安全参数化不能替代容量保护。

### 2. 存储过程和 ORM 不会自动安全

存储过程若在内部拼接并执行动态 SQL，仍然可能注入；JPA、MyBatis、jOOQ 等抽象层只在正确使用绑定参数或类型安全 DSL 时提供隔离。任何 `nativeQuery`、`${}`、`createNativeQuery`、`Statement` 和原生查询构造器都应进入安全审查清单。

### 3. 日志可能泄露敏感参数

排障时可以记录模板标识、执行耗时、返回行数和参数类型，但不要把密码、令牌、身份证号或完整查询参数写入日志。数据库异常也不应原样回传给客户端，否则表名、列名和 SQL 片段会帮助攻击者迭代输入。

### 4. 参数化不等于授权

攻击者即使不能注入，也可能修改 `tenantId` 查询其他租户。租户标识应从认证上下文获取，并在所有查询中强制加入；不要信任请求体中自报的租户或用户 ID。

## 六、用最小权限限制失守后的爆炸半径

OWASP 的 [SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html) 把最小权限列为纵深防御。数据库账号应按服务和职责拆分：

- 只读查询服务不授予 `INSERT`、`UPDATE`、`DELETE` 或 DDL 权限；
- 订单服务只访问自己的 schema 和必要表，不使用管理员账号；
- 报表查询可通过视图限制可见列与行；
- 运维迁移账号与应用运行账号分离，凭据独立轮换；
- 禁止应用账号获得创建用户、授权、文件读写等无关能力。

最小权限不能修复注入，但能阻止一个查询漏洞直接升级为全库修改、跨库读取或基础设施控制。

## 七、把防注入变成可检查的工程约束

仅靠开发者记忆很难长期守住边界，可以把规则落进交付流程：

1. 静态扫描字符串拼接后流入 `Statement.execute*`、原生查询和 MyBatis `${}` 的数据流；
2. 代码审查重点检查动态标识符、排序、批量条件和分表路由；
3. 集成测试传入引号、注释、布尔表达式、Unicode 边界和超长通配符，验证结果集与权限边界不变；
4. 数据库侧监控异常查询频率、全表扫描、超时、拒绝访问和高危语句；
5. 生产关闭面向客户端的 SQL 详情，保留内部可关联的错误编号与审计事件；
6. 定期核对运行账号授权，删除历史遗留权限。

安全测试不要只断言“请求返回 400”。更重要的是验证：数据库看到的语句结构没有变化、没有越权返回数据、没有执行额外语句、日志没有泄露敏感信息，并且异常流量不会拖垮连接池。

## 上线前检查表

- 所有普通值都通过参数占位符绑定，没有进入 SQL 字符串拼接；
- `PreparedStatement` 的 SQL 在绑定参数之前已经固定；
- MyBatis 默认使用 `#{}`，所有 `${}` 都有明确的常量来源和审查记录；
- 表名、列名、排序方向、函数名等动态结构来自代码白名单；
- `IN` 集合逐项绑定，并定义空集合与超大集合的处理；
- `LIKE` 明确“通配搜索”还是“字面搜索”，并有结果上限与超时；
- 租户和数据权限来自可信认证上下文，而非客户端自报；
- 应用数据库账号遵循最小权限，不使用管理员账号；
- SQL 与异常日志完成敏感字段脱敏；
- 原生 SQL 出口有静态扫描、集成测试和运行时监控。

防 SQL 注入没有神奇过滤器。可靠做法是让 SQL 结构只由代码和受控常量决定，让外部输入始终停留在数据通道；遇到无法绑定的结构位置，用业务枚举和白名单把开放输入收敛为有限选择。再叠加租户授权、最小权限、日志治理和自动化测试，才能把“某个查询写对了”升级为持续有效的工程防线。
