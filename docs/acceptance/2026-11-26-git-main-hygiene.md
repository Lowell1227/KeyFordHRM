# 2026-11-26 主线与分支整理

用户要求发布本批修复、清理分支并保持main干净。只处理经核实的引用；不删除工作区、不清理stash、不覆盖未提交文件，不合入未经评审的独立开发线。

- 现场远端main为`4bb2a4cf`，包含当日月度试用期周期和手选试用员工调整。本批分支已非破坏性合入该提交，无文件冲突。
- 原本地main在`unified-company-directory/HRM`，停在`54567a82`且有6项未提交的历史人才删除相关改动。已原样切至`codex/preserve-main-wip-20261126`，含暂存、未暂存及未跟踪文件的SHA-256汇总前后相同：`B47D006CC0D6996F1A030AAC6A710AF805F4CEB890C245AE43D83145D53C6A56`。没有提交其内容。
- 仅在main不再被工作树占用且确认祖先关系后，用本地fast-forward fetch将main推进到当时远端`4bb2a4cf`；不使用reset、强制推送或工作树清理。
- 已用`git branch -d`删除8条已完全并入远端main且不被任何注册worktree占用的本地分支：`archive-maintenance-markers`、`confirmation-all-companies-20261126`、`cycle-scope-clarity`、`fix-cycle-v5-participants`、`goal-change-entry-flow`、`ia-align-20261122`、`rec-accept-20261122`、`recruitment-usability`（均为`codex/`前缀）。这些对应远端分支均不存在，没有远端分支删除。
- 在用工作树、两条保留WIP分支及仍有独立提交的旧分支全部保留。`a0fb`的未经评审招聘提交`6d54cd4`仍不合入。
- 本批验证与发布完成后，再将已验证源码fast-forward同步远端main、本地main，切换本次干净工作树到main并删除已合并的本批开发引用；未完成前不声称已统一主线或已上线。
