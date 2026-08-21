# Cursor Bot 评论模式

此模式先评估远程 review 反馈，再决定是否修改代码。

## 收集评论

1. 验证用户提供的是 GitHub Pull Request URL。
2. 检查 `gh auth status`。如果没有认证，停止并提供最简洁的 `gh auth login` 配置说明；不要在对话中索要 token。
3. 获取 PR 元数据和所有相关评论渠道，优先使用：

   ```bash
   gh pr view <PR-URL> --json number,title,headRefName,baseRefName,files,reviews,comments
   gh api --paginate repos/{owner}/{repo}/pulls/{number}/comments
   gh api --paginate repos/{owner}/{repo}/issues/{number}/comments
   ```

4. 只筛选作者登录名或显示身份明确属于 Cursor 或 Cursor Bug Bot 的评论，不要悄悄混入无关的人类或其他 Bot 反馈。
5. 检查评论引用的 diff hunk 和当前上下文代码。过期评论可能已经修复，应以 PR head 为准验证，不要直接接受评论结论。

## 评估与输出

对每条去重后的评论输出：

- 评论 URL 或稳定标识；
- 文件和行号；
- 用自己的话概括问题；
- 结论：**有效**、**部分有效**、**无效**或**已经解决**；
- 证据和可能影响；
- 具体修复方案与相关测试。

合并指向同一根因的重复评论，区分已确认问题和不确定建议。首次分析不得实施修复；最后请用户确认要应用哪些方案。获得明确确认后，只修改已批准范围，运行聚焦测试并总结变更。
