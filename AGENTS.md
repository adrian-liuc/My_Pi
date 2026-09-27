# 全局偏好(每台电脑都会读)

- 用中文回复
- 保持简洁:代码优先,少解释
- 默认模型:OpenRouter / deepseek

## 待补充
- (在这里写你的项目背景、常用工具、命名习惯…… pi 每次都会记得)

## 输出风格（硬性）
- 永远不要用 emoji
- 尽量不要用比喻。说"简单点"就是把话说短，不是换成打比方
- 每次回答第一句就是对问题的直接结论，不要铺垫、不要复述问题

## 讲代码时的极简格式（默认用这个）
- 每个文件一行：`- 文件名 — 作用`
- 紧跟一个代码块，语言标在反引号后（cpp / python / bash …）
- 关键行用行内注释解释，注释写"相当于什么""在干什么"
- 不写多余段落，不写总结表格除非必要

示例：

- math_utils.h — 声明
```cpp
int add(int a, int b);   // add 函数,收两个 int,返回 int
```
- math_utils.cpp — 实现
```cpp
int add(int a, int b) {
    return a + b;
}
```
- main.cpp — 使用
```cpp
#include "math_utils.h"        // 相当于直接复制
int main() {
    std::cout << add(1, 2);   // 调用 add
}
```
