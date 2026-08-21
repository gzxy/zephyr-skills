#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  inferRequestIdFromCurrentBranch,
  isRequirementBranchForRequest,
  releaseBranchName,
  requirementBranchInfo,
  requirementSuffix,
} from "../scripts/common.mjs";

assert.equal(inferRequestIdFromCurrentBranch("feature/alice/1051440"), "1051440");
assert.equal(
  inferRequestIdFromCurrentBranch("feature/alice/guild/1051440"),
  "1051440",
);
for (const branch of [
  "fix/alice/1051440",
  "bugfix/alice/1051440",
  "feature/alice/1051440-hotfix2",
  "feature/alice/guild/1051440_v2",
  "feature/alice/other/guild/1051440",
  "master",
]) {
  assert.throws(
    () => inferRequestIdFromCurrentBranch(branch),
    /未提供需求 ID.*交付流程已退出/,
    `不应从当前分支推断需求 ID：${branch}`,
  );
}

const requestId = "1051440";
const validBranches = [
  "feature/alice/1051440",
  "feature/alice/1051440-hotfix2",
  "feature/alice/guild/1051440",
  "feature/alice/guild/1051440_v2",
  "fix/alice/1051440",
  "fix/alice/1051440-fix2",
  "fix/alice/guild/1051440",
  "fix/alice/guild/1051440.preview3",
  "bugfix/alice/1051440",
  "bugfix/alice/1051440-hotfix2",
  "bugfix/alice/guild/1051440",
  "bugfix/alice/guild/1051440.preview3",
];

for (const branch of validBranches) {
  assert.equal(
    isRequirementBranchForRequest(branch, requestId),
    true,
    `应匹配需求分支：${branch}`,
  );
}

const invalidBranches = [
  "feature/alice/10514401",
  "feature/alice/guild/10514401-fix",
  "bugfix/alice/10514401",
  "bugfix/alice/guild/10514401-fix",
  "feature/alice/other/guild/1051440",
  "feature/alice/1051440/extra",
  "chore/alice/1051440",
];

for (const branch of invalidBranches) {
  assert.equal(
    isRequirementBranchForRequest(branch, requestId),
    false,
    `不应匹配需求分支：${branch}`,
  );
}

assert.deepEqual(requirementBranchInfo("fix/alice/guild/1051440-v2", requestId), {
  prefix: "fix",
  username: "alice",
  shorthand: "guild",
  requestId,
  trailing: "-v2",
});
assert.deepEqual(
  requirementBranchInfo("bugfix/alice/guild/1051440-v2", requestId),
  {
    prefix: "bugfix",
    username: "alice",
    shorthand: "guild",
    requestId,
    trailing: "-v2",
  },
);
assert.equal(
  requirementSuffix("bugfix/alice/guild/1051440-v2", requestId),
  "alice/guild/1051440-v2",
);
assert.equal(
  releaseBranchName(
    "bugfix/alice/guild/1051440-v2",
    requestId,
    new Date(2026, 7, 19),
  ),
  "release/alice/20260819/1051440",
);

console.log("需求分支解析回归测试通过。");
