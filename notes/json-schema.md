# json-schema

[[toc]]

JSON Schema 是一种基于 JSON 格式的声明性语言，用于描述和验证 JSON 数据的结构和约束。
它类似于数据库中的表结构定义或 XML 的 XSD（XML Schema Definition），但专门针对 JSON 数据设计。
以下是 JSON Schema 的核心概念和用途：

## 核心功能

​1. 数据验证：确保 JSON 数据符合预期的格式，例如：

    - 字段的类型（字符串、数字、布尔值等）
    - 必填字段（required）
    - 值的范围（最小值、最大值、正则表达式匹配等）
    - 数组元素的约束（长度、唯一性等）

2. ​ 文档化：作为数据结构的文档，明确字段含义和规则，便于团队协作。
3. ​ 自动化支持:许多工具支持通过 JSON Schema 生成代码、表单或测试用例。

## 基本结构

JSON Schema 本身也是一个 JSON 对象，通过关键字（Keywords）定义规则。例如：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1
    },
    "age": {
      "type": "integer",
      "minimum": 0
    },
    "email": {
      "type": "string",
      "format": "email"
    }
  },
  "required": ["name", "age"]
}
```

$schema: 指定使用的 JSON Schema 版本。它告诉验证器（Validator）应该使用哪个版本的规则来解析和校验数据。
type: 定义数据类型（如 object, array, string 等）。
properties: 对象的字段及其规则。
required: 必填字段列表。

## 使用场景

### 定制配置文件的格式

1. 定义 JSON Schema 数据格式

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1
    },
    "age": {
      "type": "integer",
      "minimum": 0
    },
    "email": {
      "type": "string",
      "format": "email"
    }
  },
  "required": ["name", "age"]
}
```
